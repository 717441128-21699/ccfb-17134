import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1680, height: 1050 }
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__game');
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: 'shot-operations.png' });
await page.click('[data-page="environment"]');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shot-environment.png' });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shot-mobile.png' });
await browser.close();
console.log('shots saved');
