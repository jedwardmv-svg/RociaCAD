/**
 * Pestaña "Revisión NFPA": lista de lo que no cumple, agrupado por regla.
 * Al hacer clic en un aviso se seleccionan los rociadores o tubos y la vista va hasta ellos.
 */
import { RULE_NAMES, RULE_REFS, reviewProject, type CalcResult, type RuleFinding, type RuleId, type RuleReview } from '../../core';
import { clear, h } from './dom';
import { store } from './state';

/** Lo que provee main.ts */
export const reviewHooks = {
  focus: (_x: number, _y: number, _z: number) => {},
};

let cache: { result: CalcResult; review: RuleReview } | null = null;

/** Revisión del proyecto actual (se recalcula cuando cambia el cálculo) */
export function currentReview(): RuleReview {
  if (!cache || cache.result !== store.result) cache = { result: store.result, review: reviewProject(store.project, store.result) };
  return cache.review;
}

const open = new Set<RuleId>();

function pick(f: RuleFinding) {
  const spr = f.sprinklerIds ?? [];
  const pipes = f.pipeIds ?? [];
  if (spr.length + pipes.length === 1) store.select(spr.length ? { kind: 'sprinkler', id: spr[0] } : { kind: 'pipe', id: pipes[0] });
  else if (spr.length + pipes.length > 1) store.select({ kind: 'multi', items: { nodes: [], pipes, sprinklers: spr, elements: [] } });
  let at = f.at;
  if (!at && spr.length) {
    const s = store.project.sprinklers.find((x) => x.id === spr[0]);
    const n = s && store.project.nodes.find((x) => x.id === s.nodeId);
    if (n) at = { x: n.x, y: n.y, z: n.z };
  }
  if (!at && pipes.length) {
    const pp = store.project.pipes.find((x) => x.id === pipes[0]);
    const a = pp && store.project.nodes.find((x) => x.id === pp.from);
    const b = pp && store.project.nodes.find((x) => x.id === pp.to);
    if (a && b) at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  }
  if (at) reviewHooks.focus(at.x, at.y, at.z);
}

export function reviewTab(el: HTMLElement) {
  const r = currentReview();
  const groups = new Map<RuleId, RuleFinding[]>();
  for (const f of r.findings) (groups.get(f.rule) ?? groups.set(f.rule, []).get(f.rule)!).push(f);
  const problems = r.errors + r.warnings;
  const summary = h(
    'p',
    { class: 'review-summary' },
    problems
      ? `${r.errors} incumplimiento(s) y ${r.warnings} aviso(s). Haga clic en uno para ubicarlo en el dibujo.`
      : 'Sin incumplimientos en las reglas revisadas.',
    h(
      'small',
      null,
      ' Revisión de NFPA 13 para rociadores estándar: separaciones, coberturas, muros, deflector, presiones, diámetros y factor K. ' +
        'No revisa obstrucciones, vigas ni cielos inclinados; confirme con la edición que exija la autoridad (p. ej. NSR-10 Título J).',
    ),
  );
  const list = h('div', { class: 'review' });
  for (const [rule, items] of groups) {
    const sev = items.some((f) => f.severity === 'error') ? 'err' : items.every((f) => f.severity === 'info') ? 'info' : 'warn';
    const det = h(
      'details',
      { class: `review-group ${sev}` },
      h('summary', null, h('span', { class: 'dot' }), h('b', null, RULE_NAMES[rule]), h('span', { class: 'count' }, String(items.length)), RULE_REFS[rule] ? h('small', null, RULE_REFS[rule]) : null),
      h(
        'ul',
        null,
        items.slice(0, 200).map((f) =>
          h(
            'li',
            {
              class: f.severity,
              tabindex: '0',
              onclick: () => pick(f),
              onkeydown: (e: KeyboardEvent) => {
                if (e.key === 'Enter') pick(f);
              },
            },
            f.message,
          ),
        ),
        items.length > 200 ? h('li', { class: 'info' }, `… y ${items.length - 200} más`) : null,
      ),
    ) as HTMLDetailsElement;
    det.open = open.has(rule) || (open.size === 0 && sev === 'err');
    det.addEventListener('toggle', () => (det.open ? open.add(rule) : open.delete(rule)));
    list.append(det);
  }
  const ok = (Object.keys(RULE_NAMES) as RuleId[]).filter((id) => r.checked.includes(id) && !groups.has(id));
  if (ok.length) list.append(h('p', { class: 'review-ok' }, h('span', { class: 'dot' }), 'Cumplen: ', ok.map((id) => RULE_NAMES[id].toLowerCase()).join(', '), '.'));
  clear(el, summary, list);
}
