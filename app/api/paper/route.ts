import { NextRequest, NextResponse } from "next/server";
import {
  closePosition,
  getPaper,
  importAccount,
  openPosition,
  resetAccount,
  type Inst,
} from "@/lib/paper/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function instOf(v: string | null): Inst {
  return v === "gold" ? "gold" : "nifty";
}

export async function GET(req: NextRequest) {
  const inst = instOf(req.nextUrl.searchParams.get("instrument"));
  return NextResponse.json(await getPaper(inst));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const inst = instOf(body.instrument);
  const action = body.action;

  if (action === "open") {
    const res = await openPosition(inst, {
      side: body.side === "sell" ? "sell" : "buy",
      qty: Number(body.qty),
      sl: body.sl != null ? Number(body.sl) : null,
      target: body.target != null ? Number(body.target) : null,
      profitPct: body.profitPct != null ? Number(body.profitPct) : null,
    });
    return NextResponse.json({ ...res, ...(await getPaper(inst)) });
  }
  if (action === "close") {
    const res = await closePosition(inst, String(body.id));
    return NextResponse.json({ ...res, ...(await getPaper(inst)) });
  }
  if (action === "reset") {
    await resetAccount(inst);
    return NextResponse.json(await getPaper(inst));
  }
  if (action === "import") {
    const res = await importAccount(inst, body.account);
    return NextResponse.json({ ...(await getPaper(inst)), persisted: res.persisted });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
