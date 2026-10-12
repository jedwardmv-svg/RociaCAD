/**
 * Punto de entrada de la interfaz.
 */
import './styles.css';
import * as THREE from 'three';
import {
  addNode,
  addPipe,
  addSprinkler,
  deleteNode,
  deletePipe,
  deleteSprinkler,
  emptyProject,
  exampleGrid,
  exampleWarehouse,
  fmt,
  FILE_FORMAT_VERSION,
  MATERIAL_IDS,
  MATERIALS,
  PIPE_ROLE_NAMES,
  sizeLabel,
  sizesFor,
  splitPipe,
  type MaterialId,
  type NominalSize,
  type PipeRole,
  type Project,
} from '../../core';
import { renderBottom } from './bottomPanel';
import { clear, h } from './dom';
import { flash, numInput, selectInput } from './fields';
import { renderInspector } from './inspector';
import { renderLeft } from './leftPanel';
import { buildReport } from './report';
import { store, type ColorMode, type Tool } from './state';
import { Viewer, type ViewName } from './viewer3d';

const $ = (id: string) => document.getElementById(id)!;
const desktop = window.rocia;
let appVersion = '0.1.0';

// ---------- Íconos (trazos simples, 16×16) ----------
const I = {
  new: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  open: '<path d="M2 4h4l1.5 1.5H14v7.5H2z"/>',
  save: '<path d="M3 2h8l2 2v10H3z"/><path d="M5 2v4h6V2M5 14v-4h6v4"/>',
  undo: '<path d="M5 3L2 6l3 3"/><path d="M2 6h7a4 4 0 010 8H6"/>',
  redo: '<path d="M11 3l3 3-3 3"/><path d="M14 6H7a4 4 0 000 8h3"/>',
  select: '<path d="M3 2l9 5-4 1.2L6.5 13z"/>',
  pipe: '<path d="M2 11h6V5h6"/><circle cx="2" cy="11" r="1.2"/><circle cx="14" cy="5" r="1.2"/>',
  head: '<path d="M8 2v5"/><path d="M5 7h6"/><path d="M8 7l-3 6M8 7l3 6M8 7v6"/>',
  pdf: '<path d="M4 2h5l3 3v9H4z"/><path d="M6 9h4M6 11.5h4"/>',
  fit: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  labels: '<path d="M2 4h8l4 4-4 4H2z"/>',
};
const svg = (paths: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`;

function iconBtn(icon: string, label: string, onclick: () => void, opts: { active?: boolean; disabled?: boolean; showLabel?: boolean; cls?: string; key?: string } = {}) {
  const b = h('button', {
    class: `btn${opts.active ? ' active' : ''}${opts.cls ? ' ' + opts.cls : ''}`,
    title: label,
    'aria-label': label,
    'aria-pressed': opts.active === undefined ? undefined : String(opts.active),
    disabled: opts.disabled,
    onclick,
  });
  b.innerHTML = svg(icon) + (opts.showLabel ? `<span>${label}</span>` : '');
  return b;
}

// ---------- Vista 3D ----------
const viewer = createViewer();

/** Si el equipo no puede abrir WebGL, la app sigue funcionando sin la vista 3D. */
function createViewer(): Viewer {
  try {
    return new Viewer($('viewport'));
  } catch (err) {
    console.error(err);
    $('viewport').append(
      h(
        'div',
        { style: 'color:#e8edf1;padding:60px 24px;text-align:center;max-width:520px;margin:0 auto' },
        h('p', { style: 'font-size:16px;font-weight:600' }, 'No se pudo iniciar la vista 3D en este equipo.'),
        h('p', null, 'El cálculo, las tablas y el reporte funcionan igual. Actualice el controlador de video para usar la vista 3D.'),
      ),
    );
    const stub = { renderer: { domElement: document.createElement('canvas') }, legend: [], legendTitle: '', view: '3d', snapshot: () => undefined };
    return new Proxy(stub, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => null) }) as unknown as Viewer;
  }
}

function rebuildViewer() {
  viewer.rebuild(store.project, store.result, store.colorMode, store.selection, store.showLabels);
  renderLegend();
}

function renderLegend() {
  const el = $('legend');
  if (!viewer.legend.length) return clear(el);
  clear(
    el,
    h('h3', null, viewer.legendTitle),
    h('ul', null, viewer.legend.map((l) => h('li', null, h('i', { style: `background:${l.color}` }), l.label))),
  );
}

// ---------- Barra superior ----------
function renderToolbar() {
  const tool = (t: Tool, icon: string, label: string) => iconBtn(icon, label, () => setTool(t), { active: store.tool === t, showLabel: true });
  const units = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Unidades' },
    (['metric', 'us'] as const).map((u) =>
      h(
        'button',
        {
          'aria-pressed': String(store.project.displayUnits === u),
          onclick: () => {
            if (store.project.displayUnits !== u) store.mutate((p) => (p.displayUnits = u));
          },
        },
        u === 'metric' ? 'Métrico' : 'US',
      ),
    ),
  );
  const colorSel = selectInput<ColorMode>(
    'Colorear tubería por',
    store.colorMode,
    [
      { value: 'material', label: 'Color: material' },
      { value: 'size', label: 'Color: diámetro' },
      { value: 'pressure', label: 'Color: presión' },
      { value: 'velocity', label: 'Color: velocidad' },
    ],
    'color-mode',
    (v) => {
      store.colorMode = v;
      rebuildViewer();
    },
  );
  colorSel.style.width = 'auto';
  colorSel.style.height = '30px';
  const mark = h('span', { class: 'brand' });
  mark.innerHTML =
    '<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="5" fill="#24303a"/><path d="M12 4v6" stroke="#e5484d" stroke-width="2.2" stroke-linecap="round"/><path d="M8 10.5h8" stroke="#e8edf1" stroke-width="1.8" stroke-linecap="round"/>' +
    [[6, 14], [9, 13.4], [12, 14.6], [15, 13.4], [18, 14], [7.5, 17.5], [12, 18.4], [16.5, 17.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="#5aa9e6"/>`).join('') +
    '</svg>RociaCAD';
  clear(
    $('toolbar'),
    mark,
    h(
      'div',
      { class: 'tb-group' },
      iconBtn(I.new, 'Nuevo proyecto', () => actions.new()),
      iconBtn(I.open, 'Abrir proyecto', () => actions.open()),
      iconBtn(I.save, 'Guardar proyecto', () => actions.save()),
    ),
    h(
      'div',
      { class: 'tb-group' },
      iconBtn(I.undo, 'Deshacer', () => store.undo(), { disabled: !store.canUndo }),
      iconBtn(I.redo, 'Rehacer', () => store.redo(), { disabled: !store.canRedo }),
    ),
    h('div', { class: 'tb-group' }, tool('select', I.select, 'Seleccionar'), tool('draw', I.pipe, 'Dibujar tubería'), tool('sprinkler', I.head, 'Rociador')),
    h(
      'div',
      { class: 'tb-group' },
      colorSel,
      iconBtn(
        I.labels,
        'Mostrar etiquetas',
        () => {
          store.showLabels = !store.showLabels;
          renderToolbar();
          rebuildViewer();
        },
        { active: store.showLabels },
      ),
    ),
    h('div', { class: 'tb-spacer' }),
    units,
    h('div', { class: 'tb-group' }, iconBtn(I.pdf, 'Exportar reporte PDF', () => actions.exportPdf(), { showLabel: true, cls: 'primary' })),
  );
}

function renderViewSwitch() {
  const names: [ViewName, string][] = [
    ['3d', '3D'],
    ['top', 'Planta'],
    ['front', 'Frente'],
    ['side', 'Lado'],
  ];
  clear(
    $('view-switch'),
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Vista' },
      names.map(([v, label]) => h('button', { 'aria-pressed': String(viewer.view === v), onclick: () => setView(v) }, label)),
    ),
    iconBtn(I.fit, 'Ajustar a la pantalla', () => viewer.fit(), { cls: 'outline small' }),
  );
}

function setView(v: ViewName) {
  viewer.setView(v);
  renderViewSwitch();
}

// ---------- Herramientas de dibujo ----------
interface DrawPoint {
  point: THREE.Vector3;
  nodeId?: string;
  pipeId?: string;
}
let drawStart: { nodeId: string; point: THREE.Vector3 } | null = null;
let drawElevation = 3.5 / 0.3048; // ft

function setTool(t: Tool) {
  store.setTool(t);
  drawStart = null;
  viewer.setPreview(null, null);
  $('viewport').classList.toggle('drawing', t !== 'select');
  renderToolbar();
  renderToolOptions();
  renderHint();
}

function renderToolOptions() {
  const el = $('tool-options');
  const d = store.drawDefaults;
  const u = store.project.displayUnits;
  const metric = u === 'metric';
  if (store.tool === 'draw') {
    clear(
      el,
      h('span', null, 'Tubo nuevo'),
      selectInput<NominalSize>('Diámetro', d.size, sizesFor(d.material).map((s) => ({ value: s, label: sizeLabel(s, metric) })), 'draw-size', (v) => (d.size = v)),
      selectInput<MaterialId>('Material', d.material, MATERIAL_IDS.map((m) => ({ value: m, label: MATERIALS[m].name })), 'draw-mat', (v) => {
        d.material = v;
        if (!sizesFor(v).includes(d.size)) d.size = sizesFor(v)[0];
        renderToolOptions();
      }),
      selectInput<PipeRole>('Función', d.role, (Object.keys(PIPE_ROLE_NAMES) as PipeRole[]).map((k) => ({ value: k, label: PIPE_ROLE_NAMES[k] })), 'draw-role', (v) => (d.role = v)),
      h('span', null, 'Elevación'),
      numInput({ label: 'Elevación de dibujo', q: 'elevation', value: drawStart ? store.project.nodes.find((n) => n.id === drawStart!.nodeId)?.z : drawElevation, key: 'draw-z', onCommit: (v) => (drawElevation = v) }),
      h('span', null, 'Paso'),
      numInput({ label: 'Paso de la cuadrícula', q: 'length', value: d.gridFt, key: 'draw-grid', min: 0, onCommit: (v) => (d.gridFt = v) }),
    );
  } else if (store.tool === 'sprinkler') {
    clear(el, h('span', null, 'Rociador nuevo'), h('span', null, 'K'), numInput({ label: 'Factor K', q: 'kfactor', value: d.k, key: 'draw-k', min: 0.1, onCommit: (v) => (d.k = v) }));
  } else {
    clear(el);
  }
}

function renderHint() {
  const hints: Record<Tool, string> = {
    select: 'Clic para seleccionar. Arrastre para girar, rueda para acercar, clic derecho para desplazar.',
    draw: drawStart
      ? 'Clic para el siguiente punto. Alt desactiva el ajuste a 45°. Esc o clic derecho termina.'
      : 'Clic en un nodo, un tubo o un punto vacío para empezar a dibujar.',
    sprinkler: 'Clic en un nodo o sobre un tubo para colocar un rociador.',
  };
  $('hint').textContent = hints[store.tool];
}

function nodeVec(id: string): THREE.Vector3 {
  const n = store.project.nodes.find((x) => x.id === id)!;
  return new THREE.Vector3(n.x, n.y, n.z);
}

/** Punto destino del dibujo con ajustes a nodos, tubos, 45° y cuadrícula. */
function drawTarget(ev: PointerEvent): DrawPoint | null {
  // 1) nodo cercano en pantalla
  let best: { id: string; d: number } | null = null;
  for (const n of store.project.nodes) {
    const s = viewer.toScreen(new THREE.Vector3(n.x, n.y, n.z));
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const d = Math.hypot(s.x - (ev.clientX - rect.left), s.y - (ev.clientY - rect.top));
    if (d < 12 && (!best || d < best.d)) best = { id: n.id, d };
  }
  if (best) return { point: nodeVec(best.id), nodeId: best.id };

  const grid = store.drawDefaults.gridFt;
  const snap = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);

  // 2) sobre un tubo existente (para hacer una tee)
  const hit = viewer.pick(ev);
  if (hit && hit.kind === 'pipe' && !drawStartOnPipe(hit.id)) {
    const pipe = store.project.pipes.find((p) => p.id === hit.id)!;
    const a = nodeVec(pipe.from);
    const b = nodeVec(pipe.to);
    const ab = b.clone().sub(a);
    const len = ab.length();
    let t = hit.point.clone().sub(a).dot(ab) / (len * len);
    t = grid > 0 ? snap(t * len) / len : t;
    t = Math.min(0.98, Math.max(0.02, t));
    return { point: a.clone().addScaledVector(ab, t), pipeId: pipe.id };
  }

  // 3) plano horizontal
  const z = drawStart ? drawStart.point.z : drawElevation;
  const p = viewer.planePoint(ev, z);
  if (!p) return null;
  if (!drawStart) return { point: new THREE.Vector3(snap(p.x), snap(p.y), z) };
  const d = p.clone().sub(drawStart.point);
  let ang = Math.atan2(d.y, d.x);
  let len = Math.hypot(d.x, d.y);
  if (!ev.altKey) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  len = snap(len);
  return { point: new THREE.Vector3(drawStart.point.x + len * Math.cos(ang), drawStart.point.y + len * Math.sin(ang), z) };
}

function drawStartOnPipe(pipeId: string) {
  if (!drawStart) return false;
  const p = store.project.pipes.find((x) => x.id === pipeId);
  return !!p && (p.from === drawStart.nodeId || p.to === drawStart.nodeId);
}

/** Convierte un punto de dibujo en un nodo (creándolo o dividiendo un tubo). */
function materialize(p: Project, t: DrawPoint): string {
  if (t.nodeId) return t.nodeId;
  if (t.pipeId) return splitPipe(p, t.pipeId, t.point.x, t.point.y, t.point.z)!.id;
  return addNode(p, t.point.x, t.point.y, t.point.z).id;
}

function onDrawClick(ev: PointerEvent) {
  const t = drawTarget(ev);
  if (!t) return;
  if (!drawStart) {
    let id = '';
    if (t.nodeId) id = t.nodeId;
    else store.mutate((p) => (id = materialize(p, t)));
    drawStart = { nodeId: id, point: nodeVec(id) };
  } else {
    if (t.nodeId === drawStart.nodeId || t.point.distanceTo(drawStart.point) < 1e-3) return;
    const connectsExisting = !!t.nodeId || !!t.pipeId;
    let endId = '';
    let pipeId = '';
    const from = drawStart.nodeId;
    const d = store.drawDefaults;
    store.mutate((p) => {
      endId = materialize(p, t);
      pipeId = addPipe(p, from, endId, { size: d.size, material: d.material, role: d.role }).id;
    });
    store.select({ kind: 'pipe', id: pipeId });
    drawStart = connectsExisting ? null : { nodeId: endId, point: nodeVec(endId) };
  }
  viewer.setPreview(null, null);
  renderHint();
  renderToolOptions();
}

function onSprinklerClick(ev: PointerEvent) {
  const hit = viewer.pick(ev);
  if (!hit) return;
  if (hit.kind === 'sprinkler') return store.select({ kind: 'sprinkler', id: hit.id });
  let sid = '';
  if (hit.kind === 'node') {
    const existing = store.project.sprinklers.find((s) => s.nodeId === hit.id);
    if (existing) return store.select({ kind: 'sprinkler', id: existing.id });
    store.mutate((p) => (sid = addSprinkler(p, hit.id, store.drawDefaults.k).id));
  } else {
    store.mutate((p) => {
      const node = splitPipe(p, hit.id, hit.point.x, hit.point.y, hit.point.z);
      if (node) sid = addSprinkler(p, node.id, store.drawDefaults.k).id;
    });
  }
  if (sid) store.select({ kind: 'sprinkler', id: sid });
}

const canvas = viewer.renderer.domElement;
let down: { x: number; y: number; button: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, button: e.button }));
canvas.addEventListener('pointerup', (e) => {
  if (!down || down.button !== e.button || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  down = null;
  if (e.button === 2) {
    if (store.tool === 'draw' && drawStart) {
      drawStart = null;
      viewer.setPreview(null, null);
      renderHint();
    }
    return;
  }
  if (e.button !== 0) return;
  if (store.tool === 'draw') return onDrawClick(e);
  if (store.tool === 'sprinkler') return onSprinklerClick(e);
  const hit = viewer.pick(e);
  store.select(hit ? { kind: hit.kind, id: hit.id } : null);
});
canvas.addEventListener('pointermove', (e) => {
  if (store.tool !== 'draw' || e.buttons) return;
  const t = drawTarget(e);
  viewer.setPreview(drawStart?.point ?? null, t?.point ?? null, !!t?.nodeId || !!t?.pipeId);
  if (t && drawStart) {
    const len = t.point.distanceTo(drawStart.point);
    $('hint').textContent = `Longitud ${fmt('length', len, store.project.displayUnits, true)}. Esc o clic derecho termina.`;
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Archivos ----------
function normalize(raw: unknown): Project {
  const p = raw as Project;
  if (!p || p.format !== 'rociacad' || !Array.isArray(p.nodes) || !Array.isArray(p.pipes)) {
    throw new Error('El archivo no es un proyecto de RociaCAD.');
  }
  if (p.version > FILE_FORMAT_VERSION) throw new Error('El archivo fue creado con una versión más nueva de RociaCAD.');
  const base = emptyProject();
  return {
    ...base,
    ...p,
    info: { ...base.info, ...p.info },
    criteria: { ...base.criteria, ...p.criteria },
    supply: { ...base.supply, ...p.supply },
    sprinklers: p.sprinklers ?? [],
    pipes: p.pipes.map((pp) => ({ ...pp, fittings: pp.fittings ?? [] })),
  };
}

async function confirmDiscard(): Promise<boolean> {
  if (!store.dirty) return true;
  if (desktop) {
    const r = await desktop.confirm({ message: 'El proyecto tiene cambios sin guardar.', detail: '¿Quiere descartarlos?', buttons: ['Descartar cambios', 'Cancelar'] });
    return r === 0;
  }
  return window.confirm('El proyecto tiene cambios sin guardar. ¿Descartarlos?');
}

function fileBaseName() {
  return (store.project.info.name || 'proyecto').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'proyecto';
}

const actions = {
  async new() {
    if (!(await confirmDiscard())) return;
    store.load(emptyProject());
    setTool('draw');
    viewer.fit();
  },
  async example(kind: 'tree' | 'grid') {
    if (!(await confirmDiscard())) return;
    store.load(kind === 'tree' ? exampleWarehouse() : exampleGrid());
    setTool('select');
    viewer.fit();
  },
  async open() {
    if (!(await confirmDiscard())) return;
    try {
      if (desktop) {
        const f = await desktop.openFile();
        if (!f) return;
        store.load(normalize(JSON.parse(f.content)), { path: f.path, name: f.name });
      } else {
        const f = await pickFile();
        if (!f) return;
        store.load(normalize(JSON.parse(await f.text())), { path: null, name: f.name });
      }
      setTool('select');
      viewer.fit();
      flash('Proyecto abierto');
    } catch (err) {
      flash(`No se pudo abrir: ${(err as Error).message}`);
    }
  },
  async save(asNew = false): Promise<boolean> {
    const content = JSON.stringify(store.project, null, 1);
    if (desktop) {
      const r = await desktop.saveFile({ path: asNew ? undefined : store.filePath ?? undefined, content, suggestedName: fileBaseName() });
      if (!r) return false;
      store.filePath = r.path;
      store.fileName = r.name;
    } else {
      download(new Blob([content], { type: 'application/json' }), `${fileBaseName()}.rcad`);
      store.fileName = `${fileBaseName()}.rcad`;
    }
    store.setDirty(false);
    flash('Proyecto guardado');
    return true;
  },
  async exportPdf() {
    store.recalcNow();
    const image = viewer.snapshot();
    buildReport($('print-root'), { image, version: appVersion });
    await document.fonts.ready;
    if (desktop) {
      const r = await desktop.exportPdf({ suggestedName: `Memoria de cálculo - ${fileBaseName()}` });
      if (r) flash('Reporte PDF guardado');
    } else {
      window.print();
    }
  },
};

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.rcad,application/json' });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

function download(blob: Blob, name: string) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function deleteSelection() {
  const s = store.selection;
  if (!s) return;
  if (s.kind === 'node' && s.id === store.project.supply.nodeId) return flash('El punto de suministro no se puede borrar');
  store.mutate((p) => {
    if (s.kind === 'pipe') deletePipe(p, s.id);
    else if (s.kind === 'node') deleteNode(p, s.id);
    else deleteSprinkler(p, s.id);
  });
  store.select(null);
}

// ---------- Menú y teclado ----------
desktop?.onMenu(async (action) => {
  switch (action) {
    case 'new':
      return actions.new();
    case 'open':
      return actions.open();
    case 'save':
      return actions.save();
    case 'save-as':
      return actions.save(true);
    case 'save-and-close':
      if (await actions.save()) desktop.closeAfterSave();
      return;
    case 'export-pdf':
      return actions.exportPdf();
    case 'example-tree':
      return actions.example('tree');
    case 'example-grid':
      return actions.example('grid');
    case 'undo':
      if (isTyping()) return document.execCommand('undo');
      return store.undo();
    case 'redo':
      if (isTyping()) return document.execCommand('redo');
      return store.redo();
    case 'view-3d':
      return setView('3d');
    case 'view-top':
      return setView('top');
    case 'view-fit':
      return viewer.fit();
    case 'about':
      return flash(`RociaCAD ${appVersion}. Software libre bajo licencia MIT.`);
  }
});

function isTyping() {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
}

window.addEventListener('keydown', (e) => {
  if (isTyping()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (store.tool === 'draw' && drawStart) {
      drawStart = null;
      viewer.setPreview(null, null);
      renderHint();
    } else if (store.tool !== 'select') setTool('select');
    else store.select(null);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelection();
  } else if (!desktop && mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (!desktop && mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  } else if (!desktop && mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    actions.save();
  } else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
  else if (!mod && e.key.toLowerCase() === 't') setTool('draw');
  else if (!mod && e.key.toLowerCase() === 'r') setTool('sprinkler');
});

// ---------- Barra de estado ----------
function renderStatus() {
  const p = store.project;
  const r = store.result;
  const u = p.displayUnits;
  const totalLen = r.ok ? Object.values(r.pipes).reduce((a, x) => a + x.lengthFt, 0) : 0;
  clear(
    $('status'),
    h('span', null, `${p.nodes.length} nodos`),
    h('span', null, `${p.pipes.length} tubos`),
    h('span', null, `${p.sprinklers.length} rociadores`),
    r.ok ? h('span', null, `${fmt('length', totalLen, u, true)} de tubería conectada`) : null,
    h('span', { class: 'spacer' }),
    h('span', null, store.fileName ?? 'Sin guardar'),
    h('span', null, `v${appVersion}`),
  );
}

// ---------- Suscripciones ----------
store.subscribe((why) => {
  if (why === 'selection') {
    viewer.applySelection(store.selection);
    renderInspector($('inspector'));
    renderBottom($('bottom'));
    return;
  }
  if (why === 'tool') return;
  if (why === 'project') {
    rebuildViewer();
    renderToolbar();
    renderInspector($('inspector'));
    renderStatus();
    return;
  }
  // result o file
  rebuildViewer();
  renderToolbar();
  renderLeft($('left'));
  renderInspector($('inspector'));
  renderBottom($('bottom'));
  renderStatus();
  renderToolOptions();
});

// ---------- Inicio ----------
async function start() {
  if (desktop) {
    try {
      appVersion = (await desktop.appInfo()).version;
    } catch {
      /* versión por defecto */
    }
  }
  store.load(exampleWarehouse());
  // Acceso para pruebas automáticas (solo si se abre con #debug)
  if (location.hash === '#debug') Object.assign(window, { rociaDebug: { store, viewer, actions, setTool, setView } });
  renderViewSwitch();
  setTool('select');
  viewer.fit();
}

start();
