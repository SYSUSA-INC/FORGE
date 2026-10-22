const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  const base = 'http://localhost:3000';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const PAGES = [['pipeline','/pipeline'],['scout','/opportunities/scout'],['proposals','/proposals'],['reports','/reports'],['intel','/intelligence'],['kbimport','/knowledge-base/import'],['templates','/settings/templates'],['users','/users'],['audit','/audit-log'],['notifs','/notifications'],['help','/help/user'],['newopp','/opportunities/new'],['newsol','/solicitations/new'],['gsa','/opportunities/import/gsa'],['billing','/settings/billing']];
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(180000);
    const shot = async (name) => { if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/wide-${theme}-${name}.png` }); };
    await page.goto(base + '/sign-in', { waitUntil: 'networkidle' });
    await page.fill('input[type=email]', 'demo@forge.test'); await page.fill('input[type=password]', 'ForgeDemo!2026');
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/sign-in')), page.click('button[type=submit]')]);
    for (const [name, path] of PAGES) { try { await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000); await shot(name); } catch (e) { console.log(theme, name, 'ERR', e.message.split('\n')[0]); } }
    try { await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.keyboard.press('Control+K'); await page.waitForTimeout(800); await shot('palette'); } catch (e) { console.log('palette ERR', e.message.split('\n')[0]); }
    await ctx.close();
  }
  await browser.close();
})();
