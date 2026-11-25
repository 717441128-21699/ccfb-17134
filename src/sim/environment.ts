// 场馆环境演化:人群散热散湿、空调/除湿机调节、冰温与结霜
import { saturationVaporPressurePa } from './physics';
import type { FridgeDef, VenueDef } from './types';
import { clamp } from './rng';

const R_VAPOR = 461.5;          // 水蒸气气体常数 J/(kg·K)
const ROOM_VOLUME = 1400;       // 单赛道馆空气体积 m³(近似)

export interface EnvState {
  airTempC: number;
  rh: number;                 // 相对湿度 %
  rhSetpoint: number;         // 除湿设定值 %
  vaporMassKg: number;
  occupants: number;
  frostThreshold: number;     // 结霜湿度设定值(高于此开始结霜)%
}

export function createEnv(venue: VenueDef): EnvState {
  const sat = saturationVaporPressurePa(venue.ambientTempC)
    / (R_VAPOR * (venue.ambientTempC + 273.15)); // kg/m³
  const m0 = sat * ROOM_VOLUME * venue.ambientRh / 100;
  return {
    airTempC: venue.ambientTempC,
    rh: venue.ambientRh,
    rhSetpoint: 40,
    vaporMassKg: m0,
    occupants: 0,
    frostThreshold: 65,
  };
}

/** 环境推进一个仿真步 */
export function stepEnv(env: EnvState, venue: VenueDef, dtS: number): void {
  // ---- 水汽质量平衡:人群散湿 vs 除湿机 ----
  const moistureIn = env.occupants * venue.crowdMoistureKgS;
  const over = clamp((env.rh - env.rhSetpoint) / 12, 0, 1);
  const moistureOut = venue.dehumKgS * over;
  env.vaporMassKg = Math.max(0.01,
    env.vaporMassKg + (moistureIn - moistureOut) * dtS);

  // ---- 热平衡:人群散热 vs 空调 ----
  const heatIn = env.occupants * venue.crowdHeatW;
  const tempRise = heatIn / Math.max(1, venue.hvacPowerKw * 1000)
    * 6 * (1.6 - venue.insulation);
  const targetTemp = venue.ambientTempC + tempRise;
  const kTemp = dtS / (900 / Math.max(0.3, venue.insulation)); // 保温越好越慢
  env.airTempC += (targetTemp - env.airTempC) * clamp(kTemp, 0, 1);

  // ---- 由水汽质量反算相对湿度 ----
  const satDensity = saturationVaporPressurePa(env.airTempC)
    / (R_VAPOR * (env.airTempC + 273.15));
  env.rh = clamp(env.vaporMassKg / (ROOM_VOLUME * satDensity) * 100, 5, 99);
}

/** 分区冰温:向制冷管温度松弛,室温通过保温弱点渗入 */
export function stepIceTemp(current: number, fridge: FridgeDef,
  alongPos: number, insulation: number, airTempC: number, dtS: number): number {
  const pipe = fridge.brineSetpointC * fridge.efficiency
    + (1 - fridge.uniformity) * 2.2 * alongPos;
  const leak = (1 - insulation) * 0.35 * (airTempC - current);
  const target = pipe + leak;
  const k = clamp(dtS / (420 / fridge.recoveryRate), 0, 1);
  return current + (target - current) * k;
}
