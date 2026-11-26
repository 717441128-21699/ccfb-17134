import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:4173/';

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  protocolTimeout: 30000,
  args: [
    '--no-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--window-size=1680,1050'
  ],
  defaultViewport: { width: 1680, height: 1050, deviceScaleFactor: 1 }
});

try {
  const page = await browser.newPage();
  const messages = [];
  page.on('console', (msg) => messages.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => messages.push(`[pageerror] ${err.stack || err.message}`));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction('!!window.__game && !!window.__renderer', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1000));

  const initial = await page.evaluate(() => {
    const g = window.__game;
    return {
      hasGl: !!window.__renderer,
      errorHidden: document.querySelector('#webglError')?.hidden,
      flatMax: g.state.flatness.maxLocalDifferenceMm,
      redArea: g.state.flatness.redAreaPct,
      fps: document.querySelector('#hudFps')?.textContent
    };
  });
  console.log('INITIAL', JSON.stringify(initial));
  await page.screenshot({ path: 'smoke-initial.png' });

  const flow = await page.evaluate(() => {
    const g = window.__game;
    const r = window.__renderer;
    g.setTimeScale(600);
    g.state.flood.thicknessMm = 0.8;
    g.state.flood.waterC = 42;
    for (let i = 0; i < 3; i++) g.addFloodLayer();
    for (const l of g.state.layers) {
      l.elapsedS = l.neededS;
      l.completed = true;
      l.frozenThrough = true;
    }
    for (let i = 0; i < 14; i++) g.scrapeBase();

    g.startPebbleWalk();
    const s = g.state;
    if (s.walk) {
      s.walk.elapsedS = s.walk.durationS;
      g.tick(0.016);
    }
    s.pebble.freezeRemainingS = 0;
    g.scrapePebbles();
    r.uploadPebbles(s);
    g.runTrial();

    return {
      layers: s.layers.length,
      flatMax: s.flatness.maxLocalDifferenceMm,
      redArea: s.flatness.redAreaPct,
      pebbles: s.pebble.count,
      density: s.pebble.densityPerM2,
      cut: s.pebble.cutMm,
      contact: s.pebble.contactFraction,
      trial: s.lastTrial && {
        total: s.lastTrial.totalS,
        left: s.lastTrial.leftS,
        right: s.lastTrial.rightS,
        drift: s.lastTrial.driftCm,
        reached: s.lastTrial.reached,
        score: s.lastTrial.score
      }
    };
  });
  console.log('FLOW', JSON.stringify(flow, null, 2));

  await page.click('[data-page="inspection"]');
  await new Promise((r) => setTimeout(r, 6500));
  await page.screenshot({ path: 'smoke-inspection.png' });
  const hud = await page.evaluate(() => ({
    avg: document.querySelector('#avgTime')?.textContent,
    red: document.querySelector('#redArea')?.textContent,
    pebbles: document.querySelector('#hudPebbles')?.textContent,
    fps: document.querySelector('#hudFps')?.textContent,
    glErrorHidden: document.querySelector('#webglError')?.hidden
  }));
  console.log('HUD', JSON.stringify(hud));

  const evaluation = await page.evaluate(() => {
    const g = window.__game;
    const report = g.completeEnd();
    return report ? {
      end: report.end,
      total: report.scores.total,
      speed: report.scores.speed,
      symmetry: report.scores.symmetry,
      line: report.scores.line,
      freeze: report.scores.freeze,
      iceSpeed: report.iceSpeedS,
      recommendations: report.recommendations
    } : null;
  });
  console.log('EVAL', JSON.stringify(evaluation, null, 2));
  await page.click('[data-page="evaluation"]');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: 'smoke-evaluation.png' });

  const ruin = await page.evaluate(() => {
    const g = window.__game;
    g.reset('aurora');
    g.state.flood.thicknessMm = 3.2;
    g.addFloodLayer();
    g.startPebbleWalk();
    return { ruined: g.state.ruined, phase: g.state.phase, reason: g.state.ruinReason };
  });
  console.log('RUIN', JSON.stringify(ruin));

  const serious = messages.filter((m) => m.includes('[pageerror]') || (m.includes('[error]') && !m.includes('404')));
  console.log('SERIOUS_MESSAGES', serious.length ? serious.join('\n') : '(none)');
  if (serious.length || !initial.hasGl || initial.errorHidden === false) process.exitCode = 1;
} finally {
  await browser.close();
}
