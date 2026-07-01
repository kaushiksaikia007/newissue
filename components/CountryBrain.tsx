"use client";

import { useEffect, useRef, useState } from "react";
import IndiaHeadline from "./IndiaHeadline";

interface Country {
  code: string;
  name: string;
  flag: string;
}

// Major economies — each gets its own "brain".
const COUNTRIES: Country[] = [
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "US", name: "USA", flag: "🇺🇸" },
  { code: "CN", name: "China", flag: "🇨🇳" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "AE", name: "UAE", flag: "🇦🇪" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰" },
  { code: "TR", name: "Turkey", flag: "🇹🇷" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
];

interface Msg {
  role: "user" | "assistant";
  content: string;
  time: string;
}

const now = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function CountryBrain() {
  const [selected, setSelected] = useState<Country | null>(null);

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div
            className="coin"
            style={{ background: "radial-gradient(circle at 30% 28%,#a8c6ff,#2f5fd0)", color: "#06183f" }}
          >
            🌍
          </div>
          <div>
            <h1>Country Brain</h1>
            <p>Pick a country to open its dedicated macro brain</p>
          </div>
        </div>
      </header>

      {selected ? (
        <CountryChat country={selected} onBack={() => setSelected(null)} />
      ) : (
        <div className="cb-grid">
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              type="button"
              className="cb-box"
              onClick={() => setSelected(c)}
            >
              <span className="cb-flag">{c.flag}</span>
              <span className="cb-name">{c.name} Brain</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  "What's the macro outlook?",
  "Key risks right now?",
  "How are the markets doing?",
];

function CountryChat({ country, onBack }: { country: Country; onBack: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);

  // Reset the thread whenever a different country is opened.
  useEffect(() => {
    setMessages([]);
    setInput("");
    setTyping(false);
  }, [country.code]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || typing) return;
    const history = [...messages, { role: "user" as const, content: text, time: now() }];
    setMessages(history);
    setInput("");
    setTyping(true);
    try {
      const r = await fetch("/api/country/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: country.code,
          name: country.name,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      }).then((res) => res.json());
      if (!alive.current) return;
      setMessages((m) => [
        ...m,
        { role: "assistant", content: r.reply ?? "…", time: now() },
      ]);
    } catch {
      if (!alive.current) return;
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Connection error — please try again.", time: now() },
      ]);
    } finally {
      if (alive.current) setTyping(false);
    }
  };

  return (
    <div className="cb-chat">
      <div className="cb-chat-head">
        <button type="button" className="cb-back" onClick={onBack} aria-label="Back to countries">
          ←
        </button>
        <div className="cb-head-avatar">{country.flag}</div>
        <div className="cb-head-meta">
          <span className="cb-head-title">{country.name} Brain</span>
          <span className="cb-head-status">
            <span className="cb-dot" /> Macro AI · Online
          </span>
        </div>
      </div>

      {country.code === "IN" && <IndiaHeadline />}

      <div className="brain-body cb-body" ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} className={`cb-row ${m.role}`}>
            {m.role === "assistant" && <div className="cb-msg-avatar">{country.flag}</div>}
            <div className="cb-msg">
              <div className={`bubble ${m.role}`}>{m.content}</div>
              <span className="cb-time" suppressHydrationWarning>
                {m.time}
              </span>
            </div>
          </div>
        ))}

        {typing && (
          <div className="cb-row assistant">
            <div className="cb-msg-avatar">{country.flag}</div>
            <div className="cb-msg">
              <div className="bubble assistant typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        {messages.length === 0 && !typing && (
          <div className="cb-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cb-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Message the ${country.name} Brain…`}
          aria-label={`Message the ${country.name} Brain`}
          suppressHydrationWarning
        />
        <button onClick={() => send()} disabled={!input.trim() || typing} aria-label="Send">
          ➤
        </button>
      </div>
    </div>
  );
}
