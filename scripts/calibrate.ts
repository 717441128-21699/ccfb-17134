/**
 * 物理标定:不依赖浏览器/DOM,直接跑滑行积分,
 * 验证 STONE 摩擦参数使标准状态前掷线用时 ≈ 24.5s,
 * 并检查削顶(接触面)、密度、霜、冰温变化时冰速的响应。
 * 运行:npm run calibrate
 */
import { RINK, STONE, PEBBLE } from '../src/engine/constants';
import { frictionCoefficient, contactFactor, densityFactor } from '../src/engine/friction';
import { IceField } from '../src/engine/icefield';
import { Rng } from '../src/engine/rng';
import { createPebbleArrays, applyPebble, scrapePebbles } from '../src/engine/pebble';

function simulate(contact: number, density: number, frostMm: number, iceTempC: number, reliefMm: number) {
  const g = 9.81;
  let x = -RINK.HOG_X - 0.5;
  let v = STONE.RELEASE_SPEED_MPS;
  let t = 0;
  let hogTime: number | null = null;
  let crossed = false;
  while (t < 200) {
    if (v < STONE.STOP_SPEED) break;
    const mu = frictionCoefficient({ speed: v, contactFraction: contact, densityPerM2: density, frostMm, iceTempC, reliefMm });
    v -= mu * g * STONE.DT;
    x += v * STONE.DT;
    t += STONE.DT;
    if (!crossed && x >= -RINK.HOG_X) {
      crossed = true;
      t = 0;
    }
    if (crossed && hogTime === null && x >= RINK.HOG_X) hogTime = t;
  }
  return { hogTime, stopX: x };
}

// 构造真实点面,量接触面对削顶的响应
const rng = new Rng(42);
const field = new IceField(rng);
const arr = createPebbleArrays(PEBBLE.MAX_INSTANCES);
const app = applyPebble(
  arr,
  { waterTempC: 48, tankHeightM: 0.4, nozzleMm: 4, walkSpeedMps: 1.2 },
  0,
  rng
);
for (let k = 0; k < arr.count; k++) arr.data[k * 6 + 5] = 1;
const baseDensity = app.batch.densityPerM2;

function contactAfterScrape(depthMm: number): number {
  const copy = createPebbleArrays(PEBBLE.MAX_INSTANCES);
  copy.data.set(arr.data);
  copy.count = arr.count;
  scrapePebbles(copy, depthMm);
  let sum = 0;
  let n = 0;
  for (let k = 0; k < copy.count; k++) {
    const o = k * 6;
    const cut = copy.data[o + 4];
    const r = copy.data[o + 2];
    const cr = Math.sqrt(Math.max(0, r * r - (r - cut) * (r - cut)));
    sum += (cr * cr) / (r * r);
    n++;
  }
  return n ? sum / n : 0;
}

let failures = 0;
const check = (name: string, cond: boolean, detail: string) => {
  console.log(`${cond ? '✓' : '✗'} ${name}  ${detail}`);
  if (!cond) failures++;
};

console.log('=== 基础布点 ===');
console.log(`点数 ${arr.count.toLocaleString()},密度 ${Math.round(baseDensity)}/m²`);

console.log('\n=== 接触面 vs 削顶深度 ===');
for (const d of [0.1, 0.3, 0.5, 0.7, 1.0, 1.4]) {
  console.log(`削顶 ${d.toFixed(1)}mm → 接触面 ${(contactAfterScrape(d) * 100).toFixed(1)}%  factor=${contactFactor(contactAfterScrape(d)).toFixed(3)}`);
}

console.log('\n=== 标准状态(contact≈0.30, 无霜, -5℃) ===');
const refContact = contactAfterScrape(0.55);
const ref = simulate(refContact, baseDensity, 0, -5, 0.3);
check('标准 hog 用时 22~27s', ref.hogTime !== null && ref.hogTime > 22 && ref.hogTime < 27, `hog=${ref.hogTime?.toFixed(1)}s stopX=${ref.stopX.toFixed(1)}m contact=${(refContact*100).toFixed(0)}%`);

console.log('\n=== 削顶扫描(冰速 U 型:过浅/过深都慢) ===');
let prevFactor = 0;
const factors: number[] = [];
for (const d of [0.1, 0.3, 0.55, 0.8, 1.2]) {
  const c = contactAfterScrape(d);
  const r = simulate(c, baseDensity, 0, -5, 0.3);
  factors.push(contactFactor(c));
  console.log(`削顶 ${d.toFixed(1)}mm contact=${(c * 100).toFixed(0)}% → hog=${r.hogTime?.toFixed(1) ?? '未抵达'}s`);
}
check('最佳削顶附近摩擦因子最小', factors[2] <= factors[1] && factors[2] <= factors[3], `factors=${factors.map((f) => f.toFixed(2)).join(',')}`);
void prevFactor;

console.log('\n=== 霜扫描(霜越厚越慢,但不应直接到不了) ===');
const frostHogs: number[] = [];
for (const f of [0, 0.1, 0.2, 0.35]) {
  const r = simulate(refContact, baseDensity, f, -5, 0.3);
  if (r.hogTime !== null) frostHogs.push(r.hogTime);
  console.log(`霜 ${f.toFixed(2)}mm → hog=${r.hogTime?.toFixed(1) ?? '未抵达(过慢)'}s`);
}
check('0.2mm 霜仍可抵达且明显变慢', frostHogs.length >= 3 && frostHogs[2] > (ref.hogTime ?? 0) + 1.5, `参考 ${ref.hogTime?.toFixed(1)}s`);

console.log('\n=== 冰温扫描 ===');
for (const temp of [-7, -5, -3]) {
  const r = simulate(refContact, baseDensity, 0, temp, 0.3);
  console.log(`冰温 ${temp}℃ → hog=${r.hogTime?.toFixed(1) ?? '未抵达'}s`);
}

console.log('\n=== 密度扫描 ===');
for (const d of [baseDensity * 0.5, baseDensity, baseDensity * 1.5]) {
  console.log(`密度 ${Math.round(d)}/m² factor=${densityFactor(d).toFixed(3)} → hog=${simulate(refContact, d, 0, -5, 0.3).hogTime?.toFixed(1) ?? '未抵达'}s`);
}

console.log('\n=== 无点光板冰(应显著变慢) ===');
const bare = simulate(0, baseDensity, 0, -5, 0.3);
check('光板冰显著慢于标准冰面', (bare.hogTime ?? 99) > (ref.hogTime ?? 0) + 3 || bare.hogTime === null, `hog=${bare.hogTime?.toFixed(1) ?? '未抵达'}s`);

console.log(`\n${failures === 0 ? '全部标定检查通过 ✅' : `有 ${failures} 项未通过 ❌`}`);
process.exit(failures === 0 ? 0 : 1);
