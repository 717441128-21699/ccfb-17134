/**
 * 热学模型:
 * - 每层浇水的冻结时间(制冷管温度 + 水温 + 层厚 + 机组效率)
 * - 制冷管温度对设定值的一阶滞后响应
 * - 冰温由管温/室温/霜层共同决定
 * - 马格努斯公式求露点,供结霜判定
 */
import { FREEZE } from './constants';
import type { FloodLayer, RefrigerationSystem } from './types';

/** 一层水完全冻结所需模拟秒数 */
export function layerFreezeSeconds(
  thicknessMm: number,
  waterTempC: number,
  pipeTempC: number,
  system: RefrigerationSystem
): number {
  const thicknessF = Math.pow(thicknessMm / FREEZE.REF_THICKNESS_MM, 2);
  // 管温:每比设计基准暖 5℃,冻结时间约翻 1.4 倍;机组效率折减
  const pipeF = Math.pow(1.4, (pipeTempC - FREEZE.PIPE_DESIGN_REF) / 5) / system.efficiency;
  const waterF = 1 + (waterTempC - FREEZE.WATER_TEMP_REF_C) * FREEZE.WATER_TEMP_FACTOR;
  return FREEZE.REF_TIME_MIN * 60 * thicknessF * pipeF * waterF;
}

/** 推进某一层的冻结进度,返回是否刚好在本步冻透 */
export function advanceLayerFreeze(
  layer: FloodLayer,
  dtS: number,
  simS: number,
  pipeTempC: number,
  system: RefrigerationSystem
): boolean {
  if (layer.freezeFraction >= 1) return false;
  const total = layerFreezeSeconds(layer.thicknessMm, layer.waterTempC, pipeTempC, system);
  layer.freezeFraction = Math.min(1, layer.freezeFraction + dtS / total);
  if (layer.freezeFraction >= 1) {
    layer.frozenAtSimS = simS;
    return true;
  }
  return false;
}

/** 制冷管一阶滞后响应 */
export function advancePipeTemp(
  currentC: number,
  setpointC: number,
  tauS: number,
  dtS: number
): number {
  const k = 1 - Math.exp(-dtS / tauS);
  return currentC + (setpointC - currentC) * k;
}

/**
 * 平均冰温:管温经冰板滞后,再被室温与霜层上抬。
 * frostMm 越大,冰面被霜"保温",表面温度越高。
 */
export function computeIceTemp(pipeTempC: number, airTempC: number, frostMm: number): number {
  return pipeTempC + (airTempC - pipeTempC) * 0.16 + frostMm * 1.4;
}

/** 马格努斯公式:温度 + 相对湿度 → 露点 ℃ */
export function dewPointC(airTempC: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(Math.max(rh, 1e-4)) + (a * airTempC) / (b + airTempC);
  return (b * alpha) / (a - alpha);
}

/** 该层当前是否已冻透 */
export function isLayerFrozen(layer: FloodLayer): boolean {
  return layer.freezeFraction >= 1;
}
