/**
 * BL-NAV-LIFECYCLE 5b-2b — pure rules for prepaid search packs.
 */
import { describe, expect, it } from "vitest";
import { formatPackPrice, searchesToRefund } from "@/lib/search-pack-logic";

describe("formatPackPrice", () => {
  it("reads whole and fractional prices", () => {
    expect(formatPackPrice(2500, "usd")).toBe("$25");
    expect(formatPackPrice(2450, "USD")).toBe("$24.50");
    expect(formatPackPrice(2000, "eur")).toBe("20 EUR");
  });
});

describe("searchesToRefund", () => {
  const pack = { packSearches: 500, chargeAmount: 2500 };

  it("takes back the whole pack on a full refund", () => {
    expect(searchesToRefund({ ...pack, amountRefunded: 2500, previousAmountRefunded: 0 })).toBe(500);
  });

  it("takes back each partial refund's own share, never the same search twice", () => {
    expect(searchesToRefund({ ...pack, amountRefunded: 500, previousAmountRefunded: 0 })).toBe(100);
    expect(searchesToRefund({ ...pack, amountRefunded: 2500, previousAmountRefunded: 500 })).toBe(400);
    // Rounding down per running total: the shares still add up to the pack.
    const a = searchesToRefund({ packSearches: 500, chargeAmount: 2499, amountRefunded: 833, previousAmountRefunded: 0 });
    const b = searchesToRefund({ packSearches: 500, chargeAmount: 2499, amountRefunded: 2499, previousAmountRefunded: 833 });
    expect(a + b).toBe(500);
  });

  it("is zero for nothing refunded, bad input, or a total that did not grow", () => {
    expect(searchesToRefund({ ...pack, amountRefunded: 0, previousAmountRefunded: 0 })).toBe(0);
    expect(searchesToRefund({ ...pack, amountRefunded: 500, previousAmountRefunded: 500 })).toBe(0);
    expect(searchesToRefund({ packSearches: 500, chargeAmount: 0, amountRefunded: 100, previousAmountRefunded: 0 })).toBe(0);
    expect(searchesToRefund({ ...pack, amountRefunded: 9999, previousAmountRefunded: 0 })).toBe(500);
  });
});
