"use client";

import { useState } from "react";
import { useTab } from "./TabProvider";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export default function IsinLookupView() {
  const { isinTabs, openIsin, closeIsin, setTab } = useTab();
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = val.toUpperCase().trim();
    if (!ISIN_RE.test(v)) {
      setErr("That doesn't look like a valid 12-character ISIN (e.g. US0378331005).");
      return;
    }
    setErr(null);
    openIsin(v); // switches to the isin:<ISIN> tab and renders the full report
    setVal("");
  };

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <div
            className="coin"
            style={{ background: "radial-gradient(circle at 30% 28%,#d8c4ff,#7a4fd0)", color: "#1a0f33" }}
          >
            🔖
          </div>
          <div>
            <h1>ISIN Lookup</h1>
            <p>Fixed income reference data · ESMA FIRDS + GLEIF</p>
          </div>
        </div>
      </header>

      <form className="isinlk-search" onSubmit={submit}>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value.toUpperCase())}
          placeholder="Enter a 12-character ISIN, e.g. US0378331005"
          maxLength={12}
          aria-label="ISIN"
          suppressHydrationWarning
        />
        <button type="submit" suppressHydrationWarning>
          Look up
        </button>
      </form>
      {err && <div className="isinlk-err">{err}</div>}

      {isinTabs.length === 0 ? (
        <div className="strat-empty">
          No instruments looked up yet. Enter an ISIN above to fetch its issuer,
          instrument and trading-venue data.
        </div>
      ) : (
        <>
          <div className="section-title">Recent lookups ({isinTabs.length})</div>
          <div className="isinlk-grid">
            {isinTabs.map((t) => (
              <div className="isinlk-card" key={t.isin}>
                <button
                  type="button"
                  suppressHydrationWarning
                  className="isinlk-open"
                  onClick={() => setTab(`isin:${t.isin}`)}
                >
                  <span className="isinlk-name" title={t.label}>
                    {t.label}
                  </span>
                  <span className="isinlk-code">{t.isin}</span>
                </button>
                <button
                  type="button"
                  suppressHydrationWarning
                  className="wl-x"
                  onClick={() => closeIsin(t.isin)}
                  aria-label={`Close ${t.isin}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
