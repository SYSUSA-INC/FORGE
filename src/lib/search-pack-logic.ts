/**
 * BL-NAV-LIFECYCLE 5b-2b — pure rules for prepaid search packs: how a
 * price reads, and how many searches a refund takes back. No I/O.
 */

/** "$25" or "$24.50"; other currencies as "24.50 EUR". */
export function formatPackPrice(priceCents: number, currency: string): string {
  const amount = priceCents / 100;
  const text = Number.isInteger(amount) ? amount.toLocaleString("en-US") : amount.toFixed(2);
  return currency.toLowerCase() === "usd" ? `$${text}` : `${text} ${currency.toUpperCase()}`;
}

/**
 * How many of a pack's searches one refund event takes back. Stripe
 * reports the charge's running refunded total; the event's own share is
 * that total less the total before it, in searches, rounded down. A full
 * refund takes back the whole pack; never more than the pack, never
 * negative. (How many are actually removed is then capped by the balance:
 * searches already used are not clawed back.)
 */
export function searchesToRefund(input: {
  packSearches: number;
  chargeAmount: number;
  amountRefunded: number;
  previousAmountRefunded: number;
}): number {
  const { packSearches, chargeAmount } = input;
  if (!(packSearches > 0) || !(chargeAmount > 0)) return 0;
  const share = (refunded: number) => Math.floor((packSearches * Math.min(Math.max(0, refunded), chargeAmount)) / chargeAmount);
  return Math.max(0, share(input.amountRefunded) - share(input.previousAmountRefunded));
}
