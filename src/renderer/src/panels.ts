/**
 * Paneles que se pueden ocultar (izquierdo, propiedades y tablas) para agrandar el área de diseño.
 * El estado se recuerda en este equipo.
 */
import { h } from './dom';

export type PanelId = 'left' | 'insp' | 'bottom';

const KEY = 'rociacad.panelesOcultos';
const NAMES: Record<PanelId, string> = { left: 'panel izquierdo', insp: 'panel de propiedades', bottom: 'tablas' };
const SHORTCUT: Record<PanelId, string> = { left: 'Ctrl+1', insp: 'Ctrl+2', bottom: 'Ctrl+3' };

let hidden = new Set<PanelId>();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) hidden = new Set(JSON.parse(raw) as PanelId[]);
} catch {
  /* sin almacenamiento: todo visible */
}

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...hidden]));
  } catch {
    /* no importa */
  }
};

// flechas: hacia dónde se mueve el panel al hacer clic
const ARROW = {
  left: { open: '<path d="M10 3L5 8l5 5"/>', closed: '<path d="M6 3l5 5-5 5"/>' },
  insp: { open: '<path d="M6 3l5 5-5 5"/>', closed: '<path d="M10 3L5 8l5 5"/>' },
  bottom: { open: '<path d="M3 6l5 5 5-5"/>', closed: '<path d="M3 10l5-5 5 5"/>' },
};

const buttons = new Map<PanelId, HTMLButtonElement>();

function apply() {
  const app = document.getElementById('app');
  if (!app) return;
  for (const id of ['left', 'insp', 'bottom'] as PanelId[]) {
    const off = hidden.has(id);
    app.classList.toggle(`${id}-hidden`, off);
    const b = buttons.get(id);
    if (b) {
      const label = `${off ? 'Mostrar' : 'Ocultar'} ${NAMES[id]} (${SHORTCUT[id]})`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', String(!off));
      b.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${off ? ARROW[id].closed : ARROW[id].open}</svg>`;
    }
  }
}

export function isPanelHidden(id: PanelId): boolean {
  return hidden.has(id);
}

export function togglePanel(id: PanelId, show?: boolean) {
  const off = show === undefined ? !hidden.has(id) : !show;
  if (off) hidden.add(id);
  else hidden.delete(id);
  save();
  apply();
}

/** Oculta todo para ver solo el diseño, o muestra todo si ya estaba así */
export function toggleAllPanels() {
  const all = (['left', 'insp', 'bottom'] as PanelId[]).every((id) => hidden.has(id));
  hidden = all ? new Set() : new Set(['left', 'insp', 'bottom']);
  save();
  apply();
}

/** Pone las pestañas de mostrar/ocultar en los bordes del área de diseño */
export function initPanels(stage: HTMLElement) {
  for (const id of ['left', 'insp', 'bottom'] as PanelId[]) {
    const b = h('button', { class: `panel-toggle ${id}`, type: 'button', onclick: () => togglePanel(id) });
    buttons.set(id, b);
    stage.append(b);
  }
  apply();
}
