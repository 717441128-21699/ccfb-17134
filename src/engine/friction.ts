/**
 * 摩擦模型(经 scripts/calibrate.ts 标定):
 * μ(v) = μ0 + μ1·v²  —— 速度弱化:壶在低速段进入长"蠕行",
 *                       使标准状态前掷线用时落在 24.5s 附近。
 * 再乘:接触面因子、点密度因子、霜因子、冰温因子、粗糙度因子。
 */
import { STONE } from './constants';

export interface FrictionInputs {
  speed: number;
  contactFraction: number; // 0~1
  densityPerM2: number;
  frostMm: number;
  iceTempC: number;
  reliefMm: number;
}

/**
 * 接触面因子(标定目标:最佳接触 30% 时 = 1)。
 * 削太浅 → 壶底被点顶"吸住",急剧变涩;
 * 削太深 → 趋近平面,缓慢变涩;完全没点 → 光板冰惩罚。
 */
export function contactFactor(contact: number): number {
  if (contact <= 0.001) return 1.35;
  // 分段线性插值,关键点来自标定
  const pts: Array<[number, number]> = [
    [0.05, 1.18],
    [0.15, 1.06],
    [0.3, 1.0],
    [0.5, 1.04],
    [0.7, 1.12],
    [0.9, 1.2]
  ];
  if (contact <= pts[0][0]) {
    const t = contact / pts[0][0];
    return 1.35 + (pts[0][1] - 1.35) * t;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (contact >= x0 && contact <= x1) {
      return y0 + ((contact - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

/** 点密度因子:点越多壶底被"垫"得越高、摩擦略低;太稀疏则变涩 */
export function densityFactor(densityPerM2: number): number {
  const ref = STONE.REF_DENSITY_PER_M2;
  const ratio = densityPerM2 / ref;
  // 对数响应,±50% 密度变化 ≈ ±6% 摩擦
  return 1 - 0.1 * Math.log2(Math.max(ratio, 0.15));
}

export function frictionCoefficient(inp: FrictionInputs): number {
  const base = STONE.MU_C0 + STONE.MU_C1 * Math.pow(inp.speed, STONE.MU_EXP);
  const cf = contactFactor(inp.contactFraction);
  const df = inp.contactFraction > 0.001 ? densityFactor(inp.densityPerM2) : 1;
  const frostF = 1 + STONE.FROST_K * inp.frostMm;
  const tempF = 1 + STONE.TEMP_K * Math.abs(inp.iceTempC - STONE.TARGET_ICE_TEMP_C);
  const reliefF = 1 + STONE.RELIEF_K * Math.min(inp.reliefMm, 2);
  return base * cf * df * frostF * tempF * reliefF;
}
