import type { RefrigerationSystem, VenueConfig } from './types';

/**
 * 虚构的三种场馆 + 三种制冷系统(名字均为虚构,参数按真实量级编排)。
 */
export const VENUES: VenueConfig[] = [
  {
    id: 'fjord-arena',
    name: '峡湾社区冰馆',
    description: '老式社区馆,保温一般,观众席小。除湿机功率勉强够用,人一多湿度就压不住。',
    baseAirTempC: 8.5,
    baseRh: 0.42,
    crowdMax: 350,
    crowdRhImpact: 0.14,
    crowdTempImpact: 1.6,
    dehumidifierKw: 6,
    systemId: 'brine-mk2'
  },
  {
    id: 'aurora-dome',
    name: '极光穹顶体育馆',
    description: '新建大型综合馆,保温和气密都好,满场八千人时观众散热才是主要变量。',
    baseAirTempC: 7.0,
    baseRh: 0.35,
    crowdMax: 8000,
    crowdRhImpact: 0.1,
    crowdTempImpact: 2.2,
    dehumidifierKw: 18,
    systemId: 'direct-co2'
  },
  {
    id: 'pine-curling-house',
    name: '松林专用冰壶馆',
    description: '专用四赛道馆,制冷专为冰壶设计,温控细腻但设备老化,管温有轻微空间不均。',
    baseAirTempC: 6.5,
    baseRh: 0.38,
    crowdMax: 1200,
    crowdRhImpact: 0.08,
    crowdTempImpact: 0.9,
    dehumidifierKw: 12,
    systemId: 'ammonia-veteran'
  }
];

export const SYSTEMS: RefrigerationSystem[] = [
  {
    id: 'brine-mk2',
    name: '乙二醇盐水机组 MK-Ⅱ',
    description: '最常见的间接制冷:机组把盐水打冷,盐水在冰板盘管里循环。稳定但响应慢。',
    minPipeTempC: -14,
    responseTauS: 480,
    spatialUnevennessC: 0.7,
    efficiency: 1.0
  },
  {
    id: 'direct-co2',
    name: '直膨式 CO₂ 跨临界机组',
    description: '新一代直膨系统,盘管里直接蒸发,降温快、温控准,建造和运维成本高。',
    minPipeTempC: -18,
    responseTauS: 150,
    spatialUnevennessC: 0.25,
    efficiency: 1.18
  },
  {
    id: 'ammonia-veteran',
    name: '氨泵供液老机组',
    description: '二十年前的专用冰场方案,制冷极猛、能效高,但管路老化导致各区域温度不完全一致。',
    minPipeTempC: -17,
    responseTauS: 300,
    spatialUnevennessC: 1.0,
    efficiency: 1.1
  }
];

export function getSystem(id: string): RefrigerationSystem {
  return SYSTEMS.find((s) => s.id === id) ?? SYSTEMS[0];
}
