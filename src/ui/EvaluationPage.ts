/** 赛事评价页:每局四维评分、等级、历史表、判废记录与综合总成绩 */
import { SCORE } from '../engine/constants';
import type { Simulation } from '../engine/simulation';
import { h, fmt } from './dom';

export class EvaluationPage {
  readonly el: HTMLElement;
  constructor(private sim: Simulation, private rerender: () => void) {
    this.el = h('div');
    this.build();
  }

  private build(): void {
    const s = this.sim;

    // 综合成绩
    const agg = s.aggregate;
    this.el.append(
      h('div', { class: 'card', style: 'text-align:center' },
        h('h3', {}, '综合成绩'),
        h('div', { class: `grade ${agg.grade}` }, agg.grade),
        h('div', { style: 'font-size:26px;font-weight:700' }, `${agg.total}`, h('span', { style: 'font-size:13px;color:var(--muted)' }, ' /100')),
        h('div', { class: 'hint', style: 'margin-top:6px' },
          `已评 ${s.endScores.length} 局 · 权重:冰速稳定 ${SCORE.W_SPEED * 100}% / 两侧一致 ${SCORE.W_SYMMETRY * 100}% / 走线 ${SCORE.W_PATH * 100}% / 结霜 ${SCORE.W_FROST * 100}%`)
      )
    );

    // 局间操作
    if (s.phase === 'between-ends') {
      this.el.append(
        h('div', { class: 'card' },
          h('h3', {}, `第 ${s.currentEnd} 局结束后`),
          h('div', { class: 'hint', style: 'margin-bottom:10px' },
            '先在制冰作业页处理结霜/磨损(刮冰或重新洒点),再结束本局并出评分。试滑壶会双向各发一只。'),
          h('button', {
            class: 'btn good',
            onclick: () => { s.finishEnd(); this.rerender(); }
          }, '结束本局并评分')
        )
      );
    }

    // 判废
    if (s.penalties.length) {
      const card = h('div', { class: 'card' }, h('h3', {}, '判废记录', h('span', { class: 'tag', style: 'color:var(--bad)' }, `${s.penalties.length} 次`)));
      for (const p of [...s.penalties].slice(-5).reverse()) {
        card.append(h('div', { class: 'penalty' }, `${Math.round(p.atSimS / 60)}min · ${p.reason}`));
      }
      this.el.append(card);
    }

    // 最近一局明细
    const last = s.endScores[s.endScores.length - 1];
    if (last) {
      this.el.append(
        h('div', { class: 'card' },
          h('h3', {}, `第 ${last.end} 局评分明细`),
          h('div', { class: 'score-grid' },
            this.mini('冰速稳定', last.speedScore),
            this.mini('两侧一致', last.symmetryScore),
            this.mini('走线正常', last.pathScore),
            this.mini('结霜控制', last.frostScore)),
          h('div', { style: 'height:10px' }),
          h('div', { class: 'kv' }, h('span', {}, '正向 hog 用时'), h('b', {}, last.hogTimeA < 0 ? '未抵达' : `${fmt(last.hogTimeA, 1)}s`)),
          h('div', { class: 'kv' }, h('span', {}, '反向 hog 用时'), h('b', {}, last.hogTimeB < 0 ? '未抵达' : `${fmt(last.hogTimeB, 1)}s`)),
          h('div', { class: 'kv' }, h('span', {}, '最大横向偏差'), h('b', {}, `${fmt(Math.max(Math.abs(last.driftA), Math.abs(last.driftB)), 2)}m`)),
          h('div', { class: 'kv' }, h('span', {}, '当时霜厚'), h('b', {}, `${fmt(last.frostMm, 3)}mm`)),
          h('div', { style: 'height:8px' }),
          ...last.notes.map((n) => h('div', { class: 'hint', style: 'margin-bottom:4px' }, `· ${n}`))
        )
      );
    }

    // 历史
    if (s.endScores.length) {
      const card = h('div', { class: 'card' }, h('h3', {}, '各局历史'));
      card.append(
        h('table', { class: 'history' },
          h('thead', {}, h('tr', {},
            h('th', {}, '局'), h('th', {}, '冰速'), h('th', {}, '对称'), h('th', {}, '走线'),
            h('th', {}, '结霜'), h('th', {}, '总分'), h('th', {}, '等级'))),
          h('tbody', {}, ...[...s.endScores].reverse().map((sc) =>
            h('tr', {},
              h('td', {}, String(sc.end)),
              h('td', {}, String(sc.speedScore)),
              h('td', {}, String(sc.symmetryScore)),
              h('td', {}, String(sc.pathScore)),
              h('td', {}, String(sc.frostScore)),
              h('td', {}, String(sc.total)),
              h('td', { style: `font-weight:700;color:var(--${sc.grade === 'S' ? 'warn' : sc.grade === 'A' ? 'good' : 'accent'})` }, sc.grade))))
        )
      );
      this.el.append(card);
    }

    if (s.phase === 'game-over') {
      this.el.append(
        h('div', { class: 'card' },
          h('h3', {}, '比赛结束'),
          h('div', { class: 'hint' },
            agg.grade === 'S' || agg.grade === 'A'
              ? '顶级制冰水准:冰速全程稳定、两边一致、走线干净,运动员完全信任这块冰。'
              : agg.grade === 'B'
                ? '合格的职业冰面,个别局受湿度或磨损影响,维护节奏还可以再提前。'
                : '冰面波动明显:注意厚层冻透再洒点、把接触面做到 30% 附近,并在湿度抬头时提前开除湿机。'))
      );
    }
  }

  private mini(k: string, v: number): HTMLElement {
    const color = v >= 82 ? 'var(--good)' : v >= 68 ? 'var(--accent)' : v >= 50 ? 'var(--warn)' : 'var(--bad)';
    return h('div', { class: 'score-card' },
      h('div', { class: 'v', style: `color:${color}` }, String(v)),
      h('div', { class: 'k' }, k));
  }
}
