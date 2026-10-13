/**
 * Reporte de cálculo hidráulico para imprimir o exportar a PDF.
 * Se arma dentro de #print-root; los estilos de impresión ocultan la app y muestran solo esto.
 */
import { checkDesignArea, checkSystem, effectiveDesignArea, fmt, SYSTEM_TYPE_NAMES, getMaterial, HAZARD_NAMES, internalDiameter, ORIENTATION_NAMES, sizeLabel, unitLabel, type Quantity } from '../../core';
import { clear, h } from './dom';
import { store } from './state';
import { supplyChartSvg } from './supplyChart';

export function buildReport(root: HTMLElement, opts: { image?: string; planImage?: string; version: string }) {
  const p = store.project;
  const r = store.result;
  const u = p.displayUnits;
  const metric = u === 'metric';
  const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const U = (q: Quantity) => unitLabel(q, u);
  const kv = (rows: [string, string][]) => h('table', { class: 'kv' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v)))));

  const header = h(
    'header',
    { class: 'r-head' },
    h('div', null, h('h1', null, 'Memoria de cálculo hidráulico'), h('p', null, p.info.name || 'Proyecto sin nombre')),
    h('div', { class: 'r-meta' }, h('div', null, today), h('div', null, `RociaCAD ${opts.version}`)),
  );

  const info = kv([
    ['Proyecto', p.info.name || '—'],
    ['Cliente', p.info.client || '—'],
    ['Dirección', p.info.address || '—'],
    ['Diseñó', p.info.designer || '—'],
  ]);

  const c = p.criteria;
  const criteria = kv([
    ['Clasificación', HAZARD_NAMES[c.hazard]],
    ['Tipo de sistema', SYSTEM_TYPE_NAMES[c.systemType ?? 'wet']],
    ['Densidad', fmt('density', c.density, u, true)],
    [
      'Área de diseño',
      effectiveDesignArea(p) > c.area + 1e-9 ? `${fmt('area', c.area, u, true)} + 30 % = ${fmt('area', effectiveDesignArea(p), u, true)}` : fmt('area', c.area, u, true),
    ],
    ['Asignación de mangueras', fmt('flow', c.hoseAllowance, u, true)],
    ['Presión mínima por rociador', fmt('pressure', c.minSprinklerPressure, u, true)],
    ['Duración', `${c.duration} min`],
  ]);

  const parts: HTMLElement[] = [header, h('div', { class: 'r-cols' }, h('section', null, h('h2', null, 'Datos generales'), info), h('section', null, h('h2', null, 'Criterio de diseño'), criteria))];

  if (!r.ok) {
    parts.push(h('section', null, h('h2', null, 'El cálculo no se pudo completar'), h('ul', null, r.errors.map((e) => h('li', null, e)))));
  } else {
    const s = r.supply!;
    const chart = h('div', { class: 'r-chart' });
    chart.innerHTML = supplyChartSvg(r, u, 380, 250, {}, p.supply);
    parts.push(
      h(
        'section',
        { class: `r-verdict ${s.pass ? 'pass' : 'fail'}` },
        h('h2', null, 'Resumen'),
        h(
          'div',
          { class: 'r-cols' },
          h(
            'div',
            null,
            h('p', { class: 'r-state' }, s.pass ? 'El suministro de agua alcanza para la demanda calculada.' : 'El suministro de agua NO alcanza para la demanda calculada.'),
            kv([
              ['Rociadores abiertos', `${r.designArea.flowingCount} (cubren ${fmt('area', r.designArea.totalCoverage, u, true)})`],
              ['Rociador más exigido', r.criticalSprinklerId ?? '—'],
              ['Caudal de rociadores', fmt('flow', r.sprinklerFlow, u, true)],
              ['Caudal total con mangueras', fmt('flow', s.demandFlow, u, true)],
              ['Presión requerida en el suministro', fmt('pressure', s.demandPressure, u, true)],
              ['Presión disponible con ese caudal', fmt('pressure', s.availablePressure, u, true)],
              ['Margen de seguridad', `${fmt('pressure', s.margin, u, true)} (mínimo exigido ${fmt('pressure', s.minMargin, u, true)})`],
              s.source === 'tank'
                ? ['Tanque', `nivel del agua ${fmt('length', s.tank!.headFt, u, true)} sobre el suministro; volumen ${s.tank!.volume ? fmt('volume', s.tank!.volume, u, true) : 'sin indicar'}, se necesitan ${fmt('volume', s.tank!.requiredVolume, u, true)}`]
                : ['Prueba de suministro', `estática ${fmt('pressure', s.staticPressure, u, true)}, residual ${fmt('pressure', s.residualPressure, u, true)} con ${fmt('flow', s.residualFlow, u, true)}`],
              ...((s.pump
                ? [
                    [
                      'Bomba contra incendio',
                      `${p.supply.pump?.model ? `${p.supply.pump.model}: ` : ''}${fmt('flow', s.pump.ratedFlow, u, true)} a ${fmt('pressure', s.pump.ratedPressure, u, true)}; a caudal cero ${fmt('pressure', s.pump.churnPressure, u, true)}, al 150 % ${fmt('pressure', s.pump.at150Pressure, u, true)}`,
                    ],
                    ['Punto de trabajo de la bomba', `${s.pump.percentOfRated.toFixed(0)} % del caudal nominal, ${fmt('pressure', s.pump.pressureAtDemand, u, true)}; ${s.source === 'tank' ? 'tanque' : 'succión'} ${fmt('pressure', s.sourcePressure, u, true)}`],
                  ]
                : []) as [string, string][]),
              ...((() => {
                const sys = checkSystem(p);
                return sys.volume !== undefined
                  ? [['Volumen de la parte seca', `${fmt('volume', sys.volume, u, true)} (límite sin cálculo de tiempo de entrega: ${fmt('volume', sys.volumeLimit!, u, true)}; tiempo exigido ${sys.deliveryTime} s)`]]
                  : [];
              })() as [string, string][]),
            ]),
          ),
          chart,
        ),
      ),
    );
    if (opts.image) parts.push(h('section', { class: 'r-image' }, h('h2', null, 'Vista del sistema'), h('img', { src: opts.image, alt: 'Vista 3D del sistema' })));

    // Área de diseño: forma según NFPA 13 y planta
    const chk = checkDesignArea(p);
    if (chk) {
      const yes = (ok: boolean) => (ok ? 'cumple' : 'NO cumple');
      parts.push(
        h(
          'section',
          { class: 'r-image' },
          h('h2', null, 'Área de diseño'),
          kv([
            ['Rociadores abiertos', `${chk.flowing}; se requieren ${chk.rule.count} (${fmt('area', chk.rule.area, u, true)} ÷ ${fmt('area', chk.rule.coverage, u, true)} por rociador): ${yes(chk.countOk)}`],
            ['Área que cubren', `${fmt('area', chk.coverage, u, true)}: ${yes(chk.coverageOk)}`],
            [
              'Lado paralelo a los ramales',
              `${fmt('length', chk.parallel, u, true)}; mínimo 1,2·√A = ${fmt('length', chk.rule.minParallel, u, true)} (${chk.rule.perLine} rociadores por ramal): ${yes(chk.shapeOk)}`,
            ],
            ['Medidas del área', `${fmt('length', chk.parallel, u, true)} × ${fmt('length', chk.width, u, true)}`],
          ]),
          opts.planImage ? h('img', { src: opts.planImage, alt: 'Planta del sistema con el área de diseño' }) : null,
        ),
      );
    }

    // Rociadores abiertos
    const flowing = Object.values(r.sprinklers)
      .filter((x) => x.flowing)
      .sort((a, b) => a.pressure - b.pressure);
    parts.push(
      h(
        'section',
        { class: 'r-break' },
        h('h2', null, 'Rociadores del área de diseño'),
        table(
          ['Rociador', 'Nodo', `K (${U('kfactor')})`, `Presión (${U('pressure')})`, `Caudal (${U('flow')})`, `Mínimo (${U('flow')})`, `Densidad (${U('density')})`],
          flowing.map((x) => [x.id, x.nodeId, fmt('kfactor', x.k, u), fmt('pressure', x.pressure, u), fmt('flow', x.flow, u), fmt('flow', x.requiredFlow, u), fmt('density', x.density, u)]),
          2,
        ),
      ),
    );

    // Tuberías (en el orden del cálculo: de lo más remoto hacia el suministro)
    const pipes = p.pipes
      .map((pp) => ({ pp, pr: r.pipes[pp.id] }))
      .filter((x) => x.pr && Math.abs(x.pr.flow) > 1e-6)
      .sort((a, b) => a.pr.pDownstream - b.pr.pDownstream);
    parts.push(
      h(
        'section',
        null,
        h('h2', null, 'Cálculo por tramos'),
        h('p', { class: 'r-note' }, `Hazen-Williams: pérdida = 4,52 Q^1,85 / (C^1,85 d^4,87) por pie. Elevación: 0,433 psi por pie. Se ordena desde el rociador más remoto hacia el suministro.`),
        table(
          ['Tubo', 'Tramo', 'Diám.', `D. int. (${U('diameter')})`, 'C', `Q (${U('flow')})`, `L (${U('length')})`, `L. eq. (${U('length')})`, `L. total (${U('length')})`, `Pérd. (${U('frictionRate')})`, `Fricción (${U('pressure')})`, `Elev. (${U('pressure')})`, `P. salida (${U('pressure')})`, `P. entrada (${U('pressure')})`, `V (${U('velocity')})`],
          pipes.map(({ pp, pr }) => [
            pp.id,
            `${pr.downstream} – ${pr.upstream}`,
            sizeLabel(pp.size, metric),
            fmt('diameter', pp.idOverride ?? internalDiameter(pp.material, pp.size, p) ?? NaN, u),
            String(pr.c),
            fmt('flow', Math.abs(pr.flow), u),
            fmt('length', pr.lengthFt, u),
            fmt('length', pr.fittingFt, u),
            fmt('length', pr.totalFt, u),
            fmt('frictionRate', pr.frictionPerFt, u),
            fmt('pressure', pr.frictionLoss, u),
            fmt('pressure', pr.elevationLoss, u),
            fmt('pressure', pr.pDownstream, u),
            fmt('pressure', pr.pUpstream, u),
            fmt('velocity', pr.velocity, u),
          ]),
          2,
          'small',
        ),
        h(
          'p',
          { class: 'r-note' },
          'Accesorios por tramo: ',
          pipes
            .filter(({ pp }) => pp.fittings.some((f) => f.count > 0))
            .map(({ pp, pr }) => `${pp.id}: ${pr.fittingsText}`)
            .join('; ') || 'ninguno',
        ),
      ),
    );

    if (r.warnings.length) parts.push(h('section', null, h('h2', null, 'Avisos'), h('ul', null, r.warnings.map((w) => h('li', null, w)))));
    if (r.notes?.length) parts.push(h('section', null, h('h2', null, 'Notas'), h('ul', null, r.notes.map((w) => h('li', null, w)))));
  }

  // Materiales
  const bom = store.bom;
  const money = (v: number) => v.toLocaleString('es-CO', { style: 'currency', currency: bom.currency, maximumFractionDigits: bom.currency === 'COP' ? 0 : 2 });
  const withPrices = bom.items.some((i) => i.unitPrice !== undefined);
  parts.push(
    h(
      'section',
      { class: 'r-break' },
      h('h2', null, 'Lista de materiales'),
      table(
        withPrices ? ['Categoría', 'Descripción', 'Cantidad', 'Unidad', 'Precio unitario', 'Total'] : ['Categoría', 'Descripción', 'Cantidad', 'Unidad'],
        bom.items.map((i) => {
          const qty = i.lengthFt !== undefined ? `${i.quantity} (${fmt('length', i.lengthFt, u, true)})` : String(i.quantity);
          const base = [i.category, i.description, qty, i.unit];
          return withPrices ? [...base, i.unitPrice !== undefined ? money(i.unitPrice) : '—', i.total !== undefined ? money(i.total) : '—'] : base;
        }),
        2,
      ),
      withPrices ? h('p', { class: 'r-total' }, `Total: ${money(bom.grandTotal)}${bom.missingPrices ? ' (faltan precios de algunos ítems)' : ''}`) : null,
      h(
        'p',
        { class: 'r-note' },
        `Tubería: ${[...new Set(p.pipes.map((x) => getMaterial(x.material, p).name))].join(', ')}. Rociadores: ${[...new Set(p.sprinklers.map((x) => ORIENTATION_NAMES[x.orientation].toLowerCase()))].join(', ')}.`,
      ),
    ),
  );

  parts.push(
    h(
      'footer',
      { class: 'r-disclaimer' },
      'Este cálculo fue generado con RociaCAD, un programa en desarrollo que no está certificado ni listado por ninguna autoridad. ' +
        'Los resultados deben ser revisados y firmados por un profesional competente antes de usarse en un proyecto real, ' +
        'verificando los criterios contra la edición de NFPA 13 o la norma local que exija la autoridad competente.',
    ),
  );

  clear(root, h('article', { class: 'report' }, parts));
}

function table(head: string[], rows: string[][], leftCols = 1, cls = ''): HTMLElement {
  return h(
    'table',
    { class: `r-table ${cls}` },
    h('thead', null, h('tr', null, head.map((t, i) => h('th', { class: i < leftCols ? 'l' : '' }, t)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i < leftCols ? 'l' : '' }, c))))),
  );
}
