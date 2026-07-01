import { NextResponse } from "next/server";
import { answerCountryChat } from "@/lib/countryBrain";
import type { ChatMessage } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Chat with a country's macro brain. India is preloaded with live market data;
// other countries use web_search for current figures.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "this country";
  const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

  const res = await answerCountryChat(code, name, messages);
  return NextResponse.json(res);
}
