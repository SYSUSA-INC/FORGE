-- BL-NAV-LIFECYCLE 5b-2b — buying a search pack through Stripe Checkout.
-- A purchase entry keeps its Stripe payment intent, so a later refund
-- (charge.refunded) finds the purchase it belongs to. Additive, idempotent.
ALTER TABLE "search_credit_entry" ADD COLUMN IF NOT EXISTS "stripe_payment_intent_id" text;
CREATE INDEX IF NOT EXISTS "search_credit_entry_payment_intent_idx"
  ON "search_credit_entry" ("stripe_payment_intent_id")
  WHERE "stripe_payment_intent_id" IS NOT NULL;
