import { NextResponse } from "next/server";
import { authCall } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const rest = { ...body };
  delete rest.token; // the server injects the shared token itself
  delete rest.action;
  const { status, data } = await authCall(action, rest);
  return NextResponse.json(data, { status });
}
