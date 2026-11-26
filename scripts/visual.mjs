import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1680, height: 1050 }
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.stack));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__game && !!window.__renderer');
  await new Promise(r => setTimeout(r, 500));

  const info = await page.evaluate(() => {
    const g = window.__game;
    const r = window.__renderer;
    g.state.flood.thicknessMm = 0.8;
    for (let i = 0; i < 3; i++) g.addFloodLayer();
    for (const l of g.state.layers) { l.completed = true; l.frozenThrough = true; l.elapsedS = l.neededS; }
    for (let i = 0; i < 14; i++) g.scrapeBase();
    g.startPebbleWalk();
    if (g.state.walk) { g.state.walk.elapsedS = g.state.walk.durationS; g.tick(0.016); }
    g.state.pebble.freezeRemainingS = 0;
    g.scrapePebbles();
    r.uploadPebbles(g.state);
    r.inspection = false;
    r.setView('panorama');
    r.resize();
    r.render(g.state, 1234);
    const url = r.canvas.toDataURL('image/png');
    const size = [r.canvas.width, r.canvas.height, r.canvas.clientWidth, r.canvas.clientHeight];
    return { url, size, count: g.state.pebbleDrawCount };
  });
  writeFileSync('canvas-operation.png', Buffer.from(info.url.split(',')[1], 'base64'));
  console.log('operation canvas', info.size, 'pebbles', info.count);

  const info2 = await page.evaluate(() => {
    const g = window.__game;
    const r = window.__renderer;
    r.inspection = true;
    r.setView('top');
    r.resize();
    r.render(g.state, 1234);
    return r.canvas.toDataURL('image/png');
  });
  writeFileSync('canvas-inspection.png', Buffer.from(info2.split(',')[1], 'base64'));
  await page.click('[data-page="inspection"]');
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'smoke-inspection-layout.png' });
  console.log('saved visual captures');
} finally {
  await browser.close();
}
