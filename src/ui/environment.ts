// 场馆环境页:室温/湿度/结霜监控,除湿设定,人群与赛事时钟
import { END_COUNT } from '../sim/constants';
import type { Simulation } from '../sim/Simulation';
import { btn, card, fmtTime, h, slider, stat, toast } from './dom';

export class EnvPage {
  el: HTMLElement;
  private sim: Simulation;
  private statsEl!: HTMLElement;
  private rhBar!: HTMLElement;
  private frostBar!: HTMLElement;
  private logEl!: HTMLElement;
  private clockEl!: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  timeScale = 1;

  constructor(getSim: () => Simulation, private onChanged: () => void) {
    this.sim = getSim();
    this.el = h('div', { class: 'page env-page' });
    this.build();
  }

  reattach(sim: Simulation) {
    this.sim = sim;
    this.refresh();
  }

  private build() {
    this.statsEl = h('div', { class: 'stat-grid' });
    this.rhBar = this.bar();
    this.frostBar = this.bar();
    this.clockEl = h('div', { class: 'clock' });

    const rhSet = slider('除湿设定湿度', 25, 70, 1, this.sim.env.rhSetpoint, '%',
      (v) => { this.sim.env.rhSetpoint = v; });
    const frostSet = slider('结霜湿度警戒值', 45, 85, 1,
      this.sim.env.frostThreshold, '%',
      (v) => { this.sim.env.frostThreshold = v; });
    const occ = slider('馆内人数', 0, this.sim.venue.capacity, 10,
      this.sim.env.occupants, '人', (v) => { this.sim.env.occupants = v; });

    const startBtn = btn('开赛(进入第 1 局)', () => {
      if (this.sim.startMatch()) toast('比赛开始,注意湿度!');
      else toast('冰面未完成,无法开赛', 'bad');
      this.onChanged();
    }, 'primary');
    const nextBtn = btn('局间维护完成,进入下一局', () => {
      this.sim.nextEnd();
      this.onChanged();
    }, 'primary');

    this.speedBtns = [1, 8, 32, 128].map((x) => {
      const b = btn(`${x}×`, () => {
        this.timeScale = x;
        this.speedBtns.forEach((bb) => bb.classList.remove('on'));
        b.classList.add('on');
      });
      if (x === 1) b.classList.add('on');
      return b;
    });

    this.logEl = h('div', { class: 'event-log' });
    this.el.append(
      card('赛事时钟', this.clockEl,
        h('div', { class: 'btn-row' }, [startBtn, nextBtn]),
        h('div', { class: 'btn-row' }, [
          h('span', { class: 'speed-label' }, ['时间流速']), ...this.speedBtns,
        ]),
      ),
      card('环境实时监测', this.statsEl,
        h('div', { class: 'bar-wrap' }, [h('span', {}, ['相对湿度']), this.rhBar]),
        h('div', { class: 'bar-wrap' }, [h('span', {}, ['平均结霜']), this.frostBar]),
      ),
      card('环境控制', rhSet.row, frostSet.row, occ.row,
        h('p', { class: 'hint' }, [
          '观众散热散湿,湿度高于警戒值时水汽在负温冰面凝华结霜,霜层会让冰速明显下降。',
        ])),
      card('作业日志', this.logEl),
    );
  }

  private bar(): HTMLElement {
    return h('div', { class: 'meter' }, [h('div', { class: 'meter-fill' })]);
  }

  refresh() {
    const e = this.sim.env;
    const frost = this.sim.zones.reduce((s, z) => s + z.frost, 0)
      / this.sim.zones.length;
    const iceT = this.sim.zones.reduce((s, z) => s + z.iceTempC, 0)
      / this.sim.zones.length;
    this.statsEl.innerHTML = '';
    this.statsEl.append(
      stat('室温', `${e.airTempC.toFixed(1)} °C`),
      stat('相对湿度', `${e.rh.toFixed(0)} %`, e.rh > e.frostThreshold),
      stat('除湿设定', `${e.rhSetpoint} %`),
      stat('平均冰温', `${iceT.toFixed(2)} °C`),
      stat('馆内人数', `${e.occupants} 人`),
      stat('结霜程度', `${(frost * 100).toFixed(0)} %`, frost > 0.25),
    );
    const rhFill = this.rhBar.firstChild as HTMLElement;
    rhFill.style.width = `${e.rh}%`;
    rhFill.className = `meter-fill ${e.rh > e.frostThreshold ? 'danger' : ''}`;
    const fFill = this.frostBar.firstChild as HTMLElement;
    fFill.style.width = `${frost * 100}%`;
    fFill.className = `meter-fill ${frost > 0.25 ? 'danger' : ''}`;

    const phaseText: Record<string, string> = {
      build: '制冰阶段(比赛前)',
      maintenance: `第 ${this.sim.currentEnd}/${END_COUNT} 局进行中`,
      end: `第 ${this.sim.currentEnd} 局结束 · 局间维护`,
      finished: '赛事结束',
    };
    this.clockEl.innerHTML = `
      <div class="phase">${phaseText[this.sim.phase]}</div>
      <div class="time">仿真时刻 ${fmtTime(this.sim.timeS)} ·
        本局进度 ${(this.sim.endProgress * 100).toFixed(0)}%</div>`;

    this.logEl.innerHTML = '';
    for (const ev of [...this.sim.events].reverse()) {
      this.logEl.append(h('div', { class: `log-row ${ev.kind}` }, [
        h('span', { class: 'log-t' }, [fmtTime(ev.t)]),
        h('span', {}, [ev.text]),
      ]));
    }
  }
}
