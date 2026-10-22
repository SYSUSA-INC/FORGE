// Screenshot every FORGE route (light then dark, same load), signed in as the
// seeded superadmin demo user; auth/public routes from a signed-out context.
const { chromium } = require('playwright');
const pg = require('pg');
const fs = require('fs');
(async () => {
  const out = process.argv[2];
  const routes = fs.readFileSync(process.argv[3], 'utf8').split('\n').map((r) => r.trim() || '/').filter((r, i, a) => a.indexOf(r) === i);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]?.id;
  const org = await one(`select id from organization where slug='enablenow-demo'`);
  const sol = await one(`select id from solicitation where organization_id=$1 and parent_solicitation_id is null and extracted_requirements::text <> '[]' order by created_at limit 1`, [org]);
  const prop = await one(`select p.id from proposal p join proposal_review r on r.proposal_id=p.id where p.organization_id=$1 limit 1`, [org]);
  const ids = {
    'admin/gold-set': await one(`select id from extraction_gold_doc where notice_id='demo-notice-1' limit 1`),
    'admin/orgs': org,
    'admin/promo-codes': await one(`select id from promotion_code where code='DEMO20'`),
    'admin/tiers': await one(`select id from subscription_tier where slug='demo-unlimited'`),
    companies: await one(`select id from company where organization_id=$1 limit 1`, [org]),
    contacts: await one(`select id from customer_contact where organization_id=$1 limit 1`, [org]),
    'knowledge-base': await one(`select id from knowledge_entry where organization_id=$1 limit 1`, [org]),
    'knowledge-base/import': await one(`select id from knowledge_artifact where organization_id=$1 limit 1`, [org]),
    'notifications/rules': await one(`select id from notification_rule where organization_id=$1 limit 1`, [org]),
    opportunities: await one(`select id from opportunity where organization_id=$1 order by created_at limit 1`, [org]),
    proposals: prop,
    reviewId: await one(`select id from proposal_review where proposal_id=$1 limit 1`, [prop]),
    'settings/templates': await one(`select id from proposal_template where organization_id=$1 limit 1`, [org]),
    solicitations: sol,
    amendment: await one(`select id from solicitation where parent_solicitation_id=$1 limit 1`, [sol]),
  };
  const resolve = (r) => {
    if (r === '/pipeline/[id]') return null;
    if (r === '/review/[token]') return '/review/demo-review-token-0001';
    if (r === '/solicitations/[id]/diff') return `/solicitations/${ids.amendment}/diff`;
    if (r.includes('[reviewId]')) return r.replace('[id]', ids.proposals).replace('[reviewId]', ids.reviewId);
    if (!r.includes('[id]')) return r;
    const key = r.slice(1, r.indexOf('/[id]'));
    return ids[key] ? r.replace('[id]', ids[key]) : null;
  };
  const PUBLIC = new Set(['/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/verify-email', '/request-trial', '/pricing', '/review/[token]']);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const base = 'http://localhost:3000';
  const anon = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000); anon.setDefaultTimeout(180000);
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'demo@forge.test'); await page.fill('input[type=password]', 'ForgeDemo!2026');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/sign-in')), page.click('button[type=submit]')]);
  const index = [];
  for (const r of routes) {
    const path = resolve(r);
    if (!path) { index.push({ route: r, skipped: true }); continue; }
    const p = PUBLIC.has(r) ? anon : page;
    const name = (r === '/' ? 'home' : r.slice(1).replace(/\//g, '__').replace(/\[|\]/g, ''));
    try {
      const resp = await p.goto(base + path, { waitUntil: 'networkidle' });
      await p.waitForTimeout(900);
      const h = Math.min(await p.evaluate(() => document.documentElement.scrollHeight), 2700);
      for (const theme of ['light', 'dark']) {
        await p.evaluate((t) => { if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme'); }, theme);
        await p.waitForTimeout(250);
        await p.screenshot({ path: `${out}/${name}--${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: h }, fullPage: true });
      }
      await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      index.push({ route: r, path, file: name, status: resp && resp.status(), finalUrl: p.url().replace(base, '') });
    } catch (e) { index.push({ route: r, path, error: e.message.split('\n')[0] }); }
  }
  fs.writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
  await browser.close(); await db.end();
})();
