/**
 * treasurydirect — typed, zero-dependency client for the US Treasury's free
 * public APIs at treasurydirect.gov: auction results, upcoming and announced
 * auctions, security lookups, and Debt to the Penny.
 *
 * No API key required. Uses the global fetch (Node 18+); injectable for
 * testing via options.
 */

export type SecurityType = "Bill" | "Note" | "Bond" | "CMB" | "TIPS" | "FRN";

export interface TreasuryDirectOptions {
  /** Custom fetch implementation (testing, proxies). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Base URL. Defaults to "https://www.treasurydirect.gov". */
  baseUrl?: string;
}

/**
 * A security record as returned by the TA_WS API. The API returns every field
 * as a string; empty string means not applicable. Use {@link num} to convert
 * numeric fields. Only commonly used fields are typed explicitly — all other
 * fields are present via the index signature.
 */
export interface Security {
  cusip: string;
  issueDate: string; // "2026-07-15T00:00:00"
  securityType: string; // "Bill" | "Note" | "Bond" | "CMB" | "TIPS" | "FRN"
  securityTerm: string; // "13-Week", "9-Year 10-Month", …
  maturityDate: string;
  interestRate: string; // "4.375000" or "" for Bills
  announcementDate: string;
  auctionDate: string;
  datedDate: string;
  accruedInterestPer1000: string;
  auctionFormat: string;
  averageMedianYield: string;
  bidToCoverRatio: string;
  competitiveAccepted: string;
  competitiveTendered: string;
  currentlyOutstanding: string;
  directBidderAccepted: string;
  firstInterestPaymentDate: string;
  floatingRate: string; // "Yes" | "No"
  highDiscountRate: string;
  highInvestmentRate: string;
  highPrice: string;
  highYield: string;
  indirectBidderAccepted: string;
  interestPaymentFrequency: string;
  lowYield: string;
  minimumBidAmount: string;
  offeringAmount: string;
  pricePer100: string;
  primaryDealerAccepted: string;
  reopening: string; // "Yes" | "No"
  securityTermDayMonth: string;
  securityTermWeekYear: string;
  series: string;
  totalAccepted: string;
  totalTendered: string;
  type: string;
  [field: string]: string;
}

/** One "Debt to the Penny" entry. Dollar amounts are numbers. */
export interface DebtEntry {
  effectiveDate: string; // "July 9, 2026 EDT"
  governmentHoldings: number;
  publicDebt: number;
  totalDebt: number;
}

export class TreasuryDirectError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`TreasuryDirect request failed with HTTP ${status}: ${url}`);
    this.name = "TreasuryDirectError";
    this.status = status;
    this.url = url;
  }
}

/**
 * Convert a TA_WS string field to a number, or null when empty/non-numeric.
 * `num("4.375000")` → 4.375; `num("")` → null; `num("No")` → null.
 */
export function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const DEFAULT_BASE = "https://www.treasurydirect.gov";

async function request<T>(
  path: string,
  query: Record<string, string | number | undefined>,
  opts: TreasuryDirectOptions,
): Promise<T> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await doFetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new TreasuryDirectError(res.status, url.toString());
  return (await res.json()) as T;
}

function checkDays(days: number | undefined): void {
  if (days !== undefined && (!Number.isInteger(days) || days < 0)) {
    throw new RangeError(`days must be a non-negative integer, got ${days}`);
  }
}

export interface AuctionedParams {
  /** Security type filter: Bill, Note, Bond, CMB, TIPS, FRN. */
  type?: SecurityType;
  /** How many days back to include (0 = today only). API default: 7. */
  days?: number;
}

/**
 * Recently auctioned securities with full results (yields, prices,
 * bid-to-cover, accrued interest, …).
 *
 * ```ts
 * const notes = await auctionedSecurities({ type: "Note", days: 30 });
 * num(notes[0].highYield); // 4.58
 * ```
 */
export function auctionedSecurities(
  params: AuctionedParams = {},
  opts: TreasuryDirectOptions = {},
): Promise<Security[]> {
  checkDays(params.days);
  return request("/TA_WS/securities/auctioned", { type: params.type, days: params.days }, opts);
}

/** Auctions scheduled but not yet held. */
export function upcomingAuctions(opts: TreasuryDirectOptions = {}): Promise<Security[]> {
  return request("/TA_WS/securities/upcoming", {}, opts);
}

/** Announced auctions (terms published, auction pending or recent). */
export function announcedSecurities(
  params: AuctionedParams = {},
  opts: TreasuryDirectOptions = {},
): Promise<Security[]> {
  checkDays(params.days);
  return request(
    "/TA_WS/securities/announced",
    { format: "json", type: params.type, days: params.days },
    opts,
  );
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toApiDate(input: string | Date, label: string): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    const mm = String(input.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(input.getUTCDate()).padStart(2, "0");
    return `${mm}/${dd}/${input.getUTCFullYear()}`;
  }
  const m = ISO_DATE_RE.exec(input);
  if (!m) throw new RangeError(`Invalid date for ${label}: "${input}" (expected YYYY-MM-DD)`);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * A single security by CUSIP and issue date.
 *
 * ```ts
 * const note = await getSecurity("91282CQQ7", "2026-07-15");
 * ```
 */
export function getSecurity(
  cusip: string,
  issueDate: string | Date,
  opts: TreasuryDirectOptions = {},
): Promise<Security> {
  if (!/^[0-9A-Z]{9}$/i.test(cusip)) {
    throw new RangeError(`Invalid CUSIP: "${cusip}" (expected 9 alphanumeric characters)`);
  }
  const datePath = encodeURIComponent(toApiDate(issueDate, "issueDate"));
  return request(`/TA_WS/securities/${cusip}/${datePath}`, { format: "json" }, opts);
}

export interface SearchParams {
  cusip?: string;
  type?: SecurityType;
  [param: string]: string | number | undefined;
}

/**
 * Search securities. All TA_WS search parameters are passed through, e.g.
 * `{ cusip: "91282CQQ7" }` returns every issuance (original + reopenings).
 */
export function searchSecurities(
  params: SearchParams,
  opts: TreasuryDirectOptions = {},
): Promise<Security[]> {
  return request("/TA_WS/securities/search", { format: "json", ...params }, opts);
}

/** The latest "Debt to the Penny" figures. */
export function currentDebt(opts: TreasuryDirectOptions = {}): Promise<DebtEntry> {
  return request("/NP_WS/debt/current", {}, opts);
}

/**
 * "Debt to the Penny" history between two dates (inclusive).
 *
 * ```ts
 * const entries = await searchDebt({ startDate: "2026-07-01", endDate: "2026-07-08" });
 * ```
 */
export async function searchDebt(
  range: { startDate: string | Date; endDate: string | Date },
  opts: TreasuryDirectOptions = {},
): Promise<DebtEntry[]> {
  const start = isoDate(range.startDate, "startDate");
  const end = isoDate(range.endDate, "endDate");
  const res = await request<{ entries: DebtEntry[] }>(
    "/NP_WS/debt/search",
    { startdate: start, enddate: end, format: "json" },
    opts,
  );
  return res.entries;
}

function isoDate(input: string | Date, label: string): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    return input.toISOString().slice(0, 10);
  }
  if (!ISO_DATE_RE.test(input)) {
    throw new RangeError(`Invalid date for ${label}: "${input}" (expected YYYY-MM-DD)`);
  }
  return input;
}
