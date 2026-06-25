"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item {
  href: string;
  label: string;
  symbol: string;
  icon: string;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Commodities",
    items: [{ href: "/", label: "Gold", symbol: "XAU / USD", icon: "🪙" }],
  },
  {
    title: "Indices",
    items: [{ href: "/nifty50", label: "Nifty 50", symbol: "NSE", icon: "📈" }],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

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
              <Link
                key={it.href}
                href={it.href}
                className={`sb-item${isActive(it.href) ? " active" : ""}`}
              >
                <span className="sb-icon">{it.icon}</span>
                <span className="sb-item-main">
                  <span className="sb-item-label">{it.label}</span>
                  <span className="sb-item-symbol">{it.symbol}</span>
                </span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">More instruments coming soon</div>
    </aside>
  );
}
