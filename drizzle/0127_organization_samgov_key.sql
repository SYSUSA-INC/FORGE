-- BL-STAB-7b — a company's own SAM.gov API key.
--
-- One row per company. The key is stored only as AES-256-GCM ciphertext
-- (src/lib/secret-box.ts) bound to the organization, so a row copied to
-- another company cannot be decrypted; last4 is kept for display. The
-- status columns record what SAM.gov last said about the key. Every row
-- carries organization_id (the primary key). Idempotent and additive.

CREATE TABLE IF NOT EXISTS "organization_samgov_key" (
  "organization_id"  uuid        PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "ciphertext"       text        NOT NULL,
  "key_id"           varchar(16) NOT NULL,
  "last4"            varchar(4)  NOT NULL,
  "status"           varchar(16) NOT NULL DEFAULT 'ok',
  "status_at"        timestamptz NOT NULL DEFAULT now(),
  "verified_at"      timestamptz,
  "set_by_user_id"   text        REFERENCES "user"("id") ON DELETE SET NULL,
  "set_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);
