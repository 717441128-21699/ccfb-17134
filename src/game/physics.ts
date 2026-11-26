import {
  BACK_THROW_Z,
  FRONT_THROW_Z,
  HEIGHT_NX,
  HEIGHT_NZ,
  LEFT_LANE_X,
  RED_DIFF_THRESHOLD_MM,
  RIGHT_LANE_X,
  SHEET_AREA_M2,
  SHEET_LENGTH_M,
  SHEET_WIDTH_M,
  TARGET_TRIAL_S,
  TRIAL_V0_MPS
} from './config';
import { clamp, lerp, mulberry32 } from './rng';
import type {
  FlatnessMetrics,
  PebbleParams,
  PebbleStats,
  TrialResult,
  TrialSample
} from './types';

export function heightIndex(ix: number, iz: number): number {
  return iz * HEIGHT_NX + ix;
}

export function createInitialHeight(seed = 20261127): Float32Array {
  const h = new Float32Array(HEIGHT_NX * HEIGHT_NZ);
  const rand = mulberry32(seed);

  for (let iz = 0; iz < HEIGHT_NZ; iz++) {
    const z = -SHEET_LENGTH_M / 2 + (iz / (HEIGHT_NZ - 1)) * SHEET_LENGTH_M;
    for (let ix = 0; ix < HEIGHT_NX; ix++) {
      const x = -SHEET_WIDTH_M / 2 + (ix / (HEIGHT_NX - 1)) * SHEET_WIDTH_M;
      const broad = 0.72 * Math.sin(z * 0.24 + x * 1.35 + 0.6);
      const wave = 0.46 * Math.sin(z * 0.71 - x * 2.7 + 1.7);
      const fine = 0.16 * Math.sin(z * 2.3 + x * 5.1) + (rand() - 0.5) * 0.16;
      const crossSlope = 0.18 * x; // 约 0.75mm 全宽
      h[heightIndex(ix, iz)] = 22 + broad + wave + fine + crossSlope;
    }
  }

  // 几块没有被基层水完全找平的“旧冰包”。
  for (let b = 0; b < 22; b++) {
    const cx = (rand() - 0.5) * SHEET_WIDTH_M * 0.9;
    const cz = (rand() - 0.5) * SHEET_LENGTH_M * 0.92;
    const amp = (rand() < 0.5 ? -1 : 1) * (0.55 + rand() * 1.15);
    const radius = 0.28 + rand() * 0.9;
    for (let iz = 0; iz < HEIGHT_NZ; iz++) {
      const z = -SHEET_LENGTH_M / 2 + (iz / (HEIGHT_NZ - 1)) * SHEET_LENGTH_M;
      for (let ix = 0; ix < HEIGHT_NX; ix++) {
        const x = -SHEET_WIDTH_M / 2 + (ix / (HEIGHT_NX - 1)) * SHEET_WIDTH_M;
        const d2 = (x - cx) ** 2 + (z - cz) ** 2;
        h[heightIndex(ix, iz)] += amp * Math.exp(-d2 / (2 * radius * radius));
      }
    }
  }
  return h;
}

export function sampleHeight(height: Float32Array, x: number, z: number): number {
  const gx = clamp(((x + SHEET_WIDTH_M / 2) / SHEET_WIDTH_M) * (HEIGHT_NX - 1), 0, HEIGHT_NX - 1.001);
  const gz = clamp(((z + SHEET_LENGTH_M / 2) / SHEET_LENGTH_M) * (HEIGHT_NZ - 1), 0, HEIGHT_NZ - 1.001);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = gx - ix;
  const tz = gz - iz;
  const x00 = height[heightIndex(ix, iz)];
  const x10 = height[heightIndex(ix + 1, iz)];
  const x01 = height[heightIndex(ix, iz + 1)];
  const x11 = height[heightIndex(ix + 1, iz + 1)];
  return lerp(lerp(x00, x10, tx), lerp(x01, x11, tx), tz);
}

export function heightGradient(
  height: Float32Array,
  x: number,
  z: number,
  eps = 0.14
): { gx: number; gz: number } {
  const hx1 = sampleHeight(height, x + eps, z);
  const hx0 = sampleHeight(height, x - eps, z);
  const hz1 = sampleHeight(height, x, z + eps);
  const hz0 = sampleHeight(height, x, z - eps);
  // 高度场单位为 mm，转成 m 后得到无量纲坡度。
  return {
    gx: ((hx1 - hx0) * 0.001) / (2 * eps),
    gz: ((hz1 - hz0) * 0.001) / (2 * eps)
  };
}

const RISK_OFFSETS: Array<[number, number]> = [];
for (const dx of [-0.38, -0.19, 0, 0.19, 0.38]) {
  for (const dz of [-0.46, -0.23, 0, 0.23, 0.46]) RISK_OFFSETS.push([dx, dz]);
}

export function computeFlatness(height: Float32Array, risk: Float32Array): FlatnessMetrics {
  let sum = 0;
  let leftSum = 0;
  let rightSum = 0;
  let leftN = 0;
  let rightN = 0;
  let redCount = 0;
  let maxLocal = 0;
  const deviations: number[] = [];
  const localValues: number[] = [];

  for (let iz = 0; iz < HEIGHT_NZ; iz++) {
    const z = -SHEET_LENGTH_M / 2 + (iz / (HEIGHT_NZ - 1)) * SHEET_LENGTH_M;
    for (let ix = 0; ix < HEIGHT_NX; ix++) {
      const x = -SHEET_WIDTH_M / 2 + (ix / (HEIGHT_NX - 1)) * SHEET_WIDTH_M;
      const idx = heightIndex(ix, iz);
      const h = height[idx];
      sum += h;
      if (x < 0) {
        leftSum += h;
        leftN++;
      } else {
        rightSum += h;
        rightN++;
      }

      let mn = Infinity;
      let mx = -Infinity;
      for (const [dx, dz] of RISK_OFFSETS) {
        const v = sampleHeight(height, x + dx, z + dz);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const range = mx - mn;
      risk[idx] = range;
      maxLocal = Math.max(maxLocal, range);
      localValues.push(range);
      if (range > RED_DIFF_THRESHOLD_MM) redCount++;
    }
  }

  const count = height.length;
  const mean = sum / count;
  let rmsSum = 0;
  for (let i = 0; i < count; i++) rmsSum += (height[i] - mean) ** 2;
  const rms = Math.sqrt(rmsSum / count);
  const sortedLocal = [...localValues].sort((a, b) => a - b);
  const p95 = sortedLocal[Math.floor(sortedLocal.length * 0.95)] ?? maxLocal;
  const leftMean = leftSum / Math.max(1, leftN);
  const rightMean = rightSum / Math.max(1, rightN);

  return {
    maxLocalDifferenceMm: maxLocal,
    p95LocalDifferenceMm: p95,
    redAreaPct: (redCount / count) * 100,
    meanMm: mean,
    leftMeanMm: leftMean,
    rightMeanMm: rightMean,
    sideHeightDifferenceMm: rightMean - leftMean,
    unevennessRmsMm: rms,
    redCellCount: redCount,
    cellCount: count
  };
}

/** Stefan 近似 + 水的显热/潜热，计算一层水完全冻透所需秒数。 */
export function layerFreezeTimeS(
  thicknessMm: number,
  waterC: number,
  pipeC: number,
  systemResistance: number
): number {
  const d = thicknessMm / 1000;
  const deltaT = Math.max(2, -pipeC);
  const enthalpyJPerKg = 4186 * Math.max(0, waterC) + 334_000;
  const massPerM2 = 1000 * d;
  const thermalResistance = systemResistance + d / (2 * 2.2);
  return (massPerM2 * enthalpyJPerKg * thermalResistance) / deltaT;
}

/** 盘管—冰面稳态热阻网络的经验解。 */
export function iceTemperatureC(pipeC: number, roomC: number, systemResistance: number): number {
  const hAir = 9.0;
  const uPipe = 1 / systemResistance;
  return (pipeC * uPipe + roomC * hAir) / (uPipe + hAir) + 0.35;
}

export interface PebblePlan extends PebbleStats {
  flowMlPerS: number;
  dropletVolumeMm3: number;
}

export function computePebblePlan(input: PebbleParams, batch = 1): PebblePlan {
  const headMPerS2 = 2 * 9.81 * Math.max(0.1, input.tankHeightM);
  const jetSpeed = Math.sqrt(headMPerS2);
  const nozzleM = input.nozzleMm / 1000;
  const areaM2 = Math.PI * (nozzleM / 2) ** 2;
  const flowM3S = 0.62 * areaM2 * jetSpeed;

  const tempFactor = clamp(1.13 - 0.006 * input.waterC, 0.62, 1.16);
  const pressureFactor = clamp(1.22 - 0.16 * Math.sqrt(input.tankHeightM), 0.92, 1.18);
  const speedFactor = clamp(0.88 + 0.2 * input.walkSpeedMps, 0.88, 1.22);
  const dropletMm = clamp(
    input.nozzleMm * 1.38 * tempFactor * pressureFactor * speedFactor,
    0.55,
    7.5
  );

  const dropletRadiusMm = dropletMm / 2;
  const dropletVolumeMm3 = (Math.PI / 6) * dropletMm ** 3;
  const dropletsPerS = (flowM3S * 1e9) / dropletVolumeMm3;

  const swathM = clamp(
    0.42 + 0.22 * input.nozzleMm + 0.1 * Math.sqrt(input.tankHeightM) - 0.08 * input.walkSpeedMps,
    0.35,
    1.7
  );
  const laneCount = Math.max(2, Math.round(SHEET_WIDTH_M / (swathM * 0.82)));
  const walkDurationS = (laneCount * SHEET_LENGTH_M) / Math.max(0.1, input.walkSpeedMps);

  // 整条赛道的总数 = 喷嘴生成率 × 总倒退走行时间。
  const requestedCount = dropletsPerS * walkDurationS;
  const maxCount = 500_000;
  const count = Math.max(0, Math.min(maxCount, Math.round(requestedCount)));
  const densityPerM2 = count / SHEET_AREA_M2;
  const requestedDensityPerM2 = requestedCount / SHEET_AREA_M2;

  const balanceBias = clamp(input.balanceCm / 260, -0.22, 0.22);
  const leftDensityPerM2 = densityPerM2 * (1 - balanceBias);
  const rightDensityPerM2 = densityPerM2 * (1 + balanceBias);
  const uniformityPct = clamp(
    97 -
      Math.abs(input.balanceCm) * 1.45 -
      Math.abs(input.walkSpeedMps - 0.72) * 12 -
      Math.abs(input.waterC - 22) * 0.08,
    55,
    99
  );

  const radiusMm = dropletMm * 0.63; // 球滴体积守恒 → 半球半径
  const freezeS =
    8.5 * radiusMm ** 2 * (1 + Math.max(0, input.waterC) / 55) / 4.8;

  return {
    applied: false,
    batch,
    dropletMm,
    densityPerM2,
    requestedDensityPerM2,
    count,
    radiusMm,
    cutMm: 0,
    remainingMm: radiusMm,
    contactRadiusMm: 0,
    contactFraction: 0,
    uniformityPct,
    leftDensityPerM2,
    rightDensityPerM2,
    swathM,
    laneCount,
    freezeS,
    freezeRemainingS: freezeS,
    walkDurationS,
    ageEnds: 0,
    wornFactor: 1,
    flowMlPerS: flowM3S * 1e6,
    dropletVolumeMm3
  };
}

export function applyScrapeToStats(stats: PebbleStats, cutPassMm: number): PebbleStats {
  const cutMm = clamp(stats.cutMm + cutPassMm, 0, stats.radiusMm * 0.86);
  const remainingMm = Math.max(stats.radiusMm * 0.14, stats.radiusMm - cutMm);
  const contactRadiusMm = Math.sqrt(Math.max(0, stats.radiusMm ** 2 - remainingMm ** 2));
  const contactAreaM2 = Math.PI * (contactRadiusMm / 1000) ** 2;
  const contactFraction = clamp(stats.densityPerM2 * contactAreaM2, 0, 0.06);
  return { ...stats, cutMm, remainingMm, contactRadiusMm, contactFraction };
}

export function updatePebbleInstancesAfterScrape(
  data: Float32Array,
  count: number,
  radiusMeanMm: number,
  cutMm: number
): void {
  for (let i = 0; i < count; i++) {
    const o = i * 6;
    const radius = data[o + 3] || radiusMeanMm;
    data[o + 4] = Math.max(radius * 0.14, radius - cutMm);
  }
}

/** 实例数据：x, 基础冰高mm, z, 卵石半径mm, 削顶后高度mm, 明暗随机值。 */
export function generatePebbleInstances(
  plan: PebbleStats,
  input: PebbleParams,
  height: Float32Array
): Float32Array {
  const count = plan.count;
  const data = new Float32Array(count * 6);
  const rand = mulberry32(0x51a7e + plan.batch * 1009);
  const laneCount = Math.max(2, plan.laneCount);
  const laneWidth = SHEET_WIDTH_M / laneCount;
  const totalPath = laneCount * SHEET_LENGTH_M;
  const balanceM = input.balanceCm / 100;

  for (let i = 0; i < count; i++) {
    // 按倒退走行路径排序，渲染前 N 个实例即可表现“随走随洒”。
    const pathDistance = ((i + rand() * 0.7) / count) * totalPath;
    let lane = Math.min(laneCount - 1, Math.floor(pathDistance / SHEET_LENGTH_M));
    let along = pathDistance - lane * SHEET_LENGTH_M;
    if (lane % 2 === 1) along = SHEET_LENGTH_M - along;

    const laneCenter = -SHEET_WIDTH_M / 2 + laneWidth * (lane + 0.5);
    const lateralJitter = (rand() + rand() + rand() - 1.5) * laneWidth * 0.52;
    let x = laneCenter + lateralJitter + balanceM;
    x = clamp(x, -SHEET_WIDTH_M / 2 + 0.03, SHEET_WIDTH_M / 2 - 0.03);
    const z = -SHEET_LENGTH_M / 2 + along + (rand() - 0.5) * 0.16;
    const baseH = sampleHeight(height, x, z);
    const radius = plan.radiusMm * (0.84 + rand() * 0.32);
    const remaining = Math.max(radius * 0.14, radius - plan.cutMm);

    const o = i * 6;
    data[o] = x;
    data[o + 1] = baseH;
    data[o + 2] = clamp(z, -SHEET_LENGTH_M / 2 + 0.03, SHEET_LENGTH_M / 2 - 0.03);
    data[o + 3] = radius;
    data[o + 4] = remaining;
    data[o + 5] = rand();
  }
  return data;
}

export interface IcePhysicsInput {
  densityPerM2: number;
  contactFraction: number;
  uniformityPct: number;
  wornFactor: number;
  ageEnds: number;
  frost: number;
  iceC: number;
  sideBias?: number; // -1 left, +1 right
  sideHeightDifferenceMm?: number;
}

export function frictionCoefficient(p: IcePhysicsInput): number {
  const optimalDensity = 1550;
  const densityMismatch = Math.abs(p.densityPerM2 - optimalDensity) / optimalDensity;
  const densityTerm = 0.0011 * Math.tanh((p.densityPerM2 - optimalDensity) / 1300);
  const contactTerm = 0.92 * p.contactFraction;
  const uniformityTerm = (100 - p.uniformityPct) * 0.000035;
  const wearTerm = (1 - p.wornFactor) * 0.0032 + p.ageEnds * 0.00045;
  const tempDeviation = p.iceC + 4.6;
  const tempTerm = 0.00017 * tempDeviation * tempDeviation;
  const frostTerm = 0.0065 * clamp(p.frost, 0, 1);
  const sideTerm = p.sideBias ? p.sideBias * 0.00045 : 0;
  const sideHeightTerm = Math.abs(p.sideHeightDifferenceMm ?? 0) * 0.00055;
  return clamp(
    0.0064 +
      densityTerm +
      0.0011 * densityMismatch +
      contactTerm +
      uniformityTerm +
      wearTerm +
      tempTerm +
      frostTerm +
      sideTerm +
      sideHeightTerm,
    0.0052,
    0.026
  );
}

interface LaneTrial {
  timeS: number;
  driftCm: number;
  reached: boolean;
  stopZ: number;
  samples: TrialSample[];
  mu: number;
}

function simulateLane(
  height: Float32Array,
  risk: Float32Array,
  x0: number,
  mu: number,
  seed: number
): LaneTrial {
  const dt = 1 / 180;
  let x = x0;
  let z = FRONT_THROW_Z;
  let vx = 0;
  let vz = TRIAL_V0_MPS;
  let t = 0;
  const rand = mulberry32(seed);
  const samples: TrialSample[] = [{ t: 0, x, z, speed: vz }];
  let nextSample = 0.08;
  let reached = false;
  let crossingTime = 0;

  for (let step = 0; step < 20 * 180; step++) {
    const speed = Math.hypot(vx, vz);
    if (speed < 0.025) break;
    const { gx } = heightGradient(height, x, z, 0.16);
    const gzGrad = heightGradient(height, x, z, 0.16).gz;
    const idxX = clamp(
      Math.round(((x + SHEET_WIDTH_M / 2) / SHEET_WIDTH_M) * (HEIGHT_NX - 1)),
      0,
      HEIGHT_NX - 1
    );
    const idxZ = clamp(
      Math.round(((z + SHEET_LENGTH_M / 2) / SHEET_LENGTH_M) * (HEIGHT_NZ - 1)),
      0,
      HEIGHT_NZ - 1
    );
    const localRisk = risk[idxZ * HEIGHT_NX + idxX] ?? 0;

    const friction = 9.81 * mu;
    let ax = -friction * (vx / speed) - 9.81 * 0.42 * gx;
    const az = -friction * (vz / speed) - 9.81 * 0.16 * gzGrad;
    // 局部突变/冰碴给壶一个可重复的小扰动。
    ax += Math.sin(z * 7.7 + seed) * 0.006 * localRisk;
    ax += (rand() - 0.5) * 0.0018 * localRisk;

    const prevZ = z;
    vx += ax * dt;
    vz += az * dt;
    x += vx * dt;
    z += vz * dt;
    t += dt;

    if (prevZ < BACK_THROW_Z && z >= BACK_THROW_Z && vz > 0) {
      const f = (BACK_THROW_Z - prevZ) / (z - prevZ);
      crossingTime = t - dt + f * dt;
      reached = true;
      break;
    }

    if (t >= nextSample) {
      samples.push({ t, x, z, speed: Math.hypot(vx, vz) });
      nextSample += 0.08;
    }
    if (z > SHEET_LENGTH_M / 2 - 1 || Math.abs(x) > SHEET_WIDTH_M / 2) break;
  }

  if (reached) {
    samples.push({ t: crossingTime, x, z: BACK_THROW_Z, speed: Math.hypot(vx, vz) });
  }
  return {
    timeS: reached ? crossingTime : 99,
    driftCm: (x - x0) * 100,
    reached,
    stopZ: z,
    samples,
    mu
  };
}

let trialSerial = 1;

export function simulateTrial(
  height: Float32Array,
  risk: Float32Array,
  physics: Omit<IcePhysicsInput, 'sideBias'>,
  flatness: FlatnessMetrics,
  clockS: number
): TrialResult {
  const leftMu = frictionCoefficient({
    ...physics,
    sideBias: -1,
    sideHeightDifferenceMm: flatness.sideHeightDifferenceMm
  });
  const rightMu = frictionCoefficient({
    ...physics,
    sideBias: 1,
    sideHeightDifferenceMm: -flatness.sideHeightDifferenceMm
  });
  const left = simulateLane(height, risk, LEFT_LANE_X, leftMu, 9101);
  const right = simulateLane(height, risk, RIGHT_LANE_X, rightMu, 17761);
  const reached = left.reached && right.reached;
  const totalS = reached ? (left.timeS + right.timeS) / 2 : 99;
  const driftCm = (Math.abs(left.driftCm) + Math.abs(right.driftCm)) / 2;
  const speedError = Math.abs(totalS - TARGET_TRIAL_S);
  const score = clamp(100 - speedError * 7.5 - Math.abs(left.timeS - right.timeS) * 18 - driftCm * 1.1, 0, 100);

  let message: string;
  if (!reached) message = '试滑壶未能到达后掷线：摩擦过大或卵石/结霜状态异常。';
  else if (speedError < 0.7 && Math.abs(left.timeS - right.timeS) < 0.35 && driftCm < 8)
    message = '冰速接近目标，左右一致，走线稳定。';
  else if (speedError >= 0.7) message = totalS > TARGET_TRIAL_S ? '冰面偏慢：接触面积、结霜或冰温偏软需要调整。' : '冰面偏快：卵石过尖/密度偏低，可适当削顶或增加密度。';
  else if (Math.abs(left.timeS - right.timeS) >= 0.35) message = '左右冰速不一致，检查洒点偏差、管路和两侧冰高。';
  else message = '走线偏移偏大，检测页标红区域仍需刮平。';

  return {
    id: trialSerial++,
    atClockS: clockS,
    totalS,
    leftS: left.timeS,
    rightS: right.timeS,
    driftCm,
    leftDriftCm: left.driftCm,
    rightDriftCm: right.driftCm,
    mu: (leftMu + rightMu) / 2,
    targetS: TARGET_TRIAL_S,
    score: reached ? score : Math.min(score, 18),
    reached,
    stopZ: reached ? BACK_THROW_Z : (left.stopZ + right.stopZ) / 2,
    samples: left.samples,
    rightSamples: right.samples,
    flatness,
    frost: physics.frost,
    message
  };
}

export function dewPointC(roomC: number, rhPct: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * roomC) / (b + roomC) + Math.log(Math.max(1, rhPct) / 100);
  return (b * alpha) / (a - alpha);
}
