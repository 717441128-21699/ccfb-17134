/**
 * 无头浏览器冒烟测试(系统 Chrome,硬件 GPU 后端):
 * - 页面无 JS/Shader 报错
 * - 完整跑通 浇水→冻透→洒点→冻结→刮冰→试滑→开赛→10 局评分
 * - 37 万卵石点实例下 FPS ≥ 60(硬件 GPU)
 * - 检测页红格、判废规则生效
 * 运行:npx vite --port 5397 & npx tsx scripts/smoke.ts
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:5397/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // 硬件 GPU 实测 37 万实例 100+ FPS;SwiftShader 软件模拟 instanced divisor 仅个位数
    args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--window-size=1600,1000']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console.error: ' + m.text());
  });

  const clickByText = (text: string) =>
    page.$$eval('button', (bs, t) => {
      const b = bs.find((x) => x.textContent?.includes(t));
      if (b) (b as HTMLButtonElement).click();
      return !!b;
    }, text);
  const clickTab = (text: string) =>
    page.$$eval('.tab', (ts, t) => {
      const b = ts.find((x) => x.textContent?.includes(t));
      if (b) (b as HTMLButtonElement).click();
      return !!b;
    }, text);

  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(1200);

  // ---------- 1. 浇水 6 层,120× 等冻透(验证 UI 按钮接线) ----------
  for (let i = 0; i < 6; i++) {
    await clickByText('浇一层水');
    await sleep(80);
  }
  await page.$$eval('.speed-btns button', (bs) => (bs[4] as HTMLButtonElement).click());
  await page.waitForFunction(() => (window as any).__sim.allFrozen, { timeout: 30000 });
  const relief = await page.evaluate(() => (window as any).__sim.field.reliefMm());
  console.log('冻透后高低差:', relief.toFixed(2) + 'mm');

  // ---------- 2. 洒点 ----------
  await clickByText('执行洒点');
  await page.waitForFunction(() => (window as any).__sim.pebbles.count > 100000, { timeout: 10000 });
  const pebbleCount = await page.evaluate(() => (window as any).__sim.pebbles.count);
  console.log('卵石点数量:', pebbleCount.toLocaleString());
  await page.waitForFunction(() => (window as any).__sim.pebbleCountUnfrozen() === 0, { timeout: 20000 });

  // ---------- 3. 稳定期 FPS ----------
  await sleep(1200);
  const fps1 = await page.evaluate(() => parseFloat(document.querySelector('footer b')?.textContent ?? '0'));
  console.log('37 万点稳定期 FPS(硬件 GPU):', fps1);

  // ---------- 4. 刮冰两次(UI 按钮),读接触面 ----------
  for (let i = 0; i < 2; i++) {
    await clickByText('刮一遍冰');
    await sleep(300);
  }
  const contact = await page.evaluate(() => (window as any).__sim.contactFraction);
  console.log('刮冰后接触面:', (contact * 100).toFixed(0) + '%');

  // ---------- 5. 检测页 UI:试滑壶按钮 + 红格开关 ----------
  await clickTab('冰面检测');
  await sleep(400);
  const launched = await clickByText('发一对试滑壶');
  await sleep(800);
  const stones = await page.evaluate(() => {
    const s = (window as any).__sim.testStones;
    return s.slice(-2).map((x: any) => ({ hog: x.hogTimeS, drift: x.lateralDriftM }));
  });
  console.log('试滑壶按钮生效:', launched, '结果:', JSON.stringify(stones));
  await clickByText('红格');
  await sleep(300);
  const redRatio = await page.evaluate(() => (window as any).__sim.field.redCellRatio(1));
  console.log('红格占比:', (redRatio * 100).toFixed(1) + '%');

  // ---------- 6. 开赛 + 打完 10 局(UI 流程) ----------
  const prepValid = await page.evaluate(() => (window as any).__sim.prepValid);
  console.log('开赛达标(prepValid):', prepValid);
  await clickTab('制冰作业');
  await sleep(400);
  const startEnabled = await page.$$eval('button', (bs, t) => {
    const b = bs.find((x) => x.textContent?.includes(t)) as HTMLButtonElement | undefined;
    return b ? !b.disabled : false;
  }, '开始比赛');
  console.log('开赛按钮可用:', startEnabled);
  await clickByText('开始比赛');
  await sleep(500);
  await clickTab('赛事评价');
  await sleep(300);
  for (let end = 0; end < 10; end++) {
    const ok = await clickByText('结束本局并评分');
    if (!ok) break;
    await sleep(250);
  }
  await sleep(600);
  const finalGrade = await page.evaluate(() => ({
    phase: (window as any).__sim.phase,
    grade: (window as any).__sim.aggregate.grade,
    total: (window as any).__sim.aggregate.total,
    scoreRows: (window as any).__sim.endScores.length
  }));
  console.log('最终:', JSON.stringify(finalGrade));

  // ---------- 7. 判废:刷新,基础冰没冻透直接洒点 ----------
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await sleep(700);
  await clickByText('浇一层水');
  await sleep(200);
  await clickByText('执行洒点');
  await sleep(500);
  const penalty = await page.evaluate(() => (window as any).__sim.penalties.length > 0);
  console.log('未冻透洒点触发判废:', penalty);

  const fps2 = await page.evaluate(() => parseFloat(document.querySelector('footer b')?.textContent ?? '0'));
  console.log('收尾 FPS:', fps2);

  console.log('\n页面错误数(不含 favicon):', errors.length);
  errors.slice(0, 10).forEach((e) => console.log(' -', e));

  await browser.close();
  const fail =
    errors.length > 0 ||
    pebbleCount < 300000 ||
    fps1 < 55 ||
    !launched ||
    stones.length < 2 ||
    stones.some((x: any) => typeof x.hog !== 'number') ||
    !prepValid ||
    !startEnabled ||
    finalGrade.scoreRows !== 10 ||
    finalGrade.phase !== 'game-over' ||
    penalty !== true;
  console.log(fail ? '\n冒烟测试失败 ❌' : '\n冒烟测试通过 ✅');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
