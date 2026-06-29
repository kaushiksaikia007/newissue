// Minimal ISO 10962 CFI-code decoder — enough to label an instrument's type,
// category and (for debt) interest type from its 6-letter CFI code.

export interface CfiDecoded {
  category: string; // from char 1
  group: string; // from char 2
  interestType?: string; // debt: char 3
  attributes: string[]; // any extra human-readable notes
}

const CATEGORY: Record<string, string> = {
  E: "Equities",
  C: "Collective investment vehicles",
  D: "Debt instruments",
  R: "Entitlements (rights)",
  O: "Options",
  F: "Futures",
  S: "Swaps",
  H: "Non-listed / complex options",
  I: "Spot",
  J: "Forwards",
  K: "Strategies",
  L: "Financing",
  T: "Referential instruments",
  M: "Others",
};

const GROUPS: Record<string, Record<string, string>> = {
  E: { S: "Common / ordinary shares", P: "Preferred shares", C: "Common convertible", F: "Preferred convertible", L: "Limited partnership units", D: "Depositary receipts", Y: "Structured participation", M: "Other equity" },
  D: {
    B: "Bonds",
    C: "Convertible bonds",
    W: "Bonds with warrants",
    T: "Medium-term notes",
    Y: "Money-market instruments",
    G: "Mortgage-backed securities",
    A: "Asset-backed securities",
    N: "Municipal bonds",
    S: "Structured products (capital protection)",
    E: "Structured products (without capital protection)",
    M: "Other debt",
  },
  C: { I: "Standard (vanilla) funds", H: "Hedge funds", B: "Real estate investment trusts", E: "Exchange-traded funds", S: "Pension funds", F: "Funds of funds", P: "Private equity funds", M: "Other CIV" },
  R: { A: "Allotment rights", S: "Subscription rights", P: "Purchase rights", W: "Warrants", F: "Mini-future / certificates", D: "Depositary receipts on entitlements", M: "Other entitlement" },
};

// Debt interest type (char 3 for D-category instruments).
const DEBT_INTEREST: Record<string, string> = {
  F: "Fixed rate",
  Z: "Zero rate / discounted",
  V: "Variable rate",
  C: "Cash payment",
  K: "Payment in kind",
  Y: "Linked to a financial commodity",
  M: "Mixed / other",
};

export function decodeCfi(code: string | undefined): CfiDecoded | null {
  if (!code || code.length < 2) return null;
  const c = code.toUpperCase();
  const category = CATEGORY[c[0]] ?? `Unknown (${c[0]})`;
  const group = GROUPS[c[0]]?.[c[1]] ?? `Group ${c[1]}`;
  const out: CfiDecoded = { category, group, attributes: [] };
  // The 3rd char is "interest type" only for true coupon-bearing debt groups
  // (bonds, MTNs, money-market, convertibles…), not for structured products.
  const COUPON_GROUPS = new Set(["B", "C", "W", "T", "Y", "N", "G", "A"]);
  if (c[0] === "D" && c[2] && COUPON_GROUPS.has(c[1])) {
    out.interestType = DEBT_INTEREST[c[2]];
  }
  return out;
}
