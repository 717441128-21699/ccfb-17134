import './ui/styles.css';
import { App } from './ui/App';
import type { Simulation } from './engine/simulation';

declare global {
  interface Window {
    __sim?: Simulation;
    __appRenderer?: unknown;
  }
}

const root = document.getElementById('app');
if (!root) throw new Error('缺少 #app 挂载点');

try {
  const app = new App();
  app.mount(root);
  window.__sim = app.simForDebug();
  window.__appRenderer = app.rendererForDebug();
} catch (err) {
  root.innerHTML = `<div style="padding:40px;color:#ef5b5b;font-family:sans-serif">
    <h2>启动失败</h2><pre style="white-space:pre-wrap">${(err as Error).message}</pre>
    <p>请使用支持 WebGL2 的现代浏览器(Chrome/Edge/Firefox)。</p></div>`;
  console.error(err);
}
