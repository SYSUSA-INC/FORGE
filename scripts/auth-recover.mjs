// BL-MFA-RECOVERY — the operator's last resort when nobody can sign in to
// reset someone's two-step sign-in (a lone superadmin who lost every
// method and their email): run against the database, no redeploy.
//
//   npm run auth:recover -- someone@example.com "reason"
//
// Removes the person's passkeys, authenticator apps and recovery codes,
// ends every open session, and records it in the Audit Log of each of
// their workspaces. Their password is unchanged; at the next sign-in they
// set up two-step sign-in again.
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set.");
  process.exit(1);
}
const email = (process.argv[2] ?? "").trim().toLowerCase();
const reason = (process.argv[3] ?? "").trim();
if (!email || reason.length < 10) {
  console.error('Usage: npm run auth:recover -- <email> "<reason, at least 10 characters>"');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  const u = await client.query('SELECT id, email FROM "user" WHERE lower(email) = $1', [email]);
  if (u.rowCount === 0) throw new Error(`No user with email ${email}`);
  const id = u.rows[0].id;
  const f = await client.query('DELETE FROM "user_mfa_factor" WHERE user_id = $1', [id]);
  const c = await client.query('DELETE FROM "user_recovery_code" WHERE user_id = $1', [id]);
  await client.query(
    `UPDATE "user" SET mfa_enrolled_at = NULL, mfa_reset_at = now(), mfa_pass_pid = NULL, mfa_pass_at = NULL,
       webauthn_challenge = NULL, webauthn_challenge_at = NULL, mfa_recovery_token_hash = NULL, mfa_recovery_expires_at = NULL,
       session_version = session_version + 1, updated_at = now() WHERE id = $1`,
    [id],
  );
  const orgs = await client.query("SELECT DISTINCT organization_id FROM membership WHERE user_id = $1", [id]);
  for (const o of orgs.rows) {
    await client.query(
      `INSERT INTO audit_log (organization_id, actor_user_id, actor_email_snapshot, action, resource_type, resource_id, metadata)
       VALUES ($1, NULL, 'operator', 'user.mfa.reset', 'user', $2, $3)`,
      [o.organization_id, id, JSON.stringify({ via: "auth-recover script", reason, factors: f.rowCount, recoveryCodes: c.rowCount })],
    );
  }
  await client.query("COMMIT");
  console.log(`Reset two-step sign-in for ${u.rows[0].email}: ${f.rowCount} method(s) and ${c.rowCount} recovery code(s) removed, every session ended. They set it up again at the next sign-in.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
