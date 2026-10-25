-- BL-CAP-MATRIX phase C — FORGE's suggested answers, keyed by question id.
-- Never read by coverage or PWin: a person confirms each one into "answers".
ALTER TABLE "opportunity_capability_matrix" ADD COLUMN "suggestions" jsonb DEFAULT '{}'::jsonb NOT NULL;
