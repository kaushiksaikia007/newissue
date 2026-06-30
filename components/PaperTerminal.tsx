"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import PaperTrading from "./PaperTrading";
import {
  GOLD_CONFIG,
  NIFTY_CONFIG,
  SENSEX_CONFIG,
} from "@/lib/instruments/config";
import { useAuth } from "./AuthProvider";
import { useTab } from "./TabProvider";

const INSTRUMENTS = [
  {
    id: "nifty" as const,
    label: "Nifty 50",
    coin: "N50",
    coinClass: "coin-nifty",
    cfg: NIFTY_CONFIG,
  },
  {
    id: "sensex" as const,
    label: "BSE Sensex",
    coin: "SX",
    coinClass: "coin-nifty",
    cfg: SENSEX_CONFIG,
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
  const { user, ready, openAuth } = useAuth();
  const { setTab } = useTab();
  const router = useRouter();
  const pathname = usePathname();
  const [sel, setSel] = useState("nifty");
  const inst = INSTRUMENTS.find((i) => i.id === sel) ?? INSTRUMENTS[0];

  const backToMarkets = () => {
    setTab("nifty");
    if (pathname !== "/") router.push("/");
  };

  if (ready && !user) {
    return (
      <div className="wrap">
        <header className="header">
          <div className="brand">
            <div className="coin">🔒</div>
            <div>
              <h1>Paper Trading Terminal</h1>
              <p>Sign in to access paper trading</p>
            </div>
          </div>
          <div className="status">
            <button type="button" suppressHydrationWarning className="topbar-btn" onClick={backToMarkets}>
              ← Back to Markets
            </button>
          </div>
        </header>
        <div className="analyze-empty">
          You need to be signed in to open the paper trading terminal.{" "}
          <button type="button" suppressHydrationWarning className="link-btn" onClick={openAuth}>
            Sign in or create an account
          </button>
        </div>
      </div>
    );
  }

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
          <button type="button" suppressHydrationWarning className="topbar-btn" onClick={backToMarkets}>
            ← Back to Markets
          </button>
        </div>
      </header>

      <div className="seg instr-switch">
        {INSTRUMENTS.map((i) => (
          <button
            key={i.id}
            type="button"
            suppressHydrationWarning
            className={`seg-btn${sel === i.id ? " active" : ""}`}
            onClick={() => setSel(i.id)}
          >
            {i.label}
          </button>
        ))}
      </div>

      <PaperTrading key={inst.id} instrument={inst.id} label={inst.label} />
    </div>
  );
}
