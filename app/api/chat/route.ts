import { NextResponse } from "next/server";
import { answerChat, type ChatMessage, type Inst } from "@/lib/chat";
import { authCall } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const instrument: Inst = body.instrument === "gold" ? "gold" : "nifty";
  const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];

  // Resolve the signed-in user's registered email from their session so price
  // alerts go to the right address without the chat ever asking for it.
  let email: string | null = null;
  const session = typeof body.session === "string" ? body.session : "";
  if (session) {
    const { data } = await authCall("me", { session });
    const user = data.user as { email?: string } | undefined;
    if (data.ok && user?.email) email = user.email;
  }

  const res = await answerChat(instrument, messages, email);
  return NextResponse.json(res);
}
