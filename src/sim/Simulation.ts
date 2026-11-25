// 仿真核心:冰层、高度场、卵石点、分区统计、环境与赛事情绪
import {
  CELL_M, END_COUNT, END_DURATION_S, FLAT_LIMIT_M, FRIDGES,
  HOG_Z, K_ICE, MAX_RENDER_PEBBLES, MU_REF, NX, NZ, RHO_ICE, SHEET_L,
  SHEET_W, T_REF_HOG, VENUES, ZONES_ALONG, ZONES_SIDE, ZONE_COUNT,
} from './constants';
import {
  contactTemp, cutContactFraction, dropletDiameterMm, freezeTimeS,
  frictionCoefficient, frostPotential, pebbleGeometry,
} from './physics';
import { fbm } from './noise';
import { Rng, clamp } from './rng';
import { createEnv, stepEnv, stepIceTemp, type EnvState } from './environment';
import { globalStats, scoreEnd, zoneAt } from './scoring';
import { simulateThrow, type SurfaceSampler } from './trajectory';
import type {
  EndScore, FloodLayer, FloodParams, FridgeDef, PebbleSpray, Phase,
  SprayParams, ThrowResult, VenueDef, ZoneStat,
} from './types';

// 卵石点扁平数组字段:x,z,r(mm),h(mm),sphereR(mm),cut(0~1),zone
export const PEB_STRIDE = 7;

export class Simulation implements SurfaceSampler {
  venue: VenueDef;
  fridge: FridgeDef;
  env: EnvState;
  phase: Phase = 'build';

  timeS = 0;
  private zoneAccumS = 0;
  private zoneDirty = true;
  layers: FloodLayer[] = [];
  sprays: PebbleSpray[] = [];
  scores: EndScore[] = [];
  events: { t: number; text: string; kind: 'info' | 'warn' | 'bad' }[] = [];

  height = new Float32Array(NX * NZ);
  baseHeight = new Float32Array(NX * NZ);   // 地坪+各冻层的慢变高度
  redMask = new Uint8Array(NX * NZ);        // 高低差 >1mm 标红
  flatness = { maxRangeMm: 0, redRatio: 0 };
  private flatnessDirty = true;

  peb = new Float32Array(MAX_RENDER_PEBBLES * PEB_STRIDE);
  pebCount = 0;
  pebVersion = 0;                           // 每次改动自增,渲染层据此重传

  zones: ZoneStat[] = [];
  currentEnd = 0;
  endClockS = 0;
  globalHogSeconds = T_REF_HOG;
  private layerId = 1;
  private sprayId = 1;
  private rng = new Rng(20261126);

  constructor(venueId = VENUES[0].id, fridgeId = FRIDGES[0].id) {
    this.venue = VENUES.find((v) => v.id === venueId) ?? VENUES[0];
    this.fridge = FRIDGES.find((f) => f.id === fridgeId) ?? FRIDGES[0];
    this.env = createEnv(this.venue);
    this.initFloor();
    this.initZones();
    this.log('制冰师进场,开始铺底冰', 'info');
  }

  // ---------------- 初始化 ----------------
  private initFloor() {
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const x = (i - NX / 2) * CELL_M;
        const z = (j - NZ / 2) * CELL_M;
        const wav = fbm(x, z, 17, 3) * this.venue.floorWavinessMm * 0.001;
        this.baseHeight[i * NZ + j] = wav;
        this.height[i * NZ + j] = wav;
      }
    }
  }

  private initZones() {
    this.zones = Array.from({ length: ZONE_COUNT }, (_, index) => {
      const along = Math.floor(index / ZONES_SIDE);
      return {
        index, along, side: index % ZONES_SIDE,
        density: 0, meanRadiusMm: 0, contactFraction: 0,
        wear: 0, frost: 0,
        iceTempC: this.fridge.brineSetpointC * this.fridge.efficiency,
        friction: MU_REF, hogSeconds: T_REF_HOG,
      };
    });
  }

  log(text: string, kind: 'info' | 'warn' | 'bad' = 'info') {
    this.events.push({ t: this.timeS, text, kind });
    if (this.events.length > 60) this.events.shift();
  }

  // ---------------- 浇水铺冰 ----------------
  get canSpray(): boolean {
    return this.layers.length >= 4 && this.layers.every((l) => l.frozen);
  }

  flood(p: FloodParams): FloodLayer {
    const thick = clamp(p.thicknessMm, 2, 30) / 1000;
    const alongPos = 0.5;
    const contact = contactTemp(this.fridge, alongPos);
    const total = freezeTimeS(thick, p.waterTempC, contact);
    const layer: FloodLayer = {
      id: this.layerId++,
      thicknessM: thick,
      waterTempC: p.waterTempC,
      freezeTimeS: total,
      elapsedS: 0,
      frozen: false,
      roughnessMm: clamp(0.18 + thick * 1000 * 0.03 + Math.abs(contact) * 0.02, 0.15, 1.2),
    };
    this.layers.push(layer);
    this.log(`第 ${this.layers.length} 层浇水 ${(thick * 1000).toFixed(1)}mm,`
      + `预计 ${(total / 60).toFixed(1)} 分钟冻透`, 'info');
    return layer;
  }

  private updateLayers(dt: number) {
    for (const l of this.layers) {
      if (l.frozen) continue;
      l.elapsedS += dt;
      if (l.elapsedS >= l.freezeTimeS) {
        l.frozen = true;
        this.applyFrozenLayer(l);
        this.log(`第 ${l.id} 层已冻透`, 'info');
      }
    }
  }

  private applyFrozenLayer(layer: FloodLayer) {
    const seed = layer.id * 977;
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const x = (i - NX / 2) * CELL_M;
        const z = (j - NZ / 2) * CELL_M;
        const rough = fbm(x, z, seed, 2) * layer.roughnessMm * 0.001;
        const idx = i * NZ + j;
        this.baseHeight[idx] += layer.thicknessM + rough;
      }
    }
    this.rebuildHeight();
  }

  /** 冰面高度 = 慢变底冰 + 卵石点球冠(渲染/检测共用,这里只重建底冰部分) */
  rebuildHeight() {
    this.height.set(this.baseHeight);
    this.flatnessDirty = true;
  }

  /** 检测页需要时才重算标红(22k 格 × 3×3 邻域,避免冻结流程卡顿) */
  ensureFlatness() {
    if (!this.flatnessDirty) return;
    this.flatnessDirty = false;
    this.computeFlatness();
  }

  private computeFlatness() {    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < this.height.length; k++) {
      const h = this.height[k];
      if (h < min) min = h;
      if (h > max) max = h;
    }
    this.flatness.maxRangeMm = (max - min) * 1000;
    // 局部 3×3 邻域极差 >1mm 的格子标红
    let red = 0;
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const di of [-1, 0, 1]) {
          for (const dj of [-1, 0, 1]) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || ii >= NX || jj < 0 || jj >= NZ) continue;
            const h = this.height[ii * NZ + jj];
            if (h < lo) lo = h;
            if (h > hi) hi = h;
          }
        }
        const isRed = (hi - lo) > FLAT_LIMIT_M;
        const idx = i * NZ + j;
        this.redMask[idx] = isRed ? 1 : 0;
        if (isRed) red++;
      }
    }
    this.flatness.redRatio = red / this.height.length;
  }

  // ---------------- 洒卵石点 ----------------
  spray(p: SprayParams): PebbleSpray | null {
    if (!this.canSpray) {
      const why = this.layers.length < 4
        ? `底冰只有 ${this.layers.length} 层,至少 4 层才能洒点`
        : '有冰层尚未冻透,这时洒点整面冰判废!';
      this.log(why, 'bad');
      return null;
    }
    const dia = dropletDiameterMm(
      p.orificeMm, p.flowLmin, p.nozzleCount, p.tankHeadM, p.waterTempC);
    const geo = pebbleGeometry(dia, this.zones[ZONE_COUNT >> 1].iceTempC);

    // 倒退走速越快 → 单位面积扫过越快 → 落点越稀;流量越大点越多。
    // 滴率(滴/s)除以行走覆盖率(m²/s = 走速 × 喷头幅宽)即面密度。
    const rateDropsS = p.flowLmin / 60000
      / ((Math.PI / 6) * (dia / 1000) ** 3) * 0.92;
    const density = clamp(rateDropsS * 0.85 / (p.walkSpeed * p.headWidthM),
      800, 30000);
    const target = Math.min(MAX_RENDER_PEBBLES,
      Math.round(density * SHEET_W * SHEET_L));

    const pts = this.rng.jitteredGrid(SHEET_W * 0.96, SHEET_L * 0.98, target);
    this.pebCount = 0;
    for (const pt of pts) {
      if (this.pebCount >= MAX_RENDER_PEBBLES) break;
      const sizeJ = clamp(this.rng.gaussian(1, 0.09), 0.75, 1.28);
      const r = geo.baseR * sizeJ;
      const h = geo.capH * sizeJ;
      const sr = geo.sphereR * sizeJ;
      const o = this.pebCount * PEB_STRIDE;
      this.peb[o] = pt.x;
      this.peb[o + 1] = pt.z;
      this.peb[o + 2] = r;
      this.peb[o + 3] = h;
      this.peb[o + 4] = sr;
      this.peb[o + 5] = 0;
      this.peb[o + 6] = zoneAt(pt.x, pt.z);
      this.pebCount++;
    }
    this.pebVersion++;

    const rec: PebbleSpray = {
      id: this.sprayId++,
      timeS: this.timeS,
      dropletDiaMm: dia,
      baseRadiusMm: geo.baseR,
      capHeightMm: geo.capH,
      density,
      count: this.pebCount,
      cutFraction: 0,
      failed: false,
      waterTempC: p.waterTempC,
      walkSpeed: p.walkSpeed,
      tankHeadM: p.tankHeadM,
      orificeMm: p.orificeMm,
    };
    this.sprays.push(rec);
    this.zoneDirty = true;
    this.recomputeZones();
    const capped = target >= MAX_RENDER_PEBBLES;
    this.log(`洒点完成:${this.pebCount.toLocaleString()} 个卵石点,`
      + `滴径 ${dia.toFixed(2)}mm,目标密度 ${Math.round(density).toLocaleString()}/m²`
      + (capped ? '(已达渲染缓冲上限,实际密度更高)' : ''), 'info');
    return rec;
  }

  /** 刮刀削顶:cutFraction 为削去的高度比例 */
  cut(cutFraction: number) {
    if (!this.sprays.length) {
      this.log('还没有卵石点可刮', 'warn');
      return;
    }
    const c = clamp(cutFraction, 0, 0.85);
    for (let k = 0; k < this.pebCount; k++) {
      this.peb[k * PEB_STRIDE + 5] = c;
    }
    this.sprays[this.sprays.length - 1].cutFraction = c;
    this.pebVersion++;
    this.zoneDirty = true;
    this.recomputeZones();
    this.log(`刮刀削顶 ${Math.round(c * 100)}%,接触面被放大`, 'info');
  }

  // ---------------- 分区统计 ----------------
  recomputeZones() {
    const acc = this.zones.map(() => ({
      n: 0, r: 0, contact: 0, wear: 0, frost: 0,
    }));
    for (let k = 0; k < this.pebCount; k++) {
      const o = k * PEB_STRIDE;
      const zi = this.peb[o + 6] | 0;
      const a = acc[zi];
      a.n++;
      a.r += this.peb[o + 2];
      const cf = cutContactFraction(
        this.peb[o + 2], this.peb[o + 4], this.peb[o + 3], this.peb[o + 5]);
      a.contact += cf;
    }
    const area = (SHEET_W / ZONES_SIDE) * (HOG_Z * 2 + 2) / ZONES_ALONG;
    for (const z of this.zones) {
      const a = acc[z.index];
      z.density = a.n / area;
      z.meanRadiusMm = a.n ? a.r / a.n : 0;
      z.contactFraction = a.n ? a.contact / a.n : 0.4;
      z.friction = frictionCoefficient({
        contactFraction: z.contactFraction,
        density: Math.max(1, z.density),
        iceTempC: z.iceTempC,
        frost: z.frost,
        wear: z.wear,
      });
      z.hogSeconds = this.hogFromFriction(z.friction);
    }
    this.globalHogSeconds = globalStats(this.zones).hogMean;
  }

  /** μ → hog-to-hog 秒数:按固定出手速度积分;半路停壶给出单调的慢速读数 */
  private hogFromFriction(mu: number): number {
    const L = HOG_Z * 2;
    const v0 = Math.sqrt(2 * MU_REF * 9.81 * L * 1.02); // 基准 μ 下刚过线的出手速度
    const stopDist = (v0 * v0) / (2 * mu * 9.81);
    if (stopDist <= L) {
      // 到不了后掷线:停得越早读数越大,上限 40s
      return clamp(14.5 + 25.5 * (1 - stopDist / L), 14.5, 40);
    }
    const vAt = Math.sqrt(v0 * v0 - 2 * mu * 9.81 * L);
    return L / ((v0 + vAt) / 2);
  }

  // ---------------- SurfaceSampler ----------------
  heightAt(x: number, z: number): number {
    const i = clamp(Math.round((x + SHEET_W / 2) / CELL_M), 0, NX - 1);
    const j = clamp(Math.round((z + SHEET_L / 2) / CELL_M), 0, NZ - 1);
    return this.height[i * NZ + j];
  }

  frictionAt(x: number, z: number): number {
    return this.zones[zoneAt(x, z)].friction;
  }

  throwStone(spin: ThrowResult['spin']): ThrowResult {
    const r = simulateThrow(this, spin);
    if (r.hogSeconds >= 40) {
      this.log('试滑壶没能到达后掷线 —— 冰太慢了', 'warn');
    }
    return r;
  }

  // ---------------- 时间推进 ----------------
  tick(dt: number) {
    this.timeS += dt;
    this.updateLayers(dt);
    stepEnv(this.env, this.venue, dt);

    for (const z of this.zones) {
      z.iceTempC = stepIceTemp(z.iceTempC, this.fridge,
        (z.along + 0.5) / ZONES_ALONG, this.venue.insulation,
        this.env.airTempC, dt);
      const fp = frostPotential(this.env.airTempC, this.env.rh, z.iceTempC);
      const overHum = clamp(
        (this.env.rh - this.env.frostThreshold) / 18, 0, 1);
      const frostRate = fp * overHum * dt / 480;
      const meltRate = clamp((this.env.frostThreshold - this.env.rh) / 20, 0, 1) * dt / 260;
      z.frost = clamp(z.frost + frostRate - meltRate, 0, 1);
      if (this.phase === 'maintenance') {
        z.wear = clamp(z.wear + dt / END_DURATION_S * 0.5, 0, 1);
      }
    }
    this.zoneAccumS += dt;
    if (this.zoneDirty || this.zoneAccumS >= 0.5) {
      this.recomputeZones();
      this.zoneAccumS = 0;
      this.zoneDirty = false;
    }

    if (this.phase === 'maintenance') {
      this.endClockS += dt;
      if (this.endClockS >= END_DURATION_S) {
        this.finishEnd();
      }
    }
  }

  startMatch() {
    if (!this.canSpray || !this.sprays.length) {
      this.log('冰面还没做完,不能开赛', 'bad');
      return false;
    }
    this.phase = 'maintenance';
    this.currentEnd = 1;
    this.endClockS = 0;
    this.env.occupants = Math.round(this.venue.capacity * 0.7);
    this.log(`比赛开始,馆内进入 ${this.env.occupants} 名观众`, 'info');
    return true;
  }

  private finishEnd() {
    const throws: ThrowResult[] = [
      this.throwStone('cw'), this.throwStone('ccw'),
    ];
    const penalties: string[] = [];
    if (this.sprays.some((s) => s.failed)) penalties.push('存在判废的洒点作业');
    const sc = scoreEnd(this.currentEnd, this.zones, throws, penalties);
    this.scores.push(sc);
    this.log(`第 ${this.currentEnd} 局评分 ${sc.total}(${sc.grade})`,
      sc.total >= 78 ? 'info' : 'warn');
    if (this.currentEnd >= END_COUNT) {
      this.phase = 'finished';
      this.log('全部局数结束,赛事评价已生成', 'info');
    } else {
      this.phase = 'end';
      this.log(`第 ${this.currentEnd} 局结束,局间可以重新洒点、刮冰`, 'info');
    }
    this.endClockS = 0;
  }

  /** 局间维护后进入下一局 */
  nextEnd() {
    if (this.phase !== 'end') return;
    this.currentEnd++;
    this.phase = 'maintenance';
    for (const z of this.zones) z.wear *= 0.45; // 维护消除部分磨损
    this.log(`第 ${this.currentEnd} 局开始`, 'info');
  }

  get endProgress(): number {
    return clamp(this.endClockS / END_DURATION_S, 0, 1);
  }

  /** 暴露制冷管导热参数,供 UI 展示 */
  get conductionHint() {
    return {
      kIce: K_ICE,
      rhoIce: RHO_ICE,
      contactC: contactTemp(this.fridge, 0.5),
    };
  }
}
