// Seed one pending cross-domain invite (home org set), then load the three
// superadmin pages that read it or the actor list, and report each status.
const { chromium } = require('playwright');
const pg = require('pg');
(async () => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const org = (await db.query(`select id from organization where slug='enablenow-demo'`)).rows[0].id;
  const other = (await db.query(`select id from organization where id <> $1 order by created_at limit 1`, [org])).rows[0]?.id ?? org;
  await db.query(`delete from allowlist where email='crossdomain-check@elsewhere.test'`);
  await db.query(
    `insert into allowlist (email, organization_id, role, cross_domain, home_organization_id) values ('crossdomain-check@elsewhere.test', $1, 'viewer', true, $2)`,
    [other, org],
  );
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(240000);
  const base = 'http://localhost:3000';
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'demo@forge.test');
  await page.fill('input[type=password]', 'ForgeDemo!2026');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/sign-in')), page.click('button[type=submit]')]);
  for (const path of ['/admin', `/admin/orgs/${other}`, `/admin/orgs/${org}/activity`]) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle' });
    const body = await page.innerText('body');
    const html = await page.content();
    const home = (html.match(/homeOrganizationName\\?":\\?"([^"\\]+)/) || [])[1];
    console.log(res.status(), path, html.includes('crossdomain-check@elsewhere.test') ? 'invite in payload' : '', home ? 'home org: ' + home : '', /Application error|Something went wrong/i.test(body) ? 'ERROR PAGE' : '');
  }
  await db.query(`delete from allowlist where email='crossdomain-check@elsewhere.test'`);
  await browser.close(); await db.end();
})();
