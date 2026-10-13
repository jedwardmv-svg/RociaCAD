import { describe, expect, it } from 'vitest';
import {
  addElement,
  checkHangers,
  exampleWarehouse,
  hangerPoint,
  hangerRodLength,
  horizontalRuns,
  maxHangerSpacing,
  OD_IN,
  placeHangers,
  rodDiameter,
  splitPipe,
} from '../src/core';

const M = 1 / 0.3048;

describe('Soportes', () => {
  it('tabla de distancias y varillas', () => {
    const p = exampleWarehouse();
    const pipe = p.pipes.find((x) => x.size === '1')!;
    expect(maxHangerSpacing(p, pipe)).toBe(12);
    expect(maxHangerSpacing(p, { ...pipe, size: '2' })).toBe(15);
    expect(maxHangerSpacing(p, { ...pipe, material: 'cpvc', size: '1' })).toBe(6);
    expect(maxHangerSpacing(p, { ...pipe, role: 'feed' })).toBeUndefined();
    expect(rodDiameter('4')).toBe('3/8');
    expect(rodDiameter('6')).toBe('1/2');
  });

  it('reconoce las líneas rectas', () => {
    const p = exampleWarehouse();
    const runs = horizontalRuns(p);
    const branch = runs.find((r) => r.segs.some((s) => s.pipe.to === 'B1-6'))!;
    expect(branch.segs.length).toBe(6);
    expect(branch.freeEnd || branch.freeStart).toBe(true);
    // la línea no queda libre en la tee de la matriz
    expect(branch.freeEnd && branch.freeStart).toBe(false);
  });

  it('coloca soportes que cumplen las reglas', () => {
    const p = exampleWarehouse();
    const r = placeHangers(p);
    expect(r.added).toBeGreaterThan(40);
    const chk = checkHangers(p);
    expect(chk.problems).toEqual([]);
    // cada tramo de ramal entre rociadores tiene al menos un soporte
    const seg = p.pipes.find((x) => x.from === 'B2-2' && x.to === 'B2-3')!;
    expect(p.hangers!.some((h) => h.pipeId === seg.id)).toBe(true);
    // los bajantes y la acometida enterrada no llevan
    const drops = new Set(p.pipes.filter((x) => x.role === 'drop' || x.role === 'feed').map((x) => x.id));
    expect(p.hangers!.some((h) => drops.has(h.pipeId) && h.kind === 'hanger')).toBe(false);
    // el montante lleva abrazadera
    expect(p.hangers!.some((h) => h.kind === 'riser-clamp')).toBe(true);
    // el último soporte del ramal queda a 1 ft del rociador del extremo
    const last = p.pipes.find((x) => x.from === 'B1-5' && x.to === 'B1-6')!;
    const hs = p.hangers!.filter((h) => h.pipeId === last.id).map((h) => hangerPoint(p, h)!);
    const end = p.nodes.find((n) => n.id === 'B1-6')!;
    expect(Math.min(...hs.map((q) => Math.hypot(q.x - end.x, q.y - end.y)))).toBeCloseTo(1, 6);
  });

  it('largo de varilla hasta la losa dibujada', () => {
    const p = exampleWarehouse();
    placeHangers(p);
    const h = p.hangers!.find((x) => x.kind === 'hanger')!;
    const pt = hangerPoint(p, h)!;
    // sin estructura dibujada: 1,5 ft sobre el eje
    expect(hangerRodLength(p, h)).toBeCloseTo(1.5 - OD_IN[pt.pipe.size] / 24, 6);
    // losa a 5 m sobre todo el edificio
    addElement(p, 'slab-15', [{ x: -100, y: -100 }, { x: 200, y: -100 }, { x: 200, y: 200 }, { x: -100, y: 200 }], 5 * M);
    expect(hangerRodLength(p, h)).toBeCloseTo(5 * M - pt.z - OD_IN[pt.pipe.size] / 24, 6);
  });

  it('al partir un tubo los soportes quedan en su lugar', () => {
    const p = exampleWarehouse();
    placeHangers(p);
    const pipe = p.pipes.find((x) => x.from === 'B3-2' && x.to === 'B3-3')!;
    const before = p.hangers!.filter((h) => h.pipeId === pipe.id).map((h) => hangerPoint(p, h)!);
    const a = p.nodes.find((n) => n.id === 'B3-2')!;
    splitPipe(p, pipe.id, a.x + 1, a.y, a.z);
    const after = p.hangers!.map((h) => hangerPoint(p, h)!).filter((q) => before.some((b) => Math.hypot(b.x - q.x, b.y - q.y, b.z - q.z) < 1e-6));
    expect(after.length).toBe(before.length);
  });
});
