import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => console.log('[console]', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(6000); // let stream warm up

const info = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.react-grid-item')].map((el) => ({
    cls: el.className,
    style: el.getAttribute('style'),
  }));
  const handle = document.querySelector('.widget-handle');
  const resize = document.querySelector('.react-resizable-handle');
  return { items, hasHandle: !!handle, hasResize: !!resize };
});
console.log(JSON.stringify(info, null, 2));

// try dragging the hype widget by its grip
const grip = page.locator('.widget-handle').first();
const box = await grip.boundingBox();
console.log('grip box', box);
if (box) {
  const before = await page.locator('.react-grid-item').first().getAttribute('style');
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 250, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.locator('.react-grid-item').first().getAttribute('style');
  console.log('BEFORE:', before);
  console.log('AFTER: ', after);
  console.log('DRAG WORKED:', before !== after);
}
await browser.close();
