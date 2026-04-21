import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set.");
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/grant-superadmin.mjs <email>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const res = await client.query(
  'UPDATE "user" SET is_superadmin = true WHERE email = $1 RETURNING id, email, is_superadmin',
  [email.toLowerCase()],
);

if (res.rowCount === 0) {
  console.error(`No user with email ${email}`);
  await client.end();
  process.exit(1);
}

console.log("Granted superadmin:", res.rows[0]);
await client.end();
