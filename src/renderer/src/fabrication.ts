/**
 * Pestaña de fabricación: soportes y lista de corte, y su hoja para imprimir.
 */
import {
  buildCutList,
  checkHangers,
  cutListCsv,
  fmt,
  getMaterial,
  hangerRodLength,
  hangerTypeName,
  NOMINAL_SIZES,
  placeHangers,
  rodDiameter,
  sizeLabel,
  type CutList,
  type NominalSize,
  type UnitSystem,
} from '../../core';
import { clear, h } from './dom';
import { flash, numInput, selectInput } from './fields';
import { selectionFrom, store } from './state';

/** Largo de corte: en mm (métrico) o en pies y pulgadas al 1/8" (US) */
export function fmtCut(ftLen: number, units: UnitSystem): string {
  if (units === 'metric') return `${Math.round(ftLen * 304.8)} mm`;
  const totalEighths = Math.round(ftLen * 96);
  const sign = totalEighths < 0 ? '-' : '';
  const e = Math.abs(totalEighths);
  const feet = Math.floor(e / 96);
  const inchEighths = e - feet * 96;
  const inches = Math.floor(inchEighths / 8);
  let frac = inchEighths % 8;
  let den = 8;
  while (frac && frac % 2 === 0) {
    frac /= 2;
    den /= 2;
  }
  const fr = frac ? `-${frac}/${den}` : '';
  return feet ? `${sign}${feet}' ${inches}${fr}"` : `${sign}${inches}${fr}"`;
}

/** Descuento en pulgadas (US) o milímetros */
const fmtTakeOff = (inches: number, units: UnitSystem) => (units === 'metric' ? `${Math.round(inches * 25.4)} mm` : `${inches.toFixed(2).replace('.', ',')}"`);

export const fabricationHooks = {
  /** guarda el CSV (la app pone el diálogo de guardar) */
  saveCsv: async (_content: string, _name: string): Promise<void> => undefined,
  /** imprime la hoja de fabricación en PDF */
  printSheet: async (): Promise<void> => undefined,
};

export function fabricationTab(el: HTMLElement) {
  const p = store.project;
  const u = p.displayUnits;
  const metric = u === 'metric';
  const chk = checkHangers(p);
  const list = buildCutList(p);

  // --- Soportes
  const hangers = (p.hangers ?? []).filter((hg) => p.pipes.some((x) => x.id === hg.pipeId));
  const byType = new Map<string, { label: string; n: number; rod: number }>();
  for (const hg of hangers) {
    const pipe = p.pipes.find((x) => x.id === hg.pipeId)!;
    const key = `${hg.kind}|${pipe.size}`;
    const cur = byType.get(key) ?? { label: `${hangerTypeName(hg, pipe.size)} ${sizeLabel(pipe.size, metric)}${hg.kind === 'hanger' ? `, varilla ${rodDiameter(pipe.size)}"` : ''}`, n: 0, rod: 0 };
    cur.n++;
    if (hg.kind === 'hanger') cur.rod += Math.max(0, hangerRodLength(p, hg));
    byType.set(key, cur);
  }
  const typeRows = [...byType.entries()]
    .sort((a, b) => NOMINAL_SIZES.indexOf(b[0].split('|')[1] as NominalSize) - NOMINAL_SIZES.indexOf(a[0].split('|')[1] as NominalSize))
    .map(([, v]) => h('tr', null, h('td', { class: 'l' }, v.label), h('td', null, String(v.n)), h('td', null, v.rod ? fmt('length', v.rod, u, true) : '—')));

  const hangerSection = h(
    'section',
    { class: 'fab-section' },
    h(
      'div',
      { class: 'fab-head' },
      h('h3', null, `Soportes (${hangers.length})`),
      h(
        'button',
        {
          class: 'btn primary small',
          title: 'Pone soportes en toda la red según la tabla de NFPA 13 (reemplaza los que había)',
          onclick: () => {
            if (!p.pipes.length) return flash('Primero dibuje la tubería');
            let n = 0;
            store.mutate((pp) => (n = placeHangers(pp).added));
            flash(`${n} soportes colocados. Revise los avisos de la lista.`);
          },
        },
        hangers.length ? 'Volver a colocar soportes' : 'Colocar soportes',
      ),
      hangers.length ? h('button', { class: 'btn outline small', onclick: () => store.mutate((pp) => (pp.hangers = [])) }, 'Quitar todos') : null,
      h('span', { class: 'fab-field', title: 'Altura de la cara inferior de la estructura donde se anclan las varillas, cuando no hay una losa o viga dibujada encima' }, 'Estructura a'),
      numInput({
        label: 'Altura de la estructura',
        q: 'elevation',
        value: p.hangerStructureZ,
        placeholder: 'automática',
        allowEmpty: true,
        key: 'fab-struct',
        onCommit: (v) => store.mutate((pp) => (pp.hangerStructureZ = v)),
        onClear: () => store.mutate((pp) => delete pp.hangerStructureZ),
      }),
    ),
    hangers.length
      ? h(
          'div',
          { class: 'fab-cols' },
          h('table', { class: 'grid compact' }, h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Tipo'), h('th', null, 'Cantidad'), h('th', null, 'Varilla total'))), h('tbody', null, typeRows)),
          h(
            'ul',
            { class: 'messages' },
            chk.problems.length ? chk.problems.slice(0, 12).map((x) => h('li', null, x)) : h('li', { class: 'ok' }, 'Distancias y extremos dentro de lo que pide NFPA 13.'),
            h('li', { class: 'ok' }, 'No incluye arriostramiento sísmico.'),
          ),
        )
      : h('p', { class: 'muted-text' }, 'Aún no hay soportes. "Colocar soportes" los pone con las distancias máximas de NFPA 13 según material y diámetro, uno en cada tramo, cerca de los extremos libres y abrazaderas en los montantes.'),
  );

  // --- Lista de corte
  const threadedMax = p.fabrication?.threadedMax ?? '2';
  const cutSection = h(
    'section',
    { class: 'fab-section' },
    h(
      'div',
      { class: 'fab-head' },
      h('h3', null, `Lista de corte (${list.pieces.length} piezas)`),
      h('span', { class: 'fab-field' }, 'Acero roscado hasta'),
      selectInput<NominalSize>(
        'Roscado hasta',
        threadedMax,
        (['1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '4'] as NominalSize[]).map((s) => ({ value: s, label: sizeLabel(s, metric) })),
        'fab-thr',
        (v) => store.mutate((pp) => (pp.fabrication = { ...(pp.fabrication ?? {}), threadedMax: v })),
      ),
      h(
        'button',
        {
          class: 'btn outline small',
          onclick: () => void fabricationHooks.saveCsv(cutListCsv(p, list, metric), 'Lista de corte'),
        },
        'Exportar CSV (Excel)',
      ),
      h('button', { class: 'btn outline small', onclick: () => void fabricationHooks.printSheet() }, 'Hoja de fabricación PDF'),
    ),
    list.pieces.length ? summaryTable(list, u) : h('p', { class: 'muted-text' }, 'Dibuje la tubería para ver las piezas.'),
    list.pieces.length ? piecesTable(list, u) : null,
    h('p', { class: 'muted-text' }, 'Descuentos típicos de accesorios roscados (ASME B16.3), ranurados y cementados: confírmelos con los accesorios que va a usar. Clic en una pieza para verla en el dibujo.'),
  );
  clear(el, h('div', { class: 'fab' }, hangerSection, cutSection));
}

function summaryTable(list: CutList, u: UnitSystem) {
  const p = store.project;
  const metric = u === 'metric';
  return h(
    'table',
    { class: 'grid compact' },
    h('thead', null, h('tr', null, ...['Material', 'Diámetro', 'Unión', 'Piezas', 'Largo total', 'Tubos comerciales', 'Sobrante'].map((t, i) => h('th', { class: i < 3 ? 'l' : '' }, t)))),
    h(
      'tbody',
      null,
      list.summary.map((s) =>
        h(
          'tr',
          null,
          h('td', { class: 'l' }, getMaterial(s.material, p).name),
          h('td', { class: 'l' }, sizeLabel(s.size, metric)),
          h('td', { class: 'l' }, s.method),
          h('td', null, String(s.pieces)),
          h('td', null, fmt('length', s.totalCutFt, u, true)),
          h('td', null, `${s.sticks} de ${fmt('length', s.stickFt, u, true)}`),
          h('td', null, fmt('length', s.wasteFt, u, true)),
        ),
      ),
    ),
  );
}

function piecesTable(list: CutList, u: UnitSystem) {
  const metric = u === 'metric';
  return h(
    'table',
    { class: 'grid compact pieces' },
    h(
      'thead',
      null,
      h('tr', null, ...['Pieza', 'Diám.', 'Unión', 'Centro a centro', 'Extremo A', 'Desc.', 'Extremo B', 'Desc.', 'Corte', 'Nota'].map((t, i) => h('th', { class: [0, 1, 2, 4, 6, 9].includes(i) ? 'l' : '' }, t))),
    ),
    h(
      'tbody',
      null,
      list.pieces.map((pc) =>
        h(
          'tr',
          {
            class: pc.cutFt <= 0.05 ? 'bad-row' : '',
            title: `Tubos: ${pc.pipeIds.join(', ')}`,
            onclick: () => store.select(selectionFrom({ nodes: [], pipes: [...pc.pipeIds], sprinklers: [], elements: [] })),
          },
          h('td', { class: 'l' }, pc.id),
          h('td', { class: 'l' }, sizeLabel(pc.size, metric)),
          h('td', { class: 'l' }, pc.method),
          h('td', null, fmtCut(pc.ctcFt, u)),
          h('td', { class: 'l' }, pc.endA.label),
          h('td', null, fmtTakeOff(pc.endA.takeOffIn, u)),
          h('td', { class: 'l' }, pc.endB.label),
          h('td', null, fmtTakeOff(pc.endB.takeOffIn, u)),
          h('td', null, h('b', null, fmtCut(pc.cutFt, u))),
          h('td', { class: 'l' }, pc.note ?? ''),
        ),
      ),
    ),
  );
}

/** Hoja de fabricación para imprimir (lista de corte y soportes) */
export function buildFabricationSheet(root: HTMLElement, version: string) {
  const p = store.project;
  const u = p.displayUnits;
  const list = buildCutList(p);
  const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const hangers = (p.hangers ?? []).filter((hg) => p.pipes.some((x) => x.id === hg.pipeId));
  const chk = checkHangers(p);
  const hangerRows = hangers.map((hg) => {
    const pipe = p.pipes.find((x) => x.id === hg.pipeId)!;
    const rod = hangerRodLength(p, hg);
    return [hg.id, pipe.id, hangerTypeName(hg, pipe.size), sizeLabel(pipe.size, u === 'metric'), hg.kind === 'hanger' ? `${rodDiameter(pipe.size)}"` : '—', hg.kind === 'hanger' ? fmtCut(rod, u) : '—'];
  });
  const table = (head: string[], rows: string[][]) =>
    h('table', { class: 'r-table' }, h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))));
  clear(
    root,
    h(
      'div',
      { class: 'report' },
      h(
        'header',
        { class: 'r-head' },
        h('div', null, h('h1', null, 'Hoja de fabricación'), h('p', null, p.info.name || 'Proyecto sin nombre')),
        h('div', { class: 'r-meta' }, h('div', null, today), h('div', null, `RociaCAD ${version}`)),
      ),
      h('section', null, h('h2', null, 'Resumen de tubería'), table(
        ['Material', 'Diámetro', 'Unión', 'Piezas', 'Largo total', 'Tubos comerciales', 'Sobrante'],
        list.summary.map((s) => [getMaterial(s.material, p).name, sizeLabel(s.size, u === 'metric'), s.method, String(s.pieces), fmt('length', s.totalCutFt, u, true), `${s.sticks} de ${fmt('length', s.stickFt, u, true)}`, fmt('length', s.wasteFt, u, true)]),
      )),
      h('section', null, h('h2', null, 'Lista de corte'), h('p', { class: 'r-note' }, 'Corte = centro a centro − descuentos de los accesorios de cada extremo. Descuentos típicos; confírmelos con los accesorios que se van a usar.'), table(
        ['Pieza', 'Tubos', 'Diám.', 'Unión', 'Centro a centro', 'Extremo A', 'Desc. A', 'Extremo B', 'Desc. B', 'Corte', 'Nota'],
        list.pieces.map((pc) => [pc.id, pc.pipeIds.join(' '), sizeLabel(pc.size, u === 'metric'), pc.method, fmtCut(pc.ctcFt, u), pc.endA.label, fmtTakeOff(pc.endA.takeOffIn, u), pc.endB.label, fmtTakeOff(pc.endB.takeOffIn, u), fmtCut(pc.cutFt, u), pc.note ?? '']),
      )),
      hangers.length
        ? h(
            'section',
            null,
            h('h2', null, `Soportes (${hangers.length})`),
            chk.problems.length ? h('ul', null, chk.problems.map((x) => h('li', null, x))) : null,
            table(['Soporte', 'Tubo', 'Tipo', 'Diámetro', 'Varilla', 'Largo de varilla'], hangerRows),
          )
        : null,
    ),
  );
}
