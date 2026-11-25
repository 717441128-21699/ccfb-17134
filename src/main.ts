// 入口:装配仿真器、渲染器、四个页面与主循环
import './styles.css';
import { Renderer } from './render/renderer';
import { attachCamera } from './render/camera';
import { Simulation } from './sim/Simulation';
import { WorkPage } from './ui/work';
import { InspectPage } from './ui/inspect';
import { EnvPage } from './ui/environment';
import { EventPage } from './ui/event';
import { toast } from './ui/dom';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const panels = document.getElementById('panels')!;
const hud = document.getElementById('hud')!;

let sim = new Simulation();
let renderer = new Renderer(canvas, sim);
attachCamera(canvas, renderer);

const work = new WorkPage(() => sim, markDirty);
const inspect = new InspectPage(() => sim, () => renderer, markDirty);
const env = new EnvPage(() => sim, markDirty);
const eventPage = new EventPage(() => sim);
const pages = { work, inspect, env, event: eventPage };

for (const p of Object.values(pages)) panels.append(p.el);

let activeTab: keyof typeof pages = 'work';
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    activeTab = (t as HTMLElement).dataset.tab as keyof typeof pages;
    Object.entries(pages).forEach(([k, p]) => {
      p.el.classList.toggle('hidden', k !== activeTab);
    });
    markDirty();
  });
});

// 重新开局(换场馆/机组):热替换,保留页签与相机
window.addEventListener('sim-restart', ((e: CustomEvent) => {
  const { venueId, fridgeId } = e.detail;
  sim = new Simulation(venueId, fridgeId);
  renderer = new Renderer(canvas, sim);
  attachCamera(canvas, renderer);
  work.reattach(sim);
  inspect.reattach(sim, renderer);
  env.reattach(sim);
  eventPage.reattach(sim);
  markDirty();
  toast('已按新场馆/机组重新开局');
}) as EventListener);

let dirty = true;
function markDirty() { dirty = true; }

function updateHud() {
  const z = sim.zones;
  const hog = z.length ? z.reduce((s, x) => s + x.hogSeconds, 0) / z.length : 0;
  const phase: Record<string, string> = {
    build: '制冰中', maintenance: `第${sim.currentEnd}局`,
    end: '局间维护', finished: '已完赛',
  };
  hud.innerHTML = `
    <span class="hud-item">${phase[sim.phase]}</span>
    <span class="hud-item">冰速 <b>${hog.toFixed(1)}s</b></span>
    <span class="hud-item">卵石 <b>${(sim.pebCount / 10000).toFixed(1)}万</b></span>
    <span class="hud-item">湿度 <b class="${sim.env.rh > sim.env.frostThreshold ? 'alert' : ''}">${sim.env.rh.toFixed(0)}%</b></span>
    <span class="hud-item">FPS <b>${renderer.fps}</b></span>`;
}

let last = performance.now();
let uiAccum = 0;
function loop(now: number) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // 仿真时间按流速推进;单步不超过 10s,保证冻结/结霜积分稳定
  const total = realDt * env.timeScale;
  const steps = Math.max(1, Math.ceil(total / 10));
  for (let i = 0; i < steps; i++) sim.tick(total / steps);

  renderer.frame(realDt);
  updateHud();
  // 冻结完成、环境变化等仿真事件不产生 dirty,按 4Hz 定时刷新页面
  uiAccum += realDt;
  if (dirty || uiAccum >= 0.25) {
    work.refresh();
    inspect.refresh();
    env.refresh();
    eventPage.refresh();
    dirty = false;
    uiAccum = 0;
  }
  requestAnimationFrame(loop);
}

window.addEventListener('error', (e) => {
  toast(`运行错误:${e.message}`, 'bad');
});

// 调试/自动化钩子
Object.assign(window, { __sim: () => sim, __renderer: () => renderer });

requestAnimationFrame(loop);
markDirty();
