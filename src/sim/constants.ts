// 物理常量、赛道几何、场馆与制冷系统目录(场馆/机组为本游戏虚构)
import type { FridgeDef, VenueDef } from './types';

// ---- 冰壶赛道几何(单位 m,参照真实赛道尺寸) ----
export const SHEET_W = 4.75;
export const SHEET_L = 45.72;
export const HOG_TO_HOG = 21.945;            // 两条 hog line 间距
export const HOG_Z = HOG_TO_HOG / 2;         // 相对赛道中心 ±10.97
export const TEE_Z = 16.459;                 // 圆心位置
export const BACK_Z = 21.34;                 // 挡板附近
export const CELL_M = 0.1;                   // 冰面高度场网格 10cm
export const NX = Math.round(SHEET_W / CELL_M); // 48
export const NZ = Math.round(SHEET_L / CELL_M); // 458

export const ZONES_ALONG = 8;
export const ZONES_SIDE = 3;
export const ZONE_COUNT = ZONES_ALONG * ZONES_SIDE;

// ---- 物理常量(SI) ----
export const RHO_ICE = 917;
export const RHO_WATER = 1000;
export const L_FUSION = 334e3;               // J/kg
export const C_WATER = 4186;                 // J/(kg·K)
export const K_ICE = 2.22;                   // W/(m·K)
export const GRAVITY = 9.81;
export const SIGMA_0 = 0.0756;               // 0°C 水表面张力 N/m
export const MU_REF = 0.013;                 // 标定基准摩擦系数(出手 2.5m/s → 约 14.5s)
export const T_REF_HOG = 14.5;               // 基准冰速(秒)
export const FLAT_LIMIT_M = 0.001;           // 高低差 1mm 标红阈值

// ---- 游戏节奏 ----
export const END_COUNT = 6;
export const END_DURATION_S = 15 * 60;       // 每局仿真时长 15 分钟
export const MAX_RENDER_PEBBLES = 420000;    // 实例缓冲上限(约 40 万)

// ---- 四种虚构场馆 ----
export const VENUES: VenueDef[] = [
  {
    id: 'beichen',
    name: '北辰冰壶中心(城市标准馆)',
    desc: '2018 年建成的四赛道标准馆,保温与除湿都中规中矩,适合新手制冰师。',
    sheets: 4, capacity: 800, insulation: 0.85,
    dehumKgS: 0.005, hvacPowerKw: 120,
    ambientRh: 38, ambientTempC: 12,
    crowdHeatW: 110, crowdMoistureKgS: 0.000045,
    floorWavinessMm: 0.5,
  },
  {
    id: 'honggang',
    name: '红钢冷库(旧厂房改造馆)',
    desc: '老厂房改的双赛道馆,墙体保温差、除湿机老化,观众一多湿度就压不住。',
    sheets: 2, capacity: 300, insulation: 0.45,
    dehumKgS: 0.0022, hvacPowerKw: 55,
    ambientRh: 47, ambientTempC: 14,
    crowdHeatW: 115, crowdMoistureKgS: 0.00005,
    floorWavinessMm: 1.1,
  },
  {
    id: 'xuexian',
    name: '雪线基地(高原训练馆)',
    desc: '海拔 2200 米的国家队训练馆,空气干燥、制冷均匀,但低气压让水的沸点只有 93°C。',
    sheets: 2, capacity: 150, insulation: 0.92,
    dehumKgS: 0.004, hvacPowerKw: 80,
    ambientRh: 26, ambientTempC: 10,
    crowdHeatW: 105, crowdMoistureKgS: 0.000035,
    floorWavinessMm: 0.35,
  },
  {
    id: 'pengfang',
    name: '城市广场冰场(临时篷房馆)',
    desc: '篷房搭在商业广场里,隔热全靠一层膜,室外天气直接写在冰面上,地狱难度。',
    sheets: 1, capacity: 500, insulation: 0.22,
    dehumKgS: 0.003, hvacPowerKw: 70,
    ambientRh: 55, ambientTempC: 16,
    crowdHeatW: 120, crowdMoistureKgS: 0.000055,
    floorWavinessMm: 0.8,
  },
];

// ---- 四种虚构制冷系统 ----
export const FRIDGES: FridgeDef[] = [
  {
    id: 'hanquan',
    name: '寒泉-40 乙二醇机组',
    desc: '主流间接制冷,稳定耐用,温控精度 ±0.4°C,各赛事最常见的配置。',
    brineSetpointC: -7, efficiency: 0.92, uniformity: 0.9, recoveryRate: 1.0,
  },
  {
    id: 'beijixing',
    name: '北极星 氨泵直冷系统',
    desc: '氨直接蒸发,温差大、冻得快、全场温度均匀,但对操作员要求高。',
    brineSetpointC: -9, efficiency: 1.0, uniformity: 0.96, recoveryRate: 1.35,
  },
  {
    id: 'shuangzhong',
    name: '霜钟III 老式氟利昂风冷机组',
    desc: '退役场馆还在用的老机组,出水温度不够低,远端管路明显偏暖。',
    brineSetpointC: -4.5, efficiency: 0.7, uniformity: 0.55, recoveryRate: 0.6,
  },
  {
    id: 'binghe',
    name: '冰盒 M1 便携模块制冷橇',
    desc: '临时场地用的集装箱模块机,机动性好,功率与均匀性只能算够用。',
    brineSetpointC: -6, efficiency: 0.8, uniformity: 0.72, recoveryRate: 0.85,
  },
];
