import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(6000);

// RESIZE: drag the hype widget's bottom-right handle down by ~60px
const handle = page.locator('.react-grid-item >> .react-resizable-handle').first();
const hb = await handle.boundingBox();
const before = await page.locator('.react-grid-item').first().getAttribute('style');
await page.mouse.move(hb.x + 5, hb.y + 5);
await page.mouse.down();
await page.mouse.move(hb.x + 5, hb.y + 65, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(400);
const after = await page.locator('.react-grid-item').first().getAttribute('style');
console.log('RESIZE WORKED:', before !== after, '\n before:', before, '\n after: ', after);

// HIDE: hover hype widget, click eye-off
const itemCount = async () => await page.locator('.react-grid-item').count();
await page.locator('.react-grid-item').first().hover();
await page.locator('.react-grid-item button[title="Hide widget"]').first().click();
await page.waitForTimeout(400);
console.log('HIDE WORKED:', (await itemCount()) === 3);

// SHOW AGAIN via menu
await page.getByText('Widgets').click();
await page.getByText('Hype score & trend').click();
await page.waitForTimeout(400);
console.log('SHOW WORKED:', (await itemCount()) === 4);
await browser.close();
