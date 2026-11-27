/**
 * 试滑壶数值积分:
 * - 恒出手速度,沿 x 方向滑行
 * - 摩擦减速 μ·g,横坡(冰面不平)通过重力分量产生横向加速度 → 跑偏
 * - 记录前掷线到前掷线用时与完整走线
 */
import { RINK, STONE, clamp } from './constants';
import { frictionCoefficient } from './friction';
import type { IceField } from './icefield';
import type { TestStoneResult } from './types';

export interface StoneContext {
  field: IceField;
  contactFraction: number;
  densityPerM2: number;
  iceTempC: number;
}

export function launchTestStone(ctx: StoneContext, direction: 1 | -1, simS: number): TestStoneResult {
  const { field, contactFraction, densityPerM2, iceTempC } = ctx;
  const g = 9.81;
  let x = direction > 0 ? -RINK.HOG_X - 0.5 : RINK.HOG_X + 0.5;
  let z = 0;
  let vx = direction * STONE.RELEASE_SPEED_MPS;
  let vz = 0;
  const path: { x: number; z: number }[] = [{ x, z }];
  let hogTimeS: number | null = null;
  let t = 0;
  let crossedNearHog = false;

  for (let step = 0; step < 40000; step++) {
    const speed = Math.hypot(vx, vz);
    if (speed < STONE.STOP_SPEED) break;
    if (Math.abs(x) > RINK.BACK_X) break;

    const frostMm = field.sampleFrostMm(x, z);
    const relief = field.reliefMm();
    const mu = frictionCoefficient({
      speed,
      contactFraction,
      densityPerM2,
      frostMm,
      iceTempC,
      reliefMm: relief
    });

    // 减速:方向与速度相反
    const decel = mu * g;
    vx -= (vx / speed) * decel * STONE.DT;
    vz -= (vz / speed) * decel * STONE.DT;

    // 横坡跑偏:坡度 mm/m → 倾角 tanθ≈θ,横向加速度 g·θ,壶向低侧滑
    const slope = field.crossSlopeMmPerM(x, z); // mm/m ≈ 1e-3 无量纲
    const lateralAccel = -g * slope * 1e-3 * STONE.CURL_K;
    vz += lateralAccel * STONE.DT;

    x += vx * STONE.DT;
    z += vz * STONE.DT;
    t += STONE.DT;

    if (path.length < 600 && step % 48 === 0) path.push({ x, z });

    // 前掷线计时
    const nearHog = direction > 0 ? -RINK.HOG_X : RINK.HOG_X;
    const farHog = direction > 0 ? RINK.HOG_X : -RINK.HOG_X;
    if (!crossedNearHog && (direction > 0 ? x >= nearHog : x <= nearHog)) {
      crossedNearHog = true;
      t = 0;
    }
    if (crossedNearHog && hogTimeS === null && (direction > 0 ? x >= farHog : x <= farHog)) {
      hogTimeS = t;
    }
  }

  path.push({ x, z });
  return {
    atSimS: simS,
    direction,
    hogTimeS,
    lateralDriftM: clamp(z, -RINK.WIDTH / 2, RINK.WIDTH / 2),
    path,
    stopped: Math.hypot(vx, vz) < STONE.STOP_SPEED
  };
}
