// Live smoke test against the real API (not run in CI — see `npm test` for
// the mocked suite). Usage: npm run smoke
import {
  auctionedSecurities,
  currentDebt,
  getSecurity,
  num,
  upcomingAuctions,
} from "../dist/index.js";

const auctioned = await auctionedSecurities({ type: "Note", days: 30 });
console.log(`auctioned Notes (30d): ${auctioned.length}`);
const first = auctioned[0];
console.log(`  ${first.cusip} ${first.securityTerm} high yield ${num(first.highYield)}`);

const upcoming = await upcomingAuctions();
console.log(`upcoming auctions: ${upcoming.length}`);

const single = await getSecurity(first.cusip, first.issueDate.slice(0, 10));
console.log(`getSecurity: ${single.cusip} rate ${num(single.interestRate)}`);

const debt = await currentDebt();
console.log(`total debt (${debt.effectiveDate}): $${(debt.totalDebt / 1e12).toFixed(2)}T`);
console.log("SMOKE OK");
