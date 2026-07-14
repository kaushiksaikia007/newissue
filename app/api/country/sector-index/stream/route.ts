import { ensureSubscribed, subscribeTicks } from "@/lib/sources/tvSocket";
import { IN_SECTOR_INDICES, getSectorIndexList } from "@/lib/sectorIndices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Tick-by-tick SSE stream for the India sector indices. Every quote the
// TradingView websocket delivers is forwarded to the browser the moment it
// arrives (full float precision + ms timestamp); a full NSE snapshot
// (OHLC, 52W, P/E, breadth, …) is re-sent every minute.
//
// GET /api/country/sector-index/stream?code=IN
//   event: snapshot -> { sectors: [SectorIndexQuote…], asOf }
//   event: tick     -> { id, last, change, changePct, ts }
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  if (code !== "IN") {
    return new Response("sector index streaming is India-only for now", { status: 400 });
  }

  const bySymbol = new Map(IN_SECTOR_INDICES.map((d) => [d.tvSymbol, d]));
  // Previous closes from the NSE snapshot anchor each tick's change/changePct.
  const prevClose = new Map<string, number>();
  ensureSubscribed([...bySymbol.keys()]);

  const enc = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let refresh: ReturnType<typeof setInterval> | undefined;
  let unsub: () => void = () => {};
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client went away mid-write
        }
      };

      const snapshot = async () => {
        try {
          const list = await getSectorIndexList("IN");
          if (!list.sectors.length) return;
          for (const s of list.sectors) {
            if (s.previousClose > 0) prevClose.set(s.id, s.previousClose);
          }
          send("snapshot", list);
        } catch {
          /* ticks keep flowing; next refresh retries */
        }
      };
      await snapshot();

      unsub = subscribeTicks((symbol, q) => {
        const def = bySymbol.get(symbol);
        if (!def || q.price <= 0) return;
        const prev = prevClose.get(def.id) ?? q.price - q.change;
        const change = prev > 0 ? q.price - prev : q.change;
        send("tick", {
          id: def.id,
          last: q.price,
          change,
          changePct: prev > 0 ? (change / prev) * 100 : 0,
          ts: q.ts,
        });
      });

      // Comment-frame heartbeat keeps proxies from idling the connection out.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);
      refresh = setInterval(snapshot, 60_000);
    },
    cancel() {
      closed = true;
      unsub();
      if (heartbeat) clearInterval(heartbeat);
      if (refresh) clearInterval(refresh);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
