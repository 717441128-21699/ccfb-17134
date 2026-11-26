import {
  HEIGHT_NX,
  HEIGHT_NZ,
  TOTAL_ENDS,
  VENUES,
  getVenue
} from './config';
import { clamp, mulberry32 } from './rng';
import {
  applyScrapeToStats,
  computeFlatness,
  computePebblePlan,
  createInitialHeight,
  dewPointC,
  generatePebbleInstances,
  iceTemperatureC,
  layerFreezeTimeS,
  simulateTrial
} from './physics';
import type {
  EndReport,
  GameState,
  LogEntry,
  PebbleParams,
  ScoreBreakdown
} from './types';

type Listener = () => void;

export class GameEngine {
  state: GameState;
  private listeners = new Set<Listener>();
  private lastHistoryClock = 0;

  constructor(venueId = VENUES[0].id) {
    this.state = this.createState(venueId);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private createState(venueId: string): GameState {
    const venue = getVenue(venueId);
    const height = createInitialHeight();
    const risk = new Float32Array(HEIGHT_NX * HEIGHT_NZ);
    const flatness = computeFlatness(height, risk);
    const pebbleInput: PebbleParams = {
      waterC: 22,
      tankHeightM: 1.1,
      nozzleMm: 1.6,
      nozzleCount: 1,
      walkSpeedMps: 0.7,
      sprayWidthM: 0.9,
      passes: 7,
      balanceCm: 0
    };
    const pebble = computePebblePlan(pebbleInput, 1);
    pebble.applied = false;

    const state: GameState = {
      venueId,
      clockS: 8 * 3600,
      timeScale: 180,
      running: true,
      phase: 'prep',
      currentEnd: 1,
      totalEnds: TOTAL_ENDS,

      pipeC: venue.pipeDefaultC,
      roomSetC: venue.roomDefaultC,
      dehumidifier: 0.55,
      crowdPct: 0.25,

      roomC: venue.roomDefaultC + 0.8,
      rhPct: venue.humidityDefaultPct + 4,
      iceC: -5,
      dewPointC: 4,
      frost: 0.04,
      frostThresholdPct: venue.frostThresholdPct,

      flood: { thicknessMm: 1.2, waterC: 42 },
      baseScrape: { cutMm: 0.38 },
      pebbleInput,

      layers: [],
      nextLayerId: 1,
      height,
      risk,
      heightNx: HEIGHT_NX,
      heightNz: HEIGHT_NZ,
      flatness,
      baseScrapePasses: 0,

      walk: null,
      pebble,
      pebbleData: null,

      lastTrial: null,
      trialAnim: null,

      reports: [],
      logs: [],
      nextLogId: 1,
      history: [],

      ruined: false,
      ruinReason: '',
      certification: { ready: false, reasons: [] },
      fps: 60,
      pebbleDrawCount: 0
    };
    state.iceC = iceTemperatureC(state.pipeC, state.roomC, venue.resistance);
    state.dewPointC = dewPointC(state.roomC, state.rhPct);
    this.lastHistoryClock = state.clockS;
    state.history.push({ clockS: state.clockS, rh: state.rhPct, frost: state.frost, speed: 0 });
    this.log(state, 'info', `已进入${venue.venue}，初始基层有明显起伏，请先分层找冰。`);
    this.refreshCertification(state);
    return state;
  }

  reset(venueId = this.state.venueId): void {
    this.state = this.createState(venueId);
    this.emit();
  }

  setTimeScale(scale: number): void {
    this.state.timeScale = scale;
    this.state.running = scale > 0;
    this.emit();
  }

  setVenue(venueId: string): void {
    this.reset(venueId);
  }

  log(
    state: GameState,
    level: LogEntry['level'],
    text: string
  ): void {
    state.logs.unshift({ id: state.nextLogId++, clockS: state.clockS, level, text });
    if (state.logs.length > 80) state.logs.length = 80;
  }

  updateFloodInput(patch: Partial<GameState['flood']>): void {
    Object.assign(this.state.flood, patch);
  }

  updateScrapeInput(patch: Partial<GameState['baseScrape']>): void {
    Object.assign(this.state.baseScrape, patch);
  }

  updatePebbleInput(patch: Partial<PebbleParams>): void {
    Object.assign(this.state.pebbleInput, patch);
    // 尚未洒点时，预览参数不应覆盖已完成卵石层；UI 直接调用 previewPebble()。
  }

  previewPebble() {
    return computePebblePlan(this.state.pebbleInput, Math.max(1, this.state.pebble.batch));
  }

  updateEnvironment(patch: {
    pipeC?: number;
    roomSetC?: number;
    dehumidifier?: number;
    crowdPct?: number;
    frostThresholdPct?: number;
  }): void {
    Object.assign(this.state, patch);
    this.recomputeClimate();
  }

  private recomputeClimate(): void {
    const s = this.state;
    const venue = getVenue(s.venueId);
    s.iceC = iceTemperatureC(s.pipeC, s.roomC, venue.resistance);
    s.dewPointC = dewPointC(s.roomC, s.rhPct);
  }

  addFloodLayer(): void {
    const s = this.state;
    const venue = getVenue(s.venueId);
    const thicknessMm = clamp(s.flood.thicknessMm, 0.3, 5);
    const waterC = clamp(s.flood.waterC, 1, 75);
    const neededS = layerFreezeTimeS(thicknessMm, waterC, s.pipeC, venue.resistance);
    const layer = {
      id: s.nextLayerId++,
      thicknessMm,
      waterC,
      pipeC: s.pipeC,
      systemId: venue.id,
      neededS,
      elapsedS: 0,
      completed: false,
      frozenThrough: false
    };
    s.layers.unshift(layer);

    let mean = 0;
    for (let i = 0; i < s.height.length; i++) mean += s.height[i];
    mean /= s.height.length;
    const leveling = clamp(0.24 + thicknessMm * 0.15 + waterC * 0.0022, 0.22, 0.78);
    for (let i = 0; i < s.height.length; i++) {
      const idx = i;
      const old = s.height[i];
      const ripple =
        0.045 * Math.sin(idx * 0.137 + layer.id * 1.7) +
        0.026 * Math.sin(idx * 0.031 + layer.id);
      s.height[i] = mean + thicknessMm + (old - mean) * (1 - leveling) + ripple;
    }
    s.flatness = computeFlatness(s.height, s.risk);
    this.refreshCertification();

    if (thicknessMm >= 1.6) {
      this.log(s, 'warn', `第 ${layer.id} 层厚 ${thicknessMm.toFixed(1)}mm，约需 ${formatMinutes(neededS)} 分钟冻透；未冻透就洒点会判废。`);
    } else {
      this.log(s, 'good', `浇水 ${thicknessMm.toFixed(1)}mm / 水温 ${waterC.toFixed(0)}°C，预计 ${formatMinutes(neededS)} 分钟冻透。`);
    }
    this.emit();
  }

  scrapeBase(): void {
    const s = this.state;
    const cut = clamp(s.baseScrape.cutMm, 0.05, 1.2);
    let mean = 0;
    for (let i = 0; i < s.height.length; i++) mean += s.height[i];
    mean /= s.height.length;
    const plane = mean + 0.72 - cut * 1.18;
    let cutCells = 0;
    for (let i = 0; i < s.height.length; i++) {
      if (s.height[i] > plane) {
        s.height[i] = plane + 0.018 * Math.sin(i * 0.21 + s.baseScrapePasses);
        cutCells++;
      }
    }
    s.baseScrapePasses++;
    s.flatness = computeFlatness(s.height, s.risk);
    this.refreshCertification();
    this.log(s, cutCells > 0 ? 'good' : 'info', `基层刮平第 ${s.baseScrapePasses} 遍，下刀 ${cut.toFixed(2)}mm，处理 ${(cutCells / s.height.length * 100).toFixed(1)}% 高点。`);
    this.emit();
  }

  startPebbleWalk(): void {
    const s = this.state;
    if (s.walk?.active) return;

    const badLayer = s.layers.find((l) => !l.completed && l.thicknessMm >= 1.6);
    if (badLayer && !s.ruined) {
      s.ruined = true;
      s.phase = 'ruined';
      s.ruinReason = `第 ${badLayer.id} 层 ${badLayer.thicknessMm.toFixed(1)}mm 尚未冻透便开始洒点，水与卵石形成夹生层，赛道判废。`;
      this.log(s, 'bad', s.ruinReason);
    }

    const batch = s.pebble.batch + 1;
    const plan = computePebblePlan(s.pebbleInput, batch);
    plan.applied = false;
    s.pebble = plan;
    s.pebbleData = generatePebbleInstances(plan, s.pebbleInput, s.height);
    s.pebbleDrawCount = 0;
    s.walk = {
      active: true,
      elapsedS: 0,
      durationS: plan.walkDurationS,
      params: { ...s.pebbleInput }
    };
    this.log(s, 'info', `背箱倒退走开始：${plan.laneCount} 排、${(plan.count / 10000).toFixed(1)} 万个点，预计走行 ${(plan.walkDurationS / 60).toFixed(1)} 分钟。`);
    this.emit();
  }

  scrapePebbles(): void {
    const s = this.state;
    if (!s.pebble.applied || !s.pebbleData) {
      this.log(s, 'warn', '还没有可刮的卵石点，请先倒退洒点。');
      this.emit();
      return;
    }
    if (s.pebble.freezeRemainingS > 0.05) {
      this.log(s, 'warn', `卵石还在冻结，约 ${Math.ceil(s.pebble.freezeRemainingS)} 秒游戏时间后再刮。`);
      this.emit();
      return;
    }
    const pass = 0.18;
    s.pebble = applyScrapeToStats(s.pebble, pass);
    // 滑块可作为额外一次下刀量的快捷输入；按钮每次固定走一刀，避免一次跳变。
    for (let i = 0; i < s.pebble.count; i++) {
      const o = i * 6;
      const r = s.pebbleData[o + 3];
      s.pebbleData[o + 4] = Math.max(r * 0.14, r - s.pebble.cutMm);
    }
    s.frost = Math.max(0, s.frost - 0.16);
    this.refreshCertification();
    this.log(s, 'good', `刮刀削顶 ${pass.toFixed(2)}mm：接触半径均值 ${s.pebble.contactRadiusMm.toFixed(2)}mm，接触面积占比 ${(s.pebble.contactFraction * 100).toFixed(2)}%。`);
    this.emit();
  }

  runTrial(): void {
    const s = this.state;
    const p = s.pebble.applied
      ? {
          densityPerM2: s.pebble.densityPerM2 * s.pebble.wornFactor,
          contactFraction: s.pebble.contactFraction,
          uniformityPct: s.pebble.uniformityPct,
          wornFactor: s.pebble.wornFactor,
          ageEnds: s.pebble.ageEnds,
          frost: s.frost,
          iceC: s.iceC
        }
      : {
          densityPerM2: 0,
          contactFraction: 0,
          uniformityPct: 60,
          wornFactor: 1,
          ageEnds: 0,
          frost: s.frost,
          iceC: s.iceC
        };
    const result = simulateTrial(s.height, s.risk, p, s.flatness, s.clockS);
    s.lastTrial = result;
    s.trialAnim = { active: true, startRealMs: performance.now(), durationMs: 5200, resultId: result.id };
    this.refreshCertification();
    this.log(
      s,
      result.reached ? (result.score > 80 ? 'good' : 'warn') : 'bad',
      result.reached
        ? `双道试滑：左 ${result.leftS.toFixed(2)}s / 右 ${result.rightS.toFixed(2)}s，偏移 ${result.driftCm.toFixed(1)}cm。`
        : '试滑壶未到后掷线，冰速判定为失败。'
    );
    this.emit();
  }

  completeEnd(): EndReport | null {
    const s = this.state;
    if (s.walk?.active) {
      this.log(s, 'warn', '请先完成当前倒退洒点路线。');
      this.emit();
      return null;
    }
    if (s.phase === 'finished') return null;

    const endNumber = s.currentEnd;
    const crowdCurve = [0.42, 0.58, 0.72, 0.86, 0.96, 1];
    s.crowdPct = crowdCurve[Math.min(endNumber - 1, crowdCurve.length - 1)];
    // 一局约 15 分钟；观众、除湿和湿负荷在这段时间持续作用。
    s.clockS += 15 * 60;
    for (let i = 0; i < 15; i++) this.updateClimate(60);

    if (s.pebble.applied) {
      s.pebble.ageEnds += 1;
      s.pebble.wornFactor = clamp(s.pebble.wornFactor - 0.105, 0.42, 1);
      s.pebble.densityPerM2 *= 0.88;
      s.pebble.uniformityPct = clamp(s.pebble.uniformityPct - 1.4, 50, 99);
    }

    // 运动员和擦冰让细微起伏增加。
    const rand = mulberry32(8000 + endNumber * 77);
    for (let k = 0; k < 2600; k++) {
      const idx = Math.floor(rand() * s.height.length);
      s.height[idx] += (rand() - 0.48) * 0.16;
    }
    s.flatness = computeFlatness(s.height, s.risk);

    this.runTrialSilently();
    const trial = s.lastTrial!;
    const times = [...s.reports.map((r) => r.iceSpeedS), trial.totalS].filter((v) => v < 90);
    const speedMean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
    const speedVariance = times.length > 1
      ? times.reduce((a, b) => a + (b - speedMean) ** 2, 0) / times.length
      : 0;
    const speedStd = Math.sqrt(speedVariance);

    const speedScore = trial.reached
      ? clamp(100 - Math.abs(trial.totalS - trial.targetS) * 7.2 - speedStd * 16, 0, 100)
      : 0;
    const densityImbalance = s.pebble.applied
      ? Math.abs(s.pebble.leftDensityPerM2 - s.pebble.rightDensityPerM2) /
        Math.max(1, s.pebble.densityPerM2)
      : 1;
    const symmetryScore = clamp(
      100 -
        Math.abs(trial.leftS - trial.rightS) * 26 -
        Math.abs(s.flatness.sideHeightDifferenceMm) * 16 -
        densityImbalance * 95,
      0,
      100
    );
    const lineScore = clamp(
      100 -
        trial.driftCm * 1.35 -
        s.flatness.redAreaPct * 2.4 -
        Math.max(0, s.flatness.maxLocalDifferenceMm - 1) * 7,
      0,
      100
    );
    const freezeScore = s.ruined
      ? 0
      : clamp(
          100 -
            s.layers.filter((l) => !l.completed).length * 18 -
            (s.pebble.applied && s.pebble.freezeRemainingS > 0 ? 20 : 0),
          0,
          100
        );
    const scores: ScoreBreakdown = {
      speed: Math.round(speedScore),
      symmetry: Math.round(symmetryScore),
      line: Math.round(lineScore),
      freeze: Math.round(freezeScore),
      total: s.ruined
        ? 0
        : Math.round(0.38 * speedScore + 0.25 * symmetryScore + 0.25 * lineScore + 0.12 * freezeScore)
    };

    const recommendations: string[] = [];
    if (s.ruined) recommendations.push('夹生层无法通过局间修补恢复，应彻底铲冰并重开一块冰。');
    if (trial.totalS > trial.targetS + 0.8) recommendations.push('冰速偏慢：减少削顶量、降低湿度/霜层，或适当提高盘管温度。');
    if (trial.totalS < trial.targetS - 0.8) recommendations.push('冰速偏快：增加洒点密度或多削一刀以增大接触面积。');
    if (Math.abs(trial.leftS - trial.rightS) > 0.35) recommendations.push('左右速度差过大：修正走行居中偏差，并检查场馆两侧供液。');
    if (s.flatness.redAreaPct > 1) recommendations.push('检测页仍有标红区：局间用刮冰机处理高点后重新找冰。');
    if (s.frost > 0.35) recommendations.push('霜层已明显拖慢冰速：开除湿机并进行一次轻刮/削顶。');
    if (s.pebble.ageEnds > 0 || s.pebble.wornFactor < 0.8) recommendations.push('卵石已磨损：局间刮净残点，重新背箱洒点并削顶。');
    if (!recommendations.length) recommendations.push('各项指标位于窗口内，保持环境设定并监测下一局观众湿负荷。');

    const verdict =
      scores.total >= 90 ? '金冰带：比赛方确认冰速稳定、走线干净。' :
      scores.total >= 78 ? '合格赛场：仍有可感知但不影响比赛的差异。' :
      scores.total >= 60 ? '需要局间补救：运动员会反馈速度和线路变化。' :
      '事故风险：比赛方可能暂停比赛并要求制冰师立即处理。';

    const report: EndReport = {
      end: endNumber,
      clockS: s.clockS,
      crowdPct: s.crowdPct,
      roomC: s.roomC,
      rhPct: s.rhPct,
      iceC: s.iceC,
      frost: s.frost,
      frostPct: s.frost * 100,
      iceSpeedS: trial.totalS,
      leftSpeedS: trial.leftS,
      rightSpeedS: trial.rightS,
      driftCm: trial.driftCm,
      redAreaPct: s.flatness.redAreaPct,
      pebbleCount: s.pebbleDrawCount || s.pebble.count,
      scores,
      verdict,
      recommendations,
      ruined: s.ruined
    };
    s.reports.unshift(report);
    s.currentEnd += 1;
    if (s.currentEnd > s.totalEnds) s.phase = 'finished';
    else if (!s.ruined) s.phase = 'between-ends';

    this.log(s, scores.total >= 78 ? 'good' : 'bad', `第 ${endNumber} 局评分 ${scores.total}：${verdict}`);
    this.refreshCertification();
    this.emit();
    return report;
  }

  private runTrialSilently(): void {
    const s = this.state;
    const p = s.pebble.applied
      ? {
          densityPerM2: s.pebble.densityPerM2 * s.pebble.wornFactor,
          contactFraction: s.pebble.contactFraction,
          uniformityPct: s.pebble.uniformityPct,
          wornFactor: s.pebble.wornFactor,
          ageEnds: s.pebble.ageEnds,
          frost: s.frost,
          iceC: s.iceC
        }
      : {
          densityPerM2: 0,
          contactFraction: 0,
          uniformityPct: 60,
          wornFactor: 1,
          ageEnds: 0,
          frost: s.frost,
          iceC: s.iceC
        };
    s.lastTrial = simulateTrial(s.height, s.risk, p, s.flatness, s.clockS);
  }

  tick(realDtS: number): void {
    const s = this.state;
    if (!s.running || s.timeScale <= 0) return;
    const dt = Math.min(0.1, realDtS) * s.timeScale;
    s.clockS += dt;

    for (const layer of s.layers) {
      if (!layer.completed) {
        layer.elapsedS += dt;
        if (layer.elapsedS >= layer.neededS) {
          layer.completed = true;
          layer.frozenThrough = true;
          if (layer.thicknessMm >= 1.6) this.log(s, 'good', `第 ${layer.id} 层厚水已完全冻透，可以继续下一层或洒点。`);
        }
      }
    }

    if (s.walk?.active) {
      s.walk.elapsedS += dt;
      const progress = clamp(s.walk.elapsedS / s.walk.durationS, 0, 1);
      s.pebbleDrawCount = Math.floor(s.pebble.count * progress);
      if (s.walk.elapsedS >= s.walk.durationS) {
        s.walk.active = false;
        s.walk = null;
        s.pebble.applied = true;
        s.pebbleDrawCount = s.pebble.count;
        this.log(s, 'good', `${(s.pebble.count / 10000).toFixed(1)} 万个卵石点已落冰，等待冻结后可削顶。`);
      }
    }

    if (s.pebble.applied && s.pebble.freezeRemainingS > 0) {
      s.pebble.freezeRemainingS = Math.max(0, s.pebble.freezeRemainingS - dt);
    }

    this.updateClimate(dt);

    if (s.clockS - this.lastHistoryClock >= 120) {
      this.lastHistoryClock = s.clockS;
      s.history.push({
        clockS: s.clockS,
        rh: s.rhPct,
        frost: s.frost,
        speed: s.lastTrial?.reached ? s.lastTrial.totalS : 0
      });
      if (s.history.length > 180) s.history.shift();
    }
  }

  updateClimate(dt: number): void {
    const s = this.state;
    const venue = getVenue(s.venueId);
    const tau = venue.climateTauS;
    const k = 1 - Math.exp(-dt / tau);
    const targetRoom = s.roomSetC + s.crowdPct * 1.35;
    s.roomC += (targetRoom - s.roomC) * k;

    const targetRh = clamp(
      venue.humidityTargetPct + s.crowdPct * 25 - s.dehumidifier * 31 + (s.roomC - s.roomSetC) * 1.4,
      24,
      94
    );
    s.rhPct += (targetRh - s.rhPct) * k;
    this.recomputeClimate();

    const over = s.rhPct - s.frostThresholdPct;
    if (over > 0 && s.iceC < 0) {
      const rate = (over / 100) * 0.00105 * clamp(-s.iceC / 5, 0.35, 2.2);
      s.frost = clamp(s.frost + rate * dt, 0, 1);
    } else {
      const removal = 0.0001 * (0.6 + s.dehumidifier) * dt;
      s.frost = clamp(s.frost - removal, 0, 1);
    }
  }

  refreshCertification(state: GameState = this.state): void {
    const reasons: string[] = [];
    if (state.ruined) reasons.push('赛道因厚层夹生已判废，请重开冰面。');
    const frozenLayers = state.layers.filter((l) => l.completed).length;
    if (frozenLayers < 3) reasons.push(`至少 3 层完全冻透的基层（当前 ${frozenLayers} 层）。`);
    const totalThickness = state.layers.reduce((a, l) => a + l.thicknessMm, 0);
    if (totalThickness < 3.2) reasons.push('基层总厚度建议达到 3.2mm 以上（游戏化最低找冰层）。');
    if (state.flatness.redAreaPct > 1 || state.flatness.maxLocalDifferenceMm > 1.05)
      reasons.push('检测页仍有高低差超过 1mm 的标红区域。');
    if (!state.pebble.applied) reasons.push('尚未洒出卵石点。');
    else {
      if (state.pebble.freezeRemainingS > 0) reasons.push('卵石点尚未完全冻硬。');
      if (state.pebble.count < 150_000) reasons.push('卵石点数量低于 15 万，密度可能不足。');
      if (state.pebble.cutMm < 0.12) reasons.push('卵石顶尚未削平，接触面不稳定。');
    }
    if (!state.lastTrial?.reached) reasons.push('需要一次成功的双道试滑。');
    else if (Math.abs(state.lastTrial.totalS - state.lastTrial.targetS) > 1.4)
      reasons.push('试滑冰速偏离目标超过 1.4 秒。');
    state.certification = { ready: reasons.length === 0, reasons };
  }
}

export function formatMinutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

export function formatClock(clockS: number): string {
  const totalMin = Math.floor(clockS / 60);
  const day = Math.floor(totalMin / (24 * 60)) + 1;
  const hour = Math.floor((totalMin % (24 * 60)) / 60);
  const minute = totalMin % 60;
  return `第${day}日 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
