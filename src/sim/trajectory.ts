// 试滑壶轨迹:RK4 积分,摩擦减速 + 旋转侧偏(curl)+ 冰面坡度跑偏
import { GRAVITY, HOG_Z, SHEET_L, SHEET_W } from './constants';
import type { Spin, ThrowResult } from './types';
import { clamp } from './rng';

/** 仿真器需要提供的冰面采样接口 */
export interface SurfaceSampler {
  /** 冰面高度(m),相对基准平面 */
  heightAt(x: number, z: number): number;
  /** 局部摩擦系数 */
  frictionAt(x: number, z: number): number;
}

const CURL_RATIO = 0.05;   // 侧偏加速度占摩擦减速的比例
const DT = 0.05;           // 积分步长(s)

interface State { x: number; z: number; vx: number; vz: number }

function accel(s: State, spin: Spin, surf: SurfaceSampler): { ax: number; az: number } {
  const speed = Math.hypot(s.vx, s.vz);
  if (speed < 1e-6) return { ax: 0, az: 0 };
  const mu = surf.frictionAt(s.x, s.z);
  const aDrag = mu * GRAVITY;
  let ax = -aDrag * s.vx / speed;
  let az = -aDrag * s.vz / speed;

  // 旋转走线:垂直于速度方向的小侧偏力
  const spinSign = spin === 'cw' ? 1 : -1;
  const aCurl = spinSign * CURL_RATIO * aDrag;
  ax += aCurl * s.vz / speed;   // 行进方向的右侧单位向量 (vz,-vx)/v
  az += -aCurl * s.vx / speed;

  // 冰面坡度:重力沿斜面分量 a = -g·∇h
  const e = 0.06;
  const dhdx = (surf.heightAt(clamp(s.x + e, -SHEET_W / 2, SHEET_W / 2), s.z)
    - surf.heightAt(clamp(s.x - e, -SHEET_W / 2, SHEET_W / 2), s.z)) / (2 * e);
  const dhdz = (surf.heightAt(s.x, clamp(s.z + e, -SHEET_L / 2, SHEET_L / 2))
    - surf.heightAt(s.x, clamp(s.z - e, -SHEET_L / 2, SHEET_L / 2))) / (2 * e);
  ax += -GRAVITY * dhdx;
  az += -GRAVITY * dhdz;
  return { ax, az };
}

function rk4(s: State, spin: Spin, surf: SurfaceSampler): State {
  const a1 = accel(s, spin, surf);
  const s2: State = { x: s.x + s.vx * DT / 2, z: s.z + s.vz * DT / 2,
    vx: s.vx + a1.ax * DT / 2, vz: s.vz + a1.az * DT / 2 };
  const a2 = accel(s2, spin, surf);
  const s3: State = { x: s.x + s2.vx * DT / 2, z: s.z + s2.vz * DT / 2,
    vx: s.vx + a2.ax * DT / 2, vz: s.vz + a2.az * DT / 2 };
  const a3 = accel(s3, spin, surf);
  const s4: State = { x: s.x + s3.vx * DT, z: s.z + s3.vz * DT,
    vx: s.vx + a3.ax * DT, vz: s.vz + a3.az * DT };
  const a4 = accel(s4, spin, surf);
  return {
    x: s.x + DT * (s.vx + 2 * s2.vx + 2 * s3.vx + s4.vx) / 6,
    z: s.z + DT * (s.vz + 2 * s2.vz + 2 * s3.vz + s4.vz) / 6,
    vx: s.vx + DT * (a1.ax + 2 * a2.ax + 2 * a3.ax + a4.ax) / 6,
    vz: s.vz + DT * (a1.az + 2 * a2.az + 2 * a3.az + a4.az) / 6,
  };
}

/**
 * 从前掷线(z=-HOG_Z)出发,积分到后掷线(z=+HOG_Z)。
 * 初速按基准状态标定,使标准冰面 hog-to-hog ≈ 14.5s。
 */
export function simulateThrow(surf: SurfaceSampler, spin: Spin,
  launchSpeed = 2.5): ThrowResult {
  const s: State = { x: 0, z: -HOG_Z, vx: 0, vz: launchSpeed };
  let t = 0;
  const path: ThrowResult['path'] = [{ x: s.x, z: s.z, t: 0 }];
  let muSum = 0;
  let muN = 0;

  while (s.z < HOG_Z && t < 60) {
    const prev = { ...s };
    const next = rk4(s, spin, surf);
    t += DT;
    Object.assign(s, next);
    muSum += surf.frictionAt(s.x, s.z);
    muN++;
    if (Math.hypot(s.vx, s.vz) < 0.04) break;          // 壶停住了(冰太慢)
    if (path.length === 0 || t - path[path.length - 1].t >= 0.5) {
      path.push({ x: s.x, z: s.z, t });
    }
    if (prev.z < HOG_Z && s.z >= HOG_Z) {              // 线性插值 crossing 时刻
      const k = (HOG_Z - prev.z) / (s.z - prev.z);
      t = t - DT + DT * k;
      s.x = prev.x + (s.x - prev.x) * k;
      s.z = HOG_Z;
      break;
    }
  }
  path.push({ x: s.x, z: s.z, t });
  return {
    spin,
    hogSeconds: s.z >= HOG_Z - 0.01 ? t : 40,
    lateralAtHogM: s.x,
    finalZM: s.z,
    friction: muN ? muSum / muN : 0,
    path,
  };
}
