/**
 * 可种子化随机数(mulberry32)+ 一维值噪声 / 分形噪声。
 * 冰面起伏、水珠散布都走这里,保证同一配方可复现。
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** [lo, hi) 均匀分布 */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** 正态近似(中心极限) */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) / 1.2;
  }
}

/** 一维值噪声,周期 256 */
export class ValueNoise1D {
  private table: Float32Array;
  constructor(rng: Rng) {
    this.table = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.table[i] = rng.next() * 2 - 1;
  }
  sample(x: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const a = this.table[i & 255];
    const b = this.table[(i + 1) & 255];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  }
  fbm(x: number, octaves = 4): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.sample(x * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.13;
    }
    return sum / norm;
  }
}
