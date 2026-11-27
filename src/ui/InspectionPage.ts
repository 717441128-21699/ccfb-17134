/** 冰面检测页:高低差热图、>1mm 红格、试滑壶双向计时与走线 */
import { RINK } from '../engine/constants';
import type { Simulation } from '../engine/simulation';
import type { TestStoneResult } from '../engine/types';
import { h, bar, fmt } from './dom';

export interface InspectionViewState {
  heatmap: boolean;
  showRed: boolean;
  showPath: boolean;
}

export class InspectionPage {
  readonly el: HTMLElement;
  lastStones: TestStoneResult[] = [];
  constructor(
    private sim: Simulation,
    private rerender: () => void,
    public view: InspectionViewState
  ) {
    this.el = h('div');
    this.build();
  }

  private build(): void {
    const s = this.sim;
    const relief = s.field.reliefMm();
    const redRatio = s.field.redCellRatio(1);
    const lrDelta = s.field.leftRightDeltaMm();

    this.el.append(
      h('div', { class: 'card' },
        h('h3', {}, '冰面平整度'),
        h('div', { class: 'kv' },
          h('span', {}, '全场最大高低差'),
          h('b', relief > 1 ? { style: 'color:var(--bad)' } : {}, `${fmt(relief, 2)}mm`)),
        h('div', { class: 'kv' },
          h('span', {}, '超 1mm 红格占比'),
          h('b', redRatio > 0.05 ? { style: 'color:var(--bad)' } : {}, `${(redRatio * 100).toFixed(1)}%`)),
        h('div', { class: 'kv' },
          h('span', {}, '左右半幅高差'),
          h('b', lrDelta > 0.5 ? { style: 'color:var(--warn)' } : {}, `${fmt(lrDelta, 2)}mm`)),
        h('div', { class: 'kv' },
          h('span', {}, '基础冰总厚度'), h('b', {}, `${fmt(s.totalIceMm, 1)}mm`)),
        h('div', { style: 'height:8px' }),
        bar(Math.min(relief / 2, 1))
      )
    );

    // 视图开关
    this.el.append(
      h('div', { class: 'card' },
        h('h3', {}, '视图叠加'),
        h('label', { class: 'switch', style: 'margin-bottom:8px' },
          document.createTextNode('高度热图'),
          this.checkbox(this.view.heatmap, (v) => { this.view.heatmap = v; })),
        h('label', { class: 'switch', style: 'margin-bottom:8px' },
          document.createTextNode('>1mm 红格标注'),
          this.checkbox(this.view.showRed, (v) => { this.view.showRed = v; })),
        h('label', { class: 'switch' },
          document.createTextNode('试滑壶走线'),
          this.checkbox(this.view.showPath, (v) => { this.view.showPath = v; })),
        h('div', { class: 'hint', style: 'margin-top:8px' },
          '热图蓝色为低、红色为高;红格是与相邻格高差超过 1mm 的位置,壶经过时会被横向坡度带偏。')
      )
    );

    // 卵石点统计
    if (s.pebbles.count > 0) {
      this.el.append(
        h('div', { class: 'card' },
          h('h3', {}, '卵石点检测'),
          h('div', { class: 'kv' }, h('span', {}, '点总数'), h('b', {}, s.pebbles.count.toLocaleString())),
          h('div', { class: 'kv' }, h('span', {}, '点密度'), h('b', {}, `${Math.round(s.pebbleDensity)} 颗/m²`)),
          h('div', { class: 'kv' }, h('span', {}, '平均点半径'), h('b', {}, `${fmt(s.avgPebbleRadiusMm, 2)}mm`)),
          h('div', { class: 'kv' }, h('span', {}, '平均接触面'), h('b', {}, `${(s.contactFraction * 100).toFixed(1)}%`)),
          h('div', { class: 'kv' }, h('span', {}, '未冻透比例'), h('b', {}, `${(s.unfrozenPebbles() * 100).toFixed(1)}%`))
        )
      );
    }

    // 试滑壶
    const stoneCard = h('div', { class: 'card' }, h('h3', {}, '试滑壶(恒速出手)'));
    const canLaunch = s.pebbles.count > 0 && s.unfrozenPebbles() < 0.05;
    stoneCard.append(
      h('div', { class: 'hint', style: 'margin-bottom:10px' },
        `从一端前掷线外 0.5m 以 2.35m/s 出手,量到对面前掷线(x=±${RINK.HOG_X}m)的用时。双向各发一只,检查两侧是否一致。`),
      h('button', {
        class: 'btn',
        disabled: canLaunch ? false : true,
        onclick: () => { this.lastStones = s.runTestStones(); this.rerender(); }
      }, '发一对试滑壶'),
      h('div', { style: 'height:10px' })
    );
    const recent = this.lastStones.length ? this.lastStones : s.testStones.slice(-2);
    if (recent.length >= 2) {
      const [a, b] = recent;
      stoneCard.append(
        h('div', { class: 'score-grid' },
          this.stoneMini('正向壶', a),
          this.stoneMini('反向壶', b)
        ),
        h('div', { style: 'height:8px' }),
        h('div', { class: 'kv' },
          h('span', {}, '双向用时差'),
          h('b', a.hogTimeS !== null && b.hogTimeS !== null ? {} : { style: 'color:var(--bad)' },
            a.hogTimeS !== null && b.hogTimeS !== null ? `${fmt(Math.abs(a.hogTimeS - b.hogTimeS), 2)}s` : '有壶未抵达'))
      );
    }
    this.el.append(stoneCard);
  }

  private stoneMini(title: string, r: TestStoneResult): HTMLElement {
    return h('div', { class: 'score-card' },
      h('div', { class: 'k' }, title),
      h('div', { class: 'v', style: 'font-size:18px' }, r.hogTimeS === null ? '未抵达' : `${fmt(r.hogTimeS, 1)}s`),
      h('div', { class: 'k' }, `横偏 ${fmt(r.lateralDriftM, 2)}m`));
  }

  private checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
    const c = h('input', { type: 'checkbox' }) as HTMLInputElement;
    c.checked = checked;
    c.addEventListener('change', () => {
      onChange(c.checked);
      this.rerender();
    });
    return c;
  }
}
