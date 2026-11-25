// 冻结与摩擦的物理模型
import {
  C_WATER, GRAVITY, K_ICE, L_FUSION, MU_REF, RHO_ICE, RHO_WATER, SIGMA_0,
} from './constants';
import type { FridgeDef } from './types';
import { clamp } from './rng';

/**
 * Stefan 冻结模型:一层水从底部向上冻结。
 * 冻结深度 s(t) 满足 s² = 2·k·ΔT·t /(ρ·L_eff)
 * L_eff 计入把水从水温降到 0°C 的显热。
 */
export function freezeTimeS(thicknessM: number, waterTempC: number,
  contactTempC: number): number {
  const dT = Math.max(0.5, -contactTempC);               // 冰面(管温侧)为负温
  const sensible = C_WATER * Math.max(0, waterTempC);    // J/kg 显热
  const lEff = L_FUSION + sensible;
  const effusivity = 2 * K_ICE * dT / (RHO_ICE * lEff); // m²/s
  return (thicknessM * thicknessM) / Math.max(1e-12, effusivity);
}

/** 给定已过时间,返回冻结比例 0..1(Stefan: s ∝ √t) */
export function frozenFraction(elapsedS: number, totalS: number): number {
  if (totalS <= 0) return 1;
  return clamp(Math.sqrt(elapsedS / totalS), 0, 1);
}

/** 制冷管→冰面接触温度,机组均匀性越差,沿管程温差越大 */
export function contactTemp(fridge: FridgeDef, alongPos: number): number {
  // alongPos 0(近端)~1(远端),远端管路偏暖
  const gradient = (1 - fridge.uniformity) * 2.2 * alongPos;
  return fridge.brineSetpointC * fridge.efficiency + gradient;
}

/**
 * 喷嘴出流:水头决定出流速度(Torricelli),孔口流量系数取 0.62。
 * 返回单孔流速 m/s。
 */
export function jetVelocity(tankHeadM: number): number {
  return 0.62 * Math.sqrt(2 * GRAVITY * Math.max(0.05, tankHeadM));
}

/**
 * 水珠直径:由体积守恒 d = (6Q/(π·n·v))^(1/3),
 * 再用 Weber 数修正破碎 —— 高速射流会碎成更小的滴。
 */
export function dropletDiameterMm(
  orificeMm: number, flowLmin: number, nozzleCount: number,
  tankHeadM: number, waterTempC: number,
): number {
  const q = flowLmin / 60000 / Math.max(1, nozzleCount);  // 单孔 m³/s
  const v = jetVelocity(tankHeadM);
  const d0 = (6 * q / (Math.PI * Math.max(0.1, v))) ** (1 / 3);
  const sigma = SIGMA_0 - 0.00015 * Math.max(0, waterTempC); // 温水表面张力略低
  const we = RHO_WATER * v * v * d0 / Math.max(1e-4, sigma);
  // 临界 We≈13 以上发生破碎,滴径按 We^-0.42 衰减(Hinze 标度)
  const breakFactor = we > 13 ? (13 / we) ** 0.42 : 1;
  // 孔口尺寸给出下限约束(孔越小滴越小)
  const d = Math.max(orificeMm * 0.6 * 1e-3, d0 * breakFactor);
  return d * 1000;
}

/**
 * 落滴在冰面上摊成球冠卵石点(体积守恒)。
 * 真实 pebble 底径约为滴径的 2~2.6 倍,温度越低摊得越小。
 */
export function pebbleGeometry(dropletDiaMm: number, iceTempC: number) {
  const spread = clamp(2.45 + iceTempC * 0.06, 2.05, 2.65); // 冰暖则摊得开
  const baseR = (dropletDiaMm * spread) / 2;
  const vDrop = (Math.PI / 6) * dropletDiaMm ** 3;
  // 球冠体积 V = (πh/6)(3r²+h²),数值求 h
  let h = dropletDiaMm * 0.55;
  for (let i = 0; i < 24; i++) {
    const f = (Math.PI * h / 6) * (3 * baseR * baseR + h * h) - vDrop;
    const df = (Math.PI / 6) * (3 * baseR * baseR + 3 * h * h);
    h = clamp(h - f / Math.max(1e-9, df), 0.02, baseR * 1.9);
  }
  const sphereR = (baseR * baseR + h * h) / (2 * h);
  return { baseR, capH: h, sphereR };
}

/**
 * 卵石点削顶:削去球冠顶部 δ 比例的高度后,
 * 壶底落在一个半径 r_c 的水平圆台上。
 * 球心位于基面下方 (sphereR - capH);削顶深度 cut·capH 处的截面:
 * 距球心 d = sphereR - cut·capH,r_c² = sphereR² - d²。
 * 未削时 r_c=0(点接触),削到基面时 r_c=baseR,接触比例 0→1。
 */
export function cutContactFraction(baseR: number, sphereR: number,
  capH: number, cutFraction: number): number {
  const cut = clamp(cutFraction, 0, 0.85) * capH;
  const d = sphereR - cut;
  const rc2 = Math.max(0, sphereR * sphereR - d * d);
  return clamp(rc2 / (baseR * baseR), 0, 1);
}

/**
 * 摩擦系数模型(标定:基准状态 hog-to-hog ≈ 15s,出手 2.35m/s)。
 * μ 随接触面积比增大而增大,随有效密度增大而减小;
 * 冰温偏暖 → 水膜润滑 → μ 下降(冰变快);磨损与结霜使 μ 上升。
 */
export function frictionCoefficient(args: {
  contactFraction: number;
  density: number;            // 点/m²
  iceTempC: number;
  frost: number;              // 0..1
  wear: number;               // 0..1
}): number {
  const { contactFraction, density, iceTempC, frost, wear } = args;
  const densityTerm = clamp(
    1.05 - 0.06 * Math.log10(Math.max(1, density) / 15000), 0.95, 1.12);
  const contactTerm = 0.9 + 0.2 * contactFraction;
  const tempTerm = 1 - clamp((-4.5 - iceTempC) * 0.05, -0.1, 0.15);
  const frostTerm = 1 + 0.45 * frost;
  const wearTerm = 1 + 0.18 * wear;
  return MU_REF * densityTerm * contactTerm * tempTerm * frostTerm * wearTerm;
}

/** Magnus 公式:常压下水面饱和水汽压(hPa) */
export function saturationVaporPressurePa(tempC: number): number {
  return 610.94 * Math.exp((17.625 * tempC) / (tempC + 243.04));
}

/** 冰面温度下的饱和水汽压,与空气实际水汽压比较 → 结霜倾向 0..1 */
export function frostPotential(airTempC: number, rhPercent: number,
  iceTempC: number): number {
  const vpAir = saturationVaporPressurePa(airTempC) * rhPercent / 100;
  const vpIce = saturationVaporPressurePa(iceTempC);
  // vpAir 高于冰面饱和压越多,结霜越快
  return clamp((vpAir - vpIce) / Math.max(1, vpIce), 0, 1.2);
}
