/**
 * Panel derecho: propiedades del elemento seleccionado.
 */
import {
  addDropWithSprinkler,
  addSprinkler,
  deleteNode,
  deletePipe,
  deleteSprinkler,
  FITTING_NAMES,
  fmt,
  internalDiameter,
  MATERIAL_IDS,
  MATERIALS,
  ORIENTATION_NAMES,
  PIPE_ROLE_NAMES,
  pipeGeometry,
  sizeLabel,
  sizesFor,
  type FittingType,
  type MaterialId,
  type NominalSize,
  type PipeRole,
  type Quantity,
  type SprinklerOrientation,
} from '../../core';
import { clear, h } from './dom';
import { numField, numInput, rerender, selectField, selectInput, textField } from './fields';
import { store } from './state';

const icon = {
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/></svg>',
};

export function renderInspector(el: HTMLElement) {
  rerender(el, () => {
    const sel = store.selection;
    if (!sel) return clear(el, emptyHelp());
    if (sel.kind === 'pipe') return clear(el, pipePanel(sel.id));
    if (sel.kind === 'node') return clear(el, nodePanel(sel.id));
    return clear(el, sprinklerPanel(sel.id));
  });
}

function readout(rows: [string, string, boolean?][]): HTMLElement {
  return h(
    'dl',
    { class: 'readout' },
    rows.map(([k, v, bad]) => [h('dt', null, k), h('dd', { class: bad ? 'bad' : '' }, v)]),
  );
}

function title(main: string, sub: string) {
  return h('div', { class: 'insp-title' }, h('h1', null, main), h('span', null, sub));
}

function emptyHelp(): HTMLElement {
  const k = (t: string) => h('kbd', null, t);
  return h(
    'section',
    { class: 'section empty-help' },
    h('h2', null, 'Nada seleccionado'),
    h('p', null, 'Haga clic en un tubo, un nodo o un rociador para ver y cambiar sus datos.'),
    h('p', null, 'Con la herramienta Dibujar tubería haga clic en un nodo existente y luego en el punto final. Termine con ', k('Esc'), ' o clic derecho.'),
    h('p', null, 'Con la herramienta Rociador haga clic en un nodo o sobre un tubo para colocar uno.'),
    h('p', null, 'Arrastre para girar la vista, rueda para acercar y clic derecho para desplazar.'),
    h('p', null, k('Supr'), ' borra lo seleccionado, ', k('Ctrl'), '+', k('Z'), ' deshace.'),
  );
}

function pipePanel(id: string): HTMLElement {
  const pipe = store.project.pipes.find((p) => p.id === id)!;
  const u = store.project.displayUnits;
  const metric = u === 'metric';
  const g = pipeGeometry(store.project, pipe);
  const r = store.result.ok ? store.result.pipes[id] : undefined;
  const set = (fn: (pp: typeof pipe) => void, key?: string) =>
    store.mutate((p) => {
      const pp = p.pipes.find((x) => x.id === id)!;
      fn(pp);
    }, key);
  const catalogId = internalDiameter(pipe.material, pipe.size);

  const fittingRows = pipe.fittings.map((f, i) =>
    h(
      'div',
      { class: 'fitting-row' },
      selectInput<FittingType>(
        'Accesorio',
        f.type,
        (Object.keys(FITTING_NAMES) as FittingType[]).map((t) => ({ value: t, label: FITTING_NAMES[t] })),
        `fit-type-${id}-${i}`,
        (t) => set((pp) => (pp.fittings[i].type = t)),
      ),
      numInput({ label: 'Cantidad', value: f.count, key: `fit-count-${id}-${i}`, digits: 0, min: 0, unit: 'und', onCommit: (v) => set((pp) => (pp.fittings[i].count = Math.round(v))) }),
      h('button', { class: 'icon-btn', title: 'Quitar accesorio', 'aria-label': 'Quitar accesorio', onclick: () => set((pp) => pp.fittings.splice(i, 1)), innerHTML: icon.trash }),
    ),
  );

  return h(
    'div',
    null,
    h(
      'section',
      { class: 'section' },
      title(`Tubo ${id}`, `${pipe.from} a ${pipe.to}`),
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', null, 'Tubería'),
      selectField<MaterialId>(
        'Material',
        pipe.material,
        MATERIAL_IDS.map((m) => ({ value: m, label: MATERIALS[m].name })),
        'pipe-mat',
        (m) =>
          set((pp) => {
            pp.material = m;
            pp.c = MATERIALS[m].cWet;
            if (!internalDiameter(m, pp.size)) pp.size = sizesFor(m)[0];
          }),
      ),
      selectField<NominalSize>(
        'Diámetro',
        pipe.size,
        sizesFor(pipe.material).map((s) => ({ value: s, label: metric ? `${sizeLabel(s, true)} (${s}")` : `${s}"` })),
        'pipe-size',
        (s) => set((pp) => (pp.size = s)),
      ),
      selectField<PipeRole>(
        'Función',
        pipe.role,
        (Object.keys(PIPE_ROLE_NAMES) as PipeRole[]).map((k) => ({ value: k, label: PIPE_ROLE_NAMES[k] })),
        'pipe-role',
        (v) => set((pp) => (pp.role = v)),
      ),
      numField({ label: 'Coeficiente C', value: pipe.c, key: 'pipe-c', min: 1, digits: 0, onCommit: (v) => set((pp) => (pp.c = v)) }),
      numField({
        label: 'Diámetro interno',
        q: 'diameter',
        value: pipe.idOverride,
        placeholder: catalogId ? fmt('diameter', catalogId, u) : '',
        key: 'pipe-id',
        min: 0.1,
        allowEmpty: true,
        hint: 'Déjelo vacío para usar el del catálogo',
        onCommit: (v) => set((pp) => (pp.idOverride = v)),
        onClear: () => set((pp) => delete pp.idOverride),
      }),
      numField({
        label: 'Longitud real',
        q: 'length',
        value: pipe.lengthOverride,
        placeholder: fmt('length', pipeGeometry(store.project, { ...pipe, lengthOverride: undefined }).lengthFt, u),
        key: 'pipe-len',
        min: 0.01,
        allowEmpty: true,
        hint: 'Déjela vacía para usar la distancia entre los nodos',
        onCommit: (v) => set((pp) => (pp.lengthOverride = v)),
        onClear: () => set((pp) => delete pp.lengthOverride),
      }),
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', null, 'Accesorios y válvulas'),
      fittingRows.length ? fittingRows : h('p', { style: 'margin:0;color:var(--muted);font-size:13px' }, 'Sin accesorios hidráulicos.'),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn outline small', onclick: () => set((pp) => pp.fittings.push({ type: 'elbow90', count: 1 })) }, 'Agregar accesorio'),
      ),
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', null, 'Resultado'),
      r
        ? readout([
            ['Caudal', fmt('flow', Math.abs(r.flow), u, true)],
            ['Sentido', `${r.upstream} a ${r.downstream}`],
            ['Velocidad', fmt('velocity', r.velocity, u, true), r.velocity > store.project.criteria.maxVelocity],
            ['Longitud', fmt('length', r.lengthFt, u, true)],
            ['Longitud equivalente', fmt('length', r.fittingFt, u, true)],
            ['Pérdida por unidad', fmt('frictionRate', r.frictionPerFt, u, true)],
            ['Pérdida por fricción', fmt('pressure', r.frictionLoss, u, true)],
            ['Presión al entrar', fmt('pressure', r.pUpstream, u, true)],
            ['Presión al salir', fmt('pressure', r.pDownstream, u, true)],
          ])
        : readout([
            ['Longitud', fmt('length', g.lengthFt, u, true)],
            ['Longitud equivalente', fmt('length', g.fittingFt, u, true)],
          ]),
    ),
    h(
      'section',
      { class: 'section' },
      h(
        'button',
        {
          class: 'btn outline small danger',
          onclick: () => {
            store.mutate((p) => deletePipe(p, id));
            store.select(null);
          },
        },
        'Eliminar tubo',
      ),
    ),
  );
}

function nodePanel(id: string): HTMLElement {
  const node = store.project.nodes.find((n) => n.id === id)!;
  const u = store.project.displayUnits;
  const isSupply = store.project.supply.nodeId === id;
  const spk = store.project.sprinklers.find((s) => s.nodeId === id);
  const r = store.result.ok ? store.result.nodes[id] : undefined;
  const set = (fn: (n: typeof node) => void, key?: string) =>
    store.mutate((p) => {
      fn(p.nodes.find((x) => x.id === id)!);
    }, key);
  const coord = (label: string, k: 'x' | 'y' | 'z', q: Quantity) =>
    numField({ label, q, value: node[k], key: `node-${k}`, onCommit: (v) => set((n) => (n[k] = v)) });
  const dropFt = 0.3 / 0.3048;
  return h(
    'div',
    null,
    h('section', { class: 'section' }, title(`Nodo ${id}`, isSupply ? 'Punto de suministro' : spk ? `Rociador ${spk.id}` : 'Unión')),
    h(
      'section',
      { class: 'section' },
      h('h2', null, 'Posición'),
      textField('Nombre', node.label, 'node-label', (v) => set((n) => (n.label = v || undefined))),
      coord('X', 'x', 'length'),
      coord('Y', 'y', 'length'),
      coord('Elevación (Z)', 'z', 'elevation'),
      numField({
        label: 'Demanda fija',
        q: 'flow',
        value: node.fixedDemand,
        placeholder: '0',
        key: 'node-fixed',
        min: 0,
        allowEmpty: true,
        hint: 'Caudal constante que sale en este nodo (por ejemplo, una toma de manguera)',
        onCommit: (v) => set((n) => (n.fixedDemand = v || undefined)),
        onClear: () => set((n) => delete n.fixedDemand),
      }),
    ),
    r
      ? h('section', { class: 'section' }, h('h2', null, 'Resultado'), readout([['Presión', fmt('pressure', r.pressure, u, true)], ['Caudal que sale', fmt('flow', r.outflow, u, true)]]))
      : null,
    h(
      'section',
      { class: 'section' },
      h(
        'div',
        { class: 'btn-row' },
        !spk
          ? h(
              'button',
              {
                class: 'btn outline small',
                onclick: () => {
                  let sid = '';
                  store.mutate((p) => (sid = addSprinkler(p, id, store.drawDefaults.k).id));
                  store.select({ kind: 'sprinkler', id: sid });
                },
              },
              'Poner rociador aquí',
            )
          : null,
        h(
          'button',
          {
            class: 'btn outline small',
            title: 'Crea un bajante de 30 cm con un rociador colgante debajo de este nodo',
            onclick: () => {
              let sid = '';
              store.mutate((p) => (sid = addDropWithSprinkler(p, id, dropFt, store.drawDefaults.k)?.id ?? ''));
              if (sid) store.select({ kind: 'sprinkler', id: sid });
            },
          },
          'Bajante con rociador',
        ),
        !isSupply ? h('button', { class: 'btn outline small', onclick: () => store.mutate((p) => (p.supply.nodeId = id)) }, 'Usar como suministro') : null,
        !isSupply
          ? h(
              'button',
              {
                class: 'btn outline small danger',
                onclick: () => {
                  store.mutate((p) => deleteNode(p, id));
                  store.select(null);
                },
              },
              'Eliminar nodo',
            )
          : null,
      ),
    ),
  );
}

function sprinklerPanel(id: string): HTMLElement {
  const s = store.project.sprinklers.find((x) => x.id === id)!;
  const u = store.project.displayUnits;
  const r = store.result.ok ? store.result.sprinklers[id] : undefined;
  const set = (fn: (x: typeof s) => void, key?: string) =>
    store.mutate((p) => {
      fn(p.sprinklers.find((x) => x.id === id)!);
    }, key);
  const toggle = h('input', { type: 'checkbox', checked: s.inDesignArea, 'data-key': 'spk-flow' });
  toggle.addEventListener('change', () => set((x) => (x.inDesignArea = toggle.checked)));
  return h(
    'div',
    null,
    h('section', { class: 'section' }, title(`Rociador ${id}`, `en el nodo ${s.nodeId}`)),
    h(
      'section',
      { class: 'section' },
      h('label', { class: 'check' }, toggle, 'Abierto en el área de diseño'),
      numField({ label: 'Factor K', q: 'kfactor', value: s.k, key: 'spk-k', min: 0.1, onCommit: (v) => set((x) => (x.k = v)) }),
      numField({ label: 'Área de cobertura', q: 'area', value: s.coverage, key: 'spk-cov', min: 0.1, onCommit: (v) => set((x) => (x.coverage = v)) }),
      selectField<SprinklerOrientation>(
        'Orientación',
        s.orientation,
        (Object.keys(ORIENTATION_NAMES) as SprinklerOrientation[]).map((k) => ({ value: k, label: ORIENTATION_NAMES[k] })),
        'spk-or',
        (v) => set((x) => (x.orientation = v)),
      ),
      numField({ label: 'Temperatura', unit: '°C', value: s.temperatureC, key: 'spk-t', digits: 0, allowEmpty: true, onCommit: (v) => set((x) => (x.temperatureC = v)), onClear: () => set((x) => delete x.temperatureC) }),
      textField('Modelo', s.model, 'spk-model', (v) => set((x) => (x.model = v || undefined))),
    ),
    r && r.flowing
      ? h(
          'section',
          { class: 'section' },
          h('h2', null, 'Resultado'),
          readout([
            ['Presión', fmt('pressure', r.pressure, u, true)],
            ['Caudal', fmt('flow', r.flow, u, true)],
            ['Caudal mínimo', fmt('flow', r.requiredFlow, u, true)],
            ['Densidad lograda', fmt('density', r.density, u, true), r.density + 1e-9 < store.project.criteria.density],
          ]),
        )
      : r
        ? h('section', { class: 'section' }, h('h2', null, 'Resultado'), readout([['Presión estática en el nodo', fmt('pressure', r.pressure, u, true)]]))
        : null,
    h(
      'section',
      { class: 'section' },
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn outline small', onclick: () => store.select({ kind: 'node', id: s.nodeId }) }, 'Ver su nodo'),
        h(
          'button',
          {
            class: 'btn outline small danger',
            onclick: () => {
              store.mutate((p) => deleteSprinkler(p, id));
              store.select(null);
            },
          },
          'Eliminar rociador',
        ),
      ),
    ),
  );
}
