// 赛事评价页:逐局评分与总成绩
import { END_COUNT } from '../sim/constants';
import type { Simulation } from '../sim/Simulation';
import { card, h } from './dom';

export class EventPage {
  el: HTMLElement;
  private sim: Simulation;
  private listEl!: HTMLElement;
  private summaryEl!: HTMLElement;

  constructor(getSim: () => Simulation) {
    this.sim = getSim();
    this.el = h('div', { class: 'page event-page' });
    this.summaryEl = h('div', { class: 'summary' });
    this.listEl = h('div', { class: 'score-list' });
    this.el.append(
      card('赛事方综合评价(冰速稳定 40% · 左右对称 30% · 走线正常 30%)',
        this.summaryEl),
      card('逐局评分', this.listEl),
    );
  }

  reattach(sim: Simulation) {
    this.sim = sim;
    this.refresh();
  }

  refresh() {
    this.listEl.innerHTML = '';
    if (!this.sim.scores.length) {
      this.listEl.append(h('p', { class: 'hint' }, [
        '比赛开始后,每局结束自动试滑并评分。评分维度:冰速是否稳定、两边是否一样、壶的走线是否正常。',
      ]));
    }
    for (const s of [...this.sim.scores].reverse()) {
      const notes = s.notes.map((n) => h('li', {}, [n]));
      this.listEl.append(h('div', { class: 'score-card' }, [
        h('div', { class: 'score-head' }, [
          h('span', { class: 'end-no' }, [`第 ${s.end} 局`]),
          h('span', { class: `score-total ${s.total >= 78 ? 'good' : 'poor'}` },
            [`${s.total} 分`]),
          h('span', { class: 'grade' }, [s.grade]),
        ]),
        h('div', { class: 'score-bars' }, [
          this.bar('冰速稳定', s.stability),
          this.bar('左右对称', s.symmetry),
          this.bar('走线正常', s.path),
        ]),
        s.penalty ? h('div', { class: 'penalty' }, [`判废罚分 -${s.penalty}`]) : h('span'),
        h('ul', { class: 'notes' }, notes),
      ]));
    }

    const sc = this.sim.scores;
    this.summaryEl.innerHTML = '';
    if (sc.length) {
      const avg = Math.round(sc.reduce((s, x) => s + x.total, 0) / sc.length);
      const stable = Math.round(sc.reduce((s, x) => s + x.stability, 0) / sc.length);
      const sym = Math.round(sc.reduce((s, x) => s + x.symmetry, 0) / sc.length);
      const path = Math.round(sc.reduce((s, x) => s + x.path, 0) / sc.length);
      const done = sc.length;
      this.summaryEl.append(
        h('div', { class: 'big-score' }, [
          h('div', { class: 'big-num' }, [`${avg}`]),
          h('div', {}, [`累计均分(已评 ${done}/${END_COUNT} 局)`]),
        ]),
        h('div', { class: 'sum-bars' }, [
          this.bar('稳定性均值', stable),
          this.bar('对称性均值', sym),
          this.bar('走线均值', path),
        ]),
      );
    } else {
      this.summaryEl.append(h('p', { class: 'hint' }, ['暂无成绩']));
    }
  }

  private bar(label: string, v: number): HTMLElement {
    return h('div', { class: 'score-bar' }, [
      h('span', { class: 'sb-label' }, [label]),
      h('div', { class: 'sb-track' }, [
        h('div', {
          class: `sb-fill ${v >= 78 ? 'good' : v >= 60 ? 'mid' : 'poor'}`,
          style: `width:${v}%`,
        }),
      ]),
      h('span', { class: 'sb-val' }, [`${v}`]),
    ]);
  }
}
