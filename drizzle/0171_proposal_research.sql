-- BL-NAV-LIFECYCLE 5b — web research for a proposal's first draft.
--
-- proposal_research_source: the numbered public sources a research run
-- gathered for one proposal (URL, title, the cited text, retrieval date).
-- The drafter offers them as numbered sources next to the company's own
-- records, so a web claim cites a URL. Company claims never come from here.
-- A new run replaces the proposal's earlier set. Additive.
CREATE TABLE IF NOT EXISTS "proposal_research_source" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "ordinal" integer NOT NULL,
  "url" text NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "excerpt" text NOT NULL DEFAULT '',
  "page_age" text,
  "retrieved_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "proposal_research_source_ordinal_idx"
  ON "proposal_research_source" ("proposal_id", "ordinal");
CREATE INDEX IF NOT EXISTS "proposal_research_source_org_idx"
  ON "proposal_research_source" ("organization_id", "proposal_id");

-- Web searches included per month on each plan (counted in tenant_usage_counter under
-- "webSearchesPerMonth"). Unlike the other quotas, a missing key or 0 means NONE included,
-- never unlimited: a search costs real money. Bronze and Silver cannot auto-draft, so they
-- carry 0; Gold 300 (about 60 research runs of up to five searches); Platinum 1000; custom 0
-- (a platform admin sets it per tenant). The tenant's own cap only lowers this.
UPDATE "subscription_tier" SET "quotas" = jsonb_set("quotas", '{webSearchesPerMonth}', '0'::jsonb, true)
  WHERE NOT ("quotas" ? 'webSearchesPerMonth');
UPDATE "subscription_tier" SET "quotas" = jsonb_set("quotas", '{webSearchesPerMonth}', '300'::jsonb, true)
  WHERE "slug" = 'gold' AND ("quotas"->>'webSearchesPerMonth')::int = 0;
UPDATE "subscription_tier" SET "quotas" = jsonb_set("quotas", '{webSearchesPerMonth}', '1000'::jsonb, true)
  WHERE "slug" = 'platinum' AND ("quotas"->>'webSearchesPerMonth')::int = 0;
