-- BL-NAV-LIFECYCLE 4c-2 — the freeze (P-7): the compliance matrix and the outline are stamped at the end of Plan; a change after the stamp is written to the opportunity's Activity.
ALTER TABLE "opportunity_plan"
  ADD COLUMN IF NOT EXISTS "compliance_matrix_frozen_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "outline_frozen_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "frozen_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;
