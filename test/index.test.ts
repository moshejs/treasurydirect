import { describe, expect, it, vi } from "vitest";
import {
  TreasuryDirectError,
  announcedSecurities,
  auctionedSecurities,
  currentDebt,
  getSecurity,
  num,
  searchDebt,
  searchSecurities,
  upcomingAuctions,
} from "../src/index.js";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function calledUrl(f: unknown): string {
  return (f as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
}

describe("URL construction", () => {
  it("auctionedSecurities with filters", async () => {
    const f = mockFetch([]);
    await auctionedSecurities({ type: "Note", days: 30 }, { fetch: f });
    expect(calledUrl(f)).toBe(
      "https://www.treasurydirect.gov/TA_WS/securities/auctioned?type=Note&days=30",
    );
  });

  it("auctionedSecurities omits undefined params", async () => {
    const f = mockFetch([]);
    await auctionedSecurities({}, { fetch: f });
    expect(calledUrl(f)).toBe("https://www.treasurydirect.gov/TA_WS/securities/auctioned");
  });

  it("upcomingAuctions", async () => {
    const f = mockFetch([]);
    await upcomingAuctions({ fetch: f });
    expect(calledUrl(f)).toBe("https://www.treasurydirect.gov/TA_WS/securities/upcoming");
  });

  it("announcedSecurities includes format=json", async () => {
    const f = mockFetch([]);
    await announcedSecurities({ type: "Bill", days: 5 }, { fetch: f });
    expect(calledUrl(f)).toBe(
      "https://www.treasurydirect.gov/TA_WS/securities/announced?format=json&type=Bill&days=5",
    );
  });

  it("getSecurity encodes the issue date as MM/DD/YYYY in the path", async () => {
    const f = mockFetch({ cusip: "91282CQQ7" });
    await getSecurity("91282CQQ7", "2026-07-15", { fetch: f });
    expect(calledUrl(f)).toBe(
      "https://www.treasurydirect.gov/TA_WS/securities/91282CQQ7/07%2F15%2F2026?format=json",
    );
  });

  it("getSecurity accepts Date objects", async () => {
    const f = mockFetch({});
    await getSecurity("91282CQQ7", new Date(Date.UTC(2026, 6, 15)), { fetch: f });
    expect(calledUrl(f)).toContain("/91282CQQ7/07%2F15%2F2026");
  });

  it("searchSecurities passes params through", async () => {
    const f = mockFetch([]);
    await searchSecurities({ cusip: "91282CQQ7" }, { fetch: f });
    expect(calledUrl(f)).toBe(
      "https://www.treasurydirect.gov/TA_WS/securities/search?format=json&cusip=91282CQQ7",
    );
  });

  it("searchDebt uses startdate/enddate", async () => {
    const f = mockFetch({ entries: [] });
    await searchDebt({ startDate: "2026-07-01", endDate: "2026-07-08" }, { fetch: f });
    expect(calledUrl(f)).toBe(
      "https://www.treasurydirect.gov/NP_WS/debt/search?startdate=2026-07-01&enddate=2026-07-08&format=json",
    );
  });

  it("honors a custom baseUrl", async () => {
    const f = mockFetch([]);
    await upcomingAuctions({ fetch: f, baseUrl: "https://proxy.example.com" });
    expect(calledUrl(f)).toBe("https://proxy.example.com/TA_WS/securities/upcoming");
  });
});

describe("responses and errors", () => {
  it("returns parsed security arrays", async () => {
    const f = mockFetch([{ cusip: "91282CQQ7", highYield: "4.5800" }]);
    const rows = await auctionedSecurities({}, { fetch: f });
    expect(rows).toHaveLength(1);
    expect(num(rows[0]!.highYield)).toBe(4.58);
  });

  it("unwraps debt search entries", async () => {
    const f = mockFetch({
      entries: [{ effectiveDate: "July 8, 2026 EDT", totalDebt: 39394977645639.05 }],
    });
    const entries = await searchDebt(
      { startDate: "2026-07-01", endDate: "2026-07-08" },
      { fetch: f },
    );
    expect(entries[0]!.totalDebt).toBeCloseTo(39394977645639.05, 2);
  });

  it("currentDebt returns the single entry object", async () => {
    const f = mockFetch({ effectiveDate: "July 9, 2026 EDT", totalDebt: 1 });
    const debt = await currentDebt({ fetch: f });
    expect(debt.effectiveDate).toBe("July 9, 2026 EDT");
  });

  it("throws TreasuryDirectError with status on non-2xx", async () => {
    const f = mockFetch("nope", 503);
    await expect(upcomingAuctions({ fetch: f })).rejects.toMatchObject({
      name: "TreasuryDirectError",
      status: 503,
    });
    await expect(upcomingAuctions({ fetch: f })).rejects.toBeInstanceOf(TreasuryDirectError);
  });
});

describe("validation", () => {
  it("rejects bad days, CUSIPs, and dates", async () => {
    const f = mockFetch([]);
    expect(() => auctionedSecurities({ days: -1 }, { fetch: f })).toThrow(RangeError);
    expect(() => auctionedSecurities({ days: 1.5 }, { fetch: f })).toThrow(RangeError);
    expect(() => getSecurity("BAD", "2026-07-15", { fetch: f })).toThrow(/CUSIP/);
    expect(() => getSecurity("91282CQQ7", "07/15/2026", { fetch: f })).toThrow(RangeError);
    await expect(
      searchDebt({ startDate: "bad", endDate: "2026-07-08" }, { fetch: f }),
    ).rejects.toThrow(RangeError);
  });
});

describe("num helper", () => {
  it("converts numeric strings, nulls empties and non-numerics", () => {
    expect(num("4.375000")).toBe(4.375);
    expect(num("98.380297")).toBe(98.380297);
    expect(num("")).toBeNull();
    expect(num("  ")).toBeNull();
    expect(num("No")).toBeNull();
    expect(num(undefined)).toBeNull();
  });
});
