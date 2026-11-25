// 鼠标/触摸轨道相机
import type { Renderer } from './renderer';
import { clamp } from '../sim/rng';

export function attachCamera(canvas: HTMLCanvasElement, r: Renderer) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    r.cam.yaw += dx * 0.006;
    r.cam.pitch = clamp(r.cam.pitch + dy * 0.005, 0.08, 1.25);
    r.invalidateVisibility();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    r.cam.dist = clamp(r.cam.dist * (1 + Math.sign(e.deltaY) * 0.09), 8, 60);
    r.invalidateVisibility();
  }, { passive: false });
}
