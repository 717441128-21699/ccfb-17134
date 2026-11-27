/**
 * 玩法规则验证(无浏览器,直接测引擎):
 * 1. 厚层未冻透即洒点 → 判废
 * 2. 高湿结霜 → 霜厚增长、冰速下降
 * 3. 差均匀度厚冰 → 红格(高低差>1mm)
 * 4. 三种场馆/制冷系统参数差异化
 */
import { Simulation } from '../src/engine/simulation';
import { FROST } from '../src/engine/constants';
import { launchTestStone } from '../src/engine/stone';
import { VENUES, SYSTEMS } from '../src/engine/venues';

let fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}  ${detail}`);
  if (!cond) fail++;
};

// 1. 厚层未冻透判废
{
  const sim = new Simulation();
  sim.addFlood({ thicknessMm: 12, waterTempC: 60, uniformity: 0.6 }); // 厚且热
  const before = sim.penalties.length;
  sim.addPebble({ waterTempC: 48, tankHeightM: 0.4, nozzleMm: 4, walkSpeedMps: 1.2 });
  ok('厚层未冻透即洒点 → 判废', sim.penalties.length === before + 1);
  ok('判废时不产生卵石点', sim.pebbles.count === 0);
}

// 2. 结霜拖慢冰速
{
  const sim = new Simulation();
  // 做出一块合格冰面(与冒烟流程一致:刮两次到接触面 ~50%)
  for (let i = 0; i < 6; i++) sim.addFlood({ thicknessMm: 5, waterTempC: 45, uniformity: 0.95 });
  sim.layers.forEach((l) => (l.freezeFraction = 1));
  sim.field.onLayerFrozen();
  sim.addPebble({ waterTempC: 48, tankHeightM: 0.4, nozzleMm: 4, walkSpeedMps: 1.2 });
  // 走真实冻结:高倍速推进模拟时间直到点冻硬
  sim.speed = 7200;
  for (let i = 0; i < 60 && sim.pebbleCountUnfrozen() > 0; i++) sim.advance(0.1);
  sim.speed = 0;
  sim.scrape(0.5);
  sim.scrape(0.4);

  const baseCtx = { field: sim.field, contactFraction: sim.contactFraction, densityPerM2: sim.pebbleDensity, iceTempC: -5 };
  const dry = launchTestStone(baseCtx, 1, 0);
  // 人工制造霜层后用同一份接触参数再发
  for (let i = 0; i < sim.field.frost.length; i++) sim.field.frost[i] = 0.25;
  const frosty = launchTestStone({ ...baseCtx, field: sim.field }, 1, 1);
  ok('无霜时壶能抵达', dry.hogTimeS !== null, `hog=${dry.hogTimeS?.toFixed(1)}s 接触面=${(sim.contactFraction * 100).toFixed(0)}%`);
  ok('结霜后冰速下降(hog 变长或到不了)',
    frosty.hogTimeS === null || (dry.hogTimeS !== null && frosty.hogTimeS > dry.hogTimeS + 1),
    `干 ${dry.hogTimeS?.toFixed(1)}s → 霜 ${frosty.hogTimeS?.toFixed(1) ?? '未抵达'}s`);
}

// 3. 结霜模型:超阈值湿度 + 冰温低于露点 → 霜增长
{
  const sim = new Simulation();
  const f0 = sim.frostMm;
  sim.setRh(0.85);
  // 推足够长时间(管温低,冰温低于露点)
  for (let i = 0; i < 4000; i++) (sim as unknown as { tick: (d: number) => void }).tick.call(sim, 10);
  ok('高湿环境下霜厚增长', sim.frostMm > f0 + 0.02, `${f0.toFixed(3)} → ${sim.frostMm.toFixed(3)}mm`);
  ok('霜不超过上限', sim.frostMm <= FROST.MAX_MM + 1e-6);
}

// 4. 差均匀度 → 高低差/红格
{
  const sim = new Simulation();
  const { IceField } = await import('../src/engine/icefield');
  const { Rng } = await import('../src/engine/rng');
  const field = new IceField(new Rng(3));
  for (let i = 0; i < 4; i++) { field.addFlood(10, 0.5, new Rng(i)); field.onLayerFrozen(); }
  const red = field.redCellRatio(1);
  console.log(`  差均匀度厚冰:高低差 ${field.reliefMm().toFixed(2)}mm,红格 ${(red * 100).toFixed(1)}%`);
  ok('差工艺可产生平整度问题', field.reliefMm() > 0.5);
}

// 5. 场馆与系统差异化
ok('三个场馆', VENUES.length === 3);
ok('三套制冷系统', SYSTEMS.length === 3);
const sorted = [...SYSTEMS].sort((a, b) => a.responseTauS - b.responseTauS);
ok('系统响应速度有差异(CO2 最快)', sorted[0].id === 'direct-co2', `${sorted[0].name} τ=${sorted[0].responseTauS}s`);

// 6. 削顶接触面响应
{
  const sim = new Simulation();
  for (let i = 0; i < 6; i++) sim.addFlood({ thicknessMm: 5, waterTempC: 45, uniformity: 0.95 });
  sim.layers.forEach((l) => (l.freezeFraction = 1));
  sim.addPebble({ waterTempC: 48, tankHeightM: 0.4, nozzleMm: 4, walkSpeedMps: 1.2 });
  sim.speed = 7200;
  for (let i = 0; i < 60 && sim.pebbleCountUnfrozen() > 0; i++) sim.advance(0.1);
  sim.speed = 0;
  const c0 = sim.contactFraction; // 未削顶,接触≈0
  const n0 = sim.pebbles.count;
  sim.scrape(0.3); // 浅削,不会削穿
  const c1 = sim.contactFraction;
  ok('浅刮提升接触面且保留点', c1 > c0 + 0.1 && sim.pebbles.count > n0 * 0.9,
    `${(c0 * 100).toFixed(0)}% → ${(c1 * 100).toFixed(0)}%,点 ${sim.pebbles.count}`);
}

console.log(fail === 0 ? '\n玩法规则全部通过 ✅' : `\n${fail} 项失败 ❌`);
process.exit(fail ? 1 : 0);
