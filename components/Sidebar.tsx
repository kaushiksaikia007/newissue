"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTab, type Tab } from "./TabProvider";
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
    items: [{ id: "nifty", label: "Nifty 50", symbol: "NSE", icon: "📈" }],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { tab, setTab } = useTab();

  const onMarkets = pathname === "/";

  const select = (id: Tab) => {
    setTab(id);
    if (!onMarkets) router.push("/"); // come back to the markets view first
  };

  return (
    <aside className="sidebar">
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
      </nav>

      <div className="sidebar-account">
        <UserMenu />
      </div>
      <div className="sidebar-foot">More instruments coming soon</div>
    </aside>
  );
}
