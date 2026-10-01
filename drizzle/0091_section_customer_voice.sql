-- BL-FB-GEN-VOC — voice of the customer.
--
-- The drafter and the chat can now echo the agency's own language —
-- phrases read from its Section M, its requirements and its mission
-- text — where a paragraph is about the same thing. Evaluators respond
-- to hearing their own words. The per-section switch lives here; on by
-- default. Idempotent and additive.

ALTER TABLE "proposal_section" ADD COLUMN IF NOT EXISTS "echo_customer_voice" boolean NOT NULL DEFAULT true;
