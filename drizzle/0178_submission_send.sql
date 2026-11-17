-- BL-NAV-LIFECYCLE 6b — send from the portal (FORGE II S-3). Each
-- opportunity gets one address on the inbound domain, made the first
-- time it is needed and kept for the opportunity's life:
-- sub-{10 random characters}@INBOUND_EMAIL_DOMAIN. The submission goes
-- out From and Reply-To that address, so replies, bounces and
-- out-of-office notices come back to the opportunity (6c files them).
-- The send itself is a durable job. Additive, idempotent. Design:
-- docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.4.
ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "delivery_local_part" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_delivery_local_part_idx" ON "opportunity" ("delivery_local_part");--> statement-breakpoint
ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'submission_send';
