import { promises as fs } from "fs";
import path from "path";
import { getSectorIndexList, IN_SECTOR_INDICES } from "./sectorIndices";
import { searchNews } from "./sources/news";
import { getFiiDii } from "./sources/nseFiiDii";
import { getIndicators } from "./macroData";
import { getRiskRadar } from "./riskData";
import { getUpcomingEvents } from "./eventsData";

/**
 * Local CSV data recorder — persists every live feed to disk so the data can
 * be analysed later. Layout (one subfolder per dataset, one file per day):
 *
 *   <ROOT>\
 *     sector-indices\YYYY-MM-DD.csv   13 NSE sector indices, snapshot every
 *                                     5 min during market hours (09:15-15:35
 *                                     IST) — full quote per row
 *     sector-news\YYYY-MM-DD.csv      per-sector headlines, checked every
 *                                     30 min (08:00-22:00 IST), deduped by link
 *     macro\YYYY-MM-DD.csv            India live macro indicators
 *     risk\YYYY-MM-DD.csv             India risk radar (axes + components)
 *     events\YYYY-MM-DD.csv           upcoming India events
 *     fii-dii\YYYY-MM-DD.csv          FII/FPI & DII cash-market activity
 *
 * The daily bundle (macro/risk/events/fii-dii) is captured once at server
 * start if today's files are missing, and refreshed at 18:00 IST (after the
 * close, when FII/DII figures are published). Every row carries its capture
 * timestamp, so multiple captures per day stay distinguishable — take the
 * last capture of a day for EOD values.
 *
 * Started once per server via instrumentation.ts; all failures are logged
 * and swallowed so recording can never take the app down.
 */

const ROOT = process.env.NEWISSUE_DATA_DIR || "D:\\Newissue Data";
const TAG = "[recorder]";

/* ------------------------------- IST clock ------------------------------- */

interface IstNow {
  date: string; // "2026-07-14"
  hm: number; // minutes since midnight IST
  weekday: number; // 0 Sun … 6 Sat
  stamp: string; // "2026-07-14 14:05:31 IST"
}

function istNow(): IstNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date,
    hm: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: wd,
    stamp: `${date} ${get("hour")}:${get("minute")}:${get("second")} IST`,
  };
}

const inMarketHours = (t: IstNow) =>
  t.weekday >= 1 && t.weekday <= 5 && t.hm >= 9 * 60 + 15 && t.hm <= 15 * 60 + 35;

/* -------------------------------- CSV I/O -------------------------------- */

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rows that couldn't be written (file locked by Excel/AV/sync) — retried by
 *  flushPending every scheduler tick until the lock clears. Capped per file. */
const pendingRows = new Map<string, { header: string[]; rows: unknown[][] }>();
const PENDING_CAP = 10_000;

/** Retry buffered rows (quietly — the original failure was already logged). */
async function flushPending(): Promise<void> {
  for (const [key, { header }] of [...pendingRows]) {
    const slash = key.indexOf("/");
    try {
      await appendCsv(key.slice(0, slash), key.slice(slash + 1), header, []);
    } catch {
      /* still locked — keep buffering */
    }
  }
}

const isLockErr = (e: unknown) =>
  typeof e === "object" && e != null && "code" in e &&
  ["EBUSY", "EPERM", "EACCES", "EMFILE"].includes(String((e as { code: unknown }).code));

/** Append rows to <ROOT>/<dataset>/<date>.csv, writing the header (and a BOM
 *  for Excel) when the file is created. Retries briefly when the file is
 *  locked (e.g. open in Excel) and buffers the rows for the next capture if
 *  the lock persists. */
async function appendCsv(
  dataset: string,
  date: string,
  header: string[],
  rows: unknown[][],
): Promise<void> {
  const key = `${dataset}/${date}`;
  const all = [...(pendingRows.get(key)?.rows ?? []), ...rows];
  if (!all.length) return;

  const dir = path.join(ROOT, dataset);
  const file = path.join(dir, `${date}.csv`);
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const exists = await fs
        .access(file)
        .then(() => true)
        .catch(() => false);
      const lines = all.map((r) => r.map(csvCell).join(","));
      const body = (exists ? "" : "﻿" + header.join(",") + "\r\n") + lines.join("\r\n") + "\r\n";
      await fs.appendFile(file, body, "utf8");
      pendingRows.delete(key);
      return;
    } catch (e) {
      if (isLockErr(e) && attempt < 2) {
        await sleep(1500);
        continue;
      }
      // Keep the rows for the next flush attempt, then surface the error so
      // runSafe logs it.
      pendingRows.set(key, { header, rows: all.slice(-PENDING_CAP) });
      throw e;
    }
  }
}

const fileExists = (dataset: string, date: string) =>
  fs
    .access(path.join(ROOT, dataset, `${date}.csv`))
    .then(() => true)
    .catch(() => false);

/* ----------------------------- Dataset writers --------------------------- */

async function captureSectorIndices(t: IstNow): Promise<void> {
  const list = await getSectorIndexList("IN");
  if (!list.sectors.length) return;
  await appendCsv(
    "sector-indices",
    t.date,
    ["captured_at_ist", "captured_at_utc", "id", "sector", "index_name", "nse_symbol",
     "last", "change", "change_pct", "open", "high", "low", "previous_close",
     "year_high", "year_low", "pe", "pb", "div_yield",
     "advances", "declines", "unchanged", "perf_1w_pct", "perf_30d_pct", "perf_365d_pct", "live_tick"],
    list.sectors.map((s) => [
      t.stamp, new Date().toISOString(), s.id, s.sector, s.indexName, s.nseSymbol,
      s.last, s.change, s.changePct, s.open, s.high, s.low, s.previousClose,
      s.yearHigh, s.yearLow, s.pe, s.pb, s.divYield,
      s.advances, s.declines, s.unchanged, s.perChange1w, s.perChange30d, s.perChange365d, s.live,
    ]),
  );
}

/**
 * Official end-of-day record — one row per index per trading day, captured at
 * 15:45 IST once NSE's closing values have settled (close auction ends after
 * 15:30). Skipped when every index shows zero change, which only happens when
 * the exchange was shut (holiday) and the feed is still serving the previous
 * session's close.
 */
async function captureSectorEod(t: IstNow): Promise<void> {
  const list = await getSectorIndexList("IN");
  if (!list.sectors.length) return;
  if (list.sectors.every((s) => s.change === 0)) return; // NSE holiday
  await appendCsv(
    "sector-indices-eod",
    t.date,
    ["trade_date", "captured_at_ist", "id", "sector", "index_name", "nse_symbol",
     "close", "change", "change_pct", "open", "high", "low", "previous_close",
     "year_high", "year_low", "pe", "pb", "div_yield",
     "advances", "declines", "unchanged", "perf_1w_pct", "perf_30d_pct", "perf_365d_pct"],
    list.sectors.map((s) => [
      t.date, t.stamp, s.id, s.sector, s.indexName, s.nseSymbol,
      s.last, s.change, s.changePct, s.open, s.high, s.low, s.previousClose,
      s.yearHigh, s.yearLow, s.pe, s.pb, s.divYield,
      s.advances, s.declines, s.unchanged, s.perChange1w, s.perChange30d, s.perChange365d,
    ]),
  );
  console.log(`${TAG} EOD close captured for ${t.date}`);
}

/** Links already saved today, so the news file stays deduped across captures. */
let newsSeenDate = "";
const newsSeen = new Set<string>();

async function captureSectorNews(t: IstNow): Promise<void> {
  if (t.date !== newsSeenDate) {
    newsSeen.clear();
    newsSeenDate = t.date;
    // Warm the dedupe set from an existing file (e.g. after a server restart).
    try {
      const raw = await fs.readFile(path.join(ROOT, "sector-news", `${t.date}.csv`), "utf8");
      for (const m of raw.matchAll(/https?:\/\/\S+?(?=[",\r\n])/g)) newsSeen.add(m[0]);
    } catch {
      /* first capture of the day */
    }
  }

  const rows: unknown[][] = [];
  for (const def of IN_SECTOR_INDICES) {
    const items = await searchNews(`sector:${def.id}`, def.newsQuery, "IN");
    for (const n of items) {
      const key = n.link || n.title;
      if (newsSeen.has(key)) continue;
      newsSeen.add(key);
      rows.push([t.stamp, def.id, def.sector, def.indexName, n.title, n.source, n.publishedAt, n.link]);
    }
  }
  await appendCsv(
    "sector-news",
    t.date,
    ["captured_at_ist", "sector_id", "sector", "index_name", "title", "source", "published_at", "link"],
    rows,
  );
}

const IN_MACRO_KEYS = [
  "gdp", "inflation", "policy", "fx", "yield", "deficit", "reserves",
  "account", "vix", "indexpe", "indexpb", "marketcap",
];

async function captureMacro(t: IstNow): Promise<void> {
  const ind = await getIndicators("IN", "India", IN_MACRO_KEYS);
  const rows = Object.entries(ind).map(([key, v]) => [
    t.stamp, key, v.value, v.unit, v.changePct, v.yoyPct, v.detail ?? "", v.source, v.asOf,
  ]);
  await appendCsv(
    "macro",
    t.date,
    ["captured_at_ist", "indicator", "value", "unit", "change_pct", "yoy_pct", "detail", "source", "source_as_of"],
    rows,
  );
}

async function captureRisk(t: IstNow): Promise<void> {
  const radar = await getRiskRadar("IN", "India");
  const rows: unknown[][] = [];
  for (const axis of radar.axes) {
    rows.push([t.stamp, axis.label, "axis", "", axis.score, "", axis.missing.join("; ")]);
    for (const c of axis.components) {
      rows.push([t.stamp, axis.label, "component", c.label, c.score, c.weight, ""]);
    }
  }
  await appendCsv(
    "risk",
    t.date,
    ["captured_at_ist", "axis", "row_type", "component", "score", "weight", "missing_inputs"],
    rows,
  );
}

async function captureEvents(t: IstNow): Promise<void> {
  const data = await getUpcomingEvents("IN");
  await appendCsv(
    "events",
    t.date,
    ["captured_at_ist", "title", "event_date", "impact", "source", "source_url"],
    data.events.map((e) => [t.stamp, e.title, e.date, e.impact, e.source, e.sourceUrl]),
  );
}

async function captureFiiDii(t: IstNow): Promise<void> {
  const data = await getFiiDii();
  if (!data) return;
  await appendCsv(
    "fii-dii",
    t.date,
    ["captured_at_ist", "category", "trade_date", "buy_value_cr", "sell_value_cr", "net_value_cr"],
    data.rows.map((r) => [t.stamp, r.category, r.date, r.buyValue, r.sellValue, r.netValue]),
  );
}

/* ------------------------------- Scheduler ------------------------------- */

const DAILY_SETS = ["macro", "risk", "events", "fii-dii"] as const;

async function runSafe(name: string, job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (e) {
    console.error(`${TAG} ${name} failed:`, e instanceof Error ? e.message : e);
  }
}

async function dailyBundle(t: IstNow): Promise<void> {
  await runSafe("macro", () => captureMacro(t));
  await runSafe("risk", () => captureRisk(t));
  await runSafe("events", () => captureEvents(t));
  await runSafe("fii-dii", () => captureFiiDii(t));
  console.log(`${TAG} daily bundle captured for ${t.date}`);
}

const README = `Newissue Data — live market data recorded by Gold Bot
=======================================================

One subfolder per dataset, one CSV per day (YYYY-MM-DD.csv), UTF-8.
Every row carries its capture timestamp (IST); when a dataset is captured
more than once a day, take the latest capture for end-of-day values.

sector-indices\\  13 NSE sectoral indices (NIFTY Bank, IT, Pharma, ...).
                 Snapshot every 5 minutes during market hours (Mon-Fri
                 09:15-15:35 IST). Source: NSE allIndices + TradingView live.
sector-indices-eod\\  Official closing values - one row per index per trading
                 day, captured automatically at 15:45 IST after the close
                 settles (or at next server start the same evening).
sector-indices-history\\  One CSV per index with a year+ of daily OHLCV
                 history (backfill system: "npm run backfill" in Gold Bot;
                 re-running merges by date, so history only ever grows).
sector-news\\     Headlines per sector, checked every 30 minutes
                 (08:00-22:00 IST), deduplicated by link within the day.
                 Source: Google News RSS (India).
macro\\           India live macro indicators (GDP, CPI, repo rate, INR, ...).
risk\\            India risk radar - 5 axes with their weighted components.
events\\          Upcoming market-moving events for India.
fii-dii\\         FII/FPI & DII cash-market buy/sell/net (Rs crore, NSE).

The recorder runs inside the Gold Bot server (lib/recorder.ts) - data is
collected only while the app is running.

IMPORTANT: do not keep TODAY's files open in Excel while data is being
recorded - Excel locks the file and blocks new rows. The recorder buffers
locked-out rows in memory and writes them once the file is closed, but a
server restart while locked loses the buffer. To inspect live data, copy
the file first (or open past days freely - they are no longer written to).
`;

let lastSectorCapture = 0;
let lastNewsCapture = 0;
let lastDailyDate = ""; // date whose 18:00 IST refresh already ran
let lastEodDate = ""; // date whose market-close capture already ran

/** After the close on a weekday and not yet recorded → capture the EOD file.
 *  fileExists guards double-writes across restarts; the holiday check inside
 *  captureSectorEod guards non-trading weekdays. */
async function maybeCaptureEod(t: IstNow): Promise<void> {
  if (t.weekday < 1 || t.weekday > 5) return;
  if (t.hm < 15 * 60 + 45 || lastEodDate === t.date) return;
  lastEodDate = t.date;
  if (await fileExists("sector-indices-eod", t.date)) return;
  await runSafe("sector-indices-eod", () => captureSectorEod(t));
}

async function tick(): Promise<void> {
  const t = istNow();
  const nowMs = Date.now();

  // Rows blocked earlier by a file lock — retry until they land.
  await flushPending();

  // Sector indices — every 5 min during market hours.
  if (inMarketHours(t) && nowMs - lastSectorCapture >= 5 * 60_000 - 5_000) {
    lastSectorCapture = nowMs;
    await runSafe("sector-indices", () => captureSectorIndices(t));
  }

  // Official close — once, after the market closes.
  await maybeCaptureEod(t);

  // Sector news — every 30 min, 08:00-22:00 IST.
  if (t.hm >= 8 * 60 && t.hm <= 22 * 60 && nowMs - lastNewsCapture >= 30 * 60_000 - 5_000) {
    lastNewsCapture = nowMs;
    await runSafe("sector-news", () => captureSectorNews(t));
  }

  // Daily bundle — 18:00 IST refresh (once per date).
  if (t.hm >= 18 * 60 && lastDailyDate !== t.date) {
    lastDailyDate = t.date;
    await dailyBundle(t);
  }
}

/** Start the recorder loops (idempotent — survives dev hot reloads). */
export function startRecorder(): void {
  const g = globalThis as { __newissueRecorder?: boolean };
  if (g.__newissueRecorder) return;
  g.__newissueRecorder = true;

  console.log(`${TAG} starting — writing CSVs under ${ROOT}`);

  void (async () => {
    // Make the layout self-describing.
    await runSafe("readme", async () => {
      await fs.mkdir(ROOT, { recursive: true });
      const file = path.join(ROOT, "README.txt");
      const exists = await fs.access(file).then(() => true).catch(() => false);
      if (!exists) await fs.writeFile(file, README, "utf8");
    });

    // Startup catch-up: capture any dataset that has no file yet today, so a
    // late server start still produces a daily record.
    const t = istNow();
    const missingDaily = (
      await Promise.all(DAILY_SETS.map(async (d) => ((await fileExists(d, t.date)) ? null : d)))
    ).filter(Boolean);
    if (missingDaily.length === DAILY_SETS.length) {
      await dailyBundle(t);
      if (t.hm >= 18 * 60) lastDailyDate = t.date; // already past the refresh slot
    }
    if (t.hm >= 8 * 60 && t.hm <= 22 * 60 && !(await fileExists("sector-news", t.date))) {
      lastNewsCapture = Date.now();
      await runSafe("sector-news", () => captureSectorNews(t));
    }
    if (inMarketHours(t)) {
      lastSectorCapture = Date.now();
      await runSafe("sector-indices", () => captureSectorIndices(t));
    }
    // Server started after the close — record today's official close if missed.
    await maybeCaptureEod(t);

    setInterval(() => void tick(), 60_000);
  })();
}
