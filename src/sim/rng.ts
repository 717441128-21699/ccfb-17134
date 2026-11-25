// 可播种随机数:保证同一组作业参数生成可复现的卵石点分布

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }

  /** [0,1) 均匀分布 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Box-Muller 高斯 */
  gaussian(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** 抖动网格:在给定矩形内生成接近规则、带随机抖动的点列 */
  jitteredGrid(
    width: number, length: number, targetCount: number, jitter = 0.42,
  ): { x: number; z: number }[] {
    const cols = Math.max(1, Math.round(Math.sqrt(targetCount * width / length)));
    const rows = Math.max(1, Math.round(targetCount / cols));
    const dx = width / cols;
    const dz = length / rows;
    const pts: { x: number; z: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -width / 2 + (c + 0.5) * dx + this.gaussian(0, dx * jitter * 0.5);
        const z = -length / 2 + (r + 0.5) * dz + this.gaussian(0, dz * jitter * 0.5);
        if (x > -width / 2 && x < width / 2 && z > -length / 2 && z < length / 2) {
          pts.push({ x, z });
        }
      }
    }
    return pts;
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function round(v: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}
