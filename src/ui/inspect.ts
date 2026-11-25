// 冰面检测页:平整度标红、试滑壶计时、24 分区冰速
import { HOG_Z, ZONES_ALONG, ZONES_SIDE } from '../sim/constants';
import type { Renderer } from '../render/renderer';
import type { Simulation } from '../sim/Simulation';
import type { ThrowResult } from '../sim/types';
import { btn, card, h, stat, toast } from './dom';

export class InspectPage {
  el: HTMLElement;
  private sim: Simulation;
  private renderer: Renderer;
  private topStats!: HTMLElement;
  private zoneGrid!: HTMLElement;
  private throwLog!: HTMLElement;
  private lastThrows: ThrowResult[] = [];
  private statSig = '';
  private zoneSig = '';

  constructor(getSim: () => Simulation, getRenderer: () => Renderer,
    private onChanged: () => void) {
    this.sim = getSim();
    this.renderer = getRenderer();
    this.el = h('div', { class: 'page inspect-page' });
    this.build();
  }

  reattach(sim: Simulation, renderer: Renderer) {
    this.sim = sim;
    this.renderer = renderer;
    this.lastThrows = [];
    this.refresh();
  }

  private build() {
    this.topStats = h('div', { class: 'stat-grid' });
    const redToggle = btn('切换 1mm 超标标红', () => {
      this.renderer.showRed = !this.renderer.showRed;
      toast(this.renderer.showRed ? '标红已开启' : '标红已关闭');
    });
    const throwCw = btn('试滑:顺时针壶', () => this.doThrow('cw'), 'primary');
    const throwCcw = btn('试滑:逆时针壶', () => this.doThrow('ccw'), 'primary');
    const ctrl = card('检测操作',
      h('div', { class: 'btn-row' }, [redToggle, throwCw, throwCcw]),
      h('p', { class: 'hint' }, [
        `试滑从前掷线(z=-${HOG_Z.toFixed(1)}m)积分到后掷线,秒数随卵石密度与削顶量变化;冰面坡度会让壶横向跑偏。`,
      ]),
    );
    this.throwLog = h('div', { class: 'throw-log' });
    this.zoneGrid = h('div', { class: 'zone-grid' });
    this.el.append(
      card('全局指标', this.topStats),
      ctrl,
      card('试滑记录', this.throwLog),
      card('24 分区冰速(沿长度 8 段 × 横向 3 条)', this.zoneGrid),
    );
  }

  private doThrow(spin: ThrowResult['spin']) {
    if (!this.sim.sprays.length) {
      toast('还没洒卵石点,壶没法滑', 'warn');
      return;
    }
    const r = this.sim.throwStone(spin);
    this.lastThrows.unshift(r);
    if (this.lastThrows.length > 6) this.lastThrows.pop();
    this.onChanged();
    this.refresh();
  }

  refresh() {
    this.sim.ensureFlatness();
    const f = this.sim.flatness;
    const g = this.sim.zones;
    const hogVals = g.map((z) => z.hogSeconds);
    const hogMean = hogVals.reduce((s, v) => s + v, 0) / hogVals.length;
    // 数值变化不到 0.05 就不重建 DOM,避免 4Hz 全量刷新
    const sig = `${f.maxRangeMm.toFixed(2)}|${(f.redRatio * 100).toFixed(1)}`
      + `|${hogMean.toFixed(2)}|${this.sim.pebCount}|${this.renderer.visibleCount}`
      + `|${this.renderer.fps}`;
    if (sig !== this.statSig) {
      this.statSig = sig;
      this.topStats.innerHTML = '';
      this.topStats.append(
        stat('冰面最大高低差', `${f.maxRangeMm.toFixed(2)} mm`, f.redRatio > 0),
        stat('超标(>1mm)网格占比', `${(f.redRatio * 100).toFixed(1)}%`, f.redRatio > 0.02),
        stat('平均 hog-to-hog', `${hogMean.toFixed(2)} s`),
        stat('卵石点总数', this.sim.pebCount.toLocaleString()),
        stat('当前渲染实例', this.renderer.visibleCount.toLocaleString()),
        stat('渲染帧率', `${this.renderer.fps} FPS`),
      );
    }

    this.throwLog.innerHTML = '';
    if (!this.lastThrows.length) {
      this.throwLog.append(h('p', { class: 'hint' }, ['暂无试滑记录']));
    }
    for (const t of this.lastThrows) {
      const ok = t.hogSeconds < 40;
      this.throwLog.append(h('div', { class: 'throw-row' }, [
        h('span', { class: `tag ${ok ? 'ok' : 'bad'}` },
          [t.spin === 'cw' ? '顺时针' : '逆时针']),
        h('span', {}, [ok ? `${t.hogSeconds.toFixed(2)} s` : '未到达后掷线']),
        h('span', {}, [`横移 ${t.lateralAtHogM.toFixed(2)} m`]),
        h('span', {}, [`平均 μ=${t.friction.toExponential(2)}`]),
      ]));
    }

    const sigParts: string[] = [];
    for (let a = 0; a < ZONES_ALONG; a++) {
      for (let s = 0; s < ZONES_SIDE; s++) {
        const z = g[a * ZONES_SIDE + s];
        sigParts.push(`${z.hogSeconds.toFixed(1)},${z.frost.toFixed(1)},${z.wear.toFixed(1)}`);
      }
    }
    const newSig = sigParts.join('|');
    if (newSig === this.zoneSig) return;
    this.zoneSig = newSig;
    this.zoneGrid.innerHTML = '';
    const table = h('table', { class: 'zone-table' });
    const thead = h('thead', {}, [h('tr', {}, [
      h('th', {}, ['长度段 ↓ / 横向 →']),
      h('th', {}, ['左']), h('th', {}, ['中']), h('th', {}, ['右']),
    ])]);
    const tbody = h('tbody');
    for (let a = 0; a < ZONES_ALONG; a++) {
      const tr = h('tr');
      tr.append(h('td', { class: 'axis' }, [`第 ${a + 1} 段`]));
      for (let s = 0; s < ZONES_SIDE; s++) {
        const z = g[a * ZONES_SIDE + s];
        const slow = z.hogSeconds > 17 || z.hogSeconds >= 35;
        const fast = z.hogSeconds < 12;
        tr.append(h('td', { class: slow ? 'bad' : fast ? 'fast' : '' }, [
          h('div', { class: 'hog' }, [z.hogSeconds >= 35 ? '停壶' : `${z.hogSeconds.toFixed(1)}s`]),
          h('div', { class: 'sub' }, [
            `${Math.round(z.density / 1000)}k点 · μ${(z.friction * 1000).toFixed(1)}`]),
          h('div', { class: 'sub' }, [
            `霜${(z.frost * 100).toFixed(0)}% 磨${(z.wear * 100).toFixed(0)}% ${z.iceTempC.toFixed(1)}°C`]),
        ]));
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    this.zoneGrid.append(table);
  }
}
