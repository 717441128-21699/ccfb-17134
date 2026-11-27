/** 极简 DOM 构建辅助 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') {
      el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    } else if (typeof v === 'boolean') {
      // 布尔属性(如 disabled/checked):true 才设置,false 必须完全省略
      if (v && k in el) (el as unknown as Record<string, boolean>)[k] = true;
    } else if (k === 'class') {
      el.className = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  unit: string,
  onInput: (v: number) => void
): HTMLDivElement {
  const val = h('b', {}, `${value}${unit}`);
  const input = h('input', { type: 'range', min, max, step, value }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = `${v}${unit}`;
    onInput(v);
  });
  return h('div', { class: 'field' }, h('label', {}, document.createTextNode(label), val), input);
}

export function bar(fraction: number, extraClass = ''): HTMLDivElement {
  const inner = h('i', { style: `width:${Math.max(0, Math.min(1, fraction)) * 100}%` });
  return h('div', { class: `bar ${extraClass}` }, inner);
}

export function kv(key: string, value: string, danger = false): HTMLDivElement {
  return h('div', { style: 'display:contents' },
    h('span', {}, key),
    h('b', danger ? { style: 'color:var(--bad)' } : {}, value)
  ) as unknown as HTMLDivElement;
}

export function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
