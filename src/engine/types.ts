/** 全部共享类型定义 */

export type Phase =
  | 'prep-flood' // 基础冰制作
  | 'prep-pebble' // 赛前洒点
  | 'prep-scrape' // 刮冰削顶
  | 'between-ends' // 局间维护
  | 'game-over';

export interface FloodLayer {
  thicknessMm: number;
  waterTempC: number;
  uniformity: number; // 0.5~1,玩家控制的浇水平匀度
  appliedAtSimS: number;
  freezeFraction: number; // 0~1
  frozenAtSimS: number | null;
  /** 这一层带来的初始不平整度 mm */
  roughnessMm: number;
}

export interface PebbleBatch {
  waterTempC: number;
  tankHeightM: number;
  nozzleMm: number;
  walkSpeedMps: number;
  appliedAtSimS: number;
  startIndex: number;
  count: number;
  nominalDropMm: number;
  densityPerM2: number;
}

export interface ScrapeRecord {
  depthMm: number;
  atSimS: number;
  avgContactBefore: number;
}

/** 单颗卵石点的 GPU 实例数据(全部用相对半径的归一化量,渲染端还原) */
export interface Pebble {
  x: number; // 赛道坐标 m
  z: number;
  r: number; // 半球底面半径 mm
  h: number; // 高度 mm(=r,正半球)
  cut: number; // 削顶量 mm(0 = 未削)
}

export interface VenueConfig {
  id: string;
  name: string;
  description: string;
  baseAirTempC: number;
  baseRh: number; // 相对湿度 0~1
  crowdMax: number; // 满场人数
  crowdRhImpact: number; // 满场相对湿度抬升
  crowdTempImpact: number; // 满场室温抬升 ℃
  dehumidifierKw: number;
  systemId: string;
}

export interface RefrigerationSystem {
  id: string;
  name: string;
  description: string;
  minPipeTempC: number;
  /** 管温对设定值的响应时间常数(s,模拟时间) */
  responseTauS: number;
  /** 管温空间不均导致的冰温波动 ℃ */
  spatialUnevennessC: number;
  efficiency: number; // 0.8~1.2,影响冻结速度
}

export interface EnvironmentState {
  airTempC: number;
  rh: number;
  dewPointC: number;
  pipeSetpointC: number;
  pipeTempC: number;
  iceTempC: number;
  crowd: number; // 当前人数
  dehumidifierOn: boolean;
  frostMm: number;
}

export interface TestStoneResult {
  atSimS: number;
  direction: 1 | -1; // 1 = 从 -hog 到 +hog
  hogTimeS: number | null; // 前掷线到前掷线用时(没到为 null)
  lateralDriftM: number; // 终点横向偏差
  path: { x: number; z: number }[];
  stopped: boolean;
}

export interface EndScore {
  end: number;
  atSimS: number;
  speedScore: number; // 0~100
  symmetryScore: number;
  pathScore: number;
  frostScore: number;
  total: number;
  grade: Grade;
  hogTimeA: number;
  hogTimeB: number;
  driftA: number;
  driftB: number;
  frostMm: number;
  notes: string[];
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface PenaltyEvent {
  atSimS: number;
  reason: string;
}

export interface LogEntry {
  atSimS: number;
  level: 'info' | 'warn' | 'bad';
  text: string;
}
