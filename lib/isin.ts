import { decodeCfi } from "./cfi";

// ---------------------------------------------------------------------------
// ISIN lookup — ESMA FIRDS (instrument reference data) + GLEIF (issuer/LEI).
// FIRDS Solr core exposes name, CFI, currency, maturity, competent authority,
// LEI and trading venues. Coupon rate and nominal amounts are NOT in this index
// (they live in the full FIRDS debt files), so they're reported as unavailable.
// ---------------------------------------------------------------------------

export interface InstrumentDetails {
  isin: string;
  found: boolean;
  error?: string;
  // Issuer (FIRDS LEI -> GLEIF)
  issuerName?: string;
  lei?: string;
  jurisdiction?: string;
  jurisdictionCode?: string;
  leiStatus?: string;
  // Instrument (FIRDS + CFI)
  fullName?: string;
  shortName?: string;
  cfiCode?: string;
  instrumentType?: string;
  instrumentCategory?: string;
  interestType?: string;
  notionalCurrency?: string;
  maturityDate?: string;
  tradingStart?: string;
  commodityDerivative?: boolean;
  competentAuthority?: string;
  rcaCode?: string;
  venues: string[];
  status?: string;
  notes: string[];
}

const FIRDS =
  "https://registers.esma.europa.eu/solr/esma_registers_firds/select";
const GLEIF = "https://api.gleif.org/api/v1/lei-records/";

const UA = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json",
};

/** Validate ISIN format (2 country letters + 9 alnum + check digit) + Luhn. */
export function isValidIsin(raw: string): boolean {
  const s = (raw || "").toUpperCase().trim();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
  // Convert letters to numbers (A=10..Z=35), then Luhn mod-10.
  let digits = "";
  for (const ch of s) {
    digits += /[0-9]/.test(ch) ? ch : (ch.charCodeAt(0) - 55).toString();
  }
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const isoCode = (code?: string): string | undefined => {
  if (!code) return undefined;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
    );
  } catch {
    return code;
  }
};

interface FirdsDoc {
  isin?: string;
  mic?: string;
  lei?: string;
  gnr_full_name?: string;
  gnr_short_name?: string;
  gnr_cfi_code?: string;
  gnr_notional_curr_code?: string;
  gnr_comm_derivative_flag?: string;
  rca_mic?: string;
  upcoming_rca?: string;
  mrkt_trdng_trmination_date?: string;
  mrkt_trdng_start_date?: string;
  status_label?: string;
  type_s?: string;
}

const cache = new Map<string, { d: InstrumentDetails; expires: number }>();

export async function lookupIsin(rawIsin: string): Promise<InstrumentDetails> {
  const isin = (rawIsin || "").toUpperCase().trim();
  const base: InstrumentDetails = { isin, found: false, venues: [], notes: [] };
  if (!isValidIsin(isin)) {
    return { ...base, error: "That doesn't look like a valid ISIN." };
  }
  const hit = cache.get(isin);
  if (hit && hit.expires > Date.now()) return hit.d;

  let docs: FirdsDoc[] = [];
  try {
    const q = encodeURIComponent(`isin:${isin} AND gnr_cfi_code:*`);
    const url = `${FIRDS}?q=${q}&rows=50&wt=json&sort=publication_date desc`;
    const res = await fetch(url, { headers: UA, cache: "no-store" });
    if (!res.ok) throw new Error(`FIRDS ${res.status}`);
    const j = (await res.json()) as { response?: { docs?: FirdsDoc[] } };
    docs = j.response?.docs ?? [];
  } catch {
    return {
      ...base,
      error: "Couldn't reach the ESMA FIRDS reference service — try again.",
    };
  }

  if (!docs.length) {
    return {
      ...base,
      error:
        "No record found in ESMA FIRDS for this ISIN (it may be a non-EU-traded or very new instrument).",
    };
  }

  // Reference data comes from the "parent" record; fall back to the first doc.
  const ref = docs.find((d) => d.type_s === "parent" && d.gnr_full_name) ?? docs[0];
  const venues = Array.from(
    new Set(docs.map((d) => d.mic).filter((m): m is string => !!m)),
  ).sort();

  const cfi = decodeCfi(ref.gnr_cfi_code);
  const rca = ref.rca_mic || ref.upcoming_rca;
  const out: InstrumentDetails = {
    isin,
    found: true,
    fullName: ref.gnr_full_name || undefined,
    shortName: ref.gnr_short_name || undefined,
    cfiCode: ref.gnr_cfi_code || undefined,
    instrumentType: cfi?.category,
    instrumentCategory: cfi?.group,
    interestType: cfi?.interestType,
    notionalCurrency: ref.gnr_notional_curr_code || undefined,
    maturityDate: ref.mrkt_trdng_trmination_date || undefined,
    tradingStart: ref.mrkt_trdng_start_date || undefined,
    commodityDerivative:
      ref.gnr_comm_derivative_flag === "true" ||
      ref.gnr_comm_derivative_flag === "1"
        ? true
        : ref.gnr_comm_derivative_flag === "false" ||
            ref.gnr_comm_derivative_flag === "0"
          ? false
          : undefined,
    rcaCode: rca,
    competentAuthority: rca ? isoCode(rca.slice(0, 2)) : undefined,
    lei: ref.lei || undefined,
    venues,
    status: ref.status_label || undefined,
    notes: [],
  };

  // GLEIF — enrich issuer from the LEI.
  if (out.lei) {
    try {
      const res = await fetch(`${GLEIF}${out.lei}`, { headers: UA, cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as {
          data?: {
            attributes?: {
              entity?: { legalName?: { name?: string }; jurisdiction?: string };
              registration?: { status?: string };
            };
          };
        };
        const a = j.data?.attributes;
        out.issuerName = a?.entity?.legalName?.name;
        out.jurisdictionCode = a?.entity?.jurisdiction;
        out.jurisdiction = isoCode(a?.entity?.jurisdiction);
        out.leiStatus = a?.registration?.status;
      }
    } catch {
      /* GLEIF optional */
    }
  }

  if (out.instrumentType === "Debt instruments") {
    out.notes.push(
      "Coupon/interest rate, total issued nominal and nominal value per unit are not exposed by the FIRDS reference index (they live in the full FIRDS debt files). Interest type and maturity shown are derived from the CFI code and trading-termination date.",
    );
  }

  cache.set(isin, { d: out, expires: Date.now() + 10 * 60_000 });
  return out;
}
