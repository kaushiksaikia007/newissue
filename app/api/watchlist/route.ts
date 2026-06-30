import { NextResponse } from "next/server";
import {
  addWatch,
  emailFromSession,
  listWatch,
  removeWatch,
  setWatchTarget,
  triggerWatch,
  type WatchItem,
} from "@/lib/watchlist";
import { tvQuote } from "@/lib/sources/tvQuote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noAuth = () =>
  NextResponse.json({ items: [], error: "Sign in to use your watchlist." }, { status: 401 });

export async function GET(req: Request) {
  const session = new URL(req.url).searchParams.get("session") ?? "";
  const email = await emailFromSession(session);
  if (!email) return noAuth();
  const data = await listWatch(email);
  return NextResponse.json(data ?? { items: [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = await emailFromSession(String(body.session ?? ""));
  if (!email) return noAuth();

  const action = body.action;
  if (action === "add") {
    const data = await addWatch(email, {
      symbol: String(body.symbol ?? ""),
      display: String(body.display ?? body.symbol ?? ""),
      exchange: body.exchange ?? null,
      type: body.type ?? null,
      currency: body.currency ?? null,
    });
    return NextResponse.json(data ?? { items: [] });
  }
  if (action === "set_target") {
    const target =
      body.target != null && Number(body.target) > 0 ? Number(body.target) : null;
    const direction = body.direction === "below" ? "below" : "above";
    const data = await setWatchTarget(email, String(body.id ?? ""), target, direction);
    return NextResponse.json(data ?? { items: [] });
  }
  if (action === "remove") {
    const data = await removeWatch(email, String(body.id ?? ""));
    return NextResponse.json(data ?? { items: [] });
  }
  if (action === "trigger") {
    // Live browser path: the page saw a price cross a target. Re-verify the
    // price server-side (never trust the client) before emailing, then let the
    // PHP claim the trigger atomically so the cron can't double-send.
    const id = String(body.id ?? "");
    const current = (await listWatch(email)) as { items?: WatchItem[] } | null;
    const item = current?.items?.find((i) => i.id === id);
    if (!item || item.target == null || item.triggered) {
      return NextResponse.json(current ?? { items: [] });
    }
    const q = await tvQuote(item.symbol);
    if (q == null) return NextResponse.json(current ?? { items: [] });
    const hit =
      item.direction === "below" ? q.price <= item.target : q.price >= item.target;
    if (!hit) return NextResponse.json(current ?? { items: [] });

    await triggerWatch(email, id, q.price);
    const updated = await listWatch(email);
    return NextResponse.json(updated ?? current ?? { items: [] });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
