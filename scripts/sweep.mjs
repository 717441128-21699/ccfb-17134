import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__game');
const rows = await page.evaluate(() => {
  const g = window.__game;
  const s = g.state;
  s.pebble.applied = true;
  s.pebble.uniformityPct = 96;
  s.pebble.wornFactor = 1;
  s.pebble.ageEnds = 0;
  s.frost = 0;
  s.iceC = -4.6;
  const out = [];
  for (const density of [600, 1000, 1550, 2100, 2800]) {
    for (const cut of [0.05, 0.18, 0.45, 0.8]) {
      s.pebble.densityPerM2 = density;
      s.pebble.contactFraction = Math.min(0.05, density * Math.PI * (cut * 0.0011) ** 2);
      g.runTrial();
      out.push({ density, cut, t: +s.lastTrial.totalS.toFixed(2), mu: +s.lastTrial.mu.toFixed(4), reached: s.lastTrial.reached });
    }
  }
  const frost = [];
  for (const f of [0, .25, .5, .9]) {
    s.pebble.densityPerM2 = 1550;
    s.pebble.contactFraction = .003;
    s.frost = f;
    g.runTrial();
    frost.push({ f, t: +s.lastTrial.totalS.toFixed(2), mu: +s.lastTrial.mu.toFixed(4) });
  }
  return { out, frost };
});
console.table(rows.out);
console.table(rows.frost);
await browser.close();
