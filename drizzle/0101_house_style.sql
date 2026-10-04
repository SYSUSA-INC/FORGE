-- BL-FB-GEN-VOICE Slice 2 — team-wide house style.
-- One text per organization: the writing rules every section follows
-- whoever the author is ("never say leverage", "open with the customer's
-- outcome"). The drafter and chat receive it before any author's own
-- voice. Edited by tenant admins under Settings → House style.
-- Idempotent and additive.

ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "house_style" text DEFAULT '' NOT NULL;
