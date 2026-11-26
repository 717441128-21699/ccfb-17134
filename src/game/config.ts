import type { VenueSystem } from './types';

export const SHEET_WIDTH_M = 4.75;
export const SHEET_LENGTH_M = 45.72;
export const SHEET_AREA_M2 = SHEET_WIDTH_M * SHEET_LENGTH_M;

/** 高度场顶点数（含端点）。x 向约 4.8cm，z 向约 20cm 一个采样点。 */
export const HEIGHT_NX = 101;
export const HEIGHT_NZ = 229;

/** 试滑计时门：前掷线 → 后掷线，27m。 */
export const FRONT_THROW_Z = -13.5;
export const BACK_THROW_Z = 13.5;
export const TRIAL_DISTANCE_M = BACK_THROW_Z - FRONT_THROW_Z;
export const TRIAL_V0_MPS = 2.8;
export const TARGET_TRIAL_S = 12.6;

export const LEFT_LANE_X = -1.18;
export const RIGHT_LANE_X = 1.18;

export const THICK_LAYER_WARN_MM = 1.6;
export const RED_DIFF_THRESHOLD_MM = 1.0;
export const MAX_PEBBLE_INSTANCES = 500_000;

export const TOTAL_ENDS = 6;

export const VENUES: VenueSystem[] = [
  {
    id: 'aurora',
    venue: '北境冰壶中心',
    city: '哈尔滨分区 · 虚构旗舰馆',
    systemName: '极光排管 AURORA-18',
    coolant: '氨 / CO₂ 复叠，泵供液',
    description: '密排 18mm 盘管与低热阻找平层，冰温响应快；馆体保温和转轮除湿稳定，适合大赛。',
    pipeDefaultC: -18,
    pipeMinC: -24,
    pipeMaxC: -10,
    resistance: 0.085,
    climateTauS: 1500,
    roomDefaultC: 11,
    humidityDefaultPct: 42,
    humidityTargetPct: 45,
    crowdCapacity: 1800,
    frostThresholdPct: 62,
    color: '#67e8f9'
  },
  {
    id: 'harbor',
    venue: '港湾会展临时冰场',
    city: '东南沿海 · 展览中心 3 号馆',
    systemName: '冰匣 MOD-P12 模块制冷垫',
    coolant: '40% 丙二醇，模块化液压排管',
    description: '安装快但接触热阻偏大，冰面温差恢复慢；海边高湿加上满场观众，极易结霜。',
    pipeDefaultC: -18,
    pipeMinC: -22,
    pipeMaxC: -8,
    resistance: 0.112,
    climateTauS: 850,
    roomDefaultC: 13,
    humidityDefaultPct: 61,
    humidityTargetPct: 58,
    crowdCapacity: 1200,
    frostThresholdPct: 68,
    color: '#7dd3fc'
  },
  {
    id: 'plateau',
    venue: '高原低气压训练馆',
    city: '海拔 2240m · 虚构训练基地',
    systemName: '霜脉 CO₂ 跨临界直冷',
    coolant: 'CO₂ 直接蒸发 / 热氟融霜',
    description: '空气干燥、制冷极强，冰层冻结快；但冰面过硬时摩擦和崩点会改变冰速。',
    pipeDefaultC: -17,
    pipeMinC: -27,
    pipeMaxC: -12,
    resistance: 0.067,
    climateTauS: 1200,
    roomDefaultC: 10,
    humidityDefaultPct: 31,
    humidityTargetPct: 38,
    crowdCapacity: 700,
    frostThresholdPct: 55,
    color: '#a5b4fc'
  },
  {
    id: 'brine77',
    venue: '老体育馆冰壶俱乐部',
    city: '老城区 · 1977 年馆',
    systemName: '老冰匠 BRINE-77 盐水排管',
    coolant: '氯化钙盐水，旧排管间距不均',
    description: '热阻高且两侧供液不均，冻结慢、左右温差明显；除湿机噪音大，但老制冰师熟悉它的脾气。',
    pipeDefaultC: -17,
    pipeMinC: -20,
    pipeMaxC: -6,
    resistance: 0.132,
    climateTauS: 700,
    roomDefaultC: 12,
    humidityDefaultPct: 57,
    humidityTargetPct: 55,
    crowdCapacity: 500,
    frostThresholdPct: 65,
    color: '#fbbf24'
  }
];

export function getVenue(id: string): VenueSystem {
  return VENUES.find((v) => v.id === id) ?? VENUES[0];
}
