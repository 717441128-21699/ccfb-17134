/**
 * 冰面高度场:
 * - GRID_NX × GRID_NY 网格,存基础冰面相对高度(mm)与每格霜厚(mm)
 * - 浇水叠加 + 冻透收敛整平 + 刮冰整体微调
 * - 提供坡度采样(壶的跑偏)、高低差统计(检测页标红)
 */
import { FLOOD, GRID_NX, GRID_NY, RINK, clamp } from './constants';
import { Rng, ValueNoise1D } from './rng';

export class IceField {
  readonly nx = GRID_NX;
  readonly ny = GRID_NY;
  /** 基础冰面相对高度 mm(冻透的层累积,刮冰整体减去) */
  readonly base: Float32Array;
  /** 每格霜厚 mm */
  readonly frost: Float32Array;
  /** 最近一次浇水后、尚未整平的扰动幅度 mm(随冻结收敛) */
  private pendingRough = 0;
  private noiseX: ValueNoise1D;
  private noiseZ: ValueNoise1D;
  /** 刮冰累计削去的基础冰 mm */
  scrapedBaseMm = 0;
  /** 统计缓存(网格 4608 格,每帧全扫不划算;结构变化时失效) */
  private cachedRelief: number | null = null;
  private cachedRedRatio: number | null = null;
  private cachedLrDelta: number | null = null;

  invalidateStats(): void {
    this.cachedRelief = null;
    this.cachedRedRatio = null;
    this.cachedLrDelta = null;
  }

  constructor(rng: Rng) {
    this.base = new Float32Array(this.nx * this.ny);
    this.frost = new Float32Array(this.nx * this.ny);
    this.noiseX = new ValueNoise1D(rng);
    this.noiseZ = new ValueNoise1D(rng);
  }

  idx(ix: number, iz: number): number {
    return ix * this.ny + iz;
  }

  /** 浇一层水:厚度均匀叠加;均匀度差则留下条状起伏,冻透时再自流平收敛 */
  addFlood(thicknessMm: number, uniformity: number, rng: Rng): number {
    const rough = thicknessMm * (1.15 - uniformity) * 0.85;
    this.pendingRough = rough;
    const streakPhase = rng.range(0, 20);
    for (let ix = 0; ix < this.nx; ix++) {
      const x = ix / (this.nx - 1);
      const streak = this.noiseZ.fbm(x * 9 + streakPhase, 3);
      for (let iz = 0; iz < this.ny; iz++) {
        const z = iz / (this.ny - 1);
        const waviness = this.noiseX.fbm(z * 6 + ix * 0.15, 2) * 0.4;
        const micro = rng.gauss() * 0.12;
        const uneven = rough * (streak * 0.7 + waviness * 0.3) + micro;
        this.base[this.idx(ix, iz)] += thicknessMm + uneven;
      }
    }
    this.invalidateStats();
    return rough;
  }

  /** 一层冻透:水在冻结前自流平,该层起伏向全场均值大幅收敛 */
  onLayerFrozen(): void {
    let sum = 0;
    for (let i = 0; i < this.base.length; i++) sum += this.base[i];
    const mean = sum / this.base.length;
    const factor = FLOOD.SMOOTHING_PER_PASS;
    for (let i = 0; i < this.base.length; i++) {
      const dev = this.base[i] - mean;
      // 收敛到地板值,避免无限趋近但永远不平
      this.base[i] = mean + Math.sign(dev) * Math.max(Math.abs(dev) * factor, FLOOD.SMOOTHING_MIN_MM * 0.25);
    }
    this.pendingRough = 0;
    this.invalidateStats();
  }

  /** 刮冰:整体削去基础冰(削顶主要作用在卵石点上,这里只记底板轻微磨损) */
  shaveBase(depthMm: number): void {
    const d = depthMm * 0.08;
    for (let i = 0; i < this.base.length; i++) this.base[i] -= d;
    this.scrapedBaseMm += d;
    this.invalidateStats();
  }

  /** 清霜(刮冰顺带) */
  reduceFrost(amountMm: number): void {
    for (let i = 0; i < this.frost.length; i++) {
      this.frost[i] = Math.max(0, this.frost[i] - amountMm);
    }
  }

  /** 世界坐标 → 网格插值采样基础冰面 mm */
  sampleBaseMm(x: number, z: number): number {
    const fx = clamp(((x + RINK.LENGTH / 2) / RINK.LENGTH) * (this.nx - 1), 0, this.nx - 1.001);
    const fz = clamp(((z + RINK.WIDTH / 2) / RINK.WIDTH) * (this.ny - 1), 0, this.ny - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const b00 = this.base[this.idx(ix, iz)];
    const b10 = this.base[this.idx(ix + 1, iz)];
    const b01 = this.base[this.idx(ix, iz + 1)];
    const b11 = this.base[this.idx(ix + 1, iz + 1)];
    return (b00 * (1 - tx) + b10 * tx) * (1 - tz) + (b01 * (1 - tx) + b11 * tx) * tz;
  }

  /** 霜厚插值 mm */
  sampleFrostMm(x: number, z: number): number {
    const fx = clamp(((x + RINK.LENGTH / 2) / RINK.LENGTH) * (this.nx - 1), 0, this.nx - 1.001);
    const fz = clamp(((z + RINK.WIDTH / 2) / RINK.WIDTH) * (this.ny - 1), 0, this.ny - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const f00 = this.frost[this.idx(ix, iz)];
    const f10 = this.frost[this.idx(ix + 1, iz)];
    const f01 = this.frost[this.idx(ix, iz + 1)];
    const f11 = this.frost[this.idx(ix + 1, iz + 1)];
    return (f00 * (1 - tx) + f10 * tx) * (1 - tz) + (f01 * (1 - tx) + f11 * tx) * tz;
  }

  /**
   * 横向坡度(沿 x 滑行时 z 方向的 dh/dz),无量纲 mm/m。
   * 正坡度表示 +z 侧高,壶受重力向 -z 偏。
   */
  crossSlopeMmPerM(x: number, z: number): number {
    const dz = RINK.WIDTH / this.ny;
    const h1 = this.sampleBaseMm(x, z + dz);
    const h0 = this.sampleBaseMm(x, z - dz);
    return (h1 - h0) / (2 * dz);
  }

  /** 检测页统计:全场最大高低差 mm(缓存) */
  reliefMm(): number {
    if (this.cachedRelief !== null) return this.cachedRelief;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < this.base.length; i++) {
      lo = Math.min(lo, this.base[i]);
      hi = Math.max(hi, this.base[i]);
    }
    this.cachedRelief = hi - lo;
    return this.cachedRelief;
  }

  /** 检测页:超过 1mm 高低差的格子比例(相对局部 3×3 邻域,缓存) */
  redCellRatio(thresholdMm = 1): number {
    if (this.cachedRedRatio !== null) return this.cachedRedRatio;
    let red = 0;
    for (let ix = 1; ix < this.nx - 1; ix++) {
      for (let iz = 1; iz < this.ny - 1; iz++) {
        const c = this.base[this.idx(ix, iz)];
        let localDelta = 0;
        for (const [dx, dz2] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          localDelta = Math.max(localDelta, Math.abs(c - this.base[this.idx(ix + dx, iz + dz2)]));
        }
        if (localDelta > thresholdMm) red++;
      }
    }
    this.cachedRedRatio = red / ((this.nx - 2) * (this.ny - 2));
    return this.cachedRedRatio;
  }

  /** 左右两半的平均高差 mm(对称性指标,缓存) */
  leftRightDeltaMm(): number {
    if (this.cachedLrDelta !== null) return this.cachedLrDelta;
    let l = 0;
    let r = 0;
    let nl = 0;
    let nr = 0;
    for (let ix = 0; ix < this.nx; ix++) {
      for (let iz = 0; iz < this.ny; iz++) {
        if (iz < this.ny / 2) {
          l += this.base[this.idx(ix, iz)];
          nl++;
        } else {
          r += this.base[this.idx(ix, iz)];
          nr++;
        }
      }
    }
    this.cachedLrDelta = Math.abs(l / nl - r / nr);
    return this.cachedLrDelta;
  }
}
