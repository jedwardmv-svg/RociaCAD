import { describe, expect, it } from 'vitest';
import { addNode, addPipe, calculate, emptyProject, fillRoom, planGrid, spacingLimits, suggestDesignArea } from '../src/core';

const M = 1 / 0.3048;

describe('Llenar recinto con rociadores', () => {
  it('reparte respetando separación y cobertura máximas', () => {
    const g = planGrid(20 * M, 12 * M, { maxSpacing: 15, maxCoverage: 130 });
    expect(g.s).toBeLessThanOrEqual(15);
    expect(g.l).toBeLessThanOrEqual(15);
    expect(g.coverage).toBeLessThanOrEqual(130 + 1e-6);
    expect(g.along * g.across).toBe(20);
    // un recinto chico: un solo rociador
    const one = planGrid(3 * M, 3 * M, { maxSpacing: 15, maxCoverage: 130 });
    expect(one.along * one.across).toBe(1);
  });

  it('límites por riesgo', () => {
    const p = emptyProject();
    expect(spacingLimits(p)).toEqual({ maxSpacing: 15, maxCoverage: 130 });
    p.criteria.hazard = 'light';
    expect(spacingLimits(p).maxCoverage).toBe(225);
    p.criteria.hazard = 'eh1';
    expect(spacingLimits(p)).toEqual({ maxSpacing: 12, maxCoverage: 100 });
  });

  it('crea ramales, bajantes y matriz unida a la red, y se puede calcular', () => {
    const p = emptyProject();
    const z = 4 * M;
    // montante desde el suministro hasta donde quedará el inicio de la matriz
    // (a 1 ft del muro y a media separación entre ramales: 1,5 m)
    const n1 = p.nodes.find((n) => n.id === 'N1')!;
    n1.x = 1;
    n1.y = 1.5 * M;
    const top = addNode(p, 1, 1.5 * M, z);
    addPipe(p, 'N1', top.id, { size: '4', material: 'steel-sch40', role: 'riser' });
    const r = fillRoom(p, {
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
    expect(r.sprinklerIds.length).toBe(20);
    expect(r.connected).toBe(1);
    // el inicio de la matriz se fundió con la parte alta del montante (sin tubo de largo cero)
    expect(p.pipes.some((x) => x.role === 'cross' && (x.from === top.id || x.to === top.id))).toBe(true);
    // cada rociador cubre S × L
    expect(p.sprinklers[0].coverage).toBeCloseTo(r.plan.s * r.plan.l, 6);
    // ramal: el primer tramo alimenta 5 rociadores → 1½" en riesgo ordinario
    const firstBranch = p.pipes.find((x) => x.role === 'branch')!;
    expect(firstBranch.size).toBe('1-1/2');
    // la matriz que sale del montante alimenta los 20 → 2½"
    expect(p.pipes.filter((x) => x.role === 'cross').some((x) => x.size === '2-1/2')).toBe(true);
    // las bajantes son de 1"
    expect(p.pipes.filter((x) => x.role === 'drop').every((x) => x.size === '1')).toBe(true);
    // con la red unida, se puede calcular
    p.sprinklers.forEach((s) => (s.inDesignArea = false));
    const ids = suggestDesignArea(p);
    expect(ids.length).toBeGreaterThan(5);
    p.sprinklers.forEach((s) => (s.inDesignArea = ids.includes(s.id)));
    const res = calculate(p);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    // con accesorios automáticos activos (proyecto nuevo)
    expect(Object.values(res.pipes).some((x) => x.fittingsText.includes('auto'))).toBe(true);
  });

  it('solo rociadores, sin tubería', () => {
    const p = emptyProject();
    const r = fillRoom(p, { x0: 0, y0: 0, x1: 10 * M, y1: 10 * M, direction: 'y', pipeZ: 10, dropFt: 0, k: 8, piping: 'none', mainSide: 'end', material: 'steel-sch40', sizeBySchedule: true });
    expect(r.pipeIds).toEqual([]);
    expect(p.sprinklers.length).toBe(r.plan.along * r.plan.across);
    // distancia al muro = media separación
    const xs = p.nodes.filter((n) => n.id !== 'N1').map((n) => n.x);
    expect(Math.min(...xs)).toBeCloseTo(r.plan.l / 2, 6);
  });
});
