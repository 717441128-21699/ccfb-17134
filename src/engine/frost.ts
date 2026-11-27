/**
 * 结霜:
 * 当相对湿度超阈值且冰温低于露点时,水汽在冰面凝华成霜;
 * 霜按格累积(中间区域观众散热多 → 略不均匀),除湿机开启时抑制。
 */
import { FROST, clamp } from './constants';
import { dewPointC } from './thermal';
import type { IceField } from './icefield';

export function advanceFrost(
  field: IceField,
  airTempC: number,
  rh: number,
  iceTempC: number,
  dehumidifierOn: boolean,
  dehumidifierKw: number,
  dtS: number
): number {
  const effectiveRh = dehumidifierOn ? rh * clamp(1 - dehumidifierKw / 60, 0.55, 1) : rh;
  if (effectiveRh <= FROST.RH_THRESHOLD) return 0;
  const dp = dewPointC(airTempC, effectiveRh);
  if (iceTempC >= dp) return 0;

  const excess = (effectiveRh - FROST.RH_THRESHOLD) / (1 - FROST.RH_THRESHOLD);
  const depoDrive = clamp((dp - iceTempC) / 6, 0.1, 2);
  const rate = FROST.GROW_RATE * excess * depoDrive; // mm / 模拟秒
  const grow = rate * dtS;

  let added = 0;
  for (let ix = 0; ix < field.nx; ix++) {
    // 场馆中部空气交换弱,霜略重
    const xBias = 1 + 0.25 * Math.cos((ix / field.nx) * Math.PI * 2);
    for (let iz = 0; iz < field.ny; iz++) {
      const i = field.idx(ix, iz);
      const before = field.frost[i];
      field.frost[i] = Math.min(FROST.MAX_MM, before + grow * xBias);
      added += field.frost[i] - before;
    }
  }
  return added / field.frost.length;
}

export function averageFrostMm(field: IceField): number {
  let s = 0;
  for (let i = 0; i < field.frost.length; i++) s += field.frost[i];
  return s / field.frost.length;
}
