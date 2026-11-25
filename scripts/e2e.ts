// 浏览器端 E2E:经 CDP 驱动真实 Chrome(swiftshader),验证 WebGL2 渲染与完整流程
import { chromium } from 'playwright-core';

const url = 'http://localhost:5199/';
const results: { name: string; ok: boolean; info?: string }[] = [];
function rec(name: string, ok: boolean, info = '') {
  results.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name} ${info}`);
}

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1. WebGL2 上下文与帧率
const glInfo = await page.evaluate(() => {
  const c = document.getElementById('gl') as HTMLCanvasElement;
  const gl = c.getContext('webgl2');
  return {
    hasGL2: !!gl,
    renderer: gl?.getParameter(gl.VERSION),
    canvasSize: [c.width, c.height],
  };
});
rec('WebGL2 上下文创建', !!glInfo.hasGL2, glInfo.renderer ?? '');

// 2. 浇 5 层水并加速冻结
for (let i = 0; i < 5; i++) {
  await page.getByRole('button', { name: '浇一层水' }).click();
}
await page.getByRole('button', { name: '128×' }).click();
await page.waitForTimeout(11000); // 128× → 约 23 仿真分钟,足够 5 层冻透
const frozen = await page.evaluate(() => {
  const tags = [...document.querySelectorAll('.layer-row .tag')].map((e) => e.textContent);
  return tags.every((t) => t?.includes('已冻透')) && tags.length === 5;
});
rec('5 层冰全部冻透', frozen);

// 3. 洒点
await page.getByRole('button', { name: '背水箱倒退洒点' }).click();
await page.waitForTimeout(800);
const pebInfo = await page.evaluate(() => {
  const txt = document.querySelector('#hud')?.textContent ?? '';
  const m = txt.match(/卵石\s*([\d.]+)万/);
  return { wan: m ? Number(m[1]) : 0, hud: txt };
});
rec('洒点达数十万个', pebInfo.wan >= 10, `(${pebInfo.wan}万)`);

// 4. 检测页:标红 + 试滑
await page.getByRole('button', { name: '冰面检测' }).click();
await page.waitForTimeout(500);
const flat = await page.evaluate(() => {
  const stats = [...document.querySelectorAll('.stat-v')].map((e) => e.textContent);
  return stats;
});
rec('检测页显示高低差与分区', flat.length >= 6, `(${flat.slice(0, 3).join(' | ')})`);
await page.getByRole('button', { name: '试滑:顺时针壶' }).click();
await page.waitForTimeout(600);
const throwRow = await page.evaluate(() =>
  document.querySelector('.throw-row')?.textContent ?? '');
rec('试滑壶产生计时记录', /\d+\.\d+\s*s/.test(throwRow), `(${throwRow.slice(0, 40)})`);

// 5. 帧率与视锥裁剪
await page.getByRole('button', { name: '冰面检测' }).click();
await page.waitForTimeout(400);
const visibleFar = await page.evaluate(() =>
  Number(([...document.querySelectorAll('.stat-v')].map((e) => e.textContent)[4] ?? '0')
    .replace(/,/g, '')));
// 拉近相机:视野内实例应大幅减少
await page.evaluate(() => {
  const r = (window as any).__renderer();
  r.cam.dist = 9; r.cam.pitch = 0.7;
  r.invalidateVisibility();
});
await page.waitForTimeout(900);
const visibleNear = await page.evaluate(() =>
  Number(([...document.querySelectorAll('.stat-v')].map((e) => e.textContent)[4] ?? '0')
    .replace(/,/g, '')));
rec('视锥/距离裁剪生效(拉近后可见量明显下降)',
  visibleNear < visibleFar * 0.5, `(${visibleFar.toLocaleString()} → ${visibleNear.toLocaleString()})`);
await page.getByRole('button', { name: '制冰作业' }).click();
await page.waitForTimeout(3500); // 等待自适应分辨率生效
const fps = await page.evaluate(() => {
  const m = document.querySelector('#hud')?.textContent?.match(/FPS\s*(\d+)/);
  return m ? Number(m[1]) : 0;
});
rec('渲染帧率 ≥ 25(软件渲染基准;真机 GPU 目标 60)', fps >= 25, `(${fps} FPS)`);

// 6. 开赛与环境页(等待阶段文本,不用固定睡眠)
await page.getByRole('button', { name: '场馆环境' }).click();
await page.getByRole('button', { name: '开赛(进入第 1 局)' }).click();
await page.waitForFunction(
  () => document.querySelector('.phase')?.textContent?.includes('第 1') ?? false,
  { timeout: 8000 },
);
const phase = await page.evaluate(() => document.querySelector('.phase')?.textContent ?? '');
rec('比赛正常开始', phase.includes('第 1'), `(${phase})`);

// 7. 赛事评价页无报错渲染
await page.getByRole('button', { name: '赛事评价' }).click();
await page.waitForTimeout(300);
const eventOk = await page.evaluate(() =>
  !!document.querySelector('.event-page .card'));
rec('赛事评价页渲染', eventOk);

rec('全程无 JS/WebGL 报错', errors.length === 0,
  errors.length ? errors.slice(0, 3).join(' | ') : '');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
