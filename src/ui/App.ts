/** 应用外壳:四标签页 + WebGL 舞台 + 模拟时钟 + 右侧日志 */
import { Simulation } from '../engine/simulation';
import { Renderer } from '../engine/renderer';
import { h, fmt } from './dom';
import { OperationsPage } from './OperationsPage';
import { InspectionPage, type InspectionViewState } from './InspectionPage';
import { EnvironmentPage } from './EnvironmentPage';
import { EvaluationPage } from './EvaluationPage';

type TabId = 'ops' | 'inspect' | 'env' | 'score';
const TABS: Array<[TabId, string]> = [
  ['ops', '制冰作业'],
  ['inspect', '冰面检测'],
  ['env', '场馆环境'],
  ['score', '赛事评价']
];

export class App {
  private sim = new Simulation();
  private renderer!: Renderer;
  private canvas!: HTMLCanvasElement;
  private tab: TabId = 'ops';
  private opsPage!: OperationsPage;
  private inspectPage!: InspectionPage;
  private view: InspectionViewState = { heatmap: false, showRed: false, showPath: true };
  private envPage!: EnvironmentPage;
  private scorePage!: EvaluationPage;
  private leftHost!: HTMLElement;
  private rightHost!: HTMLElement;
  private hudHost!: HTMLElement;
  private fpsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private lastPebbleGeneration = -1;
  private lastPebbleCount = -1;
  private freezeUploadAcc = 0;
  private lastRedUpload = -1;
  private lastPathKey = '';
  private penaltySeen = 0;
  private raf = 0;
  private lastWall = performance.now();
  /** 画质档位:[预算实例数, 渲染缩放, 标签] */
  private qualityLevels: Array<[number, number, string]> = [
    [40000, 0.4, '标准'],
    [120000, 0.65, '高'],
    [0, 1.0, '全量']
  ];
  private qualityIdx = 0;

  mount(root: HTMLElement): void {
    root.append(this.skeleton());
    this.renderer = new Renderer(this.canvas);
    this.renderer.renderBudget = this.qualityLevels[0][0];
    this.renderer.renderScale = this.qualityLevels[0][1];
    this.opsPage = new OperationsPage(this.sim, () => this.rerender());
    this.inspectPage = new InspectionPage(this.sim, () => this.rerender(), this.view);
    this.envPage = new EnvironmentPage(this.sim, () => this.rerender());
    this.scorePage = new EvaluationPage(this.sim, () => this.rerender());
    this.bindCamera();
    this.rerender();
    this.loop();
  }

  /** 调试用:暴露仿真对象 */
  simForDebug(): Simulation {
    return this.sim;
  }
  /** 调试用:暴露渲染器 */
  rendererForDebug(): Renderer {
    return this.renderer;
  }

  private skeleton(): HTMLElement {
    const tabBar = h('div', { class: 'tabs' });
    for (const [id, label] of TABS) {
      tabBar.append(h('button', {
        class: `tab ${id === this.tab ? 'active' : ''}`,
        'data-tab': id,
        onclick: () => { this.tab = id; this.rerender(); }
      }, label));
    }

    this.canvas = h('canvas', {}) as HTMLCanvasElement;
    this.hudHost = h('div', { class: 'hud' });
    const tools = h('div', { class: 'stage-tools' },
      h('button', { id: 'btn-heat', onclick: () => { this.view.heatmap = !this.view.heatmap; this.rerender(); } }, '热图'),
      h('button', { id: 'btn-red', onclick: () => { this.view.showRed = !this.view.showRed; this.rerender(); } }, '红格'),
      h('button', { id: 'btn-path', onclick: () => { this.view.showPath = !this.view.showPath; this.rerender(); } }, '走线'),
      h('button', {
        id: 'btn-quality',
        onclick: () => {
          this.qualityIdx = (this.qualityIdx + 1) % this.qualityLevels.length;
          const [budget, scale] = this.qualityLevels[this.qualityIdx];
          this.renderer.renderBudget = budget;
          this.renderer.renderScale = scale;
          this.rerender();
        }
      }, `画质:${this.qualityLevels[0][2]}`));

    const speedBtns = h('div', { class: 'speed-btns' });
    for (const [label, sp] of [['⏸', 0], ['1×', 60], ['5×', 300], ['30×', 1800], ['120×', 7200]] as Array<[string, number]>) {
      speedBtns.append(h('button', {
        class: this.sim.speed === sp ? 'on' : '',
        onclick: () => { this.sim.speed = sp; this.rerender(); }
      }, label));
    }

    this.fpsEl = h('b', {}, '— FPS');
    this.statusEl = h('span', {});

    return h('div', { class: 'app' },
      h('header', { class: 'topbar' },
        h('h1', {}, '冰壶制冰师模拟器', h('small', {}, 'Ice Maker Sim · 物理制冰/洒点/刮冰')),
        tabBar,
        h('div', { class: 'sim-clock' },
          h('span', {}, '模拟时间 '),
          h('b', { id: 'sim-clock' }, '0min'),
          speedBtns)),
      h('main', { class: 'main' },
        (this.leftHost = h('div', { class: 'side' })),
        h('div', { class: 'stage' }, this.canvas, this.hudHost, tools),
        (this.rightHost = h('div', { class: 'side right' }))),
      h('footer', { class: 'statusbar' },
        this.statusEl,
        h('span', { style: 'margin-left:auto' }, this.fpsEl))
    );
  }

  private rerender(): void {
    // 标签高亮
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === this.tab);
    });
    // 左侧页
    this.leftHost.replaceChildren();
    if (this.tab === 'ops') {
      this.opsPage = new OperationsPage(this.sim, () => this.rerender());
      this.leftHost.append(this.opsPage.el);
    } else if (this.tab === 'inspect') {
      this.inspectPage = new InspectionPage(this.sim, () => this.rerender(), this.view);
      this.leftHost.append(this.inspectPage.el);
    } else if (this.tab === 'env') {
      this.envPage = new EnvironmentPage(this.sim, () => this.rerender());
      this.leftHost.append(this.envPage.el);
    } else {
      this.scorePage = new EvaluationPage(this.sim, () => this.rerender());
      this.leftHost.append(this.scorePage.el);
    }
    // 工具按钮态
    (document.getElementById('btn-heat') as HTMLButtonElement)?.classList.toggle('on', this.view.heatmap);
    (document.getElementById('btn-red') as HTMLButtonElement)?.classList.toggle('on', this.view.showRed);
    (document.getElementById('btn-path') as HTMLButtonElement)?.classList.toggle('on', this.view.showPath);
    const qBtn = document.getElementById('btn-quality') as HTMLButtonElement | null;
    if (qBtn) {
      qBtn.textContent = `画质:${this.qualityLevels[this.qualityIdx][2]}`;
      qBtn.classList.toggle('on', this.qualityIdx > 0);
    }
    document.querySelectorAll('.speed-btns button').forEach((b, i) => {
      const speeds = [0, 60, 300, 1800, 7200];
      b.classList.toggle('on', this.sim.speed === speeds[i]);
    });

    this.renderRight();
    this.renderHud();
  }

  private renderRight(): void {
    const s = this.sim;
    const card = h('div', { class: 'card' }, h('h3', {}, '作业日志'));
    const log = h('div', { class: 'log' });
    for (const e of s.log.slice(0, 40)) {
      log.append(h('div', { class: `row ${e.level}` },
        h('span', { class: 't' }, `${Math.round(e.atSimS / 60)}′`),
        document.createTextNode(e.text)));
    }
    card.append(log);

    const stateCard = h('div', { class: 'card' }, h('h3', {}, '冰面速览'));
    stateCard.append(
      h('div', { class: 'kv' }, h('span', {}, '阶段'), h('b', {}, s.phase)),
      h('div', { class: 'kv' }, h('span', {}, '冰厚'), h('b', {}, `${fmt(s.totalIceMm, 1)}mm`)),
      h('div', { class: 'kv' }, h('span', {}, '高低差'), h('b', s.field.reliefMm() > 1 ? { style: 'color:var(--bad)' } : {}, `${fmt(s.field.reliefMm(), 2)}mm`)),
      h('div', { class: 'kv' }, h('span', {}, '卵石点'), h('b', {}, s.pebbles.count.toLocaleString())),
      h('div', { class: 'kv' }, h('span', {}, '接触面'), h('b', {}, `${(s.contactFraction * 100).toFixed(0)}%`)),
      h('div', { class: 'kv' }, h('span', {}, '霜厚'), h('b', s.frostMm > 0.1 ? { style: 'color:var(--bad)' } : {}, `${fmt(s.frostMm, 3)}mm`)),
      h('div', { class: 'kv' }, h('span', {}, '冰温'), h('b', {}, `${fmt(s.env.iceTempC, 2)}℃`)),
      h('div', { class: 'kv' }, h('span', {}, '管温'), h('b', {}, `${fmt(s.env.pipeTempC, 2)}℃`))
    );
    this.rightHost.replaceChildren(stateCard, card);
  }

  private renderHud(): void {
    const s = this.sim;
    const chips: HTMLElement[] = [
      h('span', { class: 'chip' }, '冰厚 ', h('b', {}, `${fmt(s.totalIceMm, 1)}mm`)),
      h('span', { class: `chip ${s.field.reliefMm() > 1 ? 'bad' : ''}` }, '高低差 ', h('b', {}, `${fmt(s.field.reliefMm(), 2)}mm`)),
      h('span', { class: 'chip' }, '点 ', h('b', {}, s.pebbles.count.toLocaleString())),
      h('span', { class: 'chip' }, '接触面 ', h('b', {}, `${(s.contactFraction * 100).toFixed(0)}%`)),
      h('span', { class: `chip ${s.frostMm > 0.1 ? 'bad' : s.frostMm > 0.03 ? 'warn' : ''}` }, '霜 ', h('b', {}, `${fmt(s.frostMm, 3)}mm`)),
      h('span', { class: 'chip' }, '冰温 ', h('b', {}, `${fmt(s.env.iceTempC, 2)}℃`)),
      h('span', { class: 'chip' }, '湿度 ', h('b', {}, `${(s.env.rh * 100).toFixed(0)}%`))
    ];
    this.hudHost.replaceChildren(...chips);
  }

  private bindCamera(): void {
    const c = this.canvas;
    let dragging = false;
    let lx = 0;
    let ly = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      const scale = (50 / this.renderer.zoom) / c.clientWidth;
      this.renderer.camX -= dx * scale;
      this.renderer.camZ -= dy * scale;
    });
    c.addEventListener('pointerup', () => { dragging = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      this.renderer.zoom = Math.min(6, Math.max(0.4, this.renderer.zoom * factor));
    }, { passive: false });
  }

  /** O(1) 查询是否还有未冻透点(走仿真内部计数器,不扫描数组) */
  private hasUnfrozenPebbles(): boolean {
    return this.sim.pebbleCountUnfrozen() > 0;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const wallDt = Math.min(0.1, (now - this.lastWall) / 1000);
    this.lastWall = now;

    this.sim.advance(wallDt);

    // 新判废弹窗
    if (this.sim.penalties.length > this.penaltySeen) {
      this.penaltySeen = this.sim.penalties.length;
      this.rerender();
      this.flashPenalty(this.sim.penalties[this.penaltySeen - 1].reason);
    }

    // 纹理每帧上传(高度场很小:96×48)
    this.renderer.uploadField(this.sim.field);

    // 卵石点:结构变化立即重传;冻结进度只每 0.5s 刷一次(计数器 O(1),不扫数组)
    const gen = this.sim.pebbleBatches.length + this.sim.scrapes.length;
    const structureChanged =
      this.sim.pebbles.count !== this.lastPebbleCount || gen !== this.lastPebbleGeneration;
    this.freezeUploadAcc += wallDt;
    const frozenMoving = this.sim.env ? this.hasUnfrozenPebbles() : false;
    if (structureChanged || (frozenMoving && this.freezeUploadAcc >= 0.5)) {
      this.renderer.uploadPebbles(this.sim.pebbles);
      this.lastPebbleCount = this.sim.pebbles.count;
      this.lastPebbleGeneration = gen;
      this.freezeUploadAcc = 0;
    }

    // 红格:平整度变化时重算(限频)
    const reliefKey = Math.round(this.sim.field.reliefMm() * 20);
    if (this.view.showRed && reliefKey !== this.lastRedUpload) {
      this.renderer.uploadRedCells(this.sim.field, 1);
      this.lastRedUpload = reliefKey;
    }

    // 走线:最近一次试滑
    const lastTwo = this.sim.testStones.slice(-2);
    const pathKey = lastTwo.map((r) => `${r.atSimS}-${r.direction}`).join('|');
    if (pathKey !== this.lastPathKey && lastTwo.length) {
      this.renderer.setPath(lastTwo[lastTwo.length - 1].path);
      this.lastPathKey = pathKey;
    }

    this.renderer.render(
      this.sim.pebbles,
      {
        heatmap: this.view.heatmap || this.tab === 'inspect',
        showPebbles: true,
        showLines: true,
        showRedCells: this.view.showRed
      },
      this.sim.field.reliefMm(),
      this.view.showPath,
      this.view.showRed
    );

    // HUD/时钟低频刷新;侧栏面板每 400ms 重建一次以反映冻结/霜等连续变化
    this.fpsEl.textContent = `${this.renderer.fps.toFixed(0)} FPS`;
    this.fpsEl.className = this.renderer.fps >= 55 ? 'fps-ok' : 'fps-bad';
    const clock = document.getElementById('sim-clock');
    if (clock) clock.textContent = `${Math.round(this.sim.simS / 60)}min`;
    this.statusEl.textContent = this.sim.statusLine();
    const tick250 = Math.floor(now / 250) !== Math.floor((now - wallDt * 1000) / 250);
    if (tick250) {
      this.renderHud();
      // 侧栏面板 1s 重建一次(冻结/霜等连续变化),避免高频 DOM 重建拖累帧率
      if (Math.floor(now / 1000) !== Math.floor((now - wallDt * 1000) / 1000)) {
        this.rerender();
      }
    }
  };

  private flashPenalty(reason: string): void {
    const toast = h('div', {
      style: 'position:absolute;left:50%;top:18px;transform:translateX(-50%);background:rgba(120,20,20,0.92);border:1px solid #ef5b5b;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:9;'
    }, `⛔ 判废:${reason}`);
    document.querySelector('.stage')?.append(toast);
    setTimeout(() => toast.remove(), 4200);
  }
}
