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
  /** Abort the request after this many milliseconds (no timeout by default). */
  timeoutMs?: number;
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal;
}

/**
 * A security record as returned by the TA_WS API. The API returns every field
 * as a string; empty string means not applicable. Use {@link num} to convert
 * numeric fields, {@link dateOnly} for "…T00:00:00" dates and {@link yesNo}
 * for "Yes"/"No" flags. Only commonly used fields are typed explicitly — all other
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

/**
 * One "Debt to the Penny" entry. Dollar amounts are numbers. The split into
 * public debt and intragovernmental holdings is `null` before 2005-03-31
 * (the API publishes only the total for 1993-01-04 … 2005-03-30).
 */
export interface DebtEntry {
  effectiveDate: string; // "July 9, 2026 EDT", as published
  /** effectiveDate as "YYYY-MM-DD" (added by this library). */
  date: string;
  governmentHoldings: number | null;
  publicDebt: number | null;
  totalDebt: number;
}

/**
 * Thrown for non-2xx responses and non-JSON bodies. `getSecurity` for a
 * CUSIP / issue date with no match also throws this, with `status` 404 (the
 * API itself answers HTTP 200 with the plain-text body "No data").
 */
export class TreasuryDirectError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, message?: string) {
    super(message ?? `TreasuryDirect request failed with HTTP ${status}: ${url}`);
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

/**
 * A TA_WS date-time ("2026-07-15T00:00:00") as "YYYY-MM-DD", or null when
 * empty. `dateOnly("2026-07-15T00:00:00")` → "2026-07-15".
 */
export function dateOnly(value: string | undefined): string | null {
  if (value === undefined) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value.trim());
  return m ? m[1]! : null;
}

/** A TA_WS "Yes"/"No" flag as a boolean, or null when empty/other. */
export function yesNo(value: string | undefined): boolean | null {
  if (value === "Yes") return true;
  if (value === "No") return false;
  return null;
}

const DEFAULT_BASE = "https://www.treasurydirect.gov";

function signalFor(opts: TreasuryDirectOptions): AbortSignal | undefined {
  const { signal, timeoutMs } = opts;
  if (timeoutMs === undefined) return signal;
  if (!(timeoutMs > 0)) throw new RangeError(`timeoutMs must be > 0, got ${timeoutMs}`);
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  // AbortSignal.any is Node 20+; combine by hand for Node 18.
  const ctrl = new AbortController();
  const abort = (s: AbortSignal) => () => ctrl.abort(s.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  signal.addEventListener("abort", abort(signal), { once: true });
  timeout.addEventListener("abort", abort(timeout), { once: true });
  return ctrl.signal;
}

async function request<T>(
  path: string,
  query: Record<string, string | number | undefined>,
  opts: TreasuryDirectOptions,
): Promise<T> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const href = url.toString();
  const res = await doFetch(href, {
    headers: { accept: "application/json" },
    signal: signalFor(opts),
  });
  if (!res.ok) throw new TreasuryDirectError(res.status, href);
  const text = await res.text();
  if (text.trim() === "No data") {
    throw new TreasuryDirectError(404, href, `TreasuryDirect has no data for: ${href}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TreasuryDirectError(
      res.status,
      href,
      `TreasuryDirect returned a non-JSON response (HTTP ${res.status}): ${href}`,
    );
  }
}

function checkDays(days: number | undefined): void {
  if (days !== undefined && (!Number.isInteger(days) || days < 0)) {
    throw new RangeError(`days must be a non-negative integer, got ${days}`);
  }
}

function checkPaging(p: { pagesize?: number; pagenum?: number }): void {
  if (p.pagesize !== undefined && (!Number.isInteger(p.pagesize) || p.pagesize <= 0)) {
    throw new RangeError(`pagesize must be a positive integer, got ${p.pagesize}`);
  }
  if (p.pagenum !== undefined && (!Number.isInteger(p.pagenum) || p.pagenum < 0)) {
    throw new RangeError(`pagenum must be a non-negative integer, got ${p.pagenum}`);
  }
}

export interface AuctionedParams {
  /** Security type filter: Bill, Note, Bond, CMB, TIPS, FRN. */
  type?: SecurityType;
  /**
   * Look-back window in calendar days. Without `days` (and without
   * `pagesize`) the API returns its most recent 250 records.
   */
  days?: number;
  /** Max records to return (newest first). */
  pagesize?: number;
  /** 0-based page number, used with `pagesize`. */
  pagenum?: number;
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
  checkPaging(params);
  return request("/TA_WS/securities/auctioned", listQuery(params), opts);
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
  checkPaging(params);
  return request("/TA_WS/securities/announced", { format: "json", ...listQuery(params) }, opts);
}

function listQuery(p: AuctionedParams): Record<string, string | number | undefined> {
  return { type: p.type, days: p.days, pagesize: p.pagesize, pagenum: p.pagenum };
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isRealIsoDate(s: string): boolean {
  return (
    typeof s === "string" &&
    ISO_DATE_RE.test(s) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
  );
}

function toApiDate(input: string | Date, label: string): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    const mm = String(input.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(input.getUTCDate()).padStart(2, "0");
    return `${mm}/${dd}/${input.getUTCFullYear()}`;
  }
  const m = isRealIsoDate(input) ? ISO_DATE_RE.exec(input) : null;
  if (!m) throw new RangeError(`Invalid date for ${label}: "${input}" (expected a real YYYY-MM-DD date)`);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * A single security by CUSIP and issue date (Date objects use their UTC
 * calendar date). Throws TreasuryDirectError with status 404 when no
 * security matches.
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
  /** "Yes" or "No". */
  reopening?: string;
  /** Date field to filter on with startDate/endDate, e.g. "auctionDate", "issueDate". */
  dateFieldName?: string;
  /** YYYY-MM-DD (MM/DD/YYYY also accepted by the API). */
  startDate?: string;
  endDate?: string;
  /** Max records (newest first). Without it a broad search can be tens of MB. */
  pagesize?: number;
  /** 0-based page; defaults to 0 when pagesize is given (the API ignores pagesize alone). */
  pagenum?: number;
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
  checkPaging(params);
  const query = { format: "json", ...params };
  if (params.pagesize !== undefined && params.pagenum === undefined) query.pagenum = 0;
  return request("/TA_WS/securities/search", query, opts);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** "July 9, 2026 EDT" → "2026-07-09" ("" if the format ever changes). */
function debtDate(effectiveDate: string): string {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(effectiveDate ?? "");
  const mi = m ? MONTHS.indexOf(m[1]!) : -1;
  if (!m || mi < 0) return "";
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function withDate(e: Omit<DebtEntry, "date">): DebtEntry {
  return { ...e, date: debtDate(e.effectiveDate) };
}

/** The latest "Debt to the Penny" figures. */
export async function currentDebt(opts: TreasuryDirectOptions = {}): Promise<DebtEntry> {
  return withDate(await request<DebtEntry>("/NP_WS/debt/current", {}, opts));
}

/**
 * "Debt to the Penny" history between two dates (inclusive), newest first.
 * Only business days have entries. Date objects use their UTC calendar date.
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
  if (start > end) throw new RangeError(`startDate ${start} is after endDate ${end}`);
  const res = await request<{ entries: DebtEntry[] }>(
    "/NP_WS/debt/search",
    { startdate: start, enddate: end, format: "json" },
    opts,
  );
  return res.entries.map(withDate);
}

function isoDate(input: string | Date, label: string): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError(`Invalid Date for ${label}`);
    return input.toISOString().slice(0, 10);
  }
  if (!isRealIsoDate(input)) {
    throw new RangeError(`Invalid date for ${label}: "${input}" (expected a real YYYY-MM-DD date)`);
  }
  return input;
}
