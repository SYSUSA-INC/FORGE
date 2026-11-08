-- BL-NAV-LIFECYCLE 3c-3 — the sweep of expired partner invites clears the token hash of an expired link so it can never be reused; the row stays for the Partners tab's history.
ALTER TABLE "opportunity_partner_invite" ALTER COLUMN "token_hash" DROP NOT NULL;
