/**
 * Panel izquierdo: veredicto del cálculo, datos del proyecto, criterios y suministro.
 */
import {
  fmt,
  HAZARD_NAMES,
  HAZARDS,
  SCHEDULE_CLASS_NAMES,
  scheduleClassFor,
  sizeBySchedule,
  checkDesignArea,
  checkSystem,
  defaultPump,
  effectiveDesignArea,
  suggestPump,
  SYSTEM_TYPE_NAMES,
  type SystemType,
  suggestDesignArea,
  unitLabel,
  type HazardId,
  type SizingResult,
} from '../../core';
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
        h('li', null, 'Use ', h('b', null, 'Llenar recinto'), ' para poner rociadores y tubería en cada cuarto, o dibuje a mano con ', h('b', null, 'Tubería'), ' y ', h('b', null, 'Rociador'), '.'),
        h('li', null, 'Una la red al punto de suministro con ', h('b', null, 'Tubería'), ' y pulse ', h('b', null, 'Sugerir área remota'), '.'),
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
  chart.innerHTML = supplyChartSvg(r, u, 272, 190, {}, store.project.supply);
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
    selectField<SystemType>(
      'Tipo de sistema',
      c.systemType ?? 'wet',
      (Object.keys(SYSTEM_TYPE_NAMES) as SystemType[]).map((id) => ({ value: id, label: SYSTEM_TYPE_NAMES[id] })),
      'crit-system',
      (t) => store.mutate((p) => (p.criteria.systemType = t)),
    ),
    systemExtras(),
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

/** Lo que cambia con el tipo de sistema: área aumentada, acelerador y volumen de la parte seca */
function systemExtras(): HTMLElement | null {
  const p = store.project;
  const u = p.displayUnits;
  const chk = checkSystem(p);
  if (chk.type === 'wet') return null;
  const rows: HTMLElement[] = [];
  if (chk.areaFactor > 1) rows.push(h('dt', null, 'Área de cálculo'), h('dd', null, `${fmt('area', effectiveDesignArea(p), u, true)} (+30 %)`));
  if (chk.volume !== undefined) {
    const over = chk.volume > (chk.volumeLimit ?? Infinity);
    rows.push(
      h('dt', { title: 'Agua que cabe en la tubería después de la válvula (sin la alimentación ni el montante)' }, 'Volumen parte seca'),
      h('dd', { class: over ? 'bad' : '' }, `${fmt('volume', chk.volume, u, true)} (límite ${fmt('volume', chk.volumeLimit!, u, true)})`),
    );
  }
  const qod = h('input', { type: 'checkbox', checked: !!p.criteria.quickOpening, 'data-key': 'crit-qod' });
  qod.addEventListener('change', () => store.mutate((pp) => (pp.criteria.quickOpening = qod.checked)));
  return h(
    'div',
    null,
    chk.type === 'dry' ? h('label', { class: 'check', title: 'Con acelerador o dispositivo de apertura rápida el límite sube de 500 a 750 gal' }, qod, 'Válvula con acelerador (apertura rápida)') : null,
    rows.length ? h('dl', { class: 'readout' }, rows) : null,
  );
}

function supplySection(): HTMLElement {
  const p = store.project;
  const s = p.supply;
  const u = p.displayUnits;
  const r = store.result;
  const nodes = p.nodes.map((n) => ({ value: n.id, label: n.label ? `${n.id} (${n.label})` : n.id }));
  const tank = s.source === 'tank';
  const pump = s.pump;
  const pumpOn = !!pump?.enabled;
  const pumpBox = h('input', { type: 'checkbox', checked: pumpOn, 'data-key': 'sup-pump' });
  pumpBox.addEventListener('change', () =>
    store.mutate((pp) => {
      pp.supply.pump = { ...(pp.supply.pump ?? defaultPump()), enabled: pumpBox.checked };
    }),
  );
  const setPump = (fn: (x: NonNullable<typeof pump>) => void) =>
    store.mutate((pp) => {
      if (pp.supply.pump) fn(pp.supply.pump);
    });
  const sc = r.ok ? r.supply : undefined;
  const opRows: HTMLElement[] = [];
  if (sc?.pump) {
    opRows.push(
      h('dt', null, 'Trabaja al'),
      h('dd', { class: sc.pump.percentOfRated > 150 ? 'bad' : '' }, `${sc.pump.percentOfRated.toFixed(0)} % del caudal nominal`),
      h('dt', null, 'Presión de la bomba'),
      h('dd', null, fmt('pressure', sc.pump.pressureAtDemand, u, true)),
      h('dt', null, tank ? 'Presión del tanque' : 'Presión en la succión'),
      h('dd', { class: !tank && sc.sourcePressure < 20 ? 'bad' : '' }, fmt('pressure', sc.sourcePressure, u, true)),
    );
  }
  if (sc?.tank) {
    opRows.push(
      h('dt', null, 'Volumen necesario'),
      h('dd', { class: (sc.tank.volume ?? 0) < sc.tank.requiredVolume ? 'bad' : '' }, `${fmt('volume', sc.tank.requiredVolume, u, true)} (${p.criteria.duration} min)`),
    );
  }
  const suggest = () => {
    const res = store.result;
    if (!res.ok || !res.supply) return flash('Primero el cálculo tiene que funcionar (revise los avisos)');
    const sg = suggestPump(p.supply, res.supply.demandFlow, res.supply.demandPressure, p.criteria.minSafetyMargin);
    if (!sg.pump) return flash('La fuente sola alcanza: no hace falta bomba.');
    store.mutate((pp) => (pp.supply.pump = sg.pump!));
    flash(`Bomba sugerida: ${fmt('flow', sg.pump.ratedFlow, u, true)} a ${fmt('pressure', sg.pump.ratedPressure, u, true)}. Confirme con la curva del fabricante.`);
  };
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Suministro de agua'),
    selectField('Punto de conexión', s.nodeId, nodes, 'sup-node', (id) => store.mutate((pp) => (pp.supply.nodeId = id))),
    selectField<'hydrant' | 'tank'>(
      'Fuente',
      tank ? 'tank' : 'hydrant',
      [
        { value: 'hydrant', label: 'Red pública (prueba de hidrante)' },
        { value: 'tank', label: 'Tanque' },
      ],
      'sup-source',
      (v) => store.mutate((pp) => (pp.supply.source = v)),
    ),
    tank
      ? [
          numField({
            label: 'Nivel del agua',
            q: 'elevation',
            value: s.tankHeadFt ?? 0,
            key: 'sup-tank-head',
            hint: 'Altura del nivel mínimo del agua sobre el punto de conexión (negativa si está más abajo)',
            onCommit: (v) => store.mutate((pp) => (pp.supply.tankHeadFt = v)),
          }),
          numField({ label: 'Volumen del tanque', q: 'volume', value: s.tankVolume, key: 'sup-tank-vol', min: 0, allowEmpty: true, onCommit: (v) => store.mutate((pp) => (pp.supply.tankVolume = v)), onClear: () => store.mutate((pp) => delete pp.supply.tankVolume) }),
        ]
      : [
          numField({ label: 'Presión estática', q: 'pressure', value: s.staticPressure, key: 'sup-static', min: 0, onCommit: (v) => store.mutate((pp) => (pp.supply.staticPressure = v)) }),
          numField({ label: 'Presión residual', q: 'pressure', value: s.residualPressure, key: 'sup-res', min: 0, onCommit: (v) => store.mutate((pp) => (pp.supply.residualPressure = v)) }),
          numField({ label: 'Caudal en la prueba', q: 'flow', value: s.residualFlow, key: 'sup-flow', min: 0.01, onCommit: (v) => store.mutate((pp) => (pp.supply.residualFlow = v)) }),
        ],
    h('label', { class: 'check', title: 'Bomba contra incendio (NFPA 20) en el punto de conexión' }, pumpBox, 'Bomba contra incendio'),
    pumpOn
      ? [
          numField({ label: 'Caudal nominal', q: 'flow', value: pump!.ratedFlow, key: 'pump-q', min: 1, onCommit: (v) => setPump((x) => (x.ratedFlow = v)) }),
          numField({ label: 'Presión nominal', q: 'pressure', value: pump!.ratedPressure, key: 'pump-p', min: 0.1, hint: 'Presión neta (lo que suma la bomba) al caudal nominal', onCommit: (v) => setPump((x) => (x.ratedPressure = v)) }),
          numField({ label: 'A caudal cero', unit: '%', value: pump!.churnPct, key: 'pump-churn', min: 100, max: 200, digits: 0, hint: 'Presión a caudal cero en % de la nominal (NFPA 20: hasta 140 %)', onCommit: (v) => setPump((x) => (x.churnPct = v)) }),
          numField({ label: 'Al 150 % del caudal', unit: '%', value: pump!.at150Pct, key: 'pump-150', min: 0, max: 100, digits: 0, hint: 'Presión al 150 % del caudal, en % de la nominal (NFPA 20: al menos 65 %)', onCommit: (v) => setPump((x) => (x.at150Pct = v)) }),
          textField('Marca y modelo', pump!.model, 'pump-model', (v) => setPump((x) => (x.model = v || undefined))),
        ]
      : null,
    opRows.length ? h('dl', { class: 'readout' }, opRows) : null,
    h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        { class: 'btn outline small', title: 'Caudal nominal y presión mínimos para cubrir la demanda con el margen exigido', onclick: suggest },
        'Sugerir bomba',
      ),
    ),
  );
}

/** Conexión con la vista para ubicar el área de diseño con el mouse */
export const designHooks = { placeArea: () => undefined as void };

function areaSection(): HTMLElement {
  const r = store.result;
  const u = store.project.displayUnits;
  const chk = checkDesignArea(store.project);
  const flowing = store.project.sprinklers.filter((s) => s.inDesignArea);
  const rows: (HTMLElement | null)[] = [];
  const row = (k: string, v: string, bad = false, title = '') => rows.push(h('dt', { title }, k), h('dd', { class: bad ? 'bad' : '', title }, v));
  if (chk) {
    const rule = chk.rule;
    row('Rociadores abiertos', `${chk.flowing} de ${rule.count}`, !chk.countOk, `Área de diseño ÷ cobertura por rociador = ${rule.count}`);
    row('Área que cubren', `${fmt('area', chk.coverage, u, true)} de ${fmt('area', rule.area, u, true)}`, !chk.coverageOk);
    row(
      'Lado paralelo a ramales',
      `${fmt('length', chk.parallel, u, true)} (mín. ${fmt('length', rule.minParallel, u, true)})`,
      !chk.shapeOk,
      `NFPA 13: el área es rectangular y su lado paralelo a los ramales mide al menos 1,2·√A. Son ${rule.perLine} rociadores por ramal.`,
    );
    if (r.ok) row('Rociador más exigido', r.criticalSprinklerId ?? '—');
  } else {
    row('Rociadores abiertos', String(flowing.length));
  }
  const suggest = () => {
    flash('Buscando el área más exigente…');
    // dejar que se pinte el aviso antes del cálculo
    setTimeout(() => {
      const ids = suggestDesignArea(store.project);
      if (!ids.length) return flash('No se pudo sugerir un área: revise que la red esté conectada al suministro');
      store.mutate((p) => p.sprinklers.forEach((s) => (s.inDesignArea = ids.includes(s.id))));
      flash(`Área remota con ${ids.length} rociadores: la de forma NFPA 13 que más exige al suministro.`);
    }, 30);
  };
  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Área de diseño'),
    h('dl', { class: 'readout' }, rows),
    h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        {
          class: 'btn outline small',
          title: 'Prueba los rectángulos posibles (N rociadores, 1,2·√A paralelo a los ramales) y deja el que más exige al suministro',
          onclick: suggest,
        },
        'Sugerir área remota',
      ),
      h('button', { class: 'btn outline small', title: 'Mueva el rectángulo del área con el mouse y haga clic donde va (tecla A)', onclick: () => designHooks.placeArea() }, 'Ubicar con el mouse'),
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
    h(
      'div',
      { class: 'btn-row' },
      h(
        'button',
        {
          class: 'btn outline small',
          title: 'Pone a cada tubo el diámetro mínimo de la tabla de NFPA 13 según los rociadores que alimenta (la alimentación enterrada no se toca)',
          onclick: () => runSizing(),
        },
        'Dimensionar tubería por tabla',
      ),
    ),
  );
}

/** Dimensiona toda la red (o los tubos dados) y avisa qué pasó */
export function runSizing(pipeIds?: string[]) {
  const c = store.project.criteria;
  const cls = scheduleClassFor(c.hazard, c.density);
  let r: SizingResult | undefined;
  store.mutate((p) => {
    r = sizeBySchedule(p, { pipeIds });
  });
  const n = Object.keys(r!.changed).length;
  const head = n
    ? `Se cambió el diámetro de ${n} tubo${n > 1 ? 's' : ''} con la tabla de ${SCHEDULE_CLASS_NAMES[cls].toLowerCase()}.`
    : `Los diámetros ya cumplen la tabla de ${SCHEDULE_CLASS_NAMES[cls].toLowerCase()}.`;
  flash([head, ...r!.warnings].join(' '));
}
