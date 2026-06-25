// Real-time TradingView quote stream (the same feed their symbol pages use).
// Maintains one shared websocket, keeps the latest price/change per symbol in
// memory, and reconnects automatically. The REST scanner is only a fallback.

interface Quote {
  price: number;
  change: number;
  ts: number;
}

const WS_URL = "wss://data.tradingview.com/socket.io/websocket?type=chart";
const ORIGIN = "https://www.tradingview.com";

const quotes = new Map<string, Quote>();
const subscribed = new Set<string>();
const session = "qs_" + Math.random().toString(36).slice(2, 12);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function framed(payload: string): string {
  return `~m~${payload.length}~m~${payload}`;
}
function send(socket: WebSocket, m: string, p: unknown[]): void {
  socket.send(framed(JSON.stringify({ m, p })));
}

function connect(): void {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try {
    // Node's global WebSocket (undici) accepts a headers option; the DOM type
    // doesn't, hence the cast.
    ws = new (WebSocket as unknown as {
      new (url: string, opts: { headers: Record<string, string> }): WebSocket;
    })(WS_URL, { headers: { Origin: ORIGIN } });
  } catch {
    ws = new WebSocket(WS_URL);
  }

  ws.addEventListener("open", () => {
    if (!ws) return;
    send(ws, "set_auth_token", ["unauthorized_user_token"]);
    send(ws, "quote_create_session", [session]);
    send(ws, "quote_set_fields", [session, "lp", "ch", "chp"]);
    if (subscribed.size) {
      send(ws, "quote_add_symbols", [session, ...subscribed]);
    }
  });

  ws.addEventListener("message", (ev: MessageEvent) => {
    const raw =
      typeof ev.data === "string"
        ? ev.data
        : Buffer.isBuffer(ev.data)
          ? ev.data.toString()
          : String(ev.data);
    handle(raw);
  });

  ws.addEventListener("close", scheduleReconnect);
  ws.addEventListener("error", scheduleReconnect);
}

function scheduleReconnect(): void {
  ws = null;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

function handle(raw: string): void {
  const parts = raw.split(/~m~\d+~m~/).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("~h~")) {
      ws?.send(framed(part)); // heartbeat echo
      continue;
    }
    if (!part.startsWith("{")) continue;
    let msg: { m?: string; p?: unknown[] };
    try {
      msg = JSON.parse(part);
    } catch {
      continue;
    }
    if (msg.m !== "qsd" || !Array.isArray(msg.p)) continue;
    const item = msg.p[1] as { n?: string; v?: { lp?: number; ch?: number } };
    const sym = item?.n;
    const v = item?.v;
    if (!sym || !v) continue;
    const prev = quotes.get(sym);
    const price = typeof v.lp === "number" ? v.lp : prev?.price;
    if (price == null || Number.isNaN(price)) continue;
    const change = typeof v.ch === "number" ? v.ch : (prev?.change ?? 0);
    quotes.set(sym, { price, change, ts: Date.now() });
  }
}

/** Ensure the given symbols are streaming; connects lazily. */
export function ensureSubscribed(symbols: string[]): void {
  connect();
  const toAdd = symbols.filter((s) => !subscribed.has(s));
  for (const s of toAdd) subscribed.add(s);
  if (ws && ws.readyState === 1 && toAdd.length) {
    send(ws, "quote_add_symbols", [session, ...toAdd]);
  }
}

/** Latest streamed quote for a symbol, or null if not received yet. */
export function getQuote(symbol: string): Quote | null {
  return quotes.get(symbol) ?? null;
}
