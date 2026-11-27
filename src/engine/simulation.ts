/**
 * 仿真总状态机:拥有全部物理状态,按固定步长推进模拟时间,
 * 暴露制冰师的所有操作(浇水/洒点/刮冰/环境控制/试滑/进入下一局)。
 * UI 与渲染器只读本状态,通过 subscribe() 收到变更通知。
 */
import {
  END_EVOLUTION,
  FLOOD,
  FROST,
  PEBBLE,
  RINK,
  SCRAPE,
  clamp,
  pebbleFreezeSeconds
} from './constants';
import { IceField } from './icefield';
import { Rng } from './rng';
import {
  applyPebble,
  averageContactFraction,
  averageRadiusMm,
  createPebbleArrays,
  densityPerM2,
  scrapePebbles,
  type PebbleArrays
} from './pebble';
import {
  advanceFrost,
  averageFrostMm
} from './frost';
import {
  advanceLayerFreeze,
  advancePipeTemp,
  computeIceTemp,
  dewPointC,
  layerFreezeSeconds
} from './thermal';
import { launchTestStone } from './stone';
import { aggregateGrade, scoreEnd } from './scoring';
import { getSystem, VENUES } from './venues';
import type {
  EndScore,
  EnvironmentState,
  FloodLayer,
  LogEntry,
  PenaltyEvent,
  PebbleBatch,
  Phase,
  ScrapeRecord,
  TestStoneResult,
  VenueConfig
} from './types';

export interface FloodParams {
  thicknessMm: number;
  waterTempC: number;
  uniformity: number;
}
export interface PebbleParams {
  waterTempC: number;
  tankHeightM: number;
  nozzleMm: number;
  walkSpeedMps: number;
}

type Listener = () => void;

export class Simulation {
  readonly rng = new Rng(20261128);
  readonly field = new IceField(this.rng);
  readonly pebbles: PebbleArrays = createPebbleArrays(PEBBLE.MAX_INSTANCES);

  phase: Phase = 'prep-flood';
  simS = 0;
  speed = 0; // 时间倍率,0 = 暂停
  currentEnd = 0;

  venue: VenueConfig = VENUES[0];
  env: EnvironmentState;

  layers: FloodLayer[] = [];
  pebbleBatches: PebbleBatch[] = [];
  scrapes: ScrapeRecord[] = [];
  testStones: TestStoneResult[] = [];
  endScores: EndScore[] = [];
  penalties: PenaltyEvent[] = [];
  log: LogEntry[] = [];

  /** 正在冻结中的最近一批卵石点的总冻结秒数 */
  private pebbleFreezeTotalS = 0;
  /** 未冻透点数(增量维护,避免每帧全量扫描几十万颗点) */
  private unfrozenPebbleCount = 0;
  /** 未冻透区间下界(冻结从批首向批尾推进,已冻透的不再扫) */
  private freezeCursor = 0;
  private listeners = new Set<Listener>();

  constructor() {
    const sys = getSystem(this.venue.systemId);
    this.env = {
      airTempC: this.venue.baseAirTempC,
      rh: this.venue.baseRh,
      dewPointC: dewPointC(this.venue.baseAirTempC, this.venue.baseRh),
      pipeSetpointC: -11,
      pipeTempC: -9,
      iceTempC: -6,
      crowd: 0,
      dehumidifierOn: true,
      frostMm: 0
    };
    void sys;
    this.pushLog('info', '新赛道开工:先一层层浇水冻出平整的基础冰');
  }

  // ---------- 订阅 ----------
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
  private pushLog(level: LogEntry['level'], text: string): void {
    this.log.unshift({ atSimS: this.simS, level, text });
    if (this.log.length > 120) this.log.pop();
  }

  // ---------- 派生量 ----------
  get system() {
    return getSystem(this.venue.systemId);
  }
  get totalIceMm(): number {
    return this.layers.reduce((a, l) => a + l.thicknessMm, 0);
  }
  get topLayer(): FloodLayer | null {
    return this.layers.length ? this.layers[this.layers.length - 1] : null;
  }
  get allFrozen(): boolean {
    return this.layers.length > 0 && this.layers.every((l) => l.freezeFraction >= 1);
  }
  /** 派生量缓存(采样 4 万点成本不低,500ms 刷一次足够 UI 用) */
  private cachedContact = 0;
  private cachedDensity = 0;
  private cachedRadius = 0;
  private cachedFrost = 0;
  private cacheAccS = 0;
  private cacheDirty = true;

  private refreshDerivedCache(): void {
    this.cachedContact = averageContactFraction(this.pebbles);
    this.cachedDensity = densityPerM2(this.pebbles);
    this.cachedRadius = averageRadiusMm(this.pebbles);
    this.cachedFrost = averageFrostMm(this.field);
    this.cacheDirty = false;
  }
  invalidateDerivedCache(): void {
    this.cacheDirty = true;
  }
  get contactFraction(): number {
    if (this.cacheDirty) this.refreshDerivedCache();
    return this.cachedContact;
  }
  get pebbleDensity(): number {
    if (this.cacheDirty) this.refreshDerivedCache();
    return this.cachedDensity;
  }
  get avgPebbleRadiusMm(): number {
    if (this.cacheDirty) this.refreshDerivedCache();
    return this.cachedRadius;
  }
  get frostMm(): number {
    if (this.cacheDirty) this.refreshDerivedCache();
    return this.cachedFrost;
  }
  get prepValid(): boolean {
    return (
      this.totalIceMm >= FLOOD.MIN_TOTAL_MM &&
      this.totalIceMm <= FLOOD.MAX_TOTAL_MM &&
      this.allFrozen &&
      this.field.reliefMm() <= 1.2 &&
      this.pebbles.count > 20000 &&
      this.unfrozenPebbles() < 0.05
    );
  }
  unfrozenPebbles(): number {
    return this.pebbles.count === 0 ? 0 : this.unfrozenPebbleCount / this.pebbles.count;
  }
  /** O(1) 未冻透点数(供渲染循环高频调用) */
  pebbleCountUnfrozen(): number {
    return this.unfrozenPebbleCount;
  }

  // ---------- 时间推进 ----------
  private static readonly STEP = 2.0; // 单步模拟秒(热过程缓慢,2s 足够精度)
  private static readonly MAX_STEPS_PER_FRAME = 300;
  /** 结霜网格刷新间隔(模拟秒),中间用累计量一次结算 */
  private static readonly FROST_INTERVAL_S = 30;
  private frostAccumS = 0;
  private frostWarned = false;

  advance(wallDtS: number): void {
    if (this.speed <= 0 || this.phase === 'game-over') return;
    let remaining = wallDtS * this.speed;
    let steps = 0;
    while (remaining > 0 && steps < Simulation.MAX_STEPS_PER_FRAME) {
      const dt = Math.min(Simulation.STEP, remaining);
      this.tick(dt);
      remaining -= dt;
      steps++;
    }
    this.emit();
  }

  private tick(dt: number): void {
    this.simS += dt;
    const sys = this.system;

    // 管温滞后 → 冰温 → 露点
    this.env.pipeTempC = advancePipeTemp(
      this.env.pipeTempC,
      this.env.pipeSetpointC,
      sys.responseTauS,
      dt
    );
    // 管温空间不均 → 冰温上的小波动
    const spatial = sys.spatialUnevennessC * Math.sin(this.simS / 240) * 0.4;
    this.env.iceTempC =
      computeIceTemp(this.env.pipeTempC + spatial, this.env.airTempC, this.frostMm);
    this.env.dewPointC = dewPointC(this.env.airTempC, this.env.rh);

    // 层冻结
    for (const layer of this.layers) {
      const justFrozen = advanceLayerFreeze(layer, dt, this.simS, this.env.pipeTempC, sys);
      if (justFrozen) {
        this.field.onLayerFrozen();
        this.pushLog('info', `一层 ${layer.thicknessMm.toFixed(1)}mm 的冰冻透了,自流平完成`);
      }
    }

    // 卵石点冻结(只扫未冻透区间,增量维护计数)
    if (this.pebbleFreezeTotalS > 0 && this.unfrozenPebbleCount > 0) {
      const d = this.pebbles.data;
      for (let k = this.freezeCursor; k < this.pebbles.count; k++) {
        const o = k * 6;
        if (d[o + 5] >= 1) {
          this.freezeCursor = k + 1;
          continue;
        }
        const prev = d[o + 5];
        const next = Math.min(1, prev + dt / this.pebbleFreezeTotalS);
        d[o + 5] = next;
        if (next >= 1 && prev < 1) {
          this.unfrozenPebbleCount--;
          this.freezeCursor = k + 1;
        }
      }
    }

    // 结霜(网格更新节流到 FROST_INTERVAL_S,避免高倍速下每步刷 4608 格)
    this.frostAccumS += dt;
    if (this.frostAccumS >= Simulation.FROST_INTERVAL_S) {
      const span = this.frostAccumS;
      this.frostAccumS = 0;
      advanceFrost(
        this.field,
        this.env.airTempC,
        this.env.rh,
        this.env.iceTempC,
        this.env.dehumidifierOn,
        this.venue.dehumidifierKw,
        span
      );
      this.cacheDirty = true;
    }
    this.env.frostMm = this.frostMm;
    if (this.env.frostMm >= 0.05 && !this.frostWarned) {
      this.frostWarned = true;
      this.pushLog('warn', '湿度上来了,冰面开始结霜,冰速会下降');
    }

    // 派生量缓存:模拟时间每 30s 刷一次(刮冰/洒点时另有即时失效)
    this.cacheAccS += dt;
    if (this.cacheAccS >= 30) {
      this.cacheAccS = 0;
      this.cacheDirty = true;
    }
  }

  // ---------- 操作:浇水 ----------
  addFlood(p: FloodParams): void {
    const thickness = clamp(p.thicknessMm, FLOOD.MIN_THICKNESS_MM, FLOOD.MAX_THICKNESS_MM);
    const rough = this.field.addFlood(thickness, clamp(p.uniformity, 0.5, 1), this.rng);
    const layer: FloodLayer = {
      thicknessMm: thickness,
      waterTempC: clamp(p.waterTempC, FLOOD.MIN_WATER_TEMP_C, FLOOD.MAX_WATER_TEMP_C),
      uniformity: p.uniformity,
      appliedAtSimS: this.simS,
      freezeFraction: 0,
      frozenAtSimS: null,
      roughnessMm: rough
    };
    this.layers.push(layer);
    const eta = layerFreezeSeconds(
      thickness,
      layer.waterTempC,
      this.env.pipeTempC,
      this.system
    );
    this.pushLog(
      'info',
      `浇水 ${thickness.toFixed(1)}mm / 水温 ${layer.waterTempC}℃,预计 ${Math.round(eta / 60)} 分钟冻透`
    );
    this.emit();
  }

  // ---------- 操作:洒点 ----------
  addPebble(p: PebbleParams): void {
    // 判废规则 1:基础冰没冻透
    if (!this.allFrozen) {
      this.penalize('基础冰未冻透就洒点,水珠融进水层,赛道判废');
      return;
    }
    // 判废规则 2:最上层浇得太厚且没冻透(已被 allFrozen 覆盖,这里再给厚层提示)
    const top = this.topLayer;
    if (top && top.thicknessMm >= 10 && top.freezeFraction < 1) {
      this.penalize('厚冰层层未冻透即洒点,赛道判废');
      return;
    }
    // 局间重新洒点:先把残留旧点压回基础冰再布新点
    if (this.pebbles.count > 0) {
      this.field.shaveBase(0.1);
      this.pebbles.count = 0;
      this.unfrozenPebbleCount = 0;
      this.freezeCursor = 0;
      this.pushLog('info', '重新洒点:旧卵石点已被清走');
    }
    const result = applyPebble(
      this.pebbles,
      {
        waterTempC: clamp(p.waterTempC, PEBBLE.MIN_WATER_TEMP_C, PEBBLE.MAX_WATER_TEMP_C),
        tankHeightM: clamp(p.tankHeightM, PEBBLE.MIN_TANK_HT_M, PEBBLE.MAX_TANK_HT_M),
        nozzleMm: clamp(p.nozzleMm, PEBBLE.MIN_NOZZLE_MM, PEBBLE.MAX_NOZZLE_MM),
        walkSpeedMps: clamp(p.walkSpeedMps, PEBBLE.MIN_SPEED_MPS, PEBBLE.MAX_SPEED_MPS)
      },
      this.simS,
      this.rng
    );
    this.pebbleBatches.push(result.batch);
    this.unfrozenPebbleCount = result.added;
    this.freezeCursor = result.batch.startIndex;
    this.cacheDirty = true;
    const drop = result.batch.nominalDropMm;
    this.pebbleFreezeTotalS = pebbleFreezeSeconds(
      drop,
      this.env.pipeTempC,
      result.batch.waterTempC
    );
    this.pushLog(
      'info',
      `洒点 ${result.added.toLocaleString()} 颗,水珠直径 ${drop.toFixed(2)}mm,密度 ${Math.round(
        result.batch.densityPerM2
      )} 颗/m²`
    );
    if (result.capped) this.pushLog('warn', '卵石点数量达到 GPU 实例上限,后续点被丢弃');
    if (result.batch.densityPerM2 > PEBBLE.DENSITY_WARN_PER_M2)
      this.pushLog('warn', '点密度过高,冰面会偏慢且容易吃霜');
    this.emit();
  }

  // ---------- 操作:刮冰 ----------
  scrape(depthMm: number): void {
    const depth = clamp(depthMm, SCRAPE.MIN_DEPTH_MM, SCRAPE.MAX_DEPTH_MM);
    if (this.pebbles.count === 0) {
      this.pushLog('warn', '冰面上还没有卵石点,刮刀只刮到了光板冰');
      this.field.shaveBase(depth);
      this.emit();
      return;
    }
    if (this.unfrozenPebbles() > 0.1) {
      this.penalize('卵石点尚未冻硬就上刮刀,点被成片带飞,赛道判废');
      return;
    }
    const contactBefore = this.contactFraction;
    const removed = scrapePebbles(this.pebbles, depth);
    // 刮刀只处理冻硬的点,残留点全部是冻透的
    this.unfrozenPebbleCount = 0;
    this.freezeCursor = this.pebbles.count;
    this.cacheDirty = true;
    this.field.shaveBase(depth);
    this.field.reduceFrost(FROST.SCRAPE_REMOVES);
    this.env.frostMm = this.frostMm;
    this.scrapes.push({ depthMm: depth, atSimS: this.simS, avgContactBefore: contactBefore });
    this.pushLog(
      'info',
      `刮冰削顶 ${depth.toFixed(2)}mm,移除 ${removed} 颗点,当前接触面 ${(
        this.contactFraction * 100
      ).toFixed(0)}%`
    );
    this.emit();
  }

  // ---------- 操作:试滑壶 ----------
  runTestStones(): TestStoneResult[] {
    const ctx = {
      field: this.field,
      contactFraction: this.contactFraction,
      densityPerM2: this.pebbleDensity,
      iceTempC: this.env.iceTempC
    };
    const a = launchTestStone(ctx, 1, this.simS);
    const b = launchTestStone(ctx, -1, this.simS);
    this.testStones.push(a, b);
    const ta = a.hogTimeS === null ? '未抵达' : `${a.hogTimeS.toFixed(1)}s`;
    const tb = b.hogTimeS === null ? '未抵达' : `${b.hogTimeS.toFixed(1)}s`;
    this.pushLog('info', `试滑壶:正向 ${ta} / 反向 ${tb},横向偏差 ${a.lateralDriftM.toFixed(2)}m`);
    this.emit();
    return [a, b];
  }

  // ---------- 阶段流转 ----------
  startCompetition(): void {
    if (!this.prepValid) {
      this.pushLog('warn', '基础冰还没达标:厚度/平整度/卵石点冻结状态需满足要求');
      this.emit();
      return;
    }
    this.phase = 'between-ends';
    this.currentEnd = 1;
    this.env.crowd = Math.round(this.venue.crowdMax * 0.4);
    this.pushLog('info', `比赛开始!第 1 局,观众 ${this.env.crowd} 人入场`);
    this.emit();
  }

  /** 打完一局:环境演化 + 自动评分 */
  finishEnd(): void {
    if (this.phase !== 'between-ends') return;
    const [a, b] = this.runTestStones();
    const score = scoreEnd(this.currentEnd, this.simS, a, b, this.frostMm);
    this.endScores.push(score);

    if (this.currentEnd >= END_EVOLUTION.ENDS_PER_GAME) {
      this.phase = 'game-over';
      const agg = aggregateGrade(this.endScores);
      this.pushLog('info', `全部 10 局结束,综合评级 ${agg.grade} (${agg.total} 分)`);
      this.emit();
      return;
    }

    // 局间演化:观众散热散湿 + 冰面磨损
    const crowdFrac = this.env.crowd / Math.max(1, this.venue.crowdMax);
    this.env.rh = clamp(
      this.env.rh + END_EVOLUTION.CROWD_RH_RATE * crowdFrac,
      0.2,
      0.95
    );
    this.env.airTempC = clamp(
      this.env.airTempC + END_EVOLUTION.CROWD_AIR_TEMP * crowdFrac,
      4,
      14
    );
    // 接触面磨损:点顶被壶磨圆,等效削顶量轻微变化
    this.pushLog(
      'warn',
      `第 ${this.currentEnd} 局结束:湿度 ${(this.env.rh * 100).toFixed(0)}%,考虑重新洒点/刮冰`
    );
    this.currentEnd++;
    this.emit();
  }

  // ---------- 环境控制 ----------
  setPipeSetpoint(c: number): void {
    this.env.pipeSetpointC = clamp(c, this.system.minPipeTempC, -4);
    this.emit();
  }
  setAirTemp(c: number): void {
    this.env.airTempC = clamp(c, 3, 15);
    this.emit();
  }
  setRh(rh: number): void {
    this.env.rh = clamp(rh, 0.2, 0.95);
    this.emit();
  }
  setCrowd(n: number): void {
    this.env.crowd = clamp(Math.round(n), 0, this.venue.crowdMax);
    this.emit();
  }
  toggleDehumidifier(): void {
    this.env.dehumidifierOn = !this.env.dehumidifierOn;
    this.pushLog('info', `除湿机${this.env.dehumidifierOn ? '开启' : '关闭'}`);
    this.emit();
  }
  selectVenue(id: string): void {
    const v = VENUES.find((x) => x.id === id);
    if (!v) return;
    this.venue = v;
    this.env.airTempC = v.baseAirTempC;
    this.env.rh = v.baseRh;
    this.env.crowd = 0;
    this.pushLog('info', `切换场馆:${v.name} / ${getSystem(v.systemId).name}`);
    this.emit();
  }

  private penalize(reason: string): void {
    this.penalties.push({ atSimS: this.simS, reason });
    this.pushLog('bad', `判废:${reason}`);
  }

  get aggregate() {
    return aggregateGrade(this.endScores);
  }

  /** 给 UI 的一行摘要 */
  statusLine(): string {
    const t = (this.simS / 60).toFixed(0);
    return `模拟 ${t}min · 阶段:${this.phase} · 冰厚 ${this.totalIceMm.toFixed(1)}mm · 点 ${this.pebbles.count.toLocaleString()} · 霜 ${this.frostMm.toFixed(2)}mm`;
  }
}

export function hogDistance(): number {
  return RINK.HOG_X * 2;
}
