// Real-time spot gold via livepriceofgold.com's socket.io feed (the same stream
// their page uses). Maintains one shared connection, keeps the latest per-gram
// price in memory, and reconnects automatically.

import { OUNCE_TO_GRAM } from "../fred";

const URL =
  "wss://www.livepriceofgold.com/sio/p7012/socket.io/?EIO=4&transport=websocket";

let ws: WebSocket | null = null;
let latest: number | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  try {
    ws = new (WebSocket as unknown as {
      new (url: string, opts: { headers: Record<string, string> }): WebSocket;
    })(URL, {
      headers: {
        Origin: "https://www.livepriceofgold.com",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
  } catch {
    ws = new WebSocket(URL);
  }

  ws.addEventListener("message", (ev: MessageEvent) => {
    const d =
      typeof ev.data === "string"
        ? ev.data
        : Buffer.isBuffer(ev.data)
          ? ev.data.toString()
          : String(ev.data);
    if (d[0] === "0" && d[1] === "{") {
      ws?.send("40"); // engine.io open -> connect to default namespace
      return;
    }
    if (d === "2") {
      ws?.send("3"); // ping -> pong
      return;
    }
    if (d.startsWith("42")) {
      try {
        const arr = JSON.parse(d.slice(2));
        if (arr[0] === "update") {
          const p = typeof arr[1] === "string" ? JSON.parse(arr[1]) : arr[1];
          const oz = Number(p.XAUUSD);
          if (Number.isFinite(oz) && oz > 0) latest = oz / OUNCE_TO_GRAM;
        }
      } catch {
        /* ignore malformed frame */
      }
    }
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

/** Ensure the gold stream is connected. */
export function ensureGoldSocket(): void {
  connect();
}

/** Latest streamed spot gold (USD per gram), or null if not received yet. */
export function getGoldSocketPrice(): number | null {
  return latest;
}
