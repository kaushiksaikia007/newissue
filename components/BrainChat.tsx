"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function BrainChat({
  instrument,
  label,
}: {
  instrument: "gold" | "nifty";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `Hi — I'm your ${label} brain. I've got the latest ${label} data loaded. Ask me anything.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument,
          messages: next.filter((m, i) => !(i === 0 && m.role === "assistant")),
        }),
      }).then((res) => res.json());
      setMessages((m) => [...m, { role: "assistant", content: r.reply ?? "…" }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Connection error — try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions =
    instrument === "gold"
      ? ["What's driving gold today?", "Is it bullish or bearish?", "What should I watch?"]
      : ["How's Nifty looking?", "What's the trend?", "Key risks right now?"];

  return (
    <>
      <button
        className={`brain-fab ${instrument}`}
        onClick={() => setOpen((o) => !o)}
        title={`Ask the ${label} brain`}
        aria-label={`Ask the ${label} brain`}
      >
        {open ? "✕" : "🧠"}
        {!open && <span className="brain-fab-text">Ask {label} Brain</span>}
      </button>

      {open && (
        <div className={`brain-panel ${instrument}`} role="dialog" aria-modal="false">
          <div className="brain-head">
            <span className="brain-title">
              <span className="brain-dot" /> {label} Brain
            </span>
            <span className="brain-sub">live data loaded</span>
            <button className="brain-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="brain-body" ref={bodyRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="bubble assistant typing">
                <span></span><span></span><span></span>
              </div>
            )}
            {messages.length <= 1 && !loading && (
              <div className="brain-suggest">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="brain-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={`Ask about ${label}…`}
              disabled={loading}
            />
            <button onClick={send} disabled={loading || !input.trim()}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
