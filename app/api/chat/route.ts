import { NextResponse } from "next/server";
import { answerChat, type ChatMessage, type Inst } from "@/lib/chat";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const instrument: Inst = body.instrument === "gold" ? "gold" : "nifty";
  const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const res = await answerChat(instrument, messages);
  return NextResponse.json(res);
}
