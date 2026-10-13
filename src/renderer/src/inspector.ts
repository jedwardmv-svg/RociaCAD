/**
 * Panel derecho: propiedades del elemento seleccionado.
 */
import {
  addDropWithSprinkler,
  effectiveC,
  closeItems,
  deleteItems,
  itemCount,
  moveItems,
  repeatItems,
  setDrops,
  setPipeSize,
  type ItemSet,
  autoFittings,
  addSprinkler,
  deleteNode,
  deletePipe,
  deleteSprinkler,
  FITTING_NAMES,
  fmt,
  internalDiameter,
  applySprinklerModel,
  deleteElement,
  ELEMENT_KIND_NAMES,
  ELEMENT_KIND_SHAPE,
  getElementType,
  ORIENTATION_NAMES,
  putInProjectCatalog,
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
import { catalogElements, catalogMaterials, catalogSprinklers, findMaterial, findSprinklerModel } from './catalogStore';
import { openCatalog } from './catalogDialog';
import { clear, h } from './dom';
import { flash, numField, numInput, rerender, selectField, selectInput, textField } from './fields';
import { selectionFrom, store, type Selection } from './state';
import { runSizing } from './leftPanel';

const icon = {
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/></svg>',
};

export function renderInspector(el: HTMLElement) {
  rerender(el, () => {
    const sel = store.selection;
    if (!sel) return clear(el, emptyHelp());
    if (sel.kind === 'pipe') return clear(el, pipePanel(sel.id));
    if (sel.kind === 'node') return clear(el, nodePanel(sel.id));
    if (sel.kind === 'element') return clear(el, elementPanel(sel.id));
    if (sel.kind === 'multi') return clear(el, multiPanel(sel.items));
    return clear(el, sprinklerPanel(sel.id));
  });
}

/** Aplica al rociador nuevo el modelo elegido en la herramienta Rociador */
function withModel(p: import('../../core').Project, s: import('../../core').Sprinkler): string {
  const model = findSprinklerModel(store.drawDefaults.sprinklerModelId);
  if (model) {
    putInProjectCatalog(p, 'sprinklers', model);
    applySprinklerModel(s, model);
  }
  return s.id;
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
    h('p', null, 'Con la herramienta Tubería haga clic en un nodo existente y luego en el punto final. Termine con ', k('Esc'), ' o clic derecho.'),
    h('p', null, 'Con la herramienta Rociador haga clic en un nodo o sobre un tubo para colocar uno del modelo elegido.'),
    h('p', null, 'Con Llenar recinto marque dos esquinas de un cuarto: se ponen los rociadores, los ramales y la matriz con los diámetros de la tabla.'),
    h('p', null, 'Con Elementos dibuje muros, columnas, vigas, losas, cielos, ductos y tuberías de otros sistemas.'),
    h('p', null, 'En Catálogo puede crear sus propias tuberías, rociadores y elementos.'),
    h('p', null, 'Arrastre para girar la vista, rueda para acercar y clic derecho para desplazar.'),
    h('p', null, k('Supr'), ' borra lo seleccionado, ', k('Ctrl'), '+', k('Z'), ' deshace.'),
  );
}

function pipePanel(id: string): HTMLElement {
  const pipe = store.project.pipes.find((p) => p.id === id)!;
  const u = store.project.displayUnits;
  const metric = u === 'metric';
  const auto = autoFittings(store.project).get(id);
  const g = pipeGeometry(store.project, pipe, auto);
  const r = store.result.ok ? store.result.pipes[id] : undefined;
  const set = (fn: (pp: typeof pipe) => void, key?: string) =>
    store.mutate((p) => {
      const pp = p.pipes.find((x) => x.id === id)!;
      fn(pp);
    }, key);
  const catalogId = internalDiameter(pipe.material, pipe.size, store.project);

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
        catalogMaterials().map((m) => ({ value: m.id, label: m.name })),
        'pipe-mat',
        (id) =>
          store.mutate((p) => {
            const m = findMaterial(id);
            if (!m) return;
            putInProjectCatalog(p, 'materials', m);
            const pp = p.pipes.find((x) => x.id === pipe.id)!;
            pp.material = id;
            pp.c = m.cWet;
            if (!m.id_in[pp.size]) pp.size = sizesFor(id, p)[0];
          }),
      ),
      selectField<NominalSize>(
        'Diámetro',
        pipe.size,
        sizesFor(pipe.material, store.project).map((s) => ({ value: s, label: metric ? `${sizeLabel(s, true)} (${s}")` : `${s}"` })),
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
      numField({
        label: 'Coeficiente C',
        value: pipe.c,
        key: 'pipe-c',
        min: 1,
        digits: 0,
        hint: effectiveC(store.project, pipe) !== pipe.c ? `En este tipo de sistema el acero se calcula con C = ${effectiveC(store.project, pipe)}` : '',
        onCommit: (v) => set((pp) => (pp.c = v)),
      }),
      effectiveC(store.project, pipe) !== pipe.c ? h('p', { class: 'auto-fittings' }, `Se calcula con C = ${effectiveC(store.project, pipe)} (sistema seco o de preacción).`) : null,
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
      fittingRows.length ? fittingRows : h('p', { style: 'margin:0;color:var(--muted);font-size:13px' }, auto ? 'Sin accesorios puestos a mano.' : 'Sin accesorios hidráulicos.'),
      auto
        ? h(
            'p',
            { class: 'auto-fittings', title: 'Deducidos del dibujo. Se apagan en el panel izquierdo, Herramientas de diseño.' },
            'Automáticos: ',
            auto.map((f) => `${f.count} ${FITTING_NAMES[f.type].toLowerCase()}`).join(', '),
          )
        : null,
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
                  store.mutate((p) => (sid = withModel(p, addSprinkler(p, id, 5.6))));
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
              store.mutate((p) => {
                const spk = addDropWithSprinkler(p, id, dropFt, 5.6);
                sid = spk ? withModel(p, spk) : '';
              });
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
      selectField<string>(
        'Modelo',
        s.modelId && findSprinklerModel(s.modelId) ? s.modelId : '',
        [{ value: '', label: 'Datos propios (sin modelo)' }, ...catalogSprinklers().map((m) => ({ value: m.id, label: m.name }))],
        'spk-model-id',
        (mid) =>
          store.mutate((p) => {
            const x = p.sprinklers.find((y) => y.id === id)!;
            const model = findSprinklerModel(mid);
            if (!model) {
              delete x.modelId;
              return;
            }
            putInProjectCatalog(p, 'sprinklers', model);
            applySprinklerModel(x, model);
          }),
      ),
      numField({
        label: 'Factor K',
        q: 'kfactor',
        value: s.k,
        key: 'spk-k',
        min: 0.1,
        onCommit: (v) =>
          set((x) => {
            x.k = v;
            delete x.modelId; // ya no corresponde al modelo del catálogo
          }),
      }),
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
            class: 'btn outline small',
            title: `Cuelga el rociador bajo el ramal con un bajante de ${fmt('length', multiForm.drop, u, true)} (o cambia el largo del que tiene)`,
            onclick: () => store.mutate((p) => setDrops(p, [id], multiForm.drop)),
          },
          'Bajante',
        ),
        h('button', { class: 'btn outline small', title: 'Quita el bajante: el rociador queda sobre el ramal', onclick: () => store.mutate((p) => setDrops(p, [id], 0)) }, 'Sobre el ramal'),
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

function elementPanel(id: string): HTMLElement {
  const e = (store.project.elements ?? []).find((x) => x.id === id)!;
  const u = store.project.displayUnits;
  const t = getElementType(e.typeId, store.project);
  const shape = ELEMENT_KIND_SHAPE[t.kind];
  const set = (fn: (x: typeof e) => void, key?: string) =>
    store.mutate((p) => {
      fn((p.elements ?? []).find((x) => x.id === id)!);
    }, key);
  let length = 0;
  for (let i = 0; i + 1 < e.points.length; i++) length += Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
  let area = 0;
  if (shape === 'area') {
    for (let i = 0; i < e.points.length; i++) {
      const a = e.points[i];
      const b = e.points[(i + 1) % e.points.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
  }
  const zLabel = t.kind === 'beam' ? 'Fondo de la viga' : t.kind === 'duct' || t.kind === 'pipe-ref' ? 'Elevación del eje' : t.kind === 'ceiling' ? 'Altura del cielo' : 'Elevación de la base';
  return h(
    'div',
    null,
    h('section', { class: 'section' }, title(`${ELEMENT_KIND_NAMES[t.kind]} ${id}`, t.name)),
    h(
      'section',
      { class: 'section' },
      selectField<string>(
        'Tipo',
        e.typeId,
        catalogElements()
          .filter((x) => ELEMENT_KIND_SHAPE[x.kind] === shape)
          .map((x) => ({ value: x.id, label: x.name })),
        'el-type',
        (tid) =>
          store.mutate((p) => {
            const type = catalogElements().find((x) => x.id === tid);
            if (!type) return;
            putInProjectCatalog(p, 'elements', type);
            const x = (p.elements ?? []).find((y) => y.id === id)!;
            x.typeId = tid;
          }),
      ),
      numField({ label: zLabel, q: 'elevation', value: e.z, key: 'el-z', onCommit: (v) => set((x) => (x.z = v)) }),
      numField({
        label: t.kind === 'beam' ? 'Peralte' : shape === 'area' ? 'Espesor' : 'Alto',
        q: 'length',
        value: e.height,
        placeholder: fmt('length', t.height, u),
        allowEmpty: true,
        min: 0.001,
        key: 'el-h',
        hint: 'Déjelo vacío para usar el del tipo',
        onCommit: (v) => set((x) => (x.height = v)),
        onClear: () => set((x) => delete x.height),
      }),
      shape !== 'area'
        ? numField({
            label: t.kind === 'wall' ? 'Espesor' : t.kind === 'pipe-ref' ? 'Diámetro' : 'Ancho',
            q: 'length',
            value: e.width,
            placeholder: fmt('length', t.width, u),
            allowEmpty: true,
            min: 0.001,
            key: 'el-w',
            hint: 'Déjelo vacío para usar el del tipo',
            onCommit: (v) => set((x) => (x.width = v)),
            onClear: () => set((x) => delete x.width),
          })
        : null,
      shape === 'line' ? readout([['Longitud', fmt('length', length, u, true)]]) : null,
      shape === 'area' ? readout([['Área', fmt('area', area, u, true)]]) : null,
    ),
    h(
      'section',
      { class: 'section' },
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn outline small', onclick: () => openCatalog('elements', t.id) }, 'Ver el tipo en el catálogo'),
        h(
          'button',
          {
            class: 'btn outline small danger',
            onclick: () => {
              store.mutate((p) => deleteElement(p, id));
              store.select(null);
            },
          },
          'Eliminar',
        ),
      ),
    ),
  );
}

// ---------- Varios objetos ----------

/** Conexión con la vista: marcar dos puntos en el dibujo para tomar un desplazamiento */
export const editHooks: { pickVector: (done: (dx: number, dy: number, dz: number) => void) => void } = {
  pickVector: () => undefined,
};

const multiForm = { count: 1, dx: 0, dy: 0, dz: 0, mx: 0, my: 0, mz: 0, drop: 0.3 / 0.3048, size: '' as NominalSize | '' };

function multiPanel(items: ItemSet): HTMLElement {
  const p = store.project;
  const u = p.displayUnits;
  const metric = u === 'metric';
  const f = multiForm;
  const n = itemCount(items);
  const parts = [
    items.pipes.length ? `${items.pipes.length} tubo${items.pipes.length > 1 ? 's' : ''}` : '',
    items.sprinklers.length ? `${items.sprinklers.length} rociador${items.sprinklers.length > 1 ? 'es' : ''}` : '',
    items.nodes.length ? `${items.nodes.length} nodo${items.nodes.length > 1 ? 's' : ''}` : '',
    items.elements.length ? `${items.elements.length} elemento${items.elements.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  const vec = (prefix: 'd' | 'm', keyBase: string) =>
    (['x', 'y', 'z'] as const).map((axis) => {
      const field = `${prefix}${axis}` as 'dx' | 'dy' | 'dz' | 'mx' | 'my' | 'mz';
      return numField({
        label: axis === 'z' ? 'Desplazamiento Z (altura)' : `Desplazamiento ${axis.toUpperCase()}`,
        q: 'length',
        value: f[field],
        key: `${keyBase}-${axis}`,
        onCommit: (v) => (f[field] = v),
      });
    });
  const pickInto = (target: 'd' | 'm') => () =>
    editHooks.pickVector((dx, dy, dz) => {
      if (target === 'd') Object.assign(f, { dx, dy, dz });
      else Object.assign(f, { mx: dx, my: dy, mz: dz });
      store.select(store.selection); // volver a pintar el panel
    });

  const spkIds = closeItems(p, items).sprinklers;
  const pipeIds = items.pipes;
  const sizes = [...new Set(p.pipes.filter((x) => pipeIds.includes(x.id)).flatMap((x) => sizesFor(x.material, p)))];
  if (!f.size || !sizes.includes(f.size)) f.size = sizes.includes('1-1/4') ? '1-1/4' : (sizes[0] ?? '');

  const after = (fn: () => string | void) => {
    const msg = fn();
    if (msg) flashMsg(msg);
  };

  return h(
    'div',
    null,
    h('section', { class: 'section' }, title(`${n} objetos`, parts.join(', '))),
    h(
      'section',
      { class: 'section' },
      h('h2', null, 'Repetir'),
      h('p', { class: 'muted-text' }, 'Hace copias en fila. Donde una copia cae sobre un tubo o un nodo de la red, se une sola (por ejemplo, un ramal copiado sobre la matriz).'),
      numField({ label: 'Copias', value: f.count, key: 'rep-count', min: 1, max: 500, digits: 0, unit: 'und', onCommit: (v) => (f.count = Math.round(v)) }),
      vec('d', 'rep'),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn outline small', title: 'Marque dos puntos en el dibujo (se ajustan a los nodos)', onclick: pickInto('d') }, 'Tomar del dibujo'),
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: () => {
              if (Math.hypot(f.dx, f.dy, f.dz) < 1e-6) return flashMsg('Ponga un desplazamiento distinto de cero');
              let created: ItemSet | undefined;
              let joined = 0;
              store.mutate((pp) => {
                const r = repeatItems(pp, items, f.count, f.dx, f.dy, f.dz);
                created = r.created;
                joined = r.joined;
              });
              const c = created!;
              const sel = selectionFrom({ nodes: [], pipes: [...items.pipes, ...c.pipes], sprinklers: [...items.sprinklers, ...c.sprinklers], elements: [...items.elements, ...c.elements] });
              store.select(sel);
              flashMsg(`${f.count} copia${f.count > 1 ? 's' : ''} hecha${f.count > 1 ? 's' : ''}${joined ? `; ${joined} unión${joined > 1 ? 'es' : ''} con la red` : ''}.`);
            },
          },
          'Repetir',
        ),
      ),
    ),
    h(
      'section',
      { class: 'section' },
      h('h2', null, 'Mover'),
      vec('m', 'mov'),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn outline small', title: 'Marque dos puntos en el dibujo (se ajustan a los nodos)', onclick: pickInto('m') }, 'Tomar del dibujo'),
        h(
          'button',
          {
            class: 'btn primary small',
            onclick: () => {
              if (Math.hypot(f.mx, f.my, f.mz) < 1e-6) return flashMsg('Ponga un desplazamiento distinto de cero');
              store.mutate((pp) => moveItems(pp, items, f.mx, f.my, f.mz));
            },
          },
          'Mover',
        ),
      ),
    ),
    spkIds.length
      ? h(
          'section',
          { class: 'section' },
          h('h2', null, `Rociadores (${spkIds.length})`),
          numField({ label: 'Largo del bajante', q: 'length', value: f.drop, key: 'multi-drop', min: 0, onCommit: (v) => (f.drop = v) }),
          h(
            'div',
            { class: 'btn-row' },
            h(
              'button',
              {
                class: 'btn outline small',
                title: 'Cuelga cada rociador bajo su ramal con un bajante de 1" (si ya tiene, cambia el largo)',
                onclick: () =>
                  after(() => {
                    let c = 0;
                    store.mutate((pp) => (c = setDrops(pp, spkIds, f.drop)));
                    return `${c} rociador${c === 1 ? '' : 'es'} con bajante de ${fmt('length', f.drop, u, true)}`;
                  }),
              },
              'Poner bajantes',
            ),
            h(
              'button',
              {
                class: 'btn outline small',
                onclick: () =>
                  after(() => {
                    let c = 0;
                    store.mutate((pp) => (c = setDrops(pp, spkIds, 0)));
                    return `${c} rociador${c === 1 ? '' : 'es'} sobre el ramal`;
                  }),
              },
              'Quitar bajantes',
            ),
          ),
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn outline small', onclick: () => store.mutate((pp) => pp.sprinklers.forEach((x) => spkIds.includes(x.id) && (x.inDesignArea = true))) }, 'Abrir en el área'),
            h('button', { class: 'btn outline small', onclick: () => store.mutate((pp) => pp.sprinklers.forEach((x) => spkIds.includes(x.id) && (x.inDesignArea = false))) }, 'Cerrar'),
          ),
          selectField<string>(
            'Modelo',
            '',
            [{ value: '', label: 'Cambiar modelo a…' }, ...catalogSprinklers().map((m) => ({ value: m.id, label: m.name }))],
            'multi-model',
            (mid) => {
              const model = findSprinklerModel(mid);
              if (!model) return;
              store.mutate((pp) => {
                putInProjectCatalog(pp, 'sprinklers', model);
                for (const x of pp.sprinklers) if (spkIds.includes(x.id)) applySprinklerModel(x, model);
              });
            },
          ),
        )
      : null,
    pipeIds.length
      ? h(
          'section',
          { class: 'section' },
          h('h2', null, `Tubos (${pipeIds.length})`),
          sizes.length
            ? h(
                'div',
                { class: 'btn-row' },
                selectInput<NominalSize>('Diámetro', f.size as NominalSize, sizes.map((x) => ({ value: x, label: metric ? `${sizeLabel(x, true)} (${x}")` : `${x}"` })), 'multi-size', (v) => (f.size = v)),
                h(
                  'button',
                  {
                    class: 'btn outline small',
                    onclick: () =>
                      after(() => {
                        let c = 0;
                        store.mutate((pp) => (c = setPipeSize(pp, pipeIds, f.size as NominalSize)));
                        return `${c} tubo${c === 1 ? '' : 's'} cambiado${c === 1 ? '' : 's'}`;
                      }),
                  },
                  'Cambiar diámetro',
                ),
              )
            : null,
          h(
            'div',
            { class: 'btn-row' },
            h('button', { class: 'btn outline small', title: 'Diámetros mínimos de la tabla de NFPA 13 para estos tubos', onclick: () => runSizing(pipeIds) }, 'Dimensionar por tabla'),
          ),
        )
      : null,
    h(
      'section',
      { class: 'section' },
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            class: 'btn outline small danger',
            onclick: () => {
              store.mutate((pp) => deleteItems(pp, items));
              store.select(null as Selection);
            },
          },
          'Borrar todo',
        ),
        h('button', { class: 'btn outline small', onclick: () => store.select(null) }, 'Quitar selección'),
      ),
      h('p', { class: 'muted-text' }, 'Mayús + arrastrar selecciona por ventana; Ctrl + clic agrega o quita un objeto.'),
    ),
  );
}

function flashMsg(msg: string) {
  flash(msg);
}
