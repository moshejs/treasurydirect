import { describe, expect, it, vi } from "vitest";
import {
  TreasuryDirectError,
  announcedSecurities,
  auctionedSecurities,
  currentDebt,
  dateOnly,
  getSecurity,
  num,
  searchDebt,
  searchSecurities,
  upcomingAuctions,
  yesNo,
} from "../src/index.js";
import { debtAround2005, fiscalData91282CQQ7, note91282CQQ7 } from "./fixtures.js";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
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
    expect(debt.date).toBe("2026-07-09");
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

describe("live-response fixtures", () => {
  it("getSecurity record converts to the values Fiscal Data publishes for the same auction", async () => {
    const s = await getSecurity("91282CQQ7", "2026-07-15", { fetch: mockFetch(note91282CQQ7) });
    const fd = fiscalData91282CQQ7;
    expect(num(s.highYield)).toBe(Number(fd.high_yield));
    expect(num(s.pricePer100)).toBe(Number(fd.price_per100));
    expect(num(s.bidToCoverRatio)).toBe(Number(fd.bid_to_cover_ratio));
    expect(num(s.interestRate)).toBe(Number(fd.int_rate));
    expect(num(s.totalAccepted)).toBe(Number(fd.total_accepted));
    expect(num(s.offeringAmount)).toBe(Number(fd.offering_amt));
    expect(num(s.accruedInterestPer1000)).toBe(Number(fd.accrued_int_per1000));
    expect(dateOnly(s.maturityDate)).toBe(fd.maturity_date);
    expect(yesNo(s.reopening)).toBe(fd.reopening === "Yes");
  });

  it("debt entries before 2005-03-31 have null public/intragovernmental split", async () => {
    const [mar31, mar30] = await searchDebt(
      { startDate: "2005-03-30", endDate: "2005-03-31" },
      { fetch: mockFetch(debtAround2005) },
    );
    expect(mar31!.date).toBe("2005-03-31");
    expect(mar31!.publicDebt).toBeTypeOf("number");
    expect(mar30!.date).toBe("2005-03-30");
    expect(mar30!.publicDebt).toBeNull();
    expect(mar30!.governmentHoldings).toBeNull();
    expect(mar30!.totalDebt).toBe(7786606686259.96);
  });
});

describe("hardening", () => {
  it('getSecurity with no match ("No data" body) throws a 404 TreasuryDirectError', async () => {
    const f = mockFetch("No data");
    await expect(getSecurity("91282CQQ7", "2026-07-16", { fetch: f })).rejects.toMatchObject({
      name: "TreasuryDirectError",
      status: 404,
    });
  });

  it("non-JSON 200 bodies throw TreasuryDirectError, not SyntaxError", async () => {
    const f = mockFetch("<html>maintenance</html>");
    await expect(upcomingAuctions({ fetch: f })).rejects.toMatchObject({
      name: "TreasuryDirectError",
      message: expect.stringMatching(/non-JSON/),
    });
  });

  it("passes paging params; search defaults pagenum to 0 (API ignores pagesize alone)", async () => {
    const f = mockFetch([]);
    await searchSecurities({ type: "Bill", pagesize: 5 }, { fetch: f });
    expect(calledUrl(f)).toBe(
      "https://www.treasurydirect.gov/TA_WS/securities/search?format=json&type=Bill&pagesize=5&pagenum=0",
    );
    const g = mockFetch([]);
    await auctionedSecurities({ type: "Note", pagesize: 10, pagenum: 2 }, { fetch: g });
    expect(calledUrl(g)).toBe(
      "https://www.treasurydirect.gov/TA_WS/securities/auctioned?type=Note&pagesize=10&pagenum=2",
    );
    expect(() => auctionedSecurities({ pagesize: 0 }, { fetch: g })).toThrow(RangeError);
    expect(() => searchSecurities({ pagenum: -1 }, { fetch: g })).toThrow(RangeError);
  });

  it("rejects impossible dates and reversed debt ranges", async () => {
    const f = mockFetch({ entries: [] });
    expect(() => getSecurity("91282CQQ7", "2026-02-30", { fetch: f })).toThrow(RangeError);
    await expect(
      searchDebt({ startDate: "2026-02-29", endDate: "2026-03-02" }, { fetch: f }),
    ).rejects.toThrow(RangeError);
    await expect(
      searchDebt({ startDate: "2026-07-08", endDate: "2026-07-01" }, { fetch: f }),
    ).rejects.toThrow(/after endDate/);
    await expect(
      searchDebt({ startDate: "2024-02-29", endDate: "2024-03-01" }, { fetch: f }),
    ).resolves.toEqual([]);
  });

  it("honors timeoutMs and trims a trailing baseUrl slash", async () => {
    const f = mockFetch([]);
    await upcomingAuctions({ fetch: f, baseUrl: "https://proxy.example.com/", timeoutMs: 1000 });
    expect(calledUrl(f)).toBe("https://proxy.example.com/TA_WS/securities/upcoming");
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    ) as unknown as typeof fetch;
    await expect(upcomingAuctions({ fetch: hang, timeoutMs: 20 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});

describe("dateOnly / yesNo helpers", () => {
  it("strips the T00:00:00 suffix and maps Yes/No", () => {
    expect(dateOnly("2026-07-15T00:00:00")).toBe("2026-07-15");
    expect(dateOnly("2026-07-15")).toBe("2026-07-15");
    expect(dateOnly("")).toBeNull();
    expect(dateOnly(undefined)).toBeNull();
    expect(yesNo("Yes")).toBe(true);
    expect(yesNo("No")).toBe(false);
    expect(yesNo("")).toBeNull();
  });
});
