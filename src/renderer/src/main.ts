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
  areaBox,
  pickAreaAt,
  type AreaBox,
  deleteItems,
  emptyItems,
  fillRoom,
  getSprinklerModel,
  planGrid,
  spacingLimits,
  exampleGrid,
  exampleWarehouse,
  fmt,
  FILE_FORMAT_VERSION,
  addElement,
  applySprinklerModel,
  deleteElement,
  ELEMENT_KIND_SHAPE,
  isVectorPlan,
  PIPE_ROLE_NAMES,
  pruneProjectCatalog,
  putInProjectCatalog,
  sizeLabel,
  sizesFor,
  splitPipe,
  type MaterialId,
  type NominalSize,
  type PipeRole,
  type Project,
  type ProjectFile,
  type AttachedData,
} from '../../core';
import { renderBottom } from './bottomPanel';
import { openCatalog } from './catalogDialog';
import { adoptFromProject, catalogElements, catalogMaterials, catalogSprinklers, findElementType, findMaterial, findSprinklerModel } from './catalogStore';
import { buildDxf } from '../../core';
import { clear, h } from './dom';
import { flash, numInput, selectInput } from './fields';
import { editHooks, renderInspector } from './inspector';
import { designHooks, renderLeft } from './leftPanel';
import { buildReport } from './report';
import { planHooks } from './planPanel';
import { buildFabricationSheet, fabricationHooks } from './fabrication';
import { initPanels, togglePanel, toggleAllPanels } from './panels';
import { selectionFrom, store, toggleInSelection, type ColorMode, type LabelMode, type Tool } from './state';
import { createUnderlay, loadAsset, pickPlanFile, setMaxTexture, type UnderlayAsset } from './underlay';
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
  wall: '<path d="M2 13V5h12v8"/><path d="M2 9h12M6 5v4M10 9v4"/>',
  fill: '<rect x="2" y="2" width="12" height="12" rx="1"/><circle cx="5" cy="5" r=".9"/><circle cx="11" cy="5" r=".9"/><circle cx="5" cy="11" r=".9"/><circle cx="11" cy="11" r=".9"/>',
  book: '<path d="M3 3h4a2 2 0 012 2v9a2 2 0 00-2-2H3z"/><path d="M13 3H9a2 2 0 00-2 2"/><path d="M13 3v9H9"/>',
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
  viewer.rebuild(store.project, store.result, store.colorMode, store.selection, store.labelMode);
  syncUnderlay();
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
  const labelSel = selectInput<LabelMode>(
    'Etiquetas en el dibujo',
    store.labelMode,
    [
      { value: 'none', label: 'Sin etiquetas' },
      { value: 'names', label: 'Etiquetas: nombres' },
      { value: 'results', label: 'Etiquetas: resultados' },
      { value: 'pieces', label: 'Etiquetas: piezas de corte' },
    ],
    'label-mode',
    (v) => {
      store.labelMode = v;
      rebuildViewer();
    },
  );
  labelSel.style.width = 'auto';
  labelSel.style.height = '30px';
  labelSel.title = 'Nombres: nodos, tubos y rociadores. Resultados: presión en uniones, presión y caudal de los rociadores abiertos, diámetro y caudal de los tubos.';
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
    h(
      'div',
      { class: 'tb-group' },
      tool('select', I.select, 'Seleccionar'),
      tool('draw', I.pipe, 'Tubería'),
      tool('sprinkler', I.head, 'Rociador'),
      tool('fill', I.fill, 'Llenar recinto'),
      tool('element', I.wall, 'Elementos'),
      iconBtn(I.book, 'Catálogo', () => openCatalog(), { showLabel: true }),
    ),
    h(
      'div',
      { class: 'tb-group' },
      colorSel,
      labelSel,
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
  onPlan?: boolean;
  nodeId?: string;
  pipeId?: string;
}
let drawStart: { nodeId: string; point: THREE.Vector3 } | null = null;
let drawElevation = 3.5 / 0.3048; // ft

function setTool(t: Tool) {
  store.setTool(t);
  drawStart = null;
  measure = { a: null, b: null };
  elementPts = [];
  elementId = null;
  fillStart = null;
  vector.a = null;
  areaTool = t === 'area' ? startAreaTool() : null;
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
      selectInput<NominalSize>('Diámetro', d.size, drawSizes().map((s) => ({ value: s, label: sizeLabel(s, metric) })), 'draw-size', (v) => (d.size = v)),
      selectInput<MaterialId>('Material', d.material, catalogMaterials().map((m) => ({ value: m.id, label: m.name })), 'draw-mat', (v) => {
        d.material = v;
        if (!drawSizes().includes(d.size)) d.size = drawSizes()[0];
        renderToolOptions();
      }),
      selectInput<PipeRole>('Función', d.role, (Object.keys(PIPE_ROLE_NAMES) as PipeRole[]).map((k) => ({ value: k, label: PIPE_ROLE_NAMES[k] })), 'draw-role', (v) => (d.role = v)),
      h('span', null, 'Elevación'),
      numInput({ label: 'Elevación de dibujo', q: 'elevation', value: drawStart ? store.project.nodes.find((n) => n.id === drawStart!.nodeId)?.z : drawElevation, key: 'draw-z', onCommit: (v) => (drawElevation = v) }),
      h('span', null, 'Paso'),
      numInput({ label: 'Paso de la cuadrícula', q: 'length', value: d.gridFt, key: 'draw-grid', min: 0, onCommit: (v) => (d.gridFt = v) }),
    );
  } else if (store.tool === 'calibrate') {
    if (measure.a && measure.b) {
      const measured = measure.a.distanceTo(measure.b);
      let real = measured;
      const input = numInput({ label: 'Distancia real', q: 'length', value: measured, key: 'cal-real', min: 1e-6, onCommit: (v) => (real = v) });
      const apply = () => {
        (input.querySelector('input') as HTMLInputElement).dispatchEvent(new Event('change'));
        applyCalibration(measured, real);
      };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && setTimeout(apply));
      clear(
        el,
        h('span', null, `Medida en el plano: ${fmt('length', measured, u, true)}. Distancia real`),
        input,
        h('button', { class: 'btn primary small', onclick: apply }, 'Aplicar escala'),
        h('button', { class: 'btn outline small', onclick: () => setTool('select') }, 'Cancelar'),
      );
      setTimeout(() => (input.querySelector('input') as HTMLInputElement)?.select());
    } else {
      clear(el, h('span', null, measure.a ? 'Calibrar escala: marque el segundo punto' : 'Calibrar escala: marque el primer punto de una medida conocida'), h('button', { class: 'btn outline small', onclick: () => setTool('select') }, 'Cancelar'));
    }
  } else if (store.tool === 'move-plan') {
    clear(el, h('span', null, measure.a ? 'Mover plano: marque a dónde debe ir ese punto' : 'Mover plano: marque un punto del plano'), h('button', { class: 'btn outline small', onclick: () => setTool('select') }, 'Cancelar'));
  } else if (store.tool === 'sprinkler') {
    clear(
      el,
      h('span', null, 'Rociador nuevo'),
      selectInput<string>('Modelo', d.sprinklerModelId, catalogSprinklers().map((m) => ({ value: m.id, label: m.name })), 'draw-spk', (v) => (d.sprinklerModelId = v)),
      h('button', { class: 'btn outline small', onclick: () => openCatalog('sprinklers') }, 'Catálogo'),
    );
  } else if (store.tool === 'fill') {
    const f = d.fill;
    const model = findSprinklerModel(d.sprinklerModelId);
    const upright = model?.orientation === 'upright';
    clear(
      el,
      h('span', null, 'Rociador'),
      selectInput<string>('Modelo', d.sprinklerModelId, catalogSprinklers().map((m) => ({ value: m.id, label: m.name })), 'fill-spk', (v) => {
        d.sprinklerModelId = v;
        renderToolOptions();
      }),
      h('span', null, 'Ramales en'),
      selectInput<'x' | 'y'>('Dirección de los ramales', f.direction, [{ value: 'x', label: 'Horizontal' }, { value: 'y', label: 'Vertical' }], 'fill-dir', (v) => (f.direction = v)),
      selectInput<typeof f.piping>(
        'Tubería',
        f.piping,
        [
          { value: 'branches-main', label: 'Ramales y matriz' },
          { value: 'branches', label: 'Solo ramales' },
          { value: 'none', label: 'Solo rociadores' },
        ],
        'fill-piping',
        (v) => {
          f.piping = v;
          renderToolOptions();
        },
      ),
      f.piping === 'branches-main'
        ? selectInput<'start' | 'end'>(
            'Lado de la matriz',
            f.mainSide,
            [
              { value: 'start', label: f.direction === 'x' ? 'Matriz a la izquierda' : 'Matriz abajo' },
              { value: 'end', label: f.direction === 'x' ? 'Matriz a la derecha' : 'Matriz arriba' },
            ],
            'fill-side',
            (v) => (f.mainSide = v),
          )
        : null,
      h('span', null, 'Altura tubería'),
      numInput({ label: 'Altura de los ramales', q: 'elevation', value: f.pipeZ, key: 'fill-z', onCommit: (v) => (f.pipeZ = v) }),
      h('span', null, 'Bajante'),
      numInput({
        label: 'Largo del bajante',
        q: 'length',
        value: upright ? 0 : f.dropFt,
        key: 'fill-drop',
        min: 0,
        disabled: upright,
        hint: 'Los rociadores montantes van sobre el ramal, sin bajante',
        onCommit: (v) => (f.dropFt = v),
      }),
      h(
        'label',
        { class: 'check', title: 'Diámetros mínimos de la tabla de NFPA 13 según los rociadores que alimenta cada tubo' },
        (() => {
          const c = h('input', { type: 'checkbox', checked: f.bySchedule, 'data-key': 'fill-sched' });
          c.addEventListener('change', () => (f.bySchedule = c.checked));
          return c;
        })(),
        'Diámetros por tabla',
      ),
    );
  } else if (store.tool === 'element') {
    const types = catalogElements();
    if (!types.some((t) => t.id === d.elementTypeId)) d.elementTypeId = types[0].id;
    const t = findElementType(d.elementTypeId)!;
    const zLabel = t.kind === 'beam' ? 'Fondo' : t.kind === 'duct' || t.kind === 'pipe-ref' ? 'Eje a' : t.kind === 'ceiling' ? 'Altura' : 'Base';
    clear(
      el,
      h('span', null, 'Elemento'),
      selectInput<string>('Tipo de elemento', d.elementTypeId, types.map((x) => ({ value: x.id, label: x.name })), 'draw-el', (v) => {
        d.elementTypeId = v;
        elementPts = [];
        elementId = null;
        viewer.setPreview(null, null);
        renderToolOptions();
        renderHint();
      }),
      h('span', null, zLabel),
      numInput({ label: 'Elevación del elemento', q: 'elevation', value: d.elementZ, key: 'draw-elz', onCommit: (v) => (d.elementZ = v) }),
      h('button', { class: 'btn outline small', onclick: () => openCatalog('elements') }, 'Catálogo'),
    );
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
    fill: fillStart
      ? 'Clic en la esquina opuesta del recinto. Esc cancela.'
      : 'Clic en una esquina del recinto (se ajusta a las líneas del plano y a los muros). La matriz se une sola a un tubo o nodo cercano.',
    element: elementHint(),
    calibrate:
      store.project.underlay && isVectorPlan(store.project.underlay.kind)
        ? 'El cursor se ajusta a los extremos de las líneas del plano. Esc cancela.'
        : 'Acerque la vista y haga clic con precisión en los dos puntos. Esc cancela.',
    'move-plan': 'El destino se ajusta a los nodos del sistema. Esc cancela.',
    area: 'Mueva el rectángulo sobre la zona más remota y haga clic para abrir esos rociadores. Esc cancela.',
    'pick-vector': vector.a ? 'Clic en el punto de destino. Esc cancela.' : 'Clic en el punto base (se ajusta a los nodos y al plano). Esc cancela.',
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

  // 3) extremos y vértices del plano DXF
  const z = drawStart ? drawStart.point.z : drawElevation;
  const ps = viewer.underlaySnap(ev);
  if (ps) return { point: new THREE.Vector3(ps.x, ps.y, z), onPlan: true };

  // 4) plano horizontal
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
      const mat = findMaterial(d.material);
      if (mat) putInProjectCatalog(p, 'materials', mat);
      pipeId = addPipe(p, from, endId, { size: d.size, material: d.material, role: d.role }).id;
    });
    store.select({ kind: 'pipe', id: pipeId });
    drawStart = connectsExisting ? null : { nodeId: endId, point: nodeVec(endId) };
  }
  viewer.setPreview(null, null);
  renderHint();
  renderToolOptions();
}

/** Pone un rociador del modelo elegido en un nodo y devuelve su id */
function placeSprinkler(p: Project, nodeId: string): string {
  const s = addSprinkler(p, nodeId, 5.6);
  const model = findSprinklerModel(store.drawDefaults.sprinklerModelId);
  if (model) {
    putInProjectCatalog(p, 'sprinklers', model);
    applySprinklerModel(s, model);
  }
  return s.id;
}

/** Diámetros disponibles para el material elegido en la herramienta de tubería */
function drawSizes(): NominalSize[] {
  const m = findMaterial(store.drawDefaults.material);
  return m ? sizesFor(m.id, { catalog: { materials: [m] } }) : sizesFor('steel-sch40');
}

// ---------- Elementos del edificio ----------
let elementPts: THREE.Vector3[] = [];
let elementId: string | null = null;

function elementHint(): string {
  const t = findElementType(store.drawDefaults.elementTypeId);
  const shape = t ? ELEMENT_KIND_SHAPE[t.kind] : 'line';
  if (shape === 'point') return 'Clic donde va cada columna. Esc termina.';
  if (shape === 'area') return elementPts.length ? 'Clic en cada esquina. Clic en el primer punto, Enter o clic derecho para cerrar.' : 'Clic en la primera esquina.';
  return elementPts.length ? 'Clic para el siguiente punto. Alt desactiva el ajuste a 45°. Esc o clic derecho termina.' : 'Clic en el punto de inicio.';
}

function endElement() {
  const t = findElementType(store.drawDefaults.elementTypeId);
  if (t && ELEMENT_KIND_SHAPE[t.kind] === 'area' && elementPts.length >= 3) closeArea();
  elementPts = [];
  elementId = null;
  viewer.setPreview(null, null);
  renderHint();
}

function closeArea() {
  const pts = elementPts.map((v) => ({ x: v.x, y: v.y }));
  const type = findElementType(store.drawDefaults.elementTypeId);
  if (!type) return;
  let id = '';
  store.mutate((p) => {
    putInProjectCatalog(p, 'elements', type);
    id = addElement(p, type.id, pts, store.drawDefaults.elementZ).id;
  });
  store.select({ kind: 'element', id });
  elementPts = [];
}

function elementTarget(ev: PointerEvent | MouseEvent): { point: THREE.Vector3; snapped: boolean } | null {
  const z = store.drawDefaults.elementZ;
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  const near = (x: number, y: number, wz: number) => {
    const sp = viewer.toScreen(new THREE.Vector3(x, y, wz));
    return Math.hypot(sp.x - (ev.clientX - rect.left), sp.y - (ev.clientY - rect.top)) < 12;
  };
  // cerrar una losa en su primer punto
  if (elementPts.length >= 3 && near(elementPts[0].x, elementPts[0].y, z)) return { point: elementPts[0].clone(), snapped: true };
  // vértices de otros elementos
  for (const e of store.project.elements ?? []) for (const q of e.points) if (near(q.x, q.y, e.z)) return { point: new THREE.Vector3(q.x, q.y, z), snapped: true };
  // plano DXF
  const ps = viewer.underlaySnap(ev);
  if (ps) return { point: new THREE.Vector3(ps.x, ps.y, z), snapped: true };
  const p = viewer.planePoint(ev, z);
  if (!p) return null;
  const grid = store.drawDefaults.gridFt;
  const snap = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  const last = elementPts[elementPts.length - 1];
  if (!last) return { point: new THREE.Vector3(snap(p.x), snap(p.y), z), snapped: false };
  let ang = Math.atan2(p.y - last.y, p.x - last.x);
  if (!ev.altKey) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = snap(Math.hypot(p.x - last.x, p.y - last.y));
  return { point: new THREE.Vector3(last.x + len * Math.cos(ang), last.y + len * Math.sin(ang), z), snapped: false };
}

function onElementClick(ev: PointerEvent) {
  const t = elementTarget(ev);
  const type = findElementType(store.drawDefaults.elementTypeId);
  if (!t || !type) return;
  const shape = ELEMENT_KIND_SHAPE[type.kind];
  const z = store.drawDefaults.elementZ;
  if (shape === 'point') {
    let id = '';
    store.mutate((p) => {
      putInProjectCatalog(p, 'elements', type);
      id = addElement(p, type.id, [{ x: t.point.x, y: t.point.y }], z).id;
    });
    store.select({ kind: 'element', id });
    return;
  }
  if (shape === 'area') {
    if (elementPts.length >= 3 && t.point.distanceTo(elementPts[0]) < 1e-6) {
      closeArea();
      viewer.setPreview(null, null);
      renderHint();
      return;
    }
    elementPts.push(t.point);
    renderHint();
    return;
  }
  // línea: muros, vigas, ductos y tuberías de otros sistemas
  const last = elementPts[elementPts.length - 1];
  if (last && t.point.distanceTo(last) < 1e-6) return;
  elementPts.push(t.point);
  if (elementPts.length === 2) {
    let id = '';
    store.mutate((p) => {
      putInProjectCatalog(p, 'elements', type);
      id = addElement(p, type.id, elementPts.map((v) => ({ x: v.x, y: v.y })), z).id;
    });
    elementId = id;
    store.select({ kind: 'element', id });
  } else if (elementPts.length > 2 && elementId) {
    const id = elementId;
    store.mutate((p) => {
      const el = (p.elements ?? []).find((x) => x.id === id);
      if (el) el.points.push({ x: t.point.x, y: t.point.y });
    });
  }
  renderHint();
}

// ---------- Tomar un desplazamiento del dibujo (para Repetir y Mover) ----------
const vector: { a: THREE.Vector3 | null; done: ((dx: number, dy: number, dz: number) => void) | null } = { a: null, done: null };

editHooks.pickVector = (done) => {
  setTool('pick-vector');
  vector.done = done;
};

function vectorTarget(ev: PointerEvent): { point: THREE.Vector3; snapped: boolean } | null {
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  for (const n of store.project.nodes) {
    const sp = viewer.toScreen(new THREE.Vector3(n.x, n.y, n.z));
    if (Math.hypot(sp.x - (ev.clientX - rect.left), sp.y - (ev.clientY - rect.top)) < 12) return { point: new THREE.Vector3(n.x, n.y, n.z), snapped: true };
  }
  const z = vector.a?.z ?? drawElevation;
  const ps = viewer.underlaySnap(ev);
  if (ps) return { point: new THREE.Vector3(ps.x, ps.y, z), snapped: true };
  const p = viewer.planePoint(ev, z);
  return p ? { point: p, snapped: false } : null;
}

function onVectorClick(ev: PointerEvent) {
  const t = vectorTarget(ev);
  if (!t) return;
  if (!vector.a) {
    vector.a = t.point;
    renderHint();
    return;
  }
  const a = vector.a;
  const done = vector.done;
  vector.done = null;
  setTool('select');
  done?.(t.point.x - a.x, t.point.y - a.y, t.point.z - a.z);
}

function onVectorMove(ev: PointerEvent) {
  const t = vectorTarget(ev);
  viewer.setPreview(vector.a, t?.point ?? null, !!t?.snapped);
  if (t && vector.a) {
    const u = store.project.displayUnits;
    const d = t.point.clone().sub(vector.a);
    $('hint').textContent = `X ${fmt('length', d.x, u, true)}, Y ${fmt('length', d.y, u, true)}, Z ${fmt('length', d.z, u, true)}. Esc cancela.`;
  }
}

// ---------- Ubicar el área de diseño ----------
let areaTool: { box: AreaBox; z: number } | null = null;

function startAreaTool(): { box: AreaBox; z: number } | null {
  const p = store.project;
  if (!p.sprinklers.length) return null;
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const zs = p.sprinklers.map((s) => nodes.get(s.nodeId)?.z ?? 0).sort((a, b) => a - b);
  return { box: areaBox(p), z: zs[Math.floor(zs.length / 2)] };
}

designHooks.placeArea = () => {
  if (!store.project.sprinklers.length) return flash('Primero ponga rociadores');
  setTool('area');
};

function areaAt(ev: PointerEvent) {
  if (!areaTool) return null;
  const pt = viewer.planePoint(ev, areaTool.z);
  if (!pt) return null;
  return { pt, ids: pickAreaAt(store.project, pt.x, pt.y, areaTool.box) };
}

function onAreaMove(ev: PointerEvent) {
  const a = areaAt(ev);
  if (!a || !areaTool) return viewer.setPreview(null, null);
  const { box, z } = areaTool;
  const { dir } = box;
  const corner = (sa: number, sc: number) =>
    new THREE.Vector3(a.pt.x + (sa * box.parallel * dir.x) / 2 - (sc * box.width * dir.y) / 2, a.pt.y + (sa * box.parallel * dir.y) / 2 + (sc * box.width * dir.x) / 2, z);
  const rect = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
  const nodes = new Map(store.project.nodes.map((n) => [n.id, n]));
  const dots = store.project.sprinklers
    .filter((s) => a.ids.includes(s.id))
    .map((s) => {
      const n = nodes.get(s.nodeId)!;
      return new THREE.Vector3(n.x, n.y, n.z);
    });
  viewer.setPreview(null, null, false, rect, dots);
  const u = store.project.displayUnits;
  $('hint').textContent = `${a.ids.length} rociadores (se necesitan ${box.rule.count}, ${box.rule.perLine} por ramal) · ${fmt('length', box.parallel, u, true)} × ${fmt('length', box.width, u, true)}. Clic para ubicar. Esc cancela.`;
}

function onAreaClick(ev: PointerEvent) {
  const a = areaAt(ev);
  if (!a) return;
  if (!a.ids.length) return flash('No hay rociadores en ese lugar');
  store.mutate((p) => p.sprinklers.forEach((s) => (s.inDesignArea = a.ids.includes(s.id))));
  setTool('select');
  flash(`Área de diseño con ${a.ids.length} rociadores`);
}

// ---------- Llenar recinto ----------
let fillStart: THREE.Vector3 | null = null;

/** Punto del recinto: se ajusta al plano DXF/DWG y a los vértices de los elementos */
function fillTarget(ev: PointerEvent): { point: THREE.Vector3; snapped: boolean } | null {
  const z = store.drawDefaults.fill.pipeZ;
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  const near = (x: number, y: number, wz: number) => {
    const sp = viewer.toScreen(new THREE.Vector3(x, y, wz));
    return Math.hypot(sp.x - (ev.clientX - rect.left), sp.y - (ev.clientY - rect.top)) < 12;
  };
  for (const e of store.project.elements ?? []) for (const q of e.points) if (near(q.x, q.y, e.z) || near(q.x, q.y, z)) return { point: new THREE.Vector3(q.x, q.y, z), snapped: true };
  const ps = viewer.underlaySnap(ev);
  if (ps) return { point: new THREE.Vector3(ps.x, ps.y, z), snapped: true };
  const p = viewer.planePoint(ev, z);
  if (!p) return null;
  const grid = store.drawDefaults.gridFt;
  const snap = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  return { point: new THREE.Vector3(snap(p.x), snap(p.y), z), snapped: false };
}

function cancelFill() {
  fillStart = null;
  viewer.setPreview(null, null);
  renderHint();
}

const rectPath = (a: THREE.Vector3, b: THREE.Vector3) => [
  new THREE.Vector3(a.x, a.y, a.z),
  new THREE.Vector3(b.x, a.y, a.z),
  new THREE.Vector3(b.x, b.y, a.z),
  new THREE.Vector3(a.x, b.y, a.z),
  new THREE.Vector3(a.x, a.y, a.z),
];

function fillPlan(a: THREE.Vector3, b: THREE.Vector3) {
  const f = store.drawDefaults.fill;
  const lim = spacingLimits(store.project, store.drawDefaults.sprinklerModelId);
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return planGrid(f.direction === 'x' ? dx : dy, f.direction === 'x' ? dy : dx, lim);
}

function onFillMove(ev: PointerEvent) {
  const t = fillTarget(ev);
  if (!fillStart || !t) {
    viewer.setPreview(null, t?.point ?? null, !!t?.snapped);
    return;
  }
  const u = store.project.displayUnits;
  const dx = Math.abs(t.point.x - fillStart.x);
  const dy = Math.abs(t.point.y - fillStart.y);
  if (dx < 0.5 || dy < 0.5) return viewer.setPreview(null, t.point, t.snapped, rectPath(fillStart, t.point));
  const g = fillPlan(fillStart, t.point);
  // dónde quedarían los rociadores
  const dots: THREE.Vector3[] = [];
  const x0 = Math.min(fillStart.x, t.point.x);
  const y0 = Math.min(fillStart.y, t.point.y);
  const alongX = store.drawDefaults.fill.direction === 'x';
  if (g.along * g.across <= 2000)
    for (let i = 0; i < g.along; i++)
      for (let j = 0; j < g.across; j++) {
        const a = g.s / 2 + i * g.s;
        const c = g.l / 2 + j * g.l;
        dots.push(new THREE.Vector3(alongX ? x0 + a : x0 + c, alongX ? y0 + c : y0 + a, t.point.z));
      }
  viewer.setPreview(null, t.point, t.snapped, rectPath(fillStart, t.point), dots);
  $('hint').textContent = `${fmt('length', dx, u, true)} × ${fmt('length', dy, u, true)}: ${g.along * g.across} rociadores (${g.along} × ${g.across}), separación ${fmt('length', g.s, u, true)} × ${fmt('length', g.l, u, true)}, ${fmt('area', g.coverage, u, true)} c/u.`;
}

function onFillClick(ev: PointerEvent) {
  const t = fillTarget(ev);
  if (!t) return;
  if (!fillStart) {
    fillStart = t.point;
    renderHint();
    return;
  }
  const a = fillStart;
  const b = t.point;
  if (Math.abs(b.x - a.x) < 0.5 || Math.abs(b.y - a.y) < 0.5) return flash('El recinto es muy pequeño: marque la esquina opuesta');
  const d = store.drawDefaults;
  const f = d.fill;
  const model = findSprinklerModel(d.sprinklerModelId);
  const upright = model?.orientation === 'upright';
  let res: ReturnType<typeof fillRoom> | undefined;
  store.mutate((p) => {
    if (model) putInProjectCatalog(p, 'sprinklers', model);
    const m = findMaterial(d.material);
    if (m) putInProjectCatalog(p, 'materials', m);
    res = fillRoom(p, {
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
      direction: f.direction,
      pipeZ: f.pipeZ,
      dropFt: upright ? 0 : f.dropFt,
      k: getSprinklerModel(d.sprinklerModelId, p)?.k ?? 5.6,
      modelId: model ? d.sprinklerModelId : undefined,
      piping: f.piping,
      mainSide: f.mainSide,
      material: d.material,
      sizeBySchedule: f.bySchedule,
      branchSize: d.size,
      mainSize: d.size,
    });
  });
  fillStart = null;
  viewer.setPreview(null, null);
  renderHint();
  if (!res) return;
  const u = store.project.displayUnits;
  const g = res.plan;
  const joined = f.piping !== 'branches-main' ? '' : res.connected ? ' La matriz quedó unida a la red.' : ' Una la matriz a la red con la herramienta Tubería.';
  flash(`${res.sprinklerIds.length} rociadores a ${fmt('length', g.s, u, true)} × ${fmt('length', g.l, u, true)}.${joined}`);
}

function onSprinklerClick(ev: PointerEvent) {
  const hit = viewer.pick(ev);
  if (!hit) return;
  if (hit.kind === 'sprinkler') return store.select({ kind: 'sprinkler', id: hit.id });
  let sid = '';
  if (hit.kind === 'node') {
    const existing = store.project.sprinklers.find((s) => s.nodeId === hit.id);
    if (existing) return store.select({ kind: 'sprinkler', id: existing.id });
    store.mutate((p) => (sid = placeSprinkler(p, hit.id)));
  } else if (hit.kind === 'pipe') {
    store.mutate((p) => {
      const node = splitPipe(p, hit.id, hit.point.x, hit.point.y, hit.point.z);
      if (node) sid = placeSprinkler(p, node.id);
    });
  } else {
    return;
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
    if (store.tool === 'calibrate' || store.tool === 'move-plan') return setTool('select');
    if (store.tool === 'element') return endElement();
    if (store.tool === 'fill') return cancelFill();
    if (store.tool === 'pick-vector' || store.tool === 'area') return setTool('select');
    if (store.tool === 'draw' && drawStart) {
      drawStart = null;
      viewer.setPreview(null, null);
      renderHint();
    }
    return;
  }
  if (e.button !== 0) return;
  if (store.tool === 'draw') return onDrawClick(e);
  if (store.tool === 'calibrate' || store.tool === 'move-plan') return onMeasureClick(e);
  if (store.tool === 'sprinkler') return onSprinklerClick(e);
  if (store.tool === 'element') return onElementClick(e);
  if (store.tool === 'fill') return onFillClick(e);
  if (store.tool === 'pick-vector') return onVectorClick(e);
  if (store.tool === 'area') return onAreaClick(e);
  const hit = viewer.pick(e);
  if (e.ctrlKey || e.metaKey) {
    if (hit) store.select(toggleInSelection(store.selection, hit.kind, hit.id));
    return;
  }
  store.select(hit ? { kind: hit.kind, id: hit.id } : null);
});

// ---------- Selección por ventana (Mayús + arrastrar) ----------
let box: { x0: number; y0: number; el: HTMLElement; add: boolean } | null = null;
canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (store.tool !== 'select' || e.button !== 0 || !e.shiftKey) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    const el = h('div', { class: 'select-box' });
    $('viewport').append(el);
    box = { x0: e.clientX - r.left, y0: e.clientY - r.top, el, add: e.ctrlKey || e.metaKey };
    down = null;
  },
  { capture: true },
);
canvas.addEventListener(
  'pointermove',
  (e) => {
    if (!box) return;
    e.stopImmediatePropagation();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    Object.assign(box.el.style, {
      left: `${Math.min(x, box.x0)}px`,
      top: `${Math.min(y, box.y0)}px`,
      width: `${Math.abs(x - box.x0)}px`,
      height: `${Math.abs(y - box.y0)}px`,
    });
  },
  { capture: true },
);
canvas.addEventListener(
  'pointerup',
  (e) => {
    if (!box) return;
    e.stopImmediatePropagation();
    const b = box;
    box = null;
    b.el.remove();
    const r = canvas.getBoundingClientRect();
    const x1 = e.clientX - r.left;
    const y1 = e.clientY - r.top;
    // Mayús + clic sin arrastrar: agrega o quita el objeto
    if (Math.hypot(x1 - b.x0, y1 - b.y0) < 5) {
      const hit = viewer.pick(e);
      if (hit) store.select(toggleInSelection(store.selection, hit.kind, hit.id));
      return;
    }
    const [lx, hx] = [Math.min(b.x0, x1), Math.max(b.x0, x1)];
    const [ly, hy] = [Math.min(b.y0, y1), Math.max(b.y0, y1)];
    const inside = (x: number, y: number, z: number) => {
      const sp = viewer.toScreen(new THREE.Vector3(x, y, z));
      return sp.x >= lx && sp.x <= hx && sp.y >= ly && sp.y <= hy;
    };
    const p = store.project;
    const inNodes = new Set(p.nodes.filter((n) => inside(n.x, n.y, n.z)).map((n) => n.id));
    const items = emptyItems();
    items.nodes = [...inNodes];
    items.pipes = p.pipes.filter((x) => inNodes.has(x.from) && inNodes.has(x.to)).map((x) => x.id);
    items.sprinklers = p.sprinklers.filter((x) => inNodes.has(x.nodeId)).map((x) => x.id);
    items.elements = (p.elements ?? []).filter((el) => el.points.length && el.points.every((q) => inside(q.x, q.y, el.z))).map((el) => el.id);
    // los nodos que solo son extremos de tubos o soportes de rociadores no hace falta listarlos
    const covered = new Set<string>();
    for (const x of p.pipes) if (items.pipes.includes(x.id)) covered.add(x.from).add(x.to);
    for (const x of p.sprinklers) if (items.sprinklers.includes(x.id)) covered.add(x.nodeId);
    items.nodes = items.nodes.filter((id) => !covered.has(id));
    if (b.add) {
      const cur = store.selection;
      let sel = cur;
      for (const id of items.pipes) sel = toggleInSelection(sel, 'pipe', id);
      for (const id of items.sprinklers) sel = toggleInSelection(sel, 'sprinkler', id);
      for (const id of items.nodes) sel = toggleInSelection(sel, 'node', id);
      for (const id of items.elements) sel = toggleInSelection(sel, 'element', id);
      store.select(sel);
    } else store.select(selectionFrom(items));
  },
  { capture: true },
);
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  if (store.tool === 'calibrate' || store.tool === 'move-plan') {
    if (measure.b) return;
    const t = measureTarget(e);
    viewer.setPreview(measure.a, t?.point ?? null, !!t?.snapped);
    if (t && measure.a) $('hint').textContent = `Distancia ${fmt('length', t.point.distanceTo(measure.a), store.project.displayUnits, true)}`;
    return;
  }
  if (store.tool === 'element') {
    const t = elementTarget(e);
    const last = elementPts[elementPts.length - 1] ?? null;
    viewer.setPreview(last, t?.point ?? null, !!t?.snapped, elementPts);
    if (t && last) $('hint').textContent = `Longitud ${fmt('length', t.point.distanceTo(last), store.project.displayUnits, true)}. ${elementHint()}`;
    return;
  }
  if (store.tool === 'fill') return onFillMove(e);
  if (store.tool === 'pick-vector') return onVectorMove(e);
  if (store.tool === 'area') return onAreaMove(e);
  if (store.tool !== 'draw') return;
  const t = drawTarget(e);
  viewer.setPreview(drawStart?.point ?? null, t?.point ?? null, !!t?.nodeId || !!t?.pipeId || !!t?.onPlan);
  if (t && drawStart) {
    const len = t.point.distanceTo(drawStart.point);
    $('hint').textContent = `Longitud ${fmt('length', len, store.project.displayUnits, true)}. Esc o clic derecho termina.`;
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Plano de fondo ----------
let measure: { a: THREE.Vector3 | null; b: THREE.Vector3 | null } = { a: null, b: null };
let currentAsset: UnderlayAsset | undefined;
let currentAssetKey = '';

const underlayKey = (u: NonNullable<Project['underlay']>) => `${u.dataId}|${u.kind === 'pdf' ? u.page ?? 1 : ''}|${!isVectorPlan(u.kind) && u.invert ? 1 : 0}`;

/** Pone en la vista el plano del proyecto, leyéndolo si hace falta. */
function syncUnderlay() {
  const u = store.project.underlay;
  const data = u ? store.attached.get(u.dataId) : undefined;
  if (!u || !data) {
    currentAsset = undefined;
    currentAssetKey = '';
    viewer.setUnderlay(undefined, undefined);
    return;
  }
  const key = underlayKey(u);
  if (key === currentAssetKey && currentAsset) {
    viewer.setUnderlay(u, currentAsset);
    return;
  }
  if (currentAsset) viewer.setUnderlay(u, currentAsset); // mientras se lee la nueva página
  currentAssetKey = key;
  loadAsset(u, data)
    .then((asset) => {
      if (currentAssetKey !== key) return;
      currentAsset = asset;
      const now = store.project.underlay;
      viewer.setUnderlay(now, asset);
      renderLeft($('left'));
    })
    .catch((err) => flash(`No se pudo leer el plano: ${(err as Error).message}`));
}

function measureTarget(ev: PointerEvent): { point: THREE.Vector3; snapped: boolean } | null {
  // al mover, el destino se ajusta a los nodos del sistema (por ejemplo, el montante)
  if (store.tool === 'move-plan' && measure.a) {
    for (const n of store.project.nodes) {
      const s = viewer.toScreen(new THREE.Vector3(n.x, n.y, n.z));
      const rect = viewer.renderer.domElement.getBoundingClientRect();
      if (Math.hypot(s.x - (ev.clientX - rect.left), s.y - (ev.clientY - rect.top)) < 12) {
        return { point: new THREE.Vector3(n.x, n.y, store.project.underlay?.z ?? 0), snapped: true };
      }
    }
  }
  const snap = viewer.underlaySnap(ev);
  if (snap) return { point: snap, snapped: true };
  const p = viewer.underlayPoint(ev);
  return p ? { point: p, snapped: false } : null;
}

function onMeasureClick(ev: PointerEvent) {
  const t = measureTarget(ev);
  if (!t) return;
  if (!measure.a) {
    measure.a = t.point;
  } else if (!measure.b) {
    if (t.point.distanceTo(measure.a) < 1e-6) return;
    measure.b = t.point;
    if (store.tool === 'move-plan') {
      const dx = measure.b.x - measure.a.x;
      const dy = measure.b.y - measure.a.y;
      store.mutate((p) => {
        if (!p.underlay) return;
        p.underlay.x += dx;
        p.underlay.y += dy;
      });
      flash('Plano movido');
      return setTool('select');
    }
    viewer.setPreview(measure.a, measure.b, true);
  }
  renderToolOptions();
}

function applyCalibration(measured: number, real: number) {
  const a = measure.a;
  if (!a || !(real > 0) || !(measured > 0)) return;
  const local = viewer.worldToPlan(a.x, a.y);
  store.mutate((p) => {
    const u = p.underlay;
    if (!u) return;
    u.scale *= real / measured;
    // el primer punto queda donde estaba
    const r = (u.rotation * Math.PI) / 180;
    u.x = a.x - u.scale * (local.x * Math.cos(r) - local.y * Math.sin(r));
    u.y = a.y - u.scale * (local.x * Math.sin(r) + local.y * Math.cos(r));
    u.calibrated = true;
  });
  flash('Escala calibrada');
  setTool('select');
}

planHooks.asset = () => (store.project.underlay && currentAssetKey === underlayKey(store.project.underlay) ? currentAsset : undefined);
planHooks.load = async (given?: File) => {
  const file = given ?? (await pickPlanFile());
  if (!file) return;
  flash('Leyendo el plano…');
  try {
    const { meta, data, asset } = await createUnderlay(file);
    store.attached.set(meta.dataId, data);
    currentAsset = asset;
    currentAssetKey = underlayKey(meta);
    store.mutate((p) => (p.underlay = meta));
    store.recalcNow();
    setView('top');
    flash(meta.calibrated ? 'Plano cargado' : 'Plano cargado. Calibre la escala con una medida conocida.');
  } catch (err) {
    flash((err as Error).message);
  }
};
planHooks.calibrate = () => {
  if (!store.project.underlay?.visible) return flash('Muestre el plano para calibrarlo');
  if (viewer.view === '3d') setView('top');
  setTool('calibrate');
};
planHooks.move = () => {
  if (!store.project.underlay?.visible) return flash('Muestre el plano para moverlo');
  setTool('move-plan');
};
planHooks.remove = () => store.mutate((p) => delete p.underlay);

// Arrastrar un plano (DXF, PDF o imagen) o un proyecto .rcad sobre la vista
const stage = $('stage');
stage.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    stage.classList.add('dropping');
  }
});
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  stage.classList.remove('dropping');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.rcad')) {
    if (!(await confirmDiscard())) return;
    try {
      const n = normalize(JSON.parse(await file.text()));
      store.load(n.project, { path: null, name: file.name }, n.attached);
      setTool('select');
      viewer.fit();
    } catch (err) {
      flash(`No se pudo abrir: ${(err as Error).message}`);
    }
    return;
  }
  planHooks.load(file);
});

// ---------- Archivos ----------
function normalize(raw: unknown): { project: Project; attached: Record<string, AttachedData> } {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no es un proyecto de RociaCAD.');
  const { underlayData, ...p } = raw as ProjectFile;
  if (!p || p.format !== 'rociacad' || !Array.isArray(p.nodes) || !Array.isArray(p.pipes)) {
    throw new Error('El archivo no es un proyecto de RociaCAD.');
  }
  if (p.version > FILE_FORMAT_VERSION) throw new Error('El archivo fue creado con una versión más nueva de RociaCAD.');
  const base = emptyProject();
  const project: Project = {
    ...base,
    ...p,
    info: { ...base.info, ...p.info },
    criteria: { ...base.criteria, ...p.criteria },
    supply: { ...base.supply, ...p.supply },
    // los archivos de versiones anteriores no traían accesorios automáticos
    autoFittings: p.autoFittings ?? false,
    sprinklers: p.sprinklers ?? [],
    pipes: p.pipes.map((pp) => ({ ...pp, fittings: pp.fittings ?? [] })),
  };
  if (project.underlay && !underlayData?.[project.underlay.dataId]) delete project.underlay;
  return { project, attached: underlayData ?? {} };
}

/** Texto del archivo .rcad: el proyecto más los datos del plano de fondo */
function projectFileContent(): string {
  const copy: Project = JSON.parse(JSON.stringify(store.project));
  pruneProjectCatalog(copy);
  const file: ProjectFile = copy;
  const u = store.project.underlay;
  const data = u ? store.attached.get(u.dataId) : undefined;
  if (u && data) file.underlayData = { [u.dataId]: data };
  return JSON.stringify(file, null, 1);
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
        const n = normalize(JSON.parse(f.content));
        store.load(n.project, { path: f.path, name: f.name }, n.attached);
      } else {
        const f = await pickFile();
        if (!f) return;
        const n = normalize(JSON.parse(await f.text()));
        store.load(n.project, { path: null, name: f.name }, n.attached);
      }
      setTool('select');
      viewer.fit();
      flash('Proyecto abierto');
    } catch (err) {
      flash(`No se pudo abrir: ${(err as Error).message}`);
    }
  },
  async save(asNew = false): Promise<boolean> {
    const content = projectFileContent();
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
  async exportDxf() {
    const content = buildDxf(store.project, viewer.dxfExportFrame());
    if (desktop) {
      const r = await desktop.saveFile({ content, suggestedName: fileBaseName(), kind: 'dxf' });
      if (r) flash('Dibujo DXF exportado');
    } else {
      download(new Blob([content], { type: 'image/vnd.dxf' }), `${fileBaseName()}.dxf`);
    }
  },
  async exportCsv(content: string, name: string) {
    if (desktop) {
      const r = await desktop.saveFile({ content, suggestedName: `${name} - ${fileBaseName()}`, kind: 'csv' });
      if (r) flash('Archivo CSV guardado');
    } else {
      download(new Blob([content], { type: 'text/csv;charset=utf-8' }), `${name} - ${fileBaseName()}.csv`);
    }
  },
  async exportFabrication() {
    buildFabricationSheet($('print-root'), appVersion);
    await document.fonts.ready;
    if (desktop) {
      const r = await desktop.exportPdf({ suggestedName: `Hoja de fabricación - ${fileBaseName()}` });
      if (r) flash('Hoja de fabricación guardada');
    } else {
      window.print();
    }
  },
  async exportPdf() {
    store.recalcNow();
    const image = viewer.snapshot();
    const planImage = viewer.snapshotPlan();
    buildReport($('print-root'), { image, planImage, version: appVersion });
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
  if (s.kind === 'multi') {
    store.mutate((p) => deleteItems(p, s.items));
    store.select(null);
    return;
  }
  if (s.kind === 'hanger') {
    store.mutate((p) => (p.hangers = (p.hangers ?? []).filter((x) => x.id !== s.id)));
    store.select(null);
    return;
  }
  if (s.kind === 'node' && s.id === store.project.supply.nodeId) return flash('El punto de suministro no se puede borrar');
  store.mutate((p) => {
    if (s.kind === 'pipe') deletePipe(p, s.id);
    else if (s.kind === 'node') deleteNode(p, s.id);
    else if (s.kind === 'element') deleteElement(p, s.id);
    else deleteSprinkler(p, s.id);
  });
  store.select(null);
}

// ---------- Menú y teclado ----------
/** Seleccionar todo: el texto si se está escribiendo; si no, todos los objetos */
function selectAll() {
  if (isTyping()) return document.execCommand('selectAll');
  if (store.tool !== 'select') setTool('select');
  const p = store.project;
  const items = emptyItems();
  items.pipes = p.pipes.map((x) => x.id);
  items.sprinklers = p.sprinklers.map((x) => x.id);
  items.elements = (p.elements ?? []).map((x) => x.id);
  store.select(selectionFrom(items));
}

desktop?.onMenu(async (action) => {
  switch (action) {
    case 'select-all':
      return selectAll();
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
    case 'load-plan':
      return planHooks.load();
    case 'catalog':
      return openCatalog();
    case 'panel-left':
      return togglePanel('left');
    case 'panel-insp':
      return togglePanel('insp');
    case 'panel-bottom':
      return togglePanel('bottom');
    case 'panel-all':
      return toggleAllPanels();
    case 'export-dxf':
      return actions.exportDxf();
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
      return flash(`RociaCAD ${appVersion}. Software libre bajo la licencia GNU GPL v3.`);
  }
});

function isTyping() {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
}

window.addEventListener('keydown', (e) => {
  if (isTyping()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Enter' && store.tool === 'element' && elementPts.length) {
    endElement();
  } else if (e.key === 'Escape') {
    if (store.tool === 'element' && elementPts.length) {
      elementPts = [];
      elementId = null;
      viewer.setPreview(null, null);
      renderHint();
    } else if (store.tool === 'fill' && fillStart) {
      cancelFill();
    } else if (store.tool === 'draw' && drawStart) {
      drawStart = null;
      viewer.setPreview(null, null);
      renderHint();
    } else if (store.tool !== 'select') setTool('select');
    else store.select(null);
  } else if (!desktop && mod && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    if (e.key === '4') toggleAllPanels();
    else togglePanel(e.key === '1' ? 'left' : e.key === '2' ? 'insp' : 'bottom');
  } else if (!desktop && mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAll();
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
  else if (!mod && e.key.toLowerCase() === 'e') setTool('element');
  else if (!mod && e.key.toLowerCase() === 'l') setTool('fill');
  else if (!mod && e.key.toLowerCase() === 'a') designHooks.placeArea();
});

// ---------- Barra de estado ----------
let updateText = '';
desktop?.onUpdateStatus((t) => {
  updateText = t;
  renderStatus();
});

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
    updateText ? h('span', { class: 'update-status' }, updateText) : null,
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
  if (why === 'file') adoptFromProject(store.project);
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
  try {
    setMaxTexture(viewer.renderer.capabilities.maxTextureSize);
  } catch {
    /* sin WebGL */
  }
  initPanels($('stage'));
  fabricationHooks.saveCsv = (content, name) => actions.exportCsv(content, name);
  fabricationHooks.printSheet = () => actions.exportFabrication();
  // la app abre con un proyecto en blanco; los ejemplos están en Archivo → Ejemplos
  store.load(emptyProject());
  // Acceso para pruebas automáticas (solo si se abre con #debug)
  if (location.hash === '#debug') Object.assign(window, { rociaDebug: { store, viewer, actions, setTool, setView, planHooks, projectFileContent, normalize } });
  renderViewSwitch();
  setTool('select');
  viewer.fit();
}

start();
