/**
 * Panel izquierdo: veredicto del cálculo, datos del proyecto, criterios y suministro.
 */
import { fmt, HAZARD_NAMES, HAZARDS, suggestDesignArea, unitLabel, type HazardId } from '../../core';
import { clear, h } from './dom';
import { flash, numField, rerender, selectField, textField } from './fields';
import { planSection } from './planPanel';
import { store } from './state';
import { supplyChartSvg } from './supplyChart';

export function renderLeft(el: HTMLElement) {
  rerender(el, () => clear(el, verdict(), planSection(), projectSection(), criteriaSection(), supplySection(), areaSection(), designToolsSection()));
}

function verdict(): HTMLElement {
  const r = store.result;
  const u = store.project.displayUnits;
  // proyecto en blanco: en vez de errores, los primeros pasos
  if (!store.project.pipes.length && !store.project.sprinklers.length) {
    return h(
      'section',
      { class: 'verdict start', 'aria-live': 'polite' },
      h('div', { class: 'verdict-head' }, h('div', { class: 'verdict-state' }, 'Proyecto en blanco')),
      h(
        'ol',
        { class: 'verdict-steps' },
        h('li', null, 'Cargue el plano en ', h('b', null, 'Plano de fondo'), ' (DWG, DXF, PDF o imagen).'),
        h('li', null, 'Dibuje la red con la herramienta ', h('b', null, 'Tubería'), ', empezando en el punto de suministro.'),
        h('li', null, 'Ponga los rociadores con la herramienta ', h('b', null, 'Rociador'), '.'),
        h('li', null, 'Llene el criterio de diseño y el suministro de agua más abajo.'),
      ),
      h('p', { class: 'muted-text' }, 'Para ver un sistema terminado, abra Archivo → Ejemplos.'),
    );
  }
  if (!r.ok) {
    return h(
      'section',
      { class: 'verdict error', 'aria-live': 'polite' },
      h('div', { class: 'verdict-head' }, h('div', { class: 'verdict-state' }, 'Falta información para calcular')),
      h('ul', { class: 'verdict-errors' }, r.errors.slice(0, 5).map((e) => h('li', null, e))),
    );
  }
  const s = r.supply!;
  const pass = s.pass;
  const num = (value: string, unit: string, label: string) => h('div', null, h('b', null, value, h('i', null, unit)), h('span', null, label));
  const chart = h('div', { class: 'verdict-chart' });
  chart.innerHTML = supplyChartSvg(r, u, 272, 190);
  return h(
    'section',
    { class: `verdict ${pass ? 'pass' : 'fail'}`, 'aria-live': 'polite' },
    h(
      'div',
      { class: 'verdict-head' },
      h('div', { class: 'verdict-state' }, pass ? 'El suministro alcanza' : 'El suministro no alcanza'),
      h('div', { class: 'verdict-margin', title: 'Diferencia entre la presión disponible y la requerida' }, `${s.margin >= 0 ? '+' : ''}${fmt('pressure', s.margin, u, true)}`),
    ),
    h(
      'div',
      { class: 'verdict-nums' },
      num(fmt('pressure', s.demandPressure, u), unitLabel('pressure', u), 'requerida en el suministro'),
      num(fmt('flow', s.demandFlow, u), unitLabel('flow', u), 'caudal total con mangueras'),
      num(fmt('pressure', s.availablePressure, u), unitLabel('pressure', u), 'disponible con ese caudal'),
      num(fmt('flow', r.sprinklerFlow, u), unitLabel('flow', u), `${r.designArea.flowingCount} rociadores abiertos`),
    ),
    chart,
  );
}

function projectSection(): HTMLElement {
  const info = store.project.info;
  const set = (k: keyof typeof info) => (v: string) =>
    store.mutate((p) => {
      p.info[k] = v;
    });
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Proyecto'),
    textField('Nombre', info.name, 'info-name', (v) => {
      set('name')(v);
      store.setDirty(true);
    }),
    textField('Cliente', info.client, 'info-client', set('client')),
    textField('Dirección', info.address, 'info-address', set('address')),
    textField('Diseñador', info.designer, 'info-designer', set('designer')),
    textField('Notas', info.notes, 'info-notes', set('notes'), true),
  );
}

function criteriaSection(): HTMLElement {
  const c = store.project.criteria;
  const custom = (fn: () => void) =>
    store.mutate((p) => {
      fn();
      p.criteria.hazard = 'custom';
    });
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Criterio de diseño'),
    selectField<HazardId>(
      'Riesgo',
      c.hazard,
      (Object.keys(HAZARD_NAMES) as HazardId[]).map((id) => ({ value: id, label: HAZARD_NAMES[id] })),
      'crit-hazard',
      (id) =>
        store.mutate((p) => {
          p.criteria.hazard = id;
          if (id !== 'custom') {
            const hz = HAZARDS[id];
            p.criteria.density = hz.density;
            p.criteria.area = hz.area;
            p.criteria.hoseAllowance = hz.hoseAllowance;
            p.criteria.duration = hz.duration;
          }
        }),
    ),
    numField({ label: 'Densidad', q: 'density', value: c.density, key: 'crit-density', min: 0.001, onCommit: (v) => custom(() => (store.project.criteria.density = v)) }),
    numField({ label: 'Área de diseño', q: 'area', value: c.area, key: 'crit-area', min: 1, onCommit: (v) => custom(() => (store.project.criteria.area = v)) }),
    numField({
      label: 'Mangueras',
      q: 'flow',
      value: c.hoseAllowance,
      key: 'crit-hose',
      min: 0,
      hint: 'Asignación para mangueras interiores y exteriores; se suma en el punto de suministro',
      onCommit: (v) => store.mutate((p) => (p.criteria.hoseAllowance = v), 'crit-hose'),
    }),
    numField({
      label: 'Presión mínima por rociador',
      q: 'pressure',
      value: c.minSprinklerPressure,
      key: 'crit-minp',
      min: 0,
      onCommit: (v) => store.mutate((p) => (p.criteria.minSprinklerPressure = v)),
    }),
    numField({ label: 'Duración', unit: 'min', value: c.duration, key: 'crit-dur', min: 0, digits: 0, onCommit: (v) => store.mutate((p) => (p.criteria.duration = v)) }),
    numField({
      label: 'Velocidad máxima',
      q: 'velocity',
      value: c.maxVelocity,
      key: 'crit-vmax',
      min: 0,
      onCommit: (v) => store.mutate((p) => (p.criteria.maxVelocity = v)),
    }),
    numField({
      label: 'Margen mínimo exigido',
      q: 'pressure',
      value: c.minSafetyMargin,
      key: 'crit-margin',
      onCommit: (v) => store.mutate((p) => (p.criteria.minSafetyMargin = v)),
    }),
  );
}

function supplySection(): HTMLElement {
  const s = store.project.supply;
  const nodes = store.project.nodes.map((n) => ({ value: n.id, label: n.label ? `${n.id} (${n.label})` : n.id }));
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Suministro de agua'),
    selectField('Punto de conexión', s.nodeId, nodes, 'sup-node', (id) => store.mutate((p) => (p.supply.nodeId = id))),
    numField({ label: 'Presión estática', q: 'pressure', value: s.staticPressure, key: 'sup-static', min: 0, onCommit: (v) => store.mutate((p) => (p.supply.staticPressure = v)) }),
    numField({ label: 'Presión residual', q: 'pressure', value: s.residualPressure, key: 'sup-res', min: 0, onCommit: (v) => store.mutate((p) => (p.supply.residualPressure = v)) }),
    numField({ label: 'Caudal en la prueba', q: 'flow', value: s.residualFlow, key: 'sup-flow', min: 0.01, onCommit: (v) => store.mutate((p) => (p.supply.residualFlow = v)) }),
  );
}

function areaSection(): HTMLElement {
  const r = store.result;
  const u = store.project.displayUnits;
  const flowing = store.project.sprinklers.filter((s) => s.inDesignArea);
  const cov = flowing.reduce((a, s) => a + s.coverage, 0);
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Área de diseño'),
    h(
      'dl',
      { class: 'readout' },
      h('dt', null, 'Rociadores abiertos'),
      h('dd', null, String(flowing.length)),
      h('dt', null, 'Área que cubren'),
      h('dd', { class: cov + 1e-6 < store.project.criteria.area ? 'bad' : '' }, fmt('area', cov, u, true)),
      r.ok ? [h('dt', null, 'Rociador más exigido'), h('dd', null, r.criticalSprinklerId ?? '—')] : null,
    ),
    h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        {
          class: 'btn outline small',
          title: 'Abre los rociadores hidráulicamente más lejanos hasta cubrir el área de diseño',
          onclick: () => {
            const ids = suggestDesignArea(store.project);
            if (!ids.length) return flash('No se pudo sugerir un área: revise que la red esté conectada al suministro');
            store.mutate((p) => p.sprinklers.forEach((s) => (s.inDesignArea = ids.includes(s.id))));
            flash(`Área sugerida con ${ids.length} rociadores. Revise que su forma cumpla la norma.`);
          },
        },
        'Sugerir área remota',
      ),
      h(
        'button',
        { class: 'btn outline small', onclick: () => store.mutate((p) => p.sprinklers.forEach((s) => (s.inDesignArea = false))) },
        'Cerrar todos',
      ),
    ),
  );
}

function designToolsSection(): HTMLElement {
  const auto = h('input', { type: 'checkbox', checked: !!store.project.autoFittings, 'data-key': 'auto-fittings' });
  auto.addEventListener('change', () => store.mutate((p) => (p.autoFittings = auto.checked)));
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Herramientas de diseño'),
    h(
      'label',
      { class: 'check', title: 'Suma al cálculo los codos y tees que se ven en el dibujo: tee en cada derivación y codo en cada cambio de dirección' },
      auto,
      'Codos y tees automáticos en el cálculo',
    ),
  );
}
