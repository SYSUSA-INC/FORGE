const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext()).newPage();
  const failed = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  await page.goto('http://localhost:3000/sign-in', { waitUntil: 'networkidle', timeout: 180000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(async () => {
    const h = document.querySelector('h1, h2');
    const html = getComputedStyle(document.documentElement);
    await document.fonts.ready;
    return {
      htmlClass: document.documentElement.className,
      varDisplay: html.getPropertyValue('--font-display'),
      varMono: html.getPropertyValue('--font-mono'),
      bodyFont: getComputedStyle(document.body).fontFamily,
      headFont: h && getComputedStyle(h).fontFamily,
      faces: Array.from(document.fonts).map((f) => `${f.family} ${f.weight} ${f.status}`),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  console.log('failed:', failed.join('\n'));
  await browser.close();
})();
