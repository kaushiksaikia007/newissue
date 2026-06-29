"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTab, type Tab } from "./TabProvider";
import { useAuth } from "./AuthProvider";
import UserMenu from "./UserMenu";

interface Item {
  id: Tab;
  label: string;
  symbol: string;
  icon: string;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Commodities",
    items: [{ id: "gold", label: "Gold", symbol: "XAU / USD", icon: "🪙" }],
  },
  {
    title: "Indices",
    items: [
      { id: "nifty", label: "Nifty 50", symbol: "NSE", icon: "📈" },
      { id: "sensex", label: "BSE Sensex", symbol: "BSE", icon: "📊" },
    ],
  },
  {
    title: "Trading",
    items: [
      { id: "paper", label: "Paper Trading", symbol: "Demo desk", icon: "💹" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { tab, setTab, isinTabs, openIsin, closeIsin } = useTab();
  const { requireAuth } = useAuth();
  const [isinInput, setIsinInput] = useState("");
  const [open, setOpen] = useState(false);

  const onMarkets = pathname === "/";

  // Label shown in the mobile top bar so you always know which view is open.
  const activeLabel = (() => {
    if (!onMarkets) return "New Issue Bot";
    if (tab.startsWith("isin:")) {
      const isin = tab.slice(5);
      return isinTabs.find((t) => t.isin === isin)?.label ?? isin;
    }
    return GROUPS.flatMap((g) => g.items).find((i) => i.id === tab)?.label ?? "Markets";
  })();

  // Lock background scroll and allow Escape-to-close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (id: Tab) => {
    // Paper trading is gated behind sign-in.
    if (id === "paper" && !requireAuth()) return;
    setTab(id);
    setOpen(false);
    if (!onMarkets) router.push("/"); // come back to the markets view first
  };

  const lookupIsin = () => {
    const v = isinInput.toUpperCase().trim();
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(v)) return;
    openIsin(v);
    setIsinInput("");
    setOpen(false);
    if (!onMarkets) router.push("/");
  };

  const openIsinTab = (isin: string) => {
    setTab(`isin:${isin}`);
    setOpen(false);
    if (!onMarkets) router.push("/");
  };

  return (
    <>
      <header className="mobile-bar">
        <button
          className={`mobile-burger${open ? " open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-bar-brand">
          <div className="brand-badge">NB</div>
          <span className="mobile-bar-title">{activeLabel}</span>
        </div>
      </header>

      <div
        className={`sidebar-scrim${open ? " show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-brand">
        <div className="brand-badge">NB</div>
        <div>
          <div className="sb-title">New Issue Bot</div>
          <div className="sb-sub">Markets terminal</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {GROUPS.map((g) => (
          <div className="sb-group" key={g.title}>
            <div className="sb-group-title">{g.title}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                className={`sb-item${onMarkets && tab === it.id ? " active" : ""}`}
                onClick={() => select(it.id)}
              >
                <span className="sb-icon">{it.icon}</span>
                <span className="sb-item-main">
                  <span className="sb-item-label">{it.label}</span>
                  <span className="sb-item-symbol">{it.symbol}</span>
                </span>
              </button>
            ))}
          </div>
        ))}

        <div className="sb-group">
          <div className="sb-group-title">Fixed Income · ISIN</div>
          <form
            className="isin-lookup"
            onSubmit={(e) => {
              e.preventDefault();
              lookupIsin();
            }}
          >
            <input
              value={isinInput}
              onChange={(e) => setIsinInput(e.target.value.toUpperCase())}
              placeholder="Enter ISIN…"
              maxLength={12}
              aria-label="Look up an ISIN"
            />
            <button type="submit" aria-label="Look up ISIN">
              →
            </button>
          </form>
          {isinTabs.map((t) => (
            <div
              key={t.isin}
              className={`sb-item sb-isin${tab === `isin:${t.isin}` && onMarkets ? " active" : ""}`}
            >
              <button
                className="sb-isin-main"
                onClick={() => openIsinTab(t.isin)}
              >
                <span className="sb-icon">🔖</span>
                <span className="sb-item-main">
                  <span className="sb-item-label">{t.label}</span>
                  <span className="sb-item-symbol">{t.isin}</span>
                </span>
              </button>
              <button
                className="sb-isin-close"
                onClick={() => closeIsin(t.isin)}
                aria-label={`Close ${t.isin}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </nav>

        <div className="sidebar-account">
          <UserMenu />
        </div>
        <div className="sidebar-foot">More instruments coming soon</div>
      </aside>
    </>
  );
}
