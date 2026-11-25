// UI 小组件
type HProps = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { style, class: cls, ...rest } = props;
  Object.assign(el, rest);
  if (cls) el.className = cls;
  if (typeof style === 'string') el.setAttribute('style', style);
  for (const c of children) {
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

export function slider(label: string, min: number, max: number, step: number,
  value: number, unit: string, onInput: (v: number) => void) {
  const val = h('span', { class: 'sv' }, [`${value}${unit}`]);
  const input = h('input', {
    type: 'range', min: String(min), max: String(max),
    step: String(step), value: String(value),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = `${v}${unit}`;
    onInput(v);
  });
  const row = h('label', { class: 'slider' }, [
    h('span', { class: 'sl' }, [label]),
    input,
    val,
  ]);
  return { row, input, set(v: number) { input.value = String(v); val.textContent = `${v}${unit}`; } };
}

export function btn(label: string, onClick: () => void, cls = '') {
  const b = h('button', { class: `btn ${cls}` }, [label]);
  b.addEventListener('click', onClick);
  return b;
}

export function stat(label: string, value: string, warn = false) {
  return h('div', { class: `stat ${warn ? 'warn' : ''}` }, [
    h('div', { class: 'stat-l' }, [label]),
    h('div', { class: 'stat-v' }, [value]),
  ]);
}

export function card(title: string, ...children: Node[]) {
  return h('section', { class: 'card' }, [
    h('h3', {}, [title]),
    ...children,
  ]);
}

export function toast(msg: string, kind: 'info' | 'warn' | 'bad' = 'info') {
  const box = document.getElementById('toast')!;
  const t = h('div', { class: `toast ${kind}` }, [msg]);
  box.append(t);
  setTimeout(() => {
    t.classList.add('fade');
    setTimeout(() => t.remove(), 500);
  }, 3200);
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
