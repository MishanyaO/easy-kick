import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(65000); // deep into the loop: annotations + shoutouts populated
const text = await page.locator('body').innerText();
for (const probe of ['opened the case', 'PEOPLE TO SHOUT OUT', '× normal', 'first message ever']) {
  console.log(probe, '=>', text.includes(probe));
}
await page.screenshot({ path: 'scripts/center-check.png' });
await browser.close();
