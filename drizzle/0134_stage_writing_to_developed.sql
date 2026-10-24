-- BL-PIPE-STAGES — the Writing stage merges into Developed (stored as
-- pre_proposal). The enum value "writing" stays (Postgres cannot drop one);
-- nothing writes it any more.
UPDATE "opportunity" SET "stage" = 'pre_proposal' WHERE "stage" = 'writing';
