export interface InstrumentConfig {
  /** Content-header title, e.g. "Gold". */
  title: string;
  subtitle: string;
  /** Round badge text in the header. */
  coinText: string;
  coinClass?: string;
  /** Hero price label + optional unit suffix. */
  priceLabel: string;
  priceSuffix?: string;
  /** Prefix for localStorage + notification tags. */
  alertKey: string;
  /** Friendly instrument name used in notifications. */
  notifName: string;
  /** Heading above the headlines feed. */
  newsTitle: string;
  endpoints: { values: string; signal: string; news: string };
  /** Optional: enable the AI trading-strategy panel from this endpoint. */
  strategyEndpoint?: string;
  /** Optional: enable the institutional-intelligence panel from this endpoint. */
  intelEndpoint?: string;
  /** Optional: enable the paper-trading desk. */
  paperTrading?: boolean;
  /** Instrument id for the AI brain chat. */
  brainId?: "gold" | "nifty" | "sensex";
}

export const GOLD_CONFIG: InstrumentConfig = {
  title: "Gold",
  subtitle: "XAU / USD · live macro drivers & AI analysis",
  coinText: "Au",
  priceLabel: "SPOT GOLD / GRAM",
  priceSuffix: "/g",
  alertKey: "goldbot",
  notifName: "Gold",
  newsTitle: "Geopolitical Events & Risk Headlines",
  endpoints: {
    values: "/api/values",
    signal: "/api/signal",
    news: "/api/news",
  },
  strategyEndpoint: "/api/strategy",
  brainId: "gold",
};

export const NIFTY_CONFIG: InstrumentConfig = {
  title: "Nifty 50",
  subtitle: "NSE · live drivers & AI analysis",
  coinText: "N50",
  coinClass: "coin-nifty",
  priceLabel: "NIFTY 50",
  priceSuffix: "",
  alertKey: "niftybot",
  notifName: "Nifty 50",
  newsTitle: "Indian Markets & Geopolitical Headlines",
  endpoints: {
    values: "/api/nifty/values",
    signal: "/api/nifty/signal",
    news: "/api/nifty/news",
  },
  strategyEndpoint: "/api/nifty/strategy",
  paperTrading: true,
  brainId: "nifty",
};

export const SENSEX_CONFIG: InstrumentConfig = {
  title: "BSE Sensex",
  subtitle: "BSE · live drivers & AI analysis",
  coinText: "SX",
  coinClass: "coin-nifty",
  priceLabel: "BSE SENSEX",
  priceSuffix: "",
  alertKey: "sensexbot",
  notifName: "BSE Sensex",
  newsTitle: "Indian Markets & Geopolitical Headlines",
  endpoints: {
    values: "/api/sensex/values",
    signal: "/api/sensex/signal",
    news: "/api/sensex/news",
  },
  strategyEndpoint: "/api/sensex/strategy",
  intelEndpoint: "/api/sensex/intel",
  paperTrading: true,
  brainId: "sensex",
};
