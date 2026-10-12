/**
 * Campos de formulario que convierten unidades y registran cambios con deshacer.
 */
import { fromDisplay, QUANTITIES, toDisplay, unitLabel, type Quantity } from '../../core';
import { h, parseNum, round } from './dom';
import { store } from './state';

export interface NumFieldOpts {
  label: string;
  /** magnitud física; si se omite el número no tiene unidades */
  q?: Quantity;
  unit?: string;
  value: number | undefined;
  onCommit: (valueUS: number) => void;
  key: string;
  min?: number;
  max?: number;
  digits?: number;
  placeholder?: string;
  hint?: string;
  allowEmpty?: boolean;
  onClear?: () => void;
  disabled?: boolean;
}

export function numInput(o: NumFieldOpts): HTMLElement {
  const units = store.project.displayUnits;
  const digits = o.digits ?? (o.q ? QUANTITIES[o.q].digits[units] + (units === 'metric' ? 1 : 0) : 3);
  const shown = o.value === undefined ? '' : round(o.q ? toDisplay(o.q, o.value, units) : o.value, digits);
  const input = h('input', {
    type: 'text',
    inputMode: 'decimal',
    value: shown,
    placeholder: o.placeholder ?? '',
    'data-key': o.key,
    'aria-label': o.label,
    disabled: o.disabled,
  });
  const commit = () => {
    const raw = input.value.trim();
    if (raw === '' && o.allowEmpty) {
      if (o.value !== undefined) o.onClear?.();
      return;
    }
    const v = parseNum(raw);
    if (!Number.isFinite(v) || (o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
      input.value = shown;
      flash(`Valor no válido para ${o.label.toLowerCase()}`);
      return;
    }
    const us = o.q ? fromDisplay(o.q, v, units) : v;
    if (o.value === undefined || Math.abs(us - o.value) > 1e-12) o.onCommit(us);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.select();
    }
    if (e.key === 'Escape') {
      input.value = shown;
      input.blur();
    }
  });
  return h('label', { class: 'input-unit' }, input, h('em', null, o.unit ?? (o.q ? unitLabel(o.q, units) : '')));
}

export function numField(o: NumFieldOpts): HTMLElement {
  return h('div', { class: 'field', title: o.hint ?? '' }, h('span', null, o.label), numInput(o));
}

export function textField(label: string, value: string | undefined, key: string, onCommit: (v: string) => void, multiline = false): HTMLElement {
  const el = multiline
    ? h('textarea', { class: 'input-text', 'data-key': key, 'aria-label': label })
    : h('input', { class: 'input-text', type: 'text', 'data-key': key, 'aria-label': label });
  el.value = value ?? '';
  el.addEventListener('change', () => {
    if (el.value !== (value ?? '')) onCommit(el.value);
  });
  return h('div', { class: 'field wide' }, h('span', null, label), el);
}

export function selectField<T extends string>(
  label: string,
  value: T,
  options: { value: T; label: string }[],
  key: string,
  onCommit: (v: T) => void,
): HTMLElement {
  return h('div', { class: 'field select' }, h('span', null, label), selectInput(label, value, options, key, onCommit));
}

export function selectInput<T extends string>(
  label: string,
  value: T,
  options: { value: T; label: string }[],
  key: string,
  onCommit: (v: T) => void,
): HTMLSelectElement {
  const sel = h(
    'select',
    { 'data-key': key, 'aria-label': label },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  sel.addEventListener('change', () => onCommit(sel.value as T));
  return sel;
}

let toastTimer: number | undefined;
export function flash(msg: string) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}

/** Vuelve a renderizar un contenedor conservando el foco del campo activo. */
export function rerender(container: HTMLElement, build: () => void) {
  const active = document.activeElement as HTMLElement | null;
  const key = active && container.contains(active) ? active.getAttribute('data-key') : null;
  const scroll = container.scrollTop;
  build();
  container.scrollTop = scroll;
  if (key) {
    const again = container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (again) {
      again.focus();
      if (again instanceof HTMLInputElement) again.select();
    }
  }
}
