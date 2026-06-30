import { ensureSubscribed, getQuote } from "@/lib/sources/tvSocket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Real-time price stream (Server-Sent Events). The server already receives every
// TradingView tick on a shared WebSocket; this pushes those ticks to the browser
// the instant the in-memory price changes — no per-millisecond polling, just the
// real updates as fast as the market actually moves.
//
//   GET /api/quote/stream?symbols=NASDAQ:AAPL,TVC:GOLD
//   -> stream of:  data: {"quotes":{"NASDAQ:AAPL":{price,change,changePct}}}
const TICK_MS = 150; // how often we re-read the live cache (captures every tick)
const MAX_MS = 50_000; // bounded lifetime so it stays under serverless limits; the
//                        browser's EventSource auto-reconnects seamlessly.

export async function GET(req: Request) {
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.includes(":"));

  ensureSubscribed(symbols);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const last = new Map<string, number>();
      const startedAt = Date.now();

      const write = (s: string) => {
        if (!closed) controller.enqueue(encoder.encode(s));
      };

      const tick = () => {
        if (closed) return;
        const quotes: Record<string, { price: number; change: number; changePct: number }> = {};
        let changed = false;
        for (const sym of symbols) {
          const q = getQuote(sym);
          if (!q) continue;
          if (last.get(sym) !== q.price) {
            last.set(sym, q.price);
            changed = true;
          }
          const prev = q.price - q.change;
          quotes[sym] = {
            price: q.price,
            change: q.change,
            changePct: prev ? (q.change / prev) * 100 : 0,
          };
        }
        if (changed) write(`data: ${JSON.stringify({ quotes })}\n\n`);
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(loop);
        clearInterval(ka);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Push the current snapshot immediately, then stream changes.
      tick();
      const loop = setInterval(() => {
        tick();
        if (Date.now() - startedAt > MAX_MS) cleanup();
      }, TICK_MS);
      // Keep-alive comment so proxies don't drop an idle connection.
      const ka = setInterval(() => write(`: ka\n\n`), 15_000);

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
