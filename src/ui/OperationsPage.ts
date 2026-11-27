/** 制冰作业页:浇水 → 洒点 → 刮冰 的操作面板与实时状态 */
import { FLOOD, PEBBLE, SCRAPE } from '../engine/constants';
import { layerFreezeSeconds } from '../engine/thermal';
import { dropletDiameterMm } from '../engine/pebble';
import type { Simulation } from '../engine/simulation';
import { h, slider, bar, fmt } from './dom';

export class OperationsPage {
  readonly el: HTMLElement;
  constructor(private sim: Simulation, private rerender: () => void) {
    this.el = h('div');
    this.build();
  }

  private build(): void {
    this.el.replaceChildren();
    const s = this.sim;

    // ---------- 阶段指引 ----------
    const phaseHint: Record<string, string> = {
      'prep-flood': '第 1 步:一层层浇水,等每层冻透再浇下一层,总厚度 24~42mm 且高低差 ≤1.2mm',
      'prep-pebble': '第 2 步:基础冰达标后倒退洒点,水温/水箱高度/喷头/步速决定水珠大小与密度',
      'prep-scrape': '第 3 步:点冻硬后用刮刀削顶,接触面 30% 左右冰速最佳',
      'between-ends': '局间维护:湿度上来会结霜拖慢冰速,可重新洒点并刮冰',
      'game-over': '比赛结束,去赛事评价页看总成绩'
    };
    this.el.append(
      h('div', { class: 'card' },
        h('h3', {}, document.createTextNode('当前工序'), h('span', { class: 'tag' }, s.phase)),
        h('div', { class: 'hint' }, phaseHint[s.phase])
      )
    );

    // ---------- 浇水 ----------
    const floodCard = h('div', { class: 'card' }, h('h3', {}, '① 浇水做基础冰'));
    let thickness = 6;
    let waterTemp = 45;
    let uniformity = 0.9;
    const eta = h('b', {}, '');
    const refreshEta = () => {
      const secs = layerFreezeSeconds(thickness, waterTemp, s.env.pipeTempC, s.system);
      eta.textContent = `${Math.round(secs / 60)} 分钟`;
    };
    refreshEta();
    floodCard.append(
      slider('每层厚度', FLOOD.MIN_THICKNESS_MM, FLOOD.MAX_THICKNESS_MM, 0.5, thickness, 'mm', (v) => { thickness = v; refreshEta(); }),
      slider('水温', FLOOD.MIN_WATER_TEMP_C, FLOOD.MAX_WATER_TEMP_C, 1, waterTemp, '℃', (v) => { waterTemp = v; refreshEta(); }),
      slider('浇水平匀度', 0.5, 1, 0.01, uniformity, '', (v) => { uniformity = v; }),
      h('div', { class: 'kv', style: 'margin:6px 0 10px' }, h('span', {}, '预计冻结时间'), eta),
      h('button', {
        class: 'btn',
        onclick: () => { s.addFlood({ thicknessMm: thickness, waterTempC: waterTemp, uniformity }); this.rerender(); }
      }, '浇一层水')
    );
    this.el.append(floodCard);

    // 各层状态
    if (s.layers.length) {
      const list = h('div', { class: 'card' }, h('h3', {}, `冰层层数 ${s.layers.length}`, h('span', { class: 'tag' }, `总厚 ${fmt(s.totalIceMm)}mm`)));
      for (const l of [...s.layers].slice(-6).reverse()) {
        list.append(
          h('div', { style: 'margin-bottom:8px' },
            h('div', { class: 'kv' },
              h('span', {}, `${fmt(l.thicknessMm)}mm / ${l.waterTempC}℃`),
              h('b', {}, l.freezeFraction >= 1 ? '已冻透 ✓' : `冻结 ${(l.freezeFraction * 100).toFixed(1)}%`)),
            bar(l.freezeFraction, 'freeze')
          )
        );
      }
      this.el.append(list);
    }

    // ---------- 洒点 ----------
    const pebCard = h('div', { class: 'card' }, h('h3', {}, '② 倒退洒卵石点'));
    let pTemp = 48;
    let tankH = 0.4;
    let nozzle = 4;
    let walk = 1.2;
    const dropLabel = h('b', {}, '');
    const densLabel = h('b', {}, '');
    const refresh = () => {
      dropLabel.textContent = `${fmt(dropletDiameterMm(nozzle, tankH, pTemp), 2)}mm`;
      densLabel.textContent = `${Math.round(4000 * (1.2 / walk)).toLocaleString()} 颗/m²`;
    };
    refresh();
    pebCard.append(
      slider('洒点水温', PEBBLE.MIN_WATER_TEMP_C, PEBBLE.MAX_WATER_TEMP_C, 1, pTemp, '℃', (v) => { pTemp = v; refresh(); }),
      slider('水箱高度(水压)', PEBBLE.MIN_TANK_HT_M, PEBBLE.MAX_TANK_HT_M, 0.01, tankH, 'm', (v) => { tankH = v; refresh(); }),
      slider('喷头孔径', PEBBLE.MIN_NOZZLE_MM, PEBBLE.MAX_NOZZLE_MM, 1, nozzle, 'mm', (v) => { nozzle = v; refresh(); }),
      slider('倒退步速', PEBBLE.MIN_SPEED_MPS, PEBBLE.MAX_SPEED_MPS, 0.05, walk, 'm/s', (v) => { walk = v; refresh(); }),
      h('div', { class: 'kv', style: 'margin:6px 0 4px' }, h('span', {}, '水珠直径'), dropLabel),
      h('div', { class: 'kv', style: 'margin-bottom:10px' }, h('span', {}, '目标密度'), densLabel),
      h('button', {
        class: 'btn',
        onclick: () => { s.addPebble({ waterTempC: pTemp, tankHeightM: tankH, nozzleMm: nozzle, walkSpeedMps: walk }); this.rerender(); }
      }, s.pebbles.count > 0 ? '重新洒点(清除旧点)' : '执行洒点')
    );
    this.el.append(pebCard);

    // 卵石点冻结状态
    if (s.pebbles.count > 0) {
      const unfrozen = s.unfrozenPebbles();
      this.el.append(
        h('div', { class: 'card' },
          h('h3', {}, '卵石点状态'),
          h('div', { class: 'kv' },
            h('span', {}, '总点数'), h('b', {}, s.pebbles.count.toLocaleString())),
          h('div', { class: 'kv' },
            h('span', {}, '平均半径'), h('b', {}, `${fmt(s.avgPebbleRadiusMm, 2)}mm`)),
          h('div', { class: 'kv' },
            h('span', {}, '未冻透比例'), h('b', unfrozen > 0.05 ? { style: 'color:var(--warn)' } : {}, `${(unfrozen * 100).toFixed(1)}%`)),
          h('div', { class: 'kv' },
            h('span', {}, '当前接触面'), h('b', {}, `${(s.contactFraction * 100).toFixed(0)}%`))
        )
      );
    }

    // ---------- 刮冰 ----------
    const scrapeCard = h('div', { class: 'card' }, h('h3', {}, '③ 刮刀削顶'));
    let depth = 0.5;
    const dLabel = h('b', {}, `${depth}mm`);
    scrapeCard.append(
      slider('削顶深度', SCRAPE.MIN_DEPTH_MM, SCRAPE.MAX_DEPTH_MM, 0.05, depth, 'mm', (v) => { depth = v; dLabel.textContent = `${fmt(v, 2)}mm`; }),
      h('div', { style: 'height:6px' }),
      h('button', {
        class: 'btn warn',
        onclick: () => { s.scrape(depth); this.rerender(); }
      }, '刮一遍冰'),
      h('div', { class: 'hint', style: 'margin-top:8px' },
          '削顶 0.4~0.6mm 通常把接触面做到 30% 上下;削太深点被成片移除,冰面反而变涩。每次刮冰还会顺带去掉表层霜。')
    );
    this.el.append(scrapeCard);

    // ---------- 开赛 ----------
    if (s.phase.startsWith('prep')) {
      const reasons: string[] = [];
      if (s.totalIceMm < FLOOD.MIN_TOTAL_MM) reasons.push(`冰厚不足(当前 ${fmt(s.totalIceMm)}mm,需 ≥${FLOOD.MIN_TOTAL_MM}mm)`);
      if (s.totalIceMm > FLOOD.MAX_TOTAL_MM) reasons.push('冰厚超标');
      if (!s.allFrozen) reasons.push('仍有冰层未冻透');
      if (s.field.reliefMm() > 1.2) reasons.push(`高低差 ${fmt(s.field.reliefMm(), 2)}mm 超标`);
      if (s.pebbles.count < 20000) reasons.push('卵石点不足');
      if (s.unfrozenPebbles() >= 0.05) reasons.push('卵石点未冻硬');
      this.el.append(
        h('div', { class: 'card' },
          h('h3', {}, '交付比赛'),
          h('div', { class: 'hint', style: 'margin-bottom:10px' },
            reasons.length ? '未达标:' + reasons.join(';') : '冰面达标,可以开赛'),
          h('button', {
            class: `btn ${reasons.length ? '' : 'good'}`,
            disabled: reasons.length ? true : false,
            onclick: () => { s.startCompetition(); this.rerender(); }
          }, '开始比赛(10 局)')
        )
      );
    }
  }
}
