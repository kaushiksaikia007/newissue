import { authCall } from "./auth";

// Server-side helper for the per-user watchlist. State lives in MySQL behind the
// PHP api.php (watch_* actions); this module forwards to it and resolves the
// signed-in user's email from their session so the browser never sends it.

const API = process.env.PAPER_API_URL || "";
const TOKEN = process.env.PAPER_API_TOKEN || "";

export interface WatchItem {
  id: string;
  symbol: string;
  display: string;
  exchange?: string | null;
  type?: string | null;
  currency?: string | null;
  target?: number | null;
  direction?: "above" | "below" | null;
  triggered?: number;
  createdAt?: number;
}

async function php(action: string, payload: Record<string, unknown>): Promise<unknown> {
  if (!API) return null;
  const url = `${API}?action=${action}&token=${encodeURIComponent(TOKEN)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, action, ...payload }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Resolve the registered email for a session token, or null. */
export async function emailFromSession(session: string): Promise<string | null> {
  if (!session) return null;
  const { data } = await authCall("me", { session });
  const user = data.user as { email?: string } | undefined;
  return data.ok && user?.email ? user.email : null;
}

export function listWatch(email: string) {
  return php("watch_list", { email });
}
export function addWatch(email: string, item: Partial<WatchItem>) {
  return php("watch_add", { email, ...item });
}
export function setWatchTarget(
  email: string,
  id: string,
  target: number | null,
  direction: "above" | "below",
) {
  return php("watch_set_target", { email, id, target, direction });
}
export function removeWatch(email: string, id: string) {
  return php("watch_remove", { email, id });
}
export function triggerWatch(email: string, id: string, price: number) {
  return php("watch_trigger", { email, id, price });
}
