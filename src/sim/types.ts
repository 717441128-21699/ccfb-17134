// 仿真层共享类型定义

export type Phase = 'build' | 'maintenance' | 'end' | 'finished';

export type Spin = 'cw' | 'ccw';

/** 一次浇水形成的冰层 */
export interface FloodLayer {
  id: number;
  thicknessM: number;      // 名义厚度
  waterTempC: number;      // 水温
  freezeTimeS: number;     // 完全冻透所需时间(秒)
  elapsedS: number;        // 已冻结时间(仿真秒)
  frozen: boolean;
  roughnessMm: number;     // 该层冻结后的不平度振幅
}

/** 一次洒点作业 */
export interface PebbleSpray {
  id: number;
  timeS: number;
  dropletDiaMm: number;    // 水珠直径
  baseRadiusMm: number;    // 卵石点底面半径
  capHeightMm: number;     // 卵石点球冠高度
  density: number;         // 每平方米点数
  count: number;
  cutFraction: number;     // 当前削顶比例 0~1
  failed: boolean;         // 是否被判废(底冰没冻透)
  waterTempC: number;
  walkSpeed: number;       // 倒退走速 m/s
  tankHeadM: number;
  orificeMm: number;
}

/** 试滑壶结果 */
export interface ThrowResult {
  spin: Spin;
  hogSeconds: number;      // 前掷线到后掷线秒数
  lateralAtHogM: number;   // 到达后掷线时横向偏移
  finalZM: number;
  friction: number;        // 本次平均摩擦系数
  path: { x: number; z: number; t: number }[];
}

/** 场地分区统计(沿长度 8 段 × 横向 3 条 = 24 区) */
export interface ZoneStat {
  index: number;
  along: number;           // 0..7
  side: number;            // 0左 1中 2右
  density: number;
  meanRadiusMm: number;
  contactFraction: number;
  wear: number;            // 0..1
  frost: number;           // 0..1
  iceTempC: number;
  friction: number;
  hogSeconds: number;
}

/** 单局评分 */
export interface EndScore {
  end: number;
  stability: number;
  symmetry: number;
  path: number;
  penalty: number;
  total: number;
  grade: string;
  notes: string[];
}

export interface VenueDef {
  id: string;
  name: string;
  desc: string;
  sheets: number;
  capacity: number;
  insulation: number;          // 保温系数 0..1,越高越好
  dehumKgS: number;            // 除湿机能力 kg/s
  hvacPowerKw: number;         // 空调能力
  ambientRh: number;           // 无人群时平衡湿度 %
  ambientTempC: number;        // 无人群时平衡室温
  crowdHeatW: number;          // 每人散热量 W
  crowdMoistureKgS: number;    // 每人散湿 kg/s
  floorWavinessMm: number;     // 地坪原始波浪度
}

export interface FridgeDef {
  id: string;
  name: string;
  desc: string;
  brineSetpointC: number;      // 载冷剂设定温度
  efficiency: number;          // 换热效率 0..1
  uniformity: number;          // 温度均匀性 0..1
  recoveryRate: number;        // 温降恢复速率(相对值)
}

export interface SprayParams {
  tankHeadM: number;
  orificeMm: number;
  nozzleCount: number;
  headWidthM: number;
  waterTempC: number;
  walkSpeed: number;
  flowLmin: number;
}

export interface FloodParams {
  thicknessMm: number;
  waterTempC: number;
}
