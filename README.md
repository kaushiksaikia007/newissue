# Gold Bot 🪙

A Next.js (React + TypeScript) dashboard that pulls **live macro data** for the
key drivers of the gold price and turns them into a directional **gold bias**
(bullish / bearish / neutral).

## Tracked drivers

Market data is scraped live from **TradingView**, with **FRED** (St. Louis Fed)
as an automatic per-metric fallback. The monthly economic series (CPI, NFP) come
from **BLS.gov**.

| Driver | Primary (TradingView) | Fallback |
| --- | --- | --- |
| DXY (US Dollar Index) | `TVC:DXY` | FRED `DTWEXBGS` |
| US10Y Treasury Yield | `TVC:US10Y` | FRED `DGS10` |
| Federal Reserve expectations | `CBOT:ZQ1!` (Fed funds futures → implied rate) | FRED `DFEDTARU` |
| CPI | BLS.gov `CUSR0000SA0` | FRED `CPIAUCSL` |
| NFP | BLS.gov `CES0000000001` | FRED `PAYEMS` |
| Global risk sentiment | `TVC:VIX` | FRED `VIXCLS` |
| Spot gold (hero) | `TVC:GOLD` | FRED |
| Geopolitical events | Google News RSS | — |

For **Nifty 50**: `NSE:NIFTY`, `NSE:BANKNIFTY`, `NSE:INDIAVIX`, `FX_IDC:USDINR`,
`TVC:IN10Y`, `TVC:US10Y`, `ECONOMICS:ININTR` (RBI repo) and `ECONOMICS:INIRYY`
(India CPI) — all from TradingView.

> TradingView's scanner endpoint is unofficial (no public API); the FRED
> fallback keeps the app working if it changes or rate-limits. Price charts are
> built from the live tick stream. Fed expectations are derived from Fed funds
> futures (`implied rate = 100 − price`).

## Refresh cadence

- **Live values** (`/api/values`) refresh **every second** — one batched
  TradingView request, server-cached for `VALUES_CACHE_MS` (default 1000ms).
- **The recommendation** (`/api/signal`) is recomputed by OpenAI **every 60
  seconds** (`SIGNAL_CACHE_SECONDS`, default 60).
- CPI/NFP are fetched at most a few times a day (long cache) to respect BLS
  limits.

## How the "bot" works

**OpenAI is the main brain.** The live macro data + recent geopolitical
headlines are sent to OpenAI ([`lib/brain.ts`](lib/brain.ts)), which scores each
of the **seven factors 0–10** for how bullish it is for gold right now:

1. US Dollar (DXY) 2. US 10Y yield 3. Fed expectations 4. CPI / inflation
5. NFP 6. Geopolitical events 7. Global risk sentiment

This runs for **three time horizons**, each scored independently (fast movers
like risk/geopolitics/yields dominate the 1-day view; slow macro like
inflation/Fed/dollar dominate the long-term view):

| Horizon | Timeframe |
| --- | --- |
| **1 Day** | Next 24 hours |
| **Short-term** | 1–4 weeks |
| **Long-term** | 6–12 months |

For each horizon, the seven scores are **averaged (0–10)** and mapped to a
recommendation:

| Average score | Recommendation |
| --- | --- |
| 8.0 – 10.0 | **Strong Buy** |
| 6.0 – 7.9 | **Buy** |
| 4.0 – 5.9 | **Hold** |
| 2.0 – 3.9 | **Sell** |
| 0.0 – 1.9 | **Strong Sell** |

If `OPENAI_API_KEY` is not set (or a call fails), it falls back to a
deterministic heuristic in [`lib/analysis.ts`](lib/analysis.ts) using the same
relationships, so the dashboard always works.

**This is a research/educational tool — not financial advice.**

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then add your FRED_API_KEY
npm run dev
```

Open http://localhost:3000.

Get a **free** FRED API key (takes ~1 minute):
https://fredaccount.stlouisfed.org/apikeys

The app runs without a key using built-in **demo data**, clearly labelled in the
header — add the key to switch to live values.

## Architecture

- `app/api/values/route.ts`, `app/api/nifty/values/route.ts` — fast lane; live values, polled every second.
- `app/api/signal/route.ts`, `app/api/nifty/signal/route.ts` — slow lane; OpenAI recommendation, every 60s.
- `app/api/news/route.ts`, `app/api/nifty/news/route.ts` — Google News RSS (keyless).
- `lib/macro.ts` — gold aggregator + caching tiers (1s market data, long-cache CPI/NFP).
- `lib/instruments/nifty.ts` — Nifty 50 aggregator (TradingView).
- `lib/sources/tradingview.ts` — TradingView scanner client (all live market data).
- `lib/sources/bls.ts` — BLS.gov client (CPI, NFP).
- `lib/sources/news.ts` — Google News fetcher (gold + Nifty feeds; also feeds the brain).
- `lib/fred.ts` — FRED fallback client + series config + mock data.
- `lib/brain.ts` — OpenAI analysis engine (heuristic fallback).
- `lib/analysis.ts` — 0–10 factor scoring + recommendation mapping.
- `components/Dashboard.tsx` — client UI; values 1s, signal 60s. Charts build from the live tick stream.

## Scripts

- `npm run dev` — start dev server
- `npm run build` / `npm start` — production build & serve
- `npm run lint` — lint
