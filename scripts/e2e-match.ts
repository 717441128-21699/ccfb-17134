// 完整赛事流程 E2E:6 局、评分、局间重洒、湿度结霜影响(按阶段文本等待,不写死睡眠)
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// 制冰:5 层 + 冻透 + 洒点 + 削顶
for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '浇一层水' }).click();
await page.getByRole('button', { name: '128×' }).click();
await page.waitForTimeout(11000);
await page.getByRole('button', { name: '背水箱倒退洒点' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '刮刀削平点顶' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '冰面检测' }).click();
await page.waitForTimeout(300);
const visible = await page.evaluate(() =>
  [...document.querySelectorAll('.stat-v')].map((e) => e.textContent)[4]);
console.log('可见实例:', visible);

await page.getByRole('button', { name: '场馆环境' }).click();
await page.getByRole('button', { name: '开赛(进入第 1 局)' }).click();

const phase = () => page.locator('.phase').textContent();
for (let end = 1; end <= 6; end++) {
  // 等本局结束(最后一局等“赛事结束”)
  await page.waitForFunction(
    (n) => document.querySelector('.phase')?.textContent?.includes(n === 6 ? '赛事结束' : '局间维护') ?? false,
    end, { timeout: 30000 },
  );
  console.log(`第 ${end} 局结束 ->`, await phase());
  if (end < 6) {
    await page.getByRole('button', { name: '制冰作业' }).click();
    await page.getByRole('button', { name: '重新洒点(覆盖旧点)' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '场馆环境' }).click();
    await page.getByRole('button', { name: '局间维护完成,进入下一局' }).click();
    await page.waitForFunction(
      (n) => document.querySelector('.phase')?.textContent?.includes(`第 ${n}/`) ?? false,
      end + 1, { timeout: 5000 },
    );
    console.log(`  -> 进入第 ${end + 1} 局`);
  }
}

await page.getByRole('button', { name: '赛事评价' }).click();
await page.waitForSelector('.score-card', { timeout: 5000 });
const scoreCards = await page.locator('.score-card').count();
const grades = await page.locator('.grade').allInnerTexts();
const bigScore = await page.locator('.big-num').textContent();
const notes = await page.locator('.notes li').first().textContent();
console.log('评分卡数量:', scoreCards);
console.log('等级:', JSON.stringify(grades));
console.log('累计均分:', bigScore, '| 评语示例:', notes);

const ok = scoreCards === 6 && grades.length === 6 && errors.length === 0;
console.log(ok ? '\n完整赛事流程通过' : `\n流程失败 errors=${errors.slice(0, 3)}`);
await browser.close();
process.exit(ok ? 0 : 1);
