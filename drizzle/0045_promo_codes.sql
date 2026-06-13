-- BL-16 Phase C-4 — promotional codes.
--
-- Stand-alone discount-code table. No FK to organization or
-- subscription_tier — promo codes are global discounts that apply at
-- redemption time. Phase C-4 ships the data model + CRUD UI; the
-- actual redemption (applying a code to a tenant_subscription)
-- requires the BL-17 billing-integration work first.
--
-- Field semantics:
--   - code            — what the user types in. Unique, case-sensitive
--                       to avoid the L/I/0/O ambiguity problem at
--                       redemption time.
--   - description     — internal note ("Spring 2026 launch promo")
--   - discount_percent — 0..100. 100 = free.
--   - valid_from / valid_until — NULL = no lower / upper bound.
--   - max_uses        — 0 = unlimited; > 0 = absolute cap.
--   - times_used      — counter; incremented at redemption.
--   - active          — manual kill switch independent of date bounds.

CREATE TABLE "promotion_code" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"              varchar(64) NOT NULL UNIQUE,
  "description"       text NOT NULL DEFAULT '',
  "discount_percent"  integer NOT NULL DEFAULT 0,
  "valid_from"        timestamp,
  "valid_until"       timestamp,
  "max_uses"          integer NOT NULL DEFAULT 0,
  "times_used"        integer NOT NULL DEFAULT 0,
  "active"            boolean NOT NULL DEFAULT true,
  "created_at"        timestamp NOT NULL DEFAULT now(),
  "updated_at"        timestamp NOT NULL DEFAULT now()
);

-- Lookup index for the admin list view ordered by recency. The
-- unique constraint on `code` already covers the redemption lookup.
CREATE INDEX "promotion_code_created_idx" ON "promotion_code" ("created_at" DESC);
