/**
 * 卵石点模型:
 * - 水珠直径由喷头孔径、水箱高度(水压)、水温(黏度/表面张力)决定
 * - 行走速度决定单位面积落点密度
 * - 落到冰面冻成半球,半径 = 水珠等效半径 × 体积守恒系数
 * - 刮刀削顶:削去量决定壶底与点的接触面比例
 */
import { PEBBLE, RINK, SCRAPE, clamp } from './constants';
import type { PebbleBatch } from './types';
import { Rng } from './rng';

/**
 * 卵石点数据(原生交错布局,每点 6 个 float,可直接喂给 GPU 实例缓冲):
 * [x, z, rMm, hMm, cutMm, freeze],物理与渲染共用同一块内存,上传零拷贝。
 */
export interface PebbleArrays {
  /** 交错数据:count*6 个 float */
  data: Float32Array;
  /** 逻辑点数(data.length / 6) */
  count: number;
}

// 字段在每点 6-float 块内的偏移
export const PEBBLE_STRIDE = 6;
export const OFF_X = 0;
export const OFF_Z = 1;
export const OFF_R = 2;
export const OFF_H = 3;
export const OFF_CUT = 4;
export const OFF_FREEZE = 5;

export function createPebbleArrays(capacity: number): PebbleArrays {
  return { data: new Float32Array(capacity * PEBBLE_STRIDE), count: 0 };
}

/** 单颗水珠直径 mm:孔径为基准,水压(高度)增大,热水黏度低使水珠更小更匀 */
export function dropletDiameterMm(
  nozzleMm: number,
  tankHeightM: number,
  waterTempC: number
): number {
  const pressure = Math.sqrt(tankHeightM / 0.4); // 托里拆利射流速度 ∝ √h
  const tempViscosity = 1 - (waterTempC - 45) * 0.004; // 热水表面张力/黏度低
  return clamp(nozzleMm * 1.25 * pressure * tempViscosity, 1.5, 8);
}

export interface PebbleApplication {
  batch: PebbleBatch;
  added: number;
  capped: boolean;
}

/**
 * 执行一遍倒退洒点:在两条前掷线之间布点。
 * 标准行走 1.2m/s 时约 4000 点/m²(全赛道约 37 万颗);
 * 走得慢 → 重叠遍数多 → 密度高,走得快 → 密度低。
 * 落点准均匀 + 随机抖动,尺寸带 ±JITTER 散布。
 */
export function applyPebble(
  arr: PebbleArrays,
  params: Omit<PebbleBatch, 'appliedAtSimS' | 'startIndex' | 'count' | 'nominalDropMm' | 'densityPerM2'>,
  simS: number,
  rng: Rng
): PebbleApplication {
  const dropMm = dropletDiameterMm(params.nozzleMm, params.tankHeightM, params.waterTempC);
  // 落地后铺成半球:同体积球 → 半球半径 ≈ 球半径 × 2^(1/3)
  const hemiRadius = (dropMm / 2) * Math.cbrt(2);

  const targetDensity = 4000 * (1.2 / params.walkSpeedMps);
  const targetCount = Math.round(targetDensity * RINK.PEBBLE_AREA());
  const room = arr.data.length / PEBBLE_STRIDE - arr.count;
  const capped = targetCount > room;
  const n = Math.min(targetCount, room);

  const startIndex = arr.count;
  for (let i = 0; i < n; i++) {
    const k = arr.count + i;
    const o = k * PEBBLE_STRIDE;
    const sizeJit = 1 + rng.gauss() * PEBBLE.JITTER;
    arr.data[o + OFF_X] = -RINK.HOG_X + rng.next() * RINK.PEBBLE_LEN;
    arr.data[o + OFF_Z] = clamp(
      -RINK.WIDTH / 2 + rng.next() * RINK.WIDTH,
      -RINK.WIDTH / 2 + 0.03,
      RINK.WIDTH / 2 - 0.03
    );
    arr.data[o + OFF_R] = hemiRadius * sizeJit;
    arr.data[o + OFF_H] = arr.data[o + OFF_R] * sizeJit;
    arr.data[o + OFF_CUT] = 0;
    arr.data[o + OFF_FREEZE] = 0;
  }
  arr.count += n;

  const batch: PebbleBatch = {
    ...params,
    appliedAtSimS: simS,
    startIndex,
    count: n,
    nominalDropMm: dropMm,
    densityPerM2: n / RINK.PEBBLE_AREA()
  };
  return { batch, added: n, capped };
}

/**
 * 刮冰削顶:对所有点削去 depthMm(只削冻透的点)。
 * 削到 SCRAPE.REMOVE_DEPTH_MM 以上、或削穿半球的点直接移除(就地紧凑)。
 */
export function scrapePebbles(arr: PebbleArrays, depthMm: number): number {
  let write = 0;
  let removed = 0;
  for (let read = 0; read < arr.count; read++) {
    const ro = read * PEBBLE_STRIDE;
    if (arr.data[ro + OFF_FREEZE] < 0.95) {
      removed++; // 没冻透的点被刮刀直接带飞
      continue;
    }
    const r = arr.data[ro + OFF_R];
    const newCut = arr.data[ro + OFF_CUT] + depthMm;
    if (newCut >= SCRAPE.REMOVE_DEPTH_MM || newCut >= r) {
      removed++;
      continue;
    }
    const wo = write * PEBBLE_STRIDE;
    if (write !== read) arr.data.copyWithin(wo, ro, ro + PEBBLE_STRIDE);
    arr.data[wo + OFF_H] -= depthMm;
    arr.data[wo + OFF_CUT] = newCut;
    write++;
  }
  arr.count = write;
  return removed;
}

/** 单颗削顶后的接触圆半径 mm(刮刀平面与半球相交) */
export function contactRadiusMm(r: number, cut: number): number {
  const c = clamp(cut, 0, r * 0.98);
  return Math.sqrt(Math.max(0, r * r - (r - c) * (r - c)));
}

/**
 * 全场平均"接触面比例":接触圆面积 / 点底面积(采样估算,控制每次成本)。
 * 这是冰速模型最关键的中间量。
 */
export function averageContactFraction(arr: PebbleArrays): number {
  if (arr.count === 0) return 0;
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(arr.count / 40000));
  for (let k = 0; k < arr.count; k += step) {
    const o = k * PEBBLE_STRIDE;
    const cr = contactRadiusMm(arr.data[o + OFF_R], arr.data[o + OFF_CUT]);
    sum += (cr * cr) / (arr.data[o + OFF_R] * arr.data[o + OFF_R]);
    n++;
  }
  return n ? sum / n : 0;
}

/** 平均点半径 mm */
export function averageRadiusMm(arr: PebbleArrays): number {
  if (arr.count === 0) return 0;
  let sum = 0;
  const step = Math.max(1, Math.floor(arr.count / 40000));
  let n = 0;
  for (let k = 0; k < arr.count; k += step) {
    sum += arr.data[k * PEBBLE_STRIDE + OFF_R];
    n++;
  }
  return n ? sum / n : 0;
}

/** 点密度(点/m²) */
export function densityPerM2(arr: PebbleArrays): number {
  return arr.count / RINK.PEBBLE_AREA();
}
