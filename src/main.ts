import './style.css';
import { GameEngine, formatClock } from './game/engine';
import { IceRenderer } from './render/IceRenderer';
import { VENUES, getVenue, THICK_LAYER_WARN_MM, HEIGHT_NX, HEIGHT_NZ, SHEET_WIDTH_M, SHEET_LENGTH_M } from './game/config';
import type { GameState } from './game/types';

declare global {
  interface Window {
    __game?: GameEngine;
    __renderer?: IceRenderer | null;
  }
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function setText(id: string, text: string): void {
  $(id).textContent = text;
}

function fmtS(v: number): string {
  return v >= 90 ? '未到线' : `${v.toFixed(2)}s`;
}

const engine = new GameEngine();
let renderer: IceRenderer | null = null;

try {
  renderer = new IceRenderer($<HTMLCanvasElement>('glCanvas'));
} catch (err) {
  const box = $('webglError');
  box.hidden = false;
  $('webglErrorText').textContent = err instanceof Error ? err.message : String(err);
}
window.__game = engine;
window.__renderer = renderer;

/* ----------------------------- 页面切换 ----------------------------- */

function switchPage(page: string): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
  document.querySelectorAll<HTMLElement>('[data-page-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.pagePanel === page);
  });
  document.querySelectorAll<HTMLElement>('[data-aside]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.aside === page);
  });
  if (renderer) renderer.inspection = page === 'inspection';

  const titles: Record<string, [string, string]> = {
    operations: ['制冰作业 WebGL2', '分层浇水、冻透与几十万 Instanced Pebbles'],
    inspection: ['检测模式 · 红色 = 局部高差 > 1mm', '冰面高差标红与双道试滑'],
    environment: ['场馆环境联动', '湿度越过阈值后，霜层会实时压低冰速'],
    evaluation: ['赛事评价与局间演变', '冰速稳定、左右一致、走线正常共同决定评分']
  };
  const [kicker, title] = titles[page] ?? titles.operations;
  setText('stageKicker', kicker);
  setText('stageTitle', title);
}

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page ?? 'operations'));
});

/* ----------------------------- 场馆选择 ----------------------------- */

const venueSelect = $<HTMLSelectElement>('venueSelect');
for (const v of VENUES) {
  const opt = document.createElement('option');
  opt.value = v.id;
  opt.textContent = `${v.venue} · ${v.systemName}`;
  venueSelect.appendChild(opt);
}
venueSelect.value = engine.state.venueId;
venueSelect.addEventListener('change', () => {
  engine.setVenue(venueSelect.value);
  afterReset();
});

const venueCards = $('venueCards');
for (const v of VENUES) {
  const card = document.createElement('button');
  card.className = 'venue-card';
  card.style.setProperty('--vc', v.color);
  card.dataset.venue = v.id;
  card.innerHTML = `
    <h3>${v.venue}</h3>
    <p class="sys">${v.systemName}</p>
    <p>${v.coolant}</p>
    <p>${v.description}</p>
  `;
  card.addEventListener('click', () => {
    if (engine.state.venueId !== v.id) {
      engine.setVenue(v.id);
      venueSelect.value = v.id;
      afterReset();
    }
  });
  venueCards.appendChild(card);
}

function renderVenueSpec(): void {
  const v = getVenue(engine.state.venueId);
  $('venueSpec').innerHTML = `
    <h3>${v.venue}</h3>
    <div class="status-lines">
      <div><span>制冷系统</span><b>${v.systemName}</b></div>
      <div><span>载冷剂</span><b>${v.coolant}</b></div>
      <div><span>盘管热阻</span><b>${v.resistance.toFixed(3)} m²K/W</b></div>
      <div><span>默认结霜阈值</span><b>${v.frostThresholdPct}%</b></div>
      <div><span>观众容量</span><b>${v.crowdCapacity} 人</b></div>
    </div>
    <p class="hint">${v.description}</p>`;
  document.querySelectorAll<HTMLButtonElement>('.venue-card').forEach((c) => {
    c.classList.toggle('active', c.dataset.venue === v.id);
  });
}

/* ----------------------------- 控件绑定 ----------------------------- */

function bindRange(id: string, onInput: (value: number) => void): void {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('input', () => onInput(parseFloat(el.value)));
}

bindRange('floodThickness', (v) => {
  engine.updateFloodInput({ thicknessMm: v });
  setText('floodThicknessVal', `${v.toFixed(1)} mm`);
  updateFreezeEta();
});
bindRange('floodWater', (v) => {
  engine.updateFloodInput({ waterC: v });
  setText('floodWaterVal', `${v.toFixed(0)} °C`);
  updateFreezeEta();
});
bindRange('baseCut', (v) => {
  engine.updateScrapeInput({ cutMm: v });
  setText('baseCutVal', `${v.toFixed(2)} mm`);
});

bindRange('pebbleWater', (v) => {
  engine.updatePebbleInput({ waterC: v });
  setText('pebbleWaterVal', `${v.toFixed(0)}°C`);
  updatePebblePreview();
});
bindRange('tankHeight', (v) => {
  engine.updatePebbleInput({ tankHeightM: v });
  setText('tankHeightVal', `${v.toFixed(2)}m`);
  updatePebblePreview();
});
bindRange('nozzle', (v) => {
  engine.updatePebbleInput({ nozzleMm: v });
  setText('nozzleVal', `${v.toFixed(1)}mm`);
  updatePebblePreview();
});
bindRange('walkSpeed', (v) => {
  engine.updatePebbleInput({ walkSpeedMps: v });
  setText('walkSpeedVal', `${v.toFixed(2)}m/s`);
  updatePebblePreview();
});
bindRange('balance', (v) => {
  engine.updatePebbleInput({ balanceCm: v });
  setText('balanceVal', `${v.toFixed(0)}cm`);
  updatePebblePreview();
});

bindRange('heightExag', (v) => {
  if (renderer) renderer.heightExaggeration = v;
  setText('heightExagVal', `${v.toFixed(0)}×`);
});
bindRange('pebbleScale', (v) => {
  if (renderer) renderer.pebbleScale = v;
  setText('pebbleScaleVal', `${v.toFixed(1)}×`);
});

bindRange('envPipe', (v) => {
  engine.updateEnvironment({ pipeC: v });
  setText('envPipeVal', `${v.toFixed(1)}°C`);
  updateFreezeEta();
});
bindRange('roomSet', (v) => {
  engine.updateEnvironment({ roomSetC: v });
  setText('roomSetVal', `${v.toFixed(1)}°C`);
});
bindRange('frostThreshold', (v) => {
  engine.updateEnvironment({ frostThresholdPct: v });
  setText('frostThresholdVal', `${v.toFixed(0)}%`);
});
bindRange('dehumidifier', (v) => {
  engine.updateEnvironment({ dehumidifier: v });
  setText('dehumidifierVal', `${(v * 100).toFixed(0)}%`);
});
bindRange('crowd', (v) => {
  engine.updateEnvironment({ crowdPct: v });
  setText('crowdVal', `${(v * 100).toFixed(0)}%`);
});

$('addFloodBtn').addEventListener('click', () => engine.addFloodLayer());
$('scrapeBaseBtn').addEventListener('click', () => engine.scrapeBase());
$('startPebbleBtn').addEventListener('click', () => {
  engine.startPebbleWalk();
  if (renderer) renderer.uploadPebbles(engine.state);
  updateUI();
});
$('scrapePebbleBtn').addEventListener('click', () => {
  engine.scrapePebbles();
  if (renderer) renderer.uploadPebbles(engine.state);
  updateUI();
});
$('runTrialBtn').addEventListener('click', () => engine.runTrial());
$('completeEndBtn').addEventListener('click', () => {
  engine.completeEnd();
  syncControlValues();
  updateUI();
});
$('resetBtn').addEventListener('click', () => {
  engine.reset();
  afterReset();
});

document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const speed = Number(btn.dataset.speed);
    engine.setTimeScale(speed);
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => renderer?.setView((btn.dataset.view ?? 'panorama') as 'panorama' | 'top' | 'close'));
});

function syncControlValues(): void {
  const s = engine.state;
  const setRange = (id: string, value: number) => {
    const el = $<HTMLInputElement>(id);
    el.value = String(value);
  };
  setRange('floodThickness', s.flood.thicknessMm);
  setRange('floodWater', s.flood.waterC);
  setText('floodThicknessVal', `${s.flood.thicknessMm.toFixed(1)} mm`);
  setText('floodWaterVal', `${s.flood.waterC.toFixed(0)} °C`);
  setRange('baseCut', s.baseScrape.cutMm);
  setText('baseCutVal', `${s.baseScrape.cutMm.toFixed(2)} mm`);

  const p = s.pebbleInput;
  setRange('pebbleWater', p.waterC); setText('pebbleWaterVal', `${p.waterC.toFixed(0)}°C`);
  setRange('tankHeight', p.tankHeightM); setText('tankHeightVal', `${p.tankHeightM.toFixed(2)}m`);
  setRange('nozzle', p.nozzleMm); setText('nozzleVal', `${p.nozzleMm.toFixed(1)}mm`);
  setRange('walkSpeed', p.walkSpeedMps); setText('walkSpeedVal', `${p.walkSpeedMps.toFixed(2)}m/s`);
  setRange('balance', p.balanceCm); setText('balanceVal', `${p.balanceCm.toFixed(0)}cm`);

  setRange('envPipe', s.pipeC); setText('envPipeVal', `${s.pipeC.toFixed(1)}°C`);
  setRange('roomSet', s.roomSetC); setText('roomSetVal', `${s.roomSetC.toFixed(1)}°C`);
  setRange('frostThreshold', s.frostThresholdPct); setText('frostThresholdVal', `${s.frostThresholdPct.toFixed(0)}%`);
  setRange('dehumidifier', s.dehumidifier); setText('dehumidifierVal', `${(s.dehumidifier * 100).toFixed(0)}%`);
  setRange('crowd', s.crowdPct); setText('crowdVal', `${(s.crowdPct * 100).toFixed(0)}%`);
  venueSelect.value = s.venueId;
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.speed) === s.timeScale);
  });
  updateFreezeEta();
  updatePebblePreview();
}

function afterReset(): void {
  syncControlValues();
  renderVenueSpec();
  if (renderer) {
    renderer.uploadPebbles(engine.state);
    renderer.setView('panorama');
  }
  updateUI();
}

/* ----------------------------- 派生文本 ----------------------------- */

function updateFreezeEta(): void {
  const s = engine.state;
  const venue = getVenue(s.venueId);
  // 直接用 physics 公式的动态 import 会增加异步；这里通过添加层预览由引擎保持简单。
  const d = s.flood.thicknessMm / 1000;
  const deltaT = Math.max(2, -s.pipeC);
  const enthalpy = 4186 * Math.max(0, s.flood.waterC) + 334000;
  const eta = (1000 * d * enthalpy * (venue.resistance + d / (2 * 2.2))) / deltaT / 60;
  setText('freezeEta', `${eta.toFixed(1)} min`);
  setText('opPipeTemp', `${s.pipeC.toFixed(1)} °C`);
  const etaEl = $('freezeEta');
  etaEl.style.color = s.flood.thicknessMm >= THICK_LAYER_WARN_MM ? 'var(--yellow)' : 'var(--green)';
}

function updatePebblePreview(): void {
  const plan = engine.previewPebble();
  const items: Array<[string, string]> = [
    ['水珠粒径', `${plan.dropletMm.toFixed(2)} mm`],
    ['半球半径', `${plan.radiusMm.toFixed(2)} mm`],
    ['密度', `${Math.round(plan.densityPerM2)}/m²`],
    ['总点数', `${(plan.count / 10000).toFixed(1)} 万`],
    ['孔口流量', `${plan.flowMlPerS.toFixed(1)} mL/s`],
    ['喷幅 / 排数', `${plan.swathM.toFixed(2)}m / ${plan.laneCount}排`],
    ['走行时间', `${(plan.walkDurationS / 60).toFixed(1)} min`],
    ['液滴冻结', `${plan.freezeS.toFixed(1)} s`]
  ];
  $('pebblePreview').innerHTML = items
    .map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`)
    .join('');
}

function renderLayers(s: GameState): void {
  if (!s.layers.length) {
    $('layerList').innerHTML = `<p class="hint">还没有冰层。建议先浇 3 层 0.8–1.4mm 的薄水。</p>`;
    return;
  }
  $('layerList').innerHTML = s.layers.slice(0, 10).map((l) => {
    const pct = Math.min(100, (l.elapsedS / l.neededS) * 100);
    const bad = !l.completed && l.thicknessMm >= THICK_LAYER_WARN_MM;
    return `<div class="layer-row ${bad ? 'bad' : ''}">
      <div class="layer-head">
        <span>#${l.id} · ${l.thicknessMm.toFixed(1)}mm · ${l.waterC.toFixed(0)}°C</span>
        <span class="${l.completed ? 'done' : 'waiting'}">${l.completed ? '冻透' : `${pct.toFixed(0)}%`}</span>
      </div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="hint">需 ${(l.neededS / 60).toFixed(1)}min · 管温 ${l.pipeC.toFixed(0)}°C${bad ? ' · 厚层未透禁洒点' : ''}</div>
    </div>`;
  }).join('');
}

function renderPebbleStatus(s: GameState): void {
  const p = s.pebble;
  if (!s.pebbleData || !p.applied) {
    $('pebbleStatus').innerHTML = `<div><span>当前卵石层</span><b>尚未洒点</b></div>`;
    return;
  }
  $('pebbleStatus').innerHTML = `
    <div><span>批次 / 数量</span><b>#${p.batch} · ${(p.count / 10000).toFixed(1)}万</b></div>
    <div><span>实际密度</span><b>${Math.round(p.densityPerM2)}/m²</b></div>
    <div><span>削顶 / 余高</span><b>${p.cutMm.toFixed(2)} / ${p.remainingMm.toFixed(2)}mm</b></div>
    <div><span>接触圆半径</span><b>${p.contactRadiusMm.toFixed(2)}mm</b></div>
    <div><span>接触面积占比</span><b>${(p.contactFraction * 100).toFixed(2)}%</b></div>
    <div><span>均匀度</span><b>${p.uniformityPct.toFixed(1)}%</b></div>
    <div><span>左右密度</span><b>${Math.round(p.leftDensityPerM2)} / ${Math.round(p.rightDensityPerM2)}</b></div>
    <div><span>磨损系数 / 局龄</span><b>${p.wornFactor.toFixed(2)} / ${p.ageEnds}局</b></div>`;
}

function renderChecklist(s: GameState): void {
  const cert = s.certification;
  const html = cert.ready
    ? `<li class="good">关键制冰项目均在窗口内，可以交付比赛。</li>`
    : cert.reasons.map((r) => `<li class="bad">${r}</li>`).join('');
  $('certListOps').innerHTML = html;
  $('certListEval').innerHTML = html;
  const badge = $('certBadge');
  badge.textContent = s.ruined ? '赛道判废' : cert.ready ? '可比赛' : '待处理';
  badge.className = `badge ${s.ruined ? 'bad' : cert.ready ? 'good' : 'warn'}`;
}

function renderLogs(s: GameState): void {
  $('logList').innerHTML = s.logs.slice(0, 18).map((l) => `
    <div class="log-item ${l.level}">
      <time>${formatClock(l.clockS)}</time>
      ${l.text}
    </div>`).join('');
}

function renderInspection(s: GameState): void {
  const f = s.flatness;
  setText('flatMax', f.maxLocalDifferenceMm.toFixed(2));
  setText('flatP95', f.p95LocalDifferenceMm.toFixed(2));
  setText('redArea', `${f.redAreaPct.toFixed(1)}%`);
  setText('sideDiff', `${f.sideHeightDifferenceMm >= 0 ? '+' : ''}${f.sideHeightDifferenceMm.toFixed(2)}`);
  setText('rms', f.unevennessRmsMm.toFixed(2));

  const t = s.lastTrial;
  if (!t) {
    setText('trialMu', '--');
    setText('leftTime', '--'); setText('rightTime', '--'); setText('avgTime', '--');
    $('trialMessage').textContent = '调整卵石密度与削顶量后试滑。';
    $('trialQuick').textContent = '尚未试滑。';
    return;
  }
  setText('trialMu', t.mu.toFixed(4));
  setText('leftTime', fmtS(t.leftS));
  setText('rightTime', fmtS(t.rightS));
  setText('avgTime', fmtS(t.totalS));
  $('trialMessage').textContent = `${t.message} 平均评分 ${t.score.toFixed(0)}/100，偏移 ${t.driftCm.toFixed(1)}cm。`;
  $('trialQuick').textContent = `${fmtS(t.totalS)} · 偏移 ${t.driftCm.toFixed(1)}cm · μ=${t.mu.toFixed(4)}`;
}

function renderHud(s: GameState): void {
  setText('clockText', formatClock(s.clockS));
  setText('hudIceTemp', `${s.iceC.toFixed(1)}°C`);
  setText('hudRoomRh', `${s.roomC.toFixed(1)}°C / ${s.rhPct.toFixed(0)}%`);
  setText('hudFrost', `${(s.frost * 100).toFixed(0)}%`);
  setText('gaugeRoom', `${s.roomC.toFixed(1)}°C`);
  setText('gaugeRh', `${s.rhPct.toFixed(0)}%`);
  setText('gaugeDew', `${s.dewPointC.toFixed(1)}°C`);
  setText('gaugeIce', `${s.iceC.toFixed(1)}°C`);
  const pebbleN = s.pebbleDrawCount || (s.pebble.applied ? s.pebble.count : 0);
  setText('hudPebbles', pebbleN >= 10000 ? `${(pebbleN / 10000).toFixed(1)}万` : String(pebbleN));
  const phaseMap: Record<string, string> = {
    prep: '赛前制冰', 'between-ends': '局间补救', match: '比赛中', finished: '比赛结束', ruined: '赛道判废'
  };
  const phase = $('phaseBadge');
  phase.textContent = phaseMap[s.phase] ?? s.phase;
  phase.className = `badge ${s.phase === 'ruined' ? 'bad' : s.phase === 'finished' ? 'good' : ''}`;

  const ruinBanner = $('ruinBanner');
  ruinBanner.hidden = !s.ruined;
  if (s.ruined) setText('ruinBannerText', s.ruinReason);

  setText(
    'baseScrapeHint',
    `刮平遍数：${s.baseScrapePasses}。当前最大局部高差 ${s.flatness.maxLocalDifferenceMm.toFixed(2)}mm，标红面积 ${s.flatness.redAreaPct.toFixed(1)}%。`
  );

  const walkBtn = $<HTMLButtonElement>('startPebbleBtn');
  if (s.walk?.active) {
    const pct = (s.walk.elapsedS / s.walk.durationS) * 100;
    walkBtn.disabled = true;
    walkBtn.textContent = `倒退走行中 ${pct.toFixed(0)}%`;
    ($('walkProgressBar') as HTMLElement).style.width = `${pct}%`;
    $('walkHint').textContent = '实例按走行路径逐步出现；请保持速度和居中。';
  } else {
    walkBtn.disabled = false;
    walkBtn.textContent = s.pebble.batch > 1 || s.pebble.applied ? '重新背箱洒一批点' : '背上水箱，开始倒退洒点';
    ($('walkProgressBar') as HTMLElement).style.width = s.pebble.applied ? '100%' : '0%';
    $('walkHint').textContent = '参数会改变水珠粒径、流量、每平米密度和左右分布。';
  }

  const endBtn = $<HTMLButtonElement>('completeEndBtn');
  if (s.phase === 'finished') {
    endBtn.disabled = true;
    endBtn.textContent = '6 局已完成';
  } else if (s.phase === 'ruined') {
    endBtn.disabled = false;
    endBtn.textContent = `提交第 ${s.currentEnd} 局判废评分`;
  } else {
    endBtn.disabled = !!s.walk?.active;
    endBtn.textContent = `进行第 ${s.currentEnd} 局并提交评分`;
  }
}

function renderEndDots(s: GameState): void {
  $('endDots').innerHTML = Array.from({ length: s.totalEnds }, (_, i) => {
    const n = i + 1;
    const done = n <= s.reports.length;
    const current = n === s.currentEnd && s.phase !== 'finished';
    return `<span class="${done ? 'done' : ''} ${current ? 'current' : ''}">${done ? '✓' : n}</span>`;
  }).join('');
}

let lastReportSignature = '';
function renderReports(s: GameState): void {
  const signature = s.reports.map((r) => `${r.end}:${r.scores.total}`).join('|') + s.phase;
  if (signature === lastReportSignature) return;
  lastReportSignature = signature;

  $('reportList').innerHTML = s.reports.map((r) => {
    const scoreColor = r.scores.total >= 90 ? 'var(--green)' : r.scores.total >= 75 ? 'var(--cyan)' : r.scores.total >= 60 ? 'var(--yellow)' : 'var(--red)';
    const bars: Array<[string, number, string]> = [
      ['冰速', r.scores.speed, 'var(--cyan)'],
      ['一致', r.scores.symmetry, 'var(--blue)'],
      ['走线', r.scores.line, 'var(--green)'],
      ['冻透', r.scores.freeze, 'var(--warm)']
    ];
    return `<article class="report-card ${r.ruined ? 'ruined' : ''}">
      <div class="report-head">
        <h3>第 ${r.end} 局评价${r.ruined ? ' · 判废' : ''}</h3>
        <div class="score-ring" style="--score:${r.scores.total};--score-color:${scoreColor}"><b>${r.scores.total}</b></div>
      </div>
      <div class="score-bars">
        ${bars.map(([k, v, c]) => `<div>${k}<i style="--v:${v}%;--bar:${c}"></i></div>`).join('')}
      </div>
      <div class="report-stats">
        <span>平均冰速<b>${fmtS(r.iceSpeedS)}</b></span>
        <span>左 / 右<b>${fmtS(r.leftSpeedS)} / ${fmtS(r.rightSpeedS)}</b></span>
        <span>走线偏移<b>${r.driftCm.toFixed(1)} cm</b></span>
        <span>标红面积<b>${r.redAreaPct.toFixed(1)}%</b></span>
        <span>湿度 / 霜<b>${r.rhPct.toFixed(0)}% / ${r.frostPct.toFixed(0)}%</b></span>
        <span>卵石数<b>${(r.pebbleCount / 10000).toFixed(1)}万</b></span>
      </div>
      <p class="verdict" style="color:${scoreColor}">${r.verdict}</p>
      <ul>${r.recommendations.map((x) => `<li>${x}</li>`).join('')}</ul>
    </article>`;
  }).join('');

  const latest = s.reports[0];
  $('evalAdvice').innerHTML = latest
    ? latest.recommendations.map((x) => `<li>${x}</li>`).join('')
    : '<li>完成一局后，这里会出现比赛方反馈和局间补救建议。</li>';

  const finalBox = $('finalVerdict');
  if (s.phase === 'finished') {
    const avg = s.reports.reduce((a, r) => a + r.scores.total, 0) / Math.max(1, s.reports.length);
    finalBox.hidden = false;
    finalBox.innerHTML = `<h3>最终赛事评分：${avg.toFixed(1)} / 100</h3>
      <p>${avg >= 90 ? '六局冰速像节拍器一样稳定，两侧走线一致，你就是这座馆的金冰制冰师。' :
        avg >= 75 ? '比赛顺利完成；局间湿度和磨损控制仍有精进空间。' :
        avg >= 60 ? '比赛在抱怨中完成，下一次注意薄冻透、及时补点和除湿。' :
        '冰面未能达到正式比赛标准。先练习“薄水多层—检测—适度洒点—轻削顶”的循环。'}</p>`;
  } else {
    finalBox.hidden = true;
  }
}

function drawChart(s: GameState): void {
  const canvas = $<HTMLCanvasElement>('climateChart');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(148,197,255,.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 18 + (i * (h - 36)) / 4;
    ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(w - 10, y); ctx.stroke();
    ctx.fillStyle = 'rgba(145,169,189,.8)';
    ctx.font = '10px system-ui';
    ctx.fillText(`${90 - i * 17}`, 6, y + 3);
  }
  const data = s.history;
  if (data.length < 2) return;
  const xAt = (i: number) => 34 + (i / Math.max(1, data.length - 1)) * (w - 44);
  const yRh = (rh: number) => 18 + ((95 - clampNum(rh, 20, 95)) / 75) * (h - 36);
  const yFrost = (f: number) => h - 18 - clampNum(f, 0, 1) * (h - 36);

  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => i ? ctx.lineTo(xAt(i), yRh(d.rh)) : ctx.moveTo(xAt(i), yRh(d.rh)));
  ctx.stroke();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => i ? ctx.lineTo(xAt(i), yFrost(d.frost)) : ctx.moveTo(xAt(i), yFrost(d.frost)));
  ctx.stroke();

  ctx.strokeStyle = 'rgba(251,77,109,.7)';
  ctx.setLineDash([5, 4]);
  const thresholdY = yRh(s.frostThresholdPct);
  ctx.beginPath(); ctx.moveTo(34, thresholdY); ctx.lineTo(w - 10, thresholdY); ctx.stroke();
  ctx.setLineDash([]);
}

function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const heatSource = document.createElement('canvas');
heatSource.width = HEIGHT_NZ;
heatSource.height = HEIGHT_NX;
const heatCtx = heatSource.getContext('2d');

function drawHeatmap(s: GameState): void {
  const canvas = $<HTMLCanvasElement>('heatmap2d');
  const ctx = canvas.getContext('2d');
  if (!ctx || !heatCtx) return;
  const image = heatCtx.createImageData(HEIGHT_NZ, HEIGHT_NX);
  for (let iz = 0; iz < HEIGHT_NZ; iz++) {
    for (let ix = 0; ix < HEIGHT_NX; ix++) {
      const risk = s.risk[iz * HEIGHT_NX + ix] ?? 0;
      const t = clampNum(risk / 1.15, 0, 1);
      let r = 34, g = 211, b = 238;
      if (t < 0.55) {
        const k = t / 0.55;
        r = Math.round(34 + (251 - 34) * k);
        g = Math.round(211 + (191 - 211) * k);
        b = Math.round(238 + (36 - 238) * k);
      } else {
        const k = (t - 0.55) / 0.45;
        r = Math.round(251 + (251 - 251) * k);
        g = Math.round(191 + (77 - 191) * k);
        b = Math.round(36 + (109 - 36) * k);
      }
      const p = (ix * HEIGHT_NZ + iz) * 4;
      image.data[p] = r;
      image.data[p + 1] = g;
      image.data[p + 2] = b;
      image.data[p + 3] = risk > 1 ? 235 : 150;
    }
  }
  heatCtx.putImageData(image, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heatSource, 0, 0, canvas.width, canvas.height);

  const xTo = (z: number) => ((z + SHEET_LENGTH_M / 2) / SHEET_LENGTH_M) * canvas.width;
  const yTo = (x: number) => ((x + SHEET_WIDTH_M / 2) / SHEET_WIDTH_M) * canvas.height;
  ctx.strokeStyle = 'rgba(255,255,255,.38)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(103,232,249,.9)';
  for (const z of [-13.5, 13.5]) {
    ctx.beginPath(); ctx.moveTo(xTo(z), 0); ctx.lineTo(xTo(z), canvas.height); ctx.stroke();
  }
  ctx.setLineDash([]);

  if (s.lastTrial?.samples?.length) {
    const drawTrace = (samples: NonNullable<GameState['lastTrial']>['samples'], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      samples.forEach((p, i) => {
        const x = xTo(p.z);
        const y = yTo(p.x);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    drawTrace(s.lastTrial.rightSamples, 'rgba(251,191,36,.9)');
    drawTrace(s.lastTrial.samples, 'rgba(255,255,255,.95)');
  }
}

function updateUI(): void {
  const s = engine.state;
  engine.refreshCertification();
  renderHud(s);
  renderLayers(s);
  renderPebbleStatus(s);
  renderChecklist(s);
  renderLogs(s);
  renderInspection(s);
  renderEndDots(s);
  renderReports(s);
  renderVenueSpec();
  drawChart(s);
  drawHeatmap(s);
}

/* ----------------------------- 主循环 ----------------------------- */

syncControlValues();
renderVenueSpec();
updateUI();

let last = performance.now();
let uiAccumulator = 0;
let fpsFrames = 0;
let fpsLast = performance.now();
let lowFpsWindows = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  engine.tick(dt);

  if (renderer) {
    renderer.render(engine.state, now);
    // FPS 统计与自适应分辨率，保证大量实例时优先流畅。
    fpsFrames++;
    if (now - fpsLast >= 600) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
      engine.state.fps = fps;
      setText('hudFps', `${fps} / DPR ${renderer.effectiveDprScale.toFixed(2)}`);
      if (fps < 48) lowFpsWindows++;
      else lowFpsWindows = Math.max(0, lowFpsWindows - 1);
      if (lowFpsWindows >= 3) {
        const next = Math.max(0.82, renderer.effectiveDprScale - 0.12);
        renderer.setDprScale(next);
        lowFpsWindows = 0;
      }
      fpsFrames = 0;
      fpsLast = now;
    }
  } else {
    setText('hudFps', 'WebGL2 不可用');
  }

  uiAccumulator += dt;
  if (uiAccumulator > 0.16) {
    updateUI();
    uiAccumulator = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
