// 轻量值噪声:用于地坪波浪度与每层冰的不平整度

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695040888963) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 二维值噪声,输入为实际坐标与波长(m) */
export function valueNoise2D(x: number, z: number, wavelength: number, seed: number): number {
  const fx = x / wavelength;
  const fz = z / wavelength;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smooth(fx - ix);
  const tz = smooth(fz - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * tz; // 0..1
}

/** 分形叠加,返回 -1..1 */
export function fbm(x: number, z: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let wl = 6;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise2D(x, z, wl, seed + i * 131) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    wl *= 0.45;
  }
  return sum / norm;
}
