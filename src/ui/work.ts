// 制冰作业页:铺底冰、洒卵石点、刮刀削顶
import { FRIDGES, VENUES } from '../sim/constants';
import type { Simulation } from '../sim/Simulation';
import { dropletDiameterMm, freezeTimeS, jetVelocity, pebbleGeometry } from '../sim/physics';
import { contactTemp } from '../sim/physics';
import type { FloodParams, SprayParams } from '../sim/types';
import { btn, card, h, slider, toast } from './dom';

export class WorkPage {
  el: HTMLElement;
  private sim: Simulation;
  private flood: FloodParams = { thicknessMm: 8, waterTempC: 45 };
  private sprayP: SprayParams = {
    tankHeadM: 1.1, orificeMm: 0.6, nozzleCount: 8, headWidthM: 1.6,
    waterTempC: 48, walkSpeed: 1.1, flowLmin: 7,
  };
  private cutPct = 30;
  private predictEl!: HTMLElement;
  private layerListEl!: HTMLElement;
  private predictEl2!: HTMLElement;
  private venueSel!: HTMLSelectElement;
  private fridgeSel!: HTMLSelectElement;
  private venueHint!: HTMLElement;
  private fridgeHint!: HTMLElement;

  constructor(getSim: () => Simulation, private onChanged: () => void) {
    this.sim = getSim();
    this.el = h('div', { class: 'page work-page' });
    this.build();
  }

  reattach(sim: Simulation) {
    this.sim = sim;
    this.venueSel.value = sim.venue.id;
    this.fridgeSel.value = sim.fridge.id;
    this.venueHint.textContent = sim.venue.desc;
    this.fridgeHint.textContent = sim.fridge.desc;
    this.refresh();
  }

  private build() {
    // ---- 场馆/机组选择(仅 build 阶段可换) ----
    this.venueSel = h('select', {}) as HTMLSelectElement;
    VENUES.forEach((v) => this.venueSel.append(new Option(v.name, v.id)));
    this.venueSel.value = this.sim.venue.id;
    this.fridgeSel = h('select', {}) as HTMLSelectElement;
    FRIDGES.forEach((f) => this.fridgeSel.append(new Option(f.name, f.id)));
    this.fridgeSel.value = this.sim.fridge.id;
    const restart = btn('按此配置重新开局', () => {
      this.onConfig(this.venueSel.value, this.fridgeSel.value);
    }, 'primary');
    this.venueHint = h('p', { class: 'hint' }, [this.sim.venue.desc]);
    this.fridgeHint = h('p', { class: 'hint' }, [this.sim.fridge.desc]);

    const setup = card('场馆与制冷系统',
      h('label', { class: 'field' }, [h('span', {}, ['场馆']), this.venueSel]),
      this.venueHint,
      h('label', { class: 'field' }, [h('span', {}, ['制冷机组']), this.fridgeSel]),
      this.fridgeHint,
      restart,
    );

    // ---- 浇水铺冰 ----
    const t1 = slider('每层厚度', 2, 30, 0.5, this.flood.thicknessMm, 'mm',
      (v) => { this.flood.thicknessMm = v; this.refreshPredict(); });
    const t2 = slider('浇水水温', 5, 80, 1, this.flood.waterTempC, '°C',
      (v) => { this.flood.waterTempC = v; this.refreshPredict(); });
    const floodBtn = btn('浇一层水', () => {
      const l = this.sim.flood(this.flood);
      toast(`已浇水,预计 ${(l.freezeTimeS / 60).toFixed(1)} 分钟冻透`);
      this.onChanged();
    }, 'primary');
    this.predictEl = h('div', { class: 'predict' });
    this.layerListEl = h('div', { class: 'layer-list' });
    const floodCard = card('① 分层浇水铺底冰(Stefan 导热冻结)',
      t1.row, t2.row, this.predictEl, floodBtn, this.layerListEl,
      h('p', { class: 'hint' }, [
        '层越厚、水温越高、机组越弱,冻透越慢;没冻透就洒点直接判废。至少 4 层冻透才能洒点。',
      ]),
    );

    // ---- 洒点 ----
    this.predictEl2 = h('div', { class: 'predict' });
    const s1 = slider('水箱水头高度', 0.4, 2.2, 0.05, this.sprayP.tankHeadM, 'm',
      (v) => { this.sprayP.tankHeadM = v; this.refreshPredict(); });
    const s2 = slider('喷头孔径', 0.3, 1.4, 0.05, this.sprayP.orificeMm, 'mm',
      (v) => { this.sprayP.orificeMm = v; this.refreshPredict(); });
    const s3 = slider('喷头数量', 4, 16, 1, this.sprayP.nozzleCount, '孔',
      (v) => { this.sprayP.nozzleCount = v; this.refreshPredict(); });
    const s4 = slider('洒水流量', 2, 16, 0.5, this.sprayP.flowLmin, 'L/min',
      (v) => { this.sprayP.flowLmin = v; this.refreshPredict(); });
    const s5 = slider('洒点水温', 5, 85, 1, this.sprayP.waterTempC, '°C',
      (v) => { this.sprayP.waterTempC = v; this.refreshPredict(); });
    const s6 = slider('倒退走速', 0.4, 2.4, 0.05, this.sprayP.walkSpeed, 'm/s',
      (v) => { this.sprayP.walkSpeed = v; this.refreshPredict(); });
    const sprayBtn = btn('背水箱倒退洒点', () => {
      const r = this.sim.spray(this.sprayP);
      if (r) toast(`洒出 ${r.count.toLocaleString()} 个卵石点`);
      else toast('冰面不具备洒点条件,已判废!', 'bad');
      this.onChanged();
      this.refresh();
    }, 'primary');
    const sprayCard = card('② 洒卵石点(Weber 破碎 + 体积守恒球冠)',
      s1.row, s2.row, s3.row, s4.row, s5.row, s6.row,
      this.predictEl2, sprayBtn,
      h('p', { class: 'hint' }, [
        '水头越高射流越快、Weber 数越大,水珠碎得越细;走得越快落点越稀。水滴落冰冻成半球形卵石点。',
      ]),
    );

    // ---- 刮冰 ----
    const c1 = slider('削顶比例', 0, 80, 1, this.cutPct, '%', (v) => { this.cutPct = v; });
    const cutBtn = btn('刮刀削平点顶', () => {
      this.sim.cut(this.cutPct / 100);
      toast(`削顶 ${this.cutPct}%,壶底接触面变大`);
      this.onChanged();
    }, 'primary');
    const reSprayBtn = btn('重新洒点(覆盖旧点)', () => {
      const r = this.sim.spray(this.sprayP);
      if (r) toast('局间重洒完成');
      this.onChanged();
      this.refresh();
    });
    const cutCard = card('③ 刮刀削顶(决定壶底接触面积)',
      c1.row, cutBtn, h('hr'), reSprayBtn,
      h('p', { class: 'hint' }, [
        '削得越多,单个点接触圆越大、摩擦越高、冰越慢;局间可重洒+刮冰修复磨损。',
      ]),
    );

    this.el.append(setup, floodCard, sprayCard, cutCard);
    this.refreshPredict();
  }

  private onConfig(venueId: string, fridgeId: string) {
    const evt = new CustomEvent('sim-restart', { detail: { venueId, fridgeId } });
    window.dispatchEvent(evt);
  }

  private refreshPredict() {
    const c = contactTemp(this.sim.fridge, 0.5);
    const ft = freezeTimeS(this.flood.thicknessMm / 1000, this.flood.waterTempC, c);
    this.predictEl.innerHTML = `
      <div><span>管温侧接触温度</span><b>${c.toFixed(1)}°C</b></div>
      <div><span>该层冻透耗时</span><b>${(ft / 60).toFixed(1)} min</b></div>
      <div><span>当前进度</span><b>${this.sim.layers.length} 层 / 需 ≥4 层冻透</b></div>`;
    const dia = dropletDiameterMm(this.sprayP.orificeMm, this.sprayP.flowLmin,
      this.sprayP.nozzleCount, this.sprayP.tankHeadM, this.sprayP.waterTempC);
    const v = jetVelocity(this.sprayP.tankHeadM);
    const geo = pebbleGeometry(dia, -5);
    this.predictEl2.innerHTML = `
      <div><span>射流速度</span><b>${v.toFixed(2)} m/s</b></div>
      <div><span>水珠直径</span><b>${dia.toFixed(2)} mm</b></div>
      <div><span>卵石底径/冠高</span><b>${(geo.baseR * 2).toFixed(2)} / ${geo.capH.toFixed(2)} mm</b></div>`;
  }

  refresh() {
    this.refreshPredict();
    this.layerListEl.innerHTML = '';
    for (const l of this.sim.layers) {
      const pct = Math.min(100, Math.sqrt(l.elapsedS / l.freezeTimeS) * 100);
      const bar = h('div', { class: 'freeze-bar' }, [
        h('div', { class: `fill ${l.frozen ? 'ok' : ''}`,
          style: `width:${pct.toFixed(0)}%` }),
      ]);
      this.layerListEl.append(h('div', { class: 'layer-row' }, [
        h('span', {}, [`#${l.id} ${(l.thicknessM * 1000).toFixed(1)}mm · ${l.waterTempC}°C`]),
        h('span', { class: l.frozen ? 'tag ok' : 'tag' }, [
          l.frozen ? '已冻透' : `冻结 ${pct.toFixed(0)}%`,
        ]),
        bar,
      ]));
    }
  }
}
