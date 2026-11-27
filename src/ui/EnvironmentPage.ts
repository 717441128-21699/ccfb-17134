/** 场馆环境页:场馆/制冷系统选择,管温/室温/湿度/观众/除湿机控制 */
import { SYSTEMS, VENUES } from '../engine/venues';
import { FROST } from '../engine/constants';
import type { Simulation } from '../engine/simulation';
import { h, slider, bar, fmt } from './dom';

export class EnvironmentPage {
  readonly el: HTMLElement;
  constructor(private sim: Simulation, private rerender: () => void) {
    this.el = h('div');
    this.build();
  }

  private build(): void {
    const s = this.sim;

    // 场馆
    const venueCard = h('div', { class: 'card' }, h('h3', {}, '场馆选择'));
    const sel = h('select', {
      onchange: (e) => { s.selectVenue((e.target as HTMLSelectElement).value); this.rerender(); }
    }) as HTMLSelectElement;
    for (const v of VENUES) {
      const opt = h('option', { value: v.id }, v.name) as HTMLOptionElement;
      if (v.id === s.venue.id) opt.selected = true;
      sel.append(opt);
    }
    venueCard.append(sel, h('div', { class: 'hint', style: 'margin-top:8px' }, s.venue.description));
    this.el.append(venueCard);

    // 制冷系统(只读展示,随场馆联动)
    const sys = s.system;
    this.el.append(
      h('div', { class: 'card' },
        h('h3', {}, '制冷系统', h('span', { class: 'tag' }, sys.name)),
        h('div', { class: 'hint', style: 'margin-bottom:8px' }, sys.description),
        h('div', { class: 'kv' }, h('span', {}, '最低管温'), h('b', {}, `${sys.minPipeTempC}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '响应时间常数'), h('b', {}, `${Math.round(sys.responseTauS / 60)}min`)),
        h('div', { class: 'kv' }, h('span', {}, '管温空间不均'), h('b', {}, `±${sys.spatialUnevennessC}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '制冷效率系数'), h('b', {}, `${fmt(sys.efficiency, 2)}`))
      )
    );

    // 实时热环境
    const e = s.env;
    this.el.append(
      h('div', { class: 'card' },
        h('h3', {}, '实时热环境'),
        h('div', { class: 'kv' }, h('span', {}, '制冷管温度'), h('b', {}, `${fmt(e.pipeTempC, 2)}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '管温设定值'), h('b', {}, `${fmt(e.pipeSetpointC, 1)}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '冰面温度'), h('b', {}, `${fmt(e.iceTempC, 2)}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '室内温度'), h('b', {}, `${fmt(e.airTempC, 2)}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '相对湿度'), h('b', e.rh > FROST.RH_THRESHOLD ? { style: 'color:var(--warn)' } : {}, `${(e.rh * 100).toFixed(0)}%`)),
        h('div', { class: 'kv' }, h('span', {}, '露点温度'), h('b', {}, `${fmt(e.dewPointC, 2)}℃`)),
        h('div', { class: 'kv' }, h('span', {}, '结霜阈值湿度'), h('b', {}, `${FROST.RH_THRESHOLD * 100}%`)),
        h('div', { class: 'kv' }, h('span', {}, '当前霜厚'), h('b', e.frostMm > 0.1 ? { style: 'color:var(--bad)' } : {}, `${fmt(e.frostMm, 3)}mm`)),
        h('div', { style: 'height:6px' }),
        bar(Math.min(e.frostMm / FROST.MAX_MM, 1))
      )
    );

    // 控制
    const ctrl = h('div', { class: 'card' }, h('h3', {}, '环境控制'));
    ctrl.append(
      slider('管温设定', sys.minPipeTempC, -4, 0.5, e.pipeSetpointC, '℃', (v) => s.setPipeSetpoint(v)),
      slider('室温设定', 3, 15, 0.5, e.airTempC, '℃', (v) => s.setAirTemp(v)),
      slider('相对湿度', 0.2, 0.95, 0.01, e.rh, '', (v) => s.setRh(v)),
      slider('入场观众', 0, s.venue.crowdMax, 50, e.crowd, '人', (v) => s.setCrowd(v))
    );
    const dh = h('input', { type: 'checkbox' }) as HTMLInputElement;
    dh.checked = e.dehumidifierOn;
    dh.addEventListener('change', () => { s.toggleDehumidifier(); this.rerender(); });
    ctrl.append(
      h('label', { class: 'switch', style: 'margin:8px 0 12px' },
        document.createTextNode(`除湿机(额定 ${s.venue.dehumidifierKw}kW)`), dh),
      h('div', { class: 'hint' },
        `观众散湿散热:满场时每局湿度最多 +${(this.crowdRhMax() * 100).toFixed(0)}%。湿度超过 ${FROST.RH_THRESHOLD * 100}% 且冰温低于露点就会结霜,霜层按摩擦模型直接拖慢冰速。`)
    );
    this.el.append(ctrl);

    // 三种系统横向参考
    this.el.append(
      h('div', { class: 'card' },
        h('h3', {}, '全部制冷系统参考'),
        h('table', { class: 'history' },
          h('thead', {}, h('tr', {},
            h('th', {}, '系统'), h('th', {}, '最低管温'), h('th', {}, '响应'), h('th', {}, '不均'), h('th', {}, '效率'))),
          h('tbody', {}, ...SYSTEMS.map((sy) =>
            h('tr', {},
              h('td', {}, sy.name),
              h('td', {}, `${sy.minPipeTempC}℃`),
              h('td', {}, `${Math.round(sy.responseTauS / 60)}min`),
              h('td', {}, `±${sy.spatialUnevennessC}℃`),
              h('td', {}, fmt(sy.efficiency, 2))))))
      )
    );
  }

  private crowdRhMax(): number {
    return this.sim.venue.crowdRhImpact;
  }
}
