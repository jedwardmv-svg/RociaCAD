/**
 * Panel inferior con pestañas: tablas de cálculo, materiales y avisos.
 */
import { fmt, getMaterial, internalDiameter, ORIENTATION_NAMES, sizeLabel, unitLabel, type BomCategory, type Quantity } from '../../core';
import { clear, h, parseNum } from './dom';
import { numInput, rerender } from './fields';
import { isSelected, store, type Selection } from './state';
import { fabricationTab } from './fabrication';

type TabId = 'pipes' | 'sprinklers' | 'nodes' | 'bom' | 'fab' | 'messages';
let tab: TabId = 'pipes';

export function renderBottom(el: HTMLElement) {
  const r = store.result;
  const msgCount = r.errors.length + r.warnings.length;
  const tabBtn = (id: TabId, label: string, count?: number, warn = false) =>
    h(
      'button',
      {
        role: 'tab',
        'aria-selected': String(tab === id),
        onclick: () => {
          tab = id;
          renderBottom(el);
        },
      },
      label,
      count !== undefined ? h('span', { class: `count${warn ? ' warn' : ''}` }, String(count)) : null,
    );
  const body = h('div', { class: 'tab-body', role: 'tabpanel' });
  const prevBody = el.querySelector('.tab-body');
  const prevScroll = prevBody ? [prevBody.scrollTop, prevBody.scrollLeft] : [0, 0];
  rerender(el, () => {
    clear(
      el,
      h(
        'div',
        { class: 'tabs', role: 'tablist' },
        tabBtn('pipes', 'Tuberías', store.project.pipes.length),
        tabBtn('sprinklers', 'Rociadores', store.project.sprinklers.length),
        tabBtn('nodes', 'Nodos', store.project.nodes.length),
        tabBtn('bom', 'Materiales'),
        tabBtn('fab', 'Fabricación'),
        tabBtn('messages', 'Avisos', msgCount, msgCount > 0),
      ),
      body,
    );
    if (tab === 'pipes') pipesTable(body);
    else if (tab === 'sprinklers') sprinklersTable(body);
    else if (tab === 'nodes') nodesTable(body);
    else if (tab === 'bom') bomTable(body);
    else if (tab === 'fab') fabricationTab(body);
    else messages(body);
  });
  body.scrollTop = prevScroll[0];
  body.scrollLeft = prevScroll[1];
}

export function showTab(id: TabId) {
  tab = id;
}

function th(label: string, q?: Quantity, left = false) {
  const u = store.project.displayUnits;
  return h('th', { class: left ? 'l' : '' }, label, q ? h('small', null, unitLabel(q, u)) : h('small', null, ' '));
}

function isSel(sel: Selection, kind: string, id: string) {
  return isSelected(sel, kind, id);
}

function row(kind: 'pipe' | 'node' | 'sprinkler', id: string, cells: (string | HTMLElement)[], cls = '') {
  const tr = h(
    'tr',
    { class: `${cls}${isSel(store.selection, kind, id) ? ' sel' : ''}`, onclick: () => store.select({ kind, id } as Selection) },
    cells.map((c, i) => h('td', { class: i < 2 ? 'l' : '' }, c)),
  );
  return tr;
}

function pipesTable(el: HTMLElement) {
  const r = store.result;
  const u = store.project.displayUnits;
  const metric = u === 'metric';
  const pipes = [...store.project.pipes];
  if (r.ok) {
    pipes.sort((a, b) => {
      const ra = r.pipes[a.id];
      const rb = r.pipes[b.id];
      const fa = ra && Math.abs(ra.flow) > 1e-6 ? 0 : 1;
      const fb = rb && Math.abs(rb.flow) > 1e-6 ? 0 : 1;
      return fa - fb || (ra?.pDownstream ?? 0) - (rb?.pDownstream ?? 0);
    });
  }
  const rows = pipes.map((p) => {
    const pr = r.ok ? r.pipes[p.id] : undefined;
    const idIn = p.idOverride ?? internalDiameter(p.material, p.size, store.project) ?? NaN;
    const flowing = pr && Math.abs(pr.flow) > 1e-6;
    const vel = pr ? h('span', { class: pr.velocity > store.project.criteria.maxVelocity ? 'bad' : '' }, fmt('velocity', pr.velocity, u)) : '—';
    return row(
      'pipe',
      p.id,
      [
        p.id,
        pr ? (flowing ? `${pr.upstream} a ${pr.downstream}` : `${p.from} a ${p.to} (sin flujo)`) : `${p.from} a ${p.to}`,
        sizeLabel(p.size, metric),
        fmt('diameter', idIn, u),
        String(pr ? pr.c : p.c),
        pr ? fmt('flow', Math.abs(pr.flow), u) : '—',
        pr ? fmt('length', pr.lengthFt, u) : '—',
        pr ? fmt('length', pr.fittingFt, u) : '—',
        pr ? fmt('length', pr.totalFt, u) : '—',
        pr ? fmt('frictionRate', pr.frictionPerFt, u) : '—',
        pr ? fmt('pressure', pr.frictionLoss, u) : '—',
        pr ? fmt('pressure', pr.elevationLoss, u) : '—',
        pr ? fmt('pressure', pr.pUpstream, u) : '—',
        pr ? fmt('pressure', pr.pDownstream, u) : '—',
        vel,
        pr?.fittingsText || '',
      ],
      flowing ? '' : 'idle',
    );
  });
  clear(
    el,
    h(
      'table',
      { class: 'grid' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          th('Tubo', undefined, true),
          th('Tramo (sentido del flujo)', undefined, true),
          th('Diámetro'),
          th('D. interno', 'diameter'),
          th('C'),
          th('Caudal', 'flow'),
          th('Longitud', 'length'),
          th('L. equiv.', 'length'),
          th('L. total', 'length'),
          th('Pérdida', 'frictionRate'),
          th('Fricción', 'pressure'),
          th('Elevación', 'pressure'),
          th('P. entrada', 'pressure'),
          th('P. salida', 'pressure'),
          th('Velocidad', 'velocity'),
          h('th', { class: 'l' }, 'Accesorios', h('small', null, ' ')),
        ),
      ),
      h('tbody', null, rows),
    ),
  );
  // la última columna de accesorios alineada a la izquierda
  el.querySelectorAll('tbody tr').forEach((tr) => (tr.lastElementChild as HTMLElement | null)?.classList.add('l'));
}

function sprinklersTable(el: HTMLElement) {
  const r = store.result;
  const u = store.project.displayUnits;
  const list = [...store.project.sprinklers].sort((a, b) => {
    if (a.inDesignArea !== b.inDesignArea) return a.inDesignArea ? -1 : 1;
    const pa = r.ok ? r.sprinklers[a.id]?.pressure ?? 0 : 0;
    const pb = r.ok ? r.sprinklers[b.id]?.pressure ?? 0 : 0;
    return pa - pb;
  });
  clear(
    el,
    h(
      'table',
      { class: 'grid' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          th('Rociador', undefined, true),
          th('Nodo', undefined, true),
          th('Tipo'),
          th('K', 'kfactor'),
          th('Cobertura', 'area'),
          th('Presión', 'pressure'),
          th('Caudal', 'flow'),
          th('Mínimo', 'flow'),
          th('Densidad', 'density'),
        ),
      ),
      h(
        'tbody',
        null,
        list.map((s) => {
          const sr = r.ok ? r.sprinklers[s.id] : undefined;
          const crit = r.criticalSprinklerId === s.id;
          return row(
            'sprinkler',
            s.id,
            [
              crit ? `${s.id} (más exigido)` : s.id,
              s.nodeId,
              ORIENTATION_NAMES[s.orientation],
              fmt('kfactor', s.k, u),
              fmt('area', s.coverage, u),
              sr ? fmt('pressure', sr.pressure, u) : '—',
              sr?.flowing ? fmt('flow', sr.flow, u) : 'cerrado',
              sr?.flowing ? fmt('flow', sr.requiredFlow, u) : '',
              sr?.flowing ? fmt('density', sr.density, u) : '',
            ],
            s.inDesignArea ? 'flowing' : '',
          );
        }),
      ),
    ),
  );
}

function nodesTable(el: HTMLElement) {
  const r = store.result;
  const u = store.project.displayUnits;
  clear(
    el,
    h(
      'table',
      { class: 'grid' },
      h(
        'thead',
        null,
        h('tr', null, th('Nodo', undefined, true), th('Nombre', undefined, true), th('X', 'length'), th('Y', 'length'), th('Elevación', 'elevation'), th('Presión', 'pressure'), th('Sale', 'flow')),
      ),
      h(
        'tbody',
        null,
        store.project.nodes.map((n) => {
          const nr = r.ok ? r.nodes[n.id] : undefined;
          return row('node', n.id, [
            n.id,
            n.label ?? '',
            fmt('length', n.x, u),
            fmt('length', n.y, u),
            fmt('elevation', n.z, u),
            nr ? fmt('pressure', nr.pressure, u) : '—',
            nr && nr.outflow > 0 ? fmt('flow', nr.outflow, u) : '',
          ]);
        }),
      ),
    ),
  );
}

function money(v: number, currency: string) {
  return v.toLocaleString('es-CO', { style: 'currency', currency, maximumFractionDigits: currency === 'COP' ? 0 : 2 });
}

function bomTable(el: HTMLElement) {
  const bom = store.bom;
  const u = store.project.displayUnits;
  const cats: BomCategory[] = ['Tubería', 'Accesorios', 'Válvulas', 'Rociadores'];
  const currencySel = h(
    'select',
    { 'data-key': 'bom-cur', style: 'width:auto;height:24px', 'aria-label': 'Moneda' },
    ['COP', 'USD', 'EUR', 'MXN', 'PEN'].map((c) => h('option', { value: c, selected: c === bom.currency }, c)),
  );
  currencySel.addEventListener('change', () => store.mutate((p) => (p.currency = currencySel.value)));
  const body: HTMLElement[] = [];
  for (const cat of cats) {
    const items = bom.items.filter((i) => i.category === cat);
    if (!items.length) continue;
    body.push(h('tr', { class: 'group' }, h('td', { colspan: 5 }, cat)));
    for (const it of items) {
      const price = h('input', {
        class: 'price-input',
        type: 'text',
        inputMode: 'decimal',
        value: it.unitPrice !== undefined ? String(it.unitPrice).replace('.', ',') : '',
        placeholder: 'precio',
        'data-key': `price-${it.key}`,
        'aria-label': `Precio de ${it.description}`,
      });
      price.addEventListener('change', () => {
        const v = parseNum(price.value);
        store.mutate((p) => {
          p.prices = { ...(p.prices ?? {}) };
          if (price.value.trim() === '' || !Number.isFinite(v)) delete p.prices[it.key];
          else p.prices[it.key] = v;
        });
      });
      const qty = it.lengthFt !== undefined ? `${it.quantity} (${fmt('length', it.lengthFt, u, true)})` : String(it.quantity);
      body.push(
        h(
          'tr',
          null,
          h('td', { class: 'l' }, it.description),
          h('td', null, qty),
          h('td', { class: 'l' }, it.unit),
          h('td', null, price),
          h('td', null, it.total !== undefined ? money(it.total, bom.currency) : ''),
        ),
      );
    }
  }
  const used = [...new Set(store.project.pipes.map((p) => p.material))];
  const sticks = h(
    'div',
    { class: 'bom-settings' },
    h('span', null, 'Largo del tubo comercial'),
    used.map((m) =>
      h(
        'label',
        null,
        h('span', null, getMaterial(m, store.project).name),
        numInput({
          label: `Largo del tubo de ${getMaterial(m, store.project).name}`,
          q: 'length',
          value: store.project.stickLengths?.[m] ?? getMaterial(m, store.project).stickLengthFt,
          key: `stick-${m}`,
          min: 0.1,
          onCommit: (v) => store.mutate((p) => (p.stickLengths = { ...(p.stickLengths ?? {}), [m]: v })),
        }),
      ),
    ),
  );
  clear(
    el,
    sticks,
    h(
      'table',
      { class: 'grid' },
      h(
        'thead',
        null,
        h('tr', null, th('Descripción', undefined, true), th('Cantidad'), th('Unidad', undefined, true), h('th', null, 'Precio unitario', h('small', null, currencySel)), th('Total')),
      ),
      h('tbody', null, body),
      h(
        'tfoot',
        null,
        h(
          'tr',
          null,
          h('td', { class: 'l', colspan: 4 }, bom.missingPrices ? 'Total (faltan precios de algunos ítems)' : 'Total'),
          h('td', null, money(bom.grandTotal, bom.currency)),
        ),
      ),
    ),
  );
}

function messages(el: HTMLElement) {
  const r = store.result;
  const items: HTMLElement[] = [
    ...r.errors.map((e) => h('li', { class: 'err' }, e)),
    ...r.warnings.map((w) => h('li', null, w)),
  ];
  const notes = (r.notes ?? []).map((n) => h('li', { class: 'ok' }, n));
  if (!items.length) items.push(h('li', { class: 'ok' }, 'Sin avisos. El cálculo cumple los criterios revisados.'));
  items.push(...notes);
  if (r.ok)
    items.push(
      h(
        'li',
        { class: 'ok' },
        `Solución de la red: ${r.solver.evaluations} evaluaciones, ${r.solver.iterations} iteraciones de Newton, error de continuidad ${r.solver.maxResidual.toExponential(1)} gpm.`,
      ),
    );
  clear(el, h('ul', { class: 'messages' }, items));
}
