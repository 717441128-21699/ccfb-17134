import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.stack));
await page.setViewport({ width: 1366, height: 768 });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__game');

await page.click('[data-speed="60"]');
await page.evaluate(() => document.querySelector('#resetBtn').click());
const speedReset = await page.evaluate(() => ({
  scale: window.__game.state.timeScale,
  active: document.querySelector('[data-speed].active')?.dataset.speed
}));

await page.click('[data-speed="0"]');
await page.evaluate(() => {
  const el = document.querySelector('#envPipe');
  el.value = '-27';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const pausedEnv = await page.evaluate(() => ({
  iceC: window.__game.state.iceC,
  opPipe: document.querySelector('#opPipeTemp')?.textContent,
  eta: document.querySelector('#freezeEta')?.textContent,
  gaugeIce: document.querySelector('#gaugeIce')?.textContent
}));

await page.click('#scrapeBaseBtn');
const scrapeHint = await page.$eval('#baseScrapeHint', el => el.textContent);

const layout = await page.evaluate(() => {
  const r = document.querySelector('.telemetry-grid').getBoundingClientRect();
  return { bottom: Math.round(r.bottom), innerHeight, overflow: r.bottom > innerHeight - 2 };
});

const dual = await page.evaluate(() => {
  const g = window.__game;
  g.runTrial();
  return {
    leftSamples: g.state.lastTrial.samples.length,
    rightSamples: g.state.lastTrial.rightSamples.length,
    rightS: g.state.lastTrial.rightS
  };
});

await page.evaluate(() => document.querySelector('#completeEndBtn').click());
await new Promise(r => setTimeout(r, 100));
const crowdSync = await page.evaluate(() => ({
  state: window.__game.state.crowdPct,
  slider: parseFloat(document.querySelector('#crowd').value),
  label: document.querySelector('#crowdVal').textContent
}));

console.log(JSON.stringify({ speedReset, pausedEnv, scrapeHint, layout, dual, crowdSync, errors }, null, 2));
await browser.close();
if (errors.length || speedReset.active !== '180' || layout.overflow) process.exit(1);
