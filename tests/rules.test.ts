import { describe, expect, it } from 'vitest';
import { addElement, addNode, addPipe, calculate, emptyProject, fillRoom, reviewProject, suggestDesignArea, type Project } from '../src/core';

const M = 1 / 0.3048;

/** Recinto de 20 × 12 m lleno de rociadores con su tubería, con muros, losa y área de diseño */
function room(opts: { walls?: boolean; slabZ?: number } = {}): Project {
  const p = emptyProject();
  p.criteria.hazard = 'oh1';
  const z = 3 * M;
  const top = addNode(p, 1, 1.5 * M, z);
  addPipe(p, 'N1', top.id, { size: '4', material: 'steel-sch40', role: 'riser' });
  fillRoom(p, {
    x0: 0,
    y0: 0,
    x1: 20 * M,
    y1: 12 * M,
    direction: 'x',
    pipeZ: z,
    dropFt: 0.3 * M,
    k: 5.6,
    modelId: 'gen-k56-pend',
    piping: 'branches-main',
    mainSide: 'start',
    material: 'steel-sch40',
    sizeBySchedule: true,
  });
  if (opts.walls !== false) {
    addElement(p, 'wall-block-15', [
      { x: -0.075 * M, y: -0.075 * M },
      { x: 20.075 * M, y: -0.075 * M },
      { x: 20.075 * M, y: 12.075 * M },
      { x: -0.075 * M, y: 12.075 * M },
      { x: -0.075 * M, y: -0.075 * M },
    ], 0);
  }
  if (opts.slabZ !== undefined)
    addElement(p, 'slab-15', [
      { x: 0, y: 0 },
      { x: 20 * M, y: 0 },
      { x: 20 * M, y: 12 * M },
      { x: 0, y: 12 * M },
    ], opts.slabZ);
  const open = new Set(suggestDesignArea(p));
  for (const s of p.sprinklers) s.inDesignArea = open.has(s.id);
  return p;
}

const rulesOf = (p: Project) => reviewProject(p, calculate(p)).findings.map((f) => f.rule);

describe('Revisión NFPA 13', () => {
  it('un recinto bien llenado no tiene errores de separación, muros ni cobertura', () => {
    const p = room({ slabZ: 3 * M - 0.3 * M + 0.25 });
    const r = reviewProject(p, calculate(p));
    const bad = r.findings.filter((f) => ['spacing-branch', 'spacing-lines', 'coverage', 'wall-max', 'wall-min', 'min-distance', 'deflector'].includes(f.rule));
    expect(bad).toEqual([]);
    expect(r.checked).toContain('wall-max');
    expect(r.checked).toContain('deflector');
  });

  it('avisa si se corre un rociador: muy cerca de otro y lejos del muro', () => {
    const p = room();
    // el primer rociador de un ramal se corre hacia su vecino
    const s0 = p.sprinklers[0];
    const n0 = p.nodes.find((n) => n.id === s0.nodeId)!;
    const others = p.sprinklers.map((s) => p.nodes.find((n) => n.id === s.nodeId)!).filter((n) => n !== n0 && Math.abs(n.y - n0.y) < 0.1);
    const near = others.sort((a, b) => Math.abs(a.x - n0.x) - Math.abs(b.x - n0.x))[0];
    n0.x = near.x - (near.x > n0.x ? 1 : -1) * 4; // a 4 ft
    const rules = rulesOf(p);
    expect(rules).toContain('min-distance');
    expect(rules).toContain('wall-max');
  });

  it('avisa separaciones mayores que las permitidas en riesgo extra', () => {
    const p = room();
    p.criteria.hazard = 'eh1';
    p.criteria.density = 0.3;
    const rules = rulesOf(p);
    // la cuadrícula se hizo para riesgo ordinario (hasta 15 ft): en riesgo extra el máximo es 12 ft
    expect(rules.some((r) => r === 'spacing-branch' || r === 'spacing-lines' || r === 'coverage')).toBe(true);
  });

  it('revisa el deflector contra la losa', () => {
    // losa 2 ft por encima de los rociadores: el deflector queda muy abajo
    const p = room({ slabZ: 3 * M - 0.3 * M + 2 });
    expect(rulesOf(p)).toContain('deflector');
    // losa por debajo del rociador: queda encima
    const q = room({ slabZ: 3 * M - 0.3 * M - 0.3 });
    const f = reviewProject(q).findings.find((x) => x.rule === 'deflector');
    expect(f?.severity).toBe('error');
  });

  it('sin muros ni losa lo dice en vez de inventar', () => {
    const p = room({ walls: false });
    const r = reviewProject(p, calculate(p));
    expect(r.findings.some((f) => f.rule === 'not-checked')).toBe(true);
    expect(r.checked).not.toContain('wall-max');
  });

  it('tubo de acero de 3/4" y K bajo en riesgo ordinario', () => {
    const p = room();
    p.pipes.find((x) => x.role === 'branch')!.size = '3/4';
    p.sprinklers[0].k = 4.2;
    const rules = rulesOf(p);
    expect(rules).toContain('pipe-size');
    expect(rules).toContain('k-factor');
  });
});
