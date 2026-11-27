/**
 * 全局物理与场地常量。
 * 单位约定:长度 m,温度 ℃,时间 s,质量 kg,压力 Pa。
 * 所有"魔法数字"集中在此,scripts/calibrate.ts 负责标定冰速参数。
 */

// ---------- 冰壶赛道几何(WCF 标准,单位 m) ----------
export const RINK = {
  LENGTH: 45.72, // 挡板到挡板
  WIDTH: 4.75,
  HOG_X: 9.779, // 中线到前掷线
  TEE_X: 16.4592, // 中线到圆心
  BACK_X: 22.86, // 中线到挡板
  HOUSE_RADII: [0.1524, 0.6096, 1.2192, 1.8288], // 按钮/4ft/8ft/12ft
  // 洒点作业区:两条前掷线之间
  get PEBBLE_LEN() {
    return this.HOG_X * 2;
  },
  PEBBLE_AREA() {
    return this.PEBBLE_LEN * this.WIDTH;
  }
} as const;

// 冰面高度场网格(检测页高低差标红 / 走线偏转都从这里采样)
export const GRID_NX = 96;
export const GRID_NY = 48;

// ---------- 浇水(基础冰) ----------
export const FLOOD = {
  MIN_THICKNESS_MM: 2,
  MAX_THICKNESS_MM: 15,
  MIN_WATER_TEMP_C: 20,
  MAX_WATER_TEMP_C: 70,
  TARGET_TOTAL_MM: 30, // 合格基础冰总厚度
  MIN_TOTAL_MM: 24,
  MAX_TOTAL_MM: 42,
  SMOOTHING_PER_PASS: 0.18, // 每层冻透后,该层起伏只保留 18%(自流平)
  SMOOTHING_MIN_MM: 0.08 // 收敛下限
} as const;

// ---------- 冻结模型(经验标定的层冻结模型) ----------
export const FREEZE = {
  // t_freeze(min) = (d / 3.5)^2 * pipeFactor * waterFactor
  REF_THICKNESS_MM: 3.5,
  REF_TIME_MIN: 12,
  WATER_TEMP_REF_C: 40,
  WATER_TEMP_FACTOR: 0.0075, // 每比参考水温高 1℃,冻结时间 +0.75%
  PIPE_DESIGN_REF: -12 // 制冷管设计温度基准
} as const;

// ---------- 洒点(卵石点) ----------
export const PEBBLE = {
  MIN_WATER_TEMP_C: 38,
  MAX_WATER_TEMP_C: 60,
  MIN_TANK_HT_M: 0.25,
  MAX_TANK_HT_M: 0.55,
  MIN_NOZZLE_MM: 2,
  MAX_NOZZLE_MM: 6,
  MIN_SPEED_MPS: 0.6,
  MAX_SPEED_MPS: 1.8,
  // 水珠从喷头到冰面的落地效率(飞溅、飘走、合并损失)
  LANDING_EFFICIENCY: 0.45,
  JITTER: 0.12, // 落点尺寸/位置随机散布 ±12%
  MAX_INSTANCES: 420000, // GPU 实例上限
  DENSITY_WARN_PER_M2: 32000
} as const;

// 半球形卵石点小水滴的冻结(秒),d 为半球底直径 mm
export function pebbleFreezeSeconds(diameterMm: number, pipeTempC: number, waterTempC: number): number {
  const base = 26 * Math.pow(diameterMm / 4, 2);
  const pipeF = Math.pow(2, (FREEZE.PIPE_DESIGN_REF - pipeTempC) / 10); // 每暖 10℃ 时间翻倍
  const waterF = 1 + (waterTempC - 45) * 0.01;
  return (base * pipeF * waterF) / 2; // 小水滴比整层冰薄得多,经验折半
}

// ---------- 刮冰(削顶) ----------
export const SCRAPE = {
  MIN_DEPTH_MM: 0.05,
  MAX_DEPTH_MM: 2.0,
  REMOVE_DEPTH_MM: 2.5 // 削到这个深度视为整颗去掉
} as const;

// ---------- 冰壶滑行模型(scripts/calibrate.ts 标定) ----------
export const STONE = {
  MASS_KG: 19.96,
  RELEASE_SPEED_MPS: 2.35, // 试滑壶统一出手速度
  STOP_SPEED: 0.01,
  DT: 0.01,
  // μ(v) = MU_C0 + MU_C1·v^1.5(标定脚本校准,标准状态 hog 用时 ≈24.5s)
  MU_C0: 0.0006,
  MU_C1: 0.0096,
  MU_EXP: 1.5,
  REF_DENSITY_PER_M2: 4000, // 标准点密度,密度因子 = 1 的位置(真实赛道 2000~5000/m²)
  CONTACT_OPT: 0.3, // 最佳接触面比例
  FROST_K: 0.45, // 每 1mm 霜的摩擦增幅(霜上限 0.35mm → 最多 +16%)
  TEMP_K: 0.015, // 冰温每偏离目标 1℃ 的摩擦增幅
  TARGET_ICE_TEMP_C: -5,
  RELIEF_K: 0.03, // 每 1mm 高低差的摩擦增幅
  CURL_K: 0.9, // 横坡 → 横向加速度耦合
  PATH_TOL_M: 0.55 // 走线评分允许的横向偏差(m)
} as const;

// ---------- 结霜模型 ----------
export const FROST = {
  RH_THRESHOLD: 0.65, // 相对湿度超过 65% 且冰面低于露点时开始结霜
  GROW_RATE: 0.012, // 每秒(模拟时间)霜增厚 mm 的基准速率
  MAX_MM: 0.35,
  SCRAPE_REMOVES: 0.08 // 每次刮冰顺带刮掉的霜 mm
} as const;

// ---------- 局间冰面演化 ----------
export const END_EVOLUTION = {
  ENDS_PER_GAME: 10,
  END_DURATION_S: 900, // 一局 15 分钟模拟时间
  WEAR_CONTACT: 0.012, // 每局接触点磨损(接触面比例漂移)
  CROWD_RH_RATE: 0.02, // 满场观众每局抬升的相对湿度
  CROWD_AIR_TEMP: 0.35 // 满场观众每局抬升的室温 ℃
} as const;

// ---------- 评分 ----------
export const SCORE = {
  // 各维度权重
  W_SPEED: 0.35,
  W_SYMMETRY: 0.3,
  W_PATH: 0.25,
  W_FROST: 0.1,
  TARGET_HOG_TIME_S: 24.5, // 目标前掷线间滑行时间
  SPEED_TOL_S: 1.2 // ±1.2s 内视为稳定
} as const;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
