// Historical backfill — one year of daily data for the 13 NSE sector indices.
//
// A separate, standalone system from the live recorder (lib/recorder.ts):
// run it manually (or on a schedule) with
//
//   npm run backfill          — last year
//   node scripts/backfillSectorHistory.mjs 500   — last 500 trading days
//
// Bars come from the TradingView chart websocket (the same feed the live
// dashboard streams from; closes match NSE's official values). Output goes
// next to the live data, one CSV per index:
//
//   D:\Newissue Data\sector-indices-history\<id>.csv
//     trade_date,id,sector,index_name,nse_symbol,open,high,low,close,
//     prev_close,change,change_pct,volume
//
// Re-running UPDATES the files in place: existing rows are merged by date
// (fresh data wins), so the history extends day by day and never loses old
// dates that have fallen out of the fetch window.

import { promises as fs } from "fs";
import path from "path";

const ROOT = process.env.NEWISSUE_DATA_DIR || "D:\\Newissue Data";
const DATASET = "sector-indices-history";
const BARS = Math.max(30, Number(process.argv[2]) || 270); // ~1 trading year + change buffer
const WS_URL = "wss://data.tradingview.com/socket.io/websocket?type=chart";

/** Same sector→index universe as lib/sectorIndices.ts. */
const SECTORS = [
  { id: "banking", sector: "Banking", indexName: "NIFTY Bank", nseSymbol: "NIFTY BANK", tvSymbol: "NSE:BANKNIFTY" },
  { id: "it", sector: "IT", indexName: "NIFTY IT", nseSymbol: "NIFTY IT", tvSymbol: "NSE:CNXIT" },
  { id: "pharma", sector: "Pharma", indexName: "NIFTY Pharma", nseSymbol: "NIFTY PHARMA", tvSymbol: "NSE:CNXPHARMA" },
  { id: "auto", sector: "Auto", indexName: "NIFTY Auto", nseSymbol: "NIFTY AUTO", tvSymbol: "NSE:CNXAUTO" },
  { id: "fmcg", sector: "FMCG", indexName: "NIFTY FMCG", nseSymbol: "NIFTY FMCG", tvSymbol: "NSE:CNXFMCG" },
  { id: "financial-services", sector: "Financial Services", indexName: "NIFTY Financial Services", nseSymbol: "NIFTY FIN SERVICE", tvSymbol: "NSE:CNXFINANCE" },
  { id: "realty", sector: "Realty", indexName: "NIFTY Realty", nseSymbol: "NIFTY REALTY", tvSymbol: "NSE:CNXREALTY" },
  { id: "psu-banks", sector: "PSU Banks", indexName: "NIFTY PSU Bank", nseSymbol: "NIFTY PSU BANK", tvSymbol: "NSE:CNXPSUBANK" },
  { id: "metal", sector: "Metal", indexName: "NIFTY Metal", nseSymbol: "NIFTY METAL", tvSymbol: "NSE:CNXMETAL" },
  { id: "media", sector: "Media", indexName: "NIFTY Media", nseSymbol: "NIFTY MEDIA", tvSymbol: "NSE:CNXMEDIA" },
  { id: "oil-gas", sector: "Oil & Gas", indexName: "NIFTY Oil & Gas", nseSymbol: "NIFTY OIL AND GAS", tvSymbol: "NSE:NIFTY_OIL_AND_GAS" },
  { id: "healthcare", sector: "Healthcare", indexName: "NIFTY Healthcare", nseSymbol: "NIFTY HEALTHCARE", tvSymbol: "NSE:NIFTY_HEALTHCARE" },
  { id: "consumer-durables", sector: "Consumer Durables", indexName: "NIFTY Consumer Durables", nseSymbol: "NIFTY CONSR DURBL", tvSymbol: "NSE:NIFTY_CONSR_DURBL" },
];

const HEADER = [
  "trade_date", "id", "sector", "index_name", "nse_symbol",
  "open", "high", "low", "close", "prev_close", "change", "change_pct", "volume",
];

/* --------------------- TradingView chart websocket ----------------------- */

const framed = (p) => `~m~${p.length}~m~${p}`;
const chartMsg = (m, p) => framed(JSON.stringify({ m, p }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { Origin: "https://www.tradingview.com" } });
    const t = setTimeout(() => reject(new Error("websocket connect timeout")), 15000);
    ws.onopen = () => {
      clearTimeout(t);
      ws.send(chartMsg("set_auth_token", ["unauthorized_user_token"]));
      resolve(ws);
    };
    ws.onerror = (e) => { clearTimeout(t); reject(new Error(`websocket error: ${e?.message ?? e}`)); };
  });
}

/** Daily bars [{date, o, h, l, c, v}] for one symbol on a shared socket. */
function fetchBars(ws, symbol, bars) {
  return new Promise((resolve, reject) => {
    const cs = "cs_" + Math.random().toString(36).slice(2, 12);
    let out = null;
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`${symbol}: timeout`)); }, 25000);

    const onMessage = (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString();
      for (const part of raw.split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith("~h~")) { ws.send(framed(part)); continue; }
        let m; try { m = JSON.parse(part); } catch { continue; }
        if (!Array.isArray(m.p) || m.p[0] !== cs) continue;
        if (m.m === "timescale_update" && m.p[1]?.s1?.s) {
          out = m.p[1].s1.s.map((b) => {
            const [ts, o, h, l, c, v] = b.v;
            return { date: new Date(ts * 1000).toISOString().slice(0, 10), o, h, l, c, v: v ?? null };
          });
        } else if (m.m === "series_completed" && out) {
          cleanup();
          resolve(out);
        } else if (m.m === "symbol_error" || m.m === "critical_error") {
          cleanup();
          reject(new Error(`${symbol}: ${m.m}`));
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      ws.send(chartMsg("chart_delete_session", [cs]));
    };

    ws.addEventListener("message", onMessage);
    ws.send(chartMsg("chart_create_session", [cs, ""]));
    ws.send(chartMsg("resolve_symbol", [cs, "sym1", "=" + JSON.stringify({ symbol, adjustment: "splits" })]));
    ws.send(chartMsg("create_series", [cs, "s1", "s1", "sym1", "1D", bars, ""]));
  });
}

/* ------------------------------- CSV merge -------------------------------- */

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Existing rows keyed by trade_date (raw line kept as-is for stability). */
async function readExisting(file) {
  const rows = new Map();
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
      const date = line.slice(0, line.indexOf(","));
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) rows.set(date, line);
    }
  } catch {
    /* first run */
  }
  return rows;
}

async function writeIndexCsv(def, bars) {
  const dir = path.join(ROOT, DATASET);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${def.id}.csv`);

  const rows = await readExisting(file);
  // First fetched bar has no predecessor for prev_close — used only as anchor.
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1].c;
    const change = b.c - prev;
    const line = [
      b.date, def.id, def.sector, def.indexName, def.nseSymbol,
      b.o, b.h, b.l, b.c, prev, change, prev ? (change / prev) * 100 : "", b.v,
    ].map(csvCell).join(",");
    rows.set(b.date, line); // fresh data wins over an existing row
  }

  const sorted = [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, l]) => l);
  await fs.writeFile(file, "﻿" + HEADER.join(",") + "\r\n" + sorted.join("\r\n") + "\r\n", "utf8");
  return sorted.length;
}

/* ---------------------------------- Main ---------------------------------- */

console.log(`backfill: ${SECTORS.length} indices × ${BARS} daily bars -> ${path.join(ROOT, DATASET)}`);
const ws = await connect();
let failed = 0;

for (const def of SECTORS) {
  try {
    const bars = await fetchBars(ws, def.tvSymbol, BARS);
    const total = await writeIndexCsv(def, bars);
    console.log(`  ${def.id.padEnd(20)} ${bars.length - 1} bars fetched (${bars[1]?.date} … ${bars[bars.length - 1]?.date}) — file now ${total} rows`);
  } catch (e) {
    failed++;
    console.error(`  ${def.id.padEnd(20)} FAILED: ${e.message}`);
  }
  await sleep(300); // gentle pacing between series requests
}

ws.close();
console.log(failed ? `done with ${failed} failure(s) — rerun to retry` : "done — all indices backfilled");
process.exit(failed ? 1 : 0);
