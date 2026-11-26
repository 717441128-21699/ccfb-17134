import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1680, height: 1050 }
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.stack));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE.ERROR', m.text()); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__renderer');
const result = await page.evaluate(() => {
  const r = window.__renderer;
  const g = window.__game;
  r.resize();
  r.render(g.state, performance.now());
  const gl = r.gl;
  const w = r.canvas.width, h = r.canvas.height;
  const pixels = new Uint8Array(4 * 9);
  const read = (x, y) => {
    const b = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return Array.from(b);
  };
  const samples = {
    center: read(Math.floor(w / 2), Math.floor(h / 2)),
    p1: read(Math.floor(w * .45), Math.floor(h * .55)),
    p2: read(Math.floor(w * .55), Math.floor(h * .45)),
    corner: read(10, 10)
  };
  return { w, h, client: [r.canvas.clientWidth, r.canvas.clientHeight], samples, err: gl.getError() };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
