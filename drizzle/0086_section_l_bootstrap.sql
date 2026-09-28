-- BL-AIP-5b — proposal bootstrap from Section L.
--
-- proposal.bootstrap records the outline the AI built from the
-- solicitation's Section L (sections, page limits, due date, proposed
-- win themes) and what was applied, so the overview can show it and a
-- rebuild can be compared. proposal_section.instructions carries what
-- Section L says that section must contain; the drafter reads it as
-- the section's brief. Idempotent and additive.

ALTER TABLE "proposal" ADD COLUMN IF NOT EXISTS "bootstrap" jsonb;--> statement-breakpoint
ALTER TABLE "proposal_section" ADD COLUMN IF NOT EXISTS "instructions" text DEFAULT '' NOT NULL;
