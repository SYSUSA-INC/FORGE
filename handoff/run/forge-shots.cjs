// Screenshot FORGE pages (signed in as the seeded demo user) in light and dark.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, label] = [process.argv[2], process.argv[3]];
  fs.mkdirSync(out, { recursive: true });
  const base = 'http://localhost:3000';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(180000);
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 400)); });
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 400)));
    const shot = async (name) => {
      if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${label}-${theme}-${name}.png` });
    };
    await page.goto(base + '/sign-in', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot('signin');
    await page.fill('input[type=email]', 'demo@forge.test');
    await page.fill('input[type=password]', 'ForgeDemo!2026');
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 180000 }), page.click('button[type=submit]')]);
    const pages = [['command', '/'], ['opps', '/opportunities'], ['sols', '/solicitations'], ['contacts', '/contacts'], ['kb', '/knowledge-base'], ['settings', '/settings']];
    for (const [name, path] of pages) {
      try {
        await page.goto(base + path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        await shot(name);
      } catch (e) { console.log(theme, name, 'ERR', e.message.split('\n')[0]); }
    }
    try {
      await page.goto(base + '/opportunities', { waitUntil: 'networkidle' });
      const href = await page.$$eval('a[href^="/opportunities/"]', (as) => as.map((a) => a.getAttribute('href')).find((h) => /^\/opportunities\/[0-9a-f-]{36}$/.test(h)));
      if (href) { await page.goto(base + href, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); await shot('opp'); }
      await page.goto(base + '/proposals', { waitUntil: 'networkidle' });
      const ph = await page.$$eval('a[href^="/proposals/"]', (as) => as.map((a) => a.getAttribute('href')).find((h) => /^\/proposals\/[0-9a-f-]{36}$/.test(h)));
      if (ph) { await page.goto(base + ph + '/sections', { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); await shot('sections'); }
    } catch (e) { console.log(theme, 'detail ERR', e.message.split('\n')[0]); }
    fs.writeFileSync(`${out}/${label}-${theme}-console.txt`, errs.join('\n'));
    await ctx.close();
  }
  await browser.close();
})();
