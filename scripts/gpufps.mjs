import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl']
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__game && !!window.__renderer');
const glInfo = await page.evaluate(() => {
  const gl = window.__renderer.gl;
  return { renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR) };
});
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 3; i++) g.addFloodLayer();
  g.startPebbleWalk();
  if (g.state.walk) { g.state.walk.elapsedS = g.state.walk.durationS; g.tick(0.016); }
  g.state.pebble.freezeRemainingS = 0;
  g.scrapePebbles();
  window.__renderer.uploadPebbles(g.state);
});
await new Promise(r => setTimeout(r, 6000));
const fps = await page.evaluate(() => document.querySelector('#hudFps')?.textContent);
console.log(JSON.stringify({ ...glInfo, fps }, null, 2));
await browser.close();
