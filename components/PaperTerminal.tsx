"use client";

import { useState } from "react";
import Link from "next/link";
import PaperTrading from "./PaperTrading";
import { GOLD_CONFIG, NIFTY_CONFIG } from "@/lib/instruments/config";

const INSTRUMENTS = [
  {
    id: "nifty" as const,
    label: "Nifty 50",
    coin: "N50",
    coinClass: "coin-nifty",
    cfg: NIFTY_CONFIG,
  },
  {
    id: "gold" as const,
    label: "Gold (AU)",
    coin: "Au",
    coinClass: "",
    cfg: GOLD_CONFIG,
  },
];

export default function PaperTerminal() {
  const [sel, setSel] = useState("nifty");
  const inst = INSTRUMENTS.find((i) => i.id === sel) ?? INSTRUMENTS[0];

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div className={`coin ${inst.coinClass}`}>{inst.coin}</div>
          <div>
            <h1>Paper Trading Terminal</h1>
            <p>{inst.label} · practice with $1,000,000 demo capital</p>
          </div>
        </div>
        <div className="status">
          <Link href="/" className="topbar-btn">
            ← Back to Markets
          </Link>
        </div>
      </header>

      <div className="seg instr-switch">
        {INSTRUMENTS.map((i) => (
          <button
            key={i.id}
            className={`seg-btn${sel === i.id ? " active" : ""}`}
            onClick={() => setSel(i.id)}
          >
            {i.label}
          </button>
        ))}
      </div>

      <PaperTrading
        key={inst.id}
        instrument={inst.id}
        strategyEndpoint={inst.cfg.strategyEndpoint}
        label={inst.label}
      />
    </div>
  );
}
