# treasurydirect

Typed, zero-dependency client for the **US Treasury's free public APIs** at [treasurydirect.gov](https://www.treasurydirect.gov/) — auction results, upcoming and announced auctions, security lookups by CUSIP, and Debt to the Penny. **No API key required.**

```
npm install treasurydirect
```

## Why

The Treasury publishes remarkably rich data for free — every auction's high yield, bid-to-cover, price per 100, accrued interest, dealer allocations, plus the national debt to the literal penny — and npm had no client for it. If you're building a bond ladder tool, a rates dashboard, or a debt-ceiling story, this is the data source.

```ts
import { auctionedSecurities, currentDebt, getSecurity, num } from "treasurydirect";

const notes = await auctionedSecurities({ type: "Note", days: 30 });
num(notes[0].highYield);       // 4.58
num(notes[0].bidToCoverRatio); // 2.59

const note = await getSecurity("91282CQQ7", "2026-07-15");
num(note.accruedInterestPer1000); // 7.25204

const debt = await currentDebt();
debt.totalDebt; // 39_414_179_016_130.09
```

## API

All functions take an optional final `options` argument: `{ fetch?, baseUrl? }` (inject `fetch` for tests/proxies).

- **`auctionedSecurities({ type?, days? })`** — recent auction results. `type`: `"Bill" | "Note" | "Bond" | "CMB" | "TIPS" | "FRN"`; `days`: look-back window.
- **`upcomingAuctions()`** — scheduled auctions.
- **`announcedSecurities({ type?, days? })`** — announced auction terms.
- **`getSecurity(cusip, issueDate)`** — one security; `issueDate` as `"YYYY-MM-DD"` or `Date`.
- **`searchSecurities(params)`** — pass-through search, e.g. `{ cusip }` returns the original issue and every reopening.
- **`currentDebt()`** / **`searchDebt({ startDate, endDate })`** — Debt to the Penny, latest or historical.
- **`num(field)`** — the TA_WS API returns every security field as a string (`""` = not applicable); `num` converts to `number | null`.

Failures throw `TreasuryDirectError` with `status` and `url`. Security records are typed for the ~30 most useful fields with an index signature for the rest.

The mocked test suite runs offline; `npm run smoke` exercises the live API.

## Related

Part of a small fixed-income toolkit: [`32nds`](https://github.com/moshejs/32nds) (format those auction prices as Treasury quotes) · [`accrued-interest`](https://github.com/moshejs/accrued-interest) (reproduce `accruedInterestPer1000` yourself) · [`day-count`](https://github.com/moshejs/day-count) · [`sifma-holidays`](https://github.com/moshejs/sifma-holidays) (bond-market calendar).

## Author

Built by **[Moshe Malka](https://moshemalka.com)** — engineering leader in New York City. Studio work at [Quentin.Code](https://www.quentin.software/).

MIT © Moshe Malka
