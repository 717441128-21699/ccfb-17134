// Node 冒烟测试:验证物理模型数值与完整制冰流程(不依赖浏览器)
import { Simulation } from '../src/sim/Simulation';
import { freezeTimeS, frictionCoefficient, dropletDiameterMm, pebbleGeometry,
  cutContactFraction, frostPotential } from '../src/sim/physics';
import { FRIDGES, VENUES } from '../src/sim/constants';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) console.log(`  ✓ ${name} ${extra}`);
  else { console.error(`  ✗ ${name} ${extra}`); failures++; }
}

console.log('1. Stefan 冻结时间');
{
  const t5 = freezeTimeS(0.005, 45, -6.5);
  const t20 = freezeTimeS(0.02, 45, -6.5);
  check('5mm 层在数分钟量级', t5 > 60 && t5 < 900, `(${ (t5 / 60).toFixed(1) }min)`);
  check('厚度 4 倍 → 时间约 16 倍', Math.abs(t20 / t5 - 16) < 0.5,
    `(ratio=${(t20 / t5).toFixed(1)})`);
  const tWarm = freezeTimeS(0.005, 75, -6.5);
  check('水温越高冻得越慢', tWarm > t5);
  const tWeak = freezeTimeS(0.005, 45, -3);
  check('弱机组(接触温度高)冻得更慢', tWeak > t5);
}

console.log('2. 水滴与卵石几何');
{
  const dSmall = dropletDiameterMm(0.5, 7, 8, 1.6, 50);
  const dBig = dropletDiameterMm(1.1, 12, 4, 0.6, 20);
  check('滴径为亚毫米~毫米级', dSmall > 0.2 && dSmall < 4, `(${dSmall.toFixed(2)}mm)`);
  check('低水头大孔 → 滴更大', dBig > dSmall, `(${dBig.toFixed(2)} vs ${dSmall.toFixed(2)})`);
  const g = pebbleGeometry(dSmall, -5);
  check('卵石底径约为滴径 2~2.65 倍',
    g.baseR * 2 / dSmall > 1.9 && g.baseR * 2 / dSmall < 2.8);
  const vol = (Math.PI * g.capH / 6) * (3 * g.baseR ** 2 + g.capH ** 2);
  const vDrop = Math.PI / 6 * dSmall ** 3;
  check('球冠体积守恒', Math.abs(vol / vDrop - 1) < 0.02,
    `(ratio=${(vol / vDrop).toFixed(3)})`);
  const c0 = cutContactFraction(g.baseR, g.sphereR, g.capH, 0);
  const c50 = cutContactFraction(g.baseR, g.sphereR, g.capH, 0.5);
  check('削顶增大接触比例', c50 > c0, `(${c0.toFixed(2)}→${c50.toFixed(2)})`);
}

console.log('3. 摩擦与冰速方向');
{
  const fast = frictionCoefficient({ contactFraction: 0.2, density: 30000, iceTempC: -4, frost: 0, wear: 0 });
  const slow = frictionCoefficient({ contactFraction: 0.8, density: 8000, iceTempC: -7, frost: 0.8, wear: 0.6 });
  check('密点+轻削+无霜 → 摩擦低(冰快)', fast < slow,
    `(${(fast * 1000).toFixed(2)} vs ${(slow * 1000).toFixed(2)})`);
  const fpDry = frostPotential(12, 30, -6);
  const fpHumid = frostPotential(14, 80, -6);
  check('高湿结霜倾向大', fpHumid > fpDry, `(${fpHumid.toFixed(2)} vs ${fpDry.toFixed(2)})`);
}

console.log('4. 完整制冰流程');
{
  const sim = new Simulation('beichen', 'hanquan');
  check('初始无洒点资格(层数不足)', !sim.canSpray);
  const rejected = sim.spray({
    tankHeadM: 1.1, orificeMm: 0.6, nozzleCount: 8, headWidthM: 1.6,
    waterTempC: 48, walkSpeed: 1.1, flowLmin: 7,
  });
  check('未达条件洒点被拒(防判废)', rejected === null);

  for (let i = 0; i < 5; i++) {
    sim.flood({ thicknessMm: 6, waterTempC: 45 });
  }
  check('未冻透仍不可洒点', !sim.canSpray);
  for (let i = 0; i < 400; i++) sim.tick(30); // 推进 200 分钟
  check('5 层全部冻透', sim.layers.every((l) => l.frozen));
  check('冻透后获得洒点资格', sim.canSpray);

  const spray = sim.spray({
    tankHeadM: 1.1, orificeMm: 0.6, nozzleCount: 8, headWidthM: 1.6,
    waterTempC: 48, walkSpeed: 1.1, flowLmin: 7,
  });
  check('洒点成功且达数十万级', spray !== null && spray!.count > 100000,
    `(${spray?.count.toLocaleString()} 个)`);
  check('24 分区都有密度数据', sim.zones.every((z) => z.density > 0));

  // 走速/流量对密度的方向性影响(新实例避免被缓冲上限钳制)
  const slow = new Simulation('beichen', 'hanquan');
  for (let i = 0; i < 5; i++) slow.flood({ thicknessMm: 4, waterTempC: 40 });
  for (let i = 0; i < 300; i++) slow.tick(30);
  const pSlow = slow.spray({
    tankHeadM: 1.0, orificeMm: 0.6, nozzleCount: 8, headWidthM: 1.6,
    waterTempC: 45, walkSpeed: 0.5, flowLmin: 7,
  });
  const pFast = new Simulation('beichen', 'hanquan');
  for (let i = 0; i < 5; i++) pFast.flood({ thicknessMm: 4, waterTempC: 40 });
  for (let i = 0; i < 300; i++) pFast.tick(30);
  const pFastRec = pFast.spray({
    tankHeadM: 1.0, orificeMm: 0.6, nozzleCount: 8, headWidthM: 1.6,
    waterTempC: 45, walkSpeed: 2.2, flowLmin: 7,
  });
  check('倒退走速越快密度越低', pSlow!.density > pFastRec!.density,
    `(${Math.round(pSlow!.density)} vs ${Math.round(pFastRec!.density)}/m²)`);

  const hogBefore = sim.zones.reduce((s, z) => s + z.hogSeconds, 0) / sim.zones.length;
  sim.cut(0.35);
  const hogAfter = sim.zones.reduce((s, z) => s + z.hogSeconds, 0) / sim.zones.length;
  check('削顶越多冰越慢(hog 秒数增加)', hogAfter > hogBefore,
    `(${hogBefore.toFixed(2)}s → ${hogAfter.toFixed(2)}s)`);

  const th = sim.throwStone('cw');
  check('试滑壶完成 hog-to-hog(35% 削顶仍可过线)', th.hogSeconds > 10 && th.hogSeconds < 35,
    `(${th.hogSeconds.toFixed(2)}s)`);
  check('顺逆旋转横移方向相反', (() => {
    const ccw = sim.throwStone('ccw');
    return th.lateralAtHogM * ccw.lateralAtHogM < 0;
  })(), `(cw=${th.lateralAtHogM.toFixed(2)}m)`);

  sim.cut(0.8);
  const hogStop = sim.zones.reduce((s, z) => s + z.hogSeconds, 0) / sim.zones.length;
  check('过度削顶(80%)显著拖慢冰速(比 35% 再慢 1.5s 以上)',
    hogStop > hogAfter + 1.5, `(${hogAfter.toFixed(2)}s → ${hogStop.toFixed(2)}s)`);
  check('高度场标红数组已生成', sim.redMask.length === sim.height.length);
}

console.log('5. 湿度结霜与赛事评分');
{
  const sim = new Simulation('honggang', 'shuangzhong');
  for (let i = 0; i < 5; i++) sim.flood({ thicknessMm: 4, waterTempC: 40 });
  for (let i = 0; i < 300; i++) sim.tick(30);
  sim.spray({
    tankHeadM: 1.0, orificeMm: 0.6, nozzleCount: 8, headWidthM: 1.6,
    waterTempC: 45, walkSpeed: 1.0, flowLmin: 7,
  });
  sim.startMatch();
  sim.env.occupants = sim.venue.capacity;
  sim.env.rhSetpoint = 70; // 除湿放水
  const frost0 = sim.zones.reduce((s, z) => s + z.frost, 0) / sim.zones.length;
  for (let i = 0; i < 60; i++) sim.tick(60); // 60 分钟高湿
  const frost1 = sim.zones.reduce((s, z) => s + z.frost, 0) / sim.zones.length;
  check('高湿环境结霜上升', frost1 > frost0, `(${(frost0 * 100).toFixed(0)}%→${(frost1 * 100).toFixed(0)}%)`);
  const hogHumid = sim.zones.reduce((s, z) => s + z.hogSeconds, 0) / sim.zones.length;
  check('结霜使冰速下降(hog 秒数变大)', hogHumid > 15.5, `(${hogHumid.toFixed(2)}s)`);
}

console.log('6. 全部场馆×机组可构造');
for (const v of VENUES) {
  for (const f of FRIDGES) {
    const sim = new Simulation(v.id, f.id);
    check(`${v.id}/${f.id}`, sim.zones.length === 24 && sim.height.length > 0);
  }
}

console.log(failures ? `\n${failures} 项失败` : '\n全部冒烟测试通过');
process.exit(failures ? 1 : 0);
