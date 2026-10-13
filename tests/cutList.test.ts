import { describe, expect, it } from 'vitest';
import { addNode, addPipe, buildCutList, cutListCsv, emptyProject, exampleWarehouse, joinMethod, splitPipe, takeOff } from '../src/core';

describe('Lista de corte', () => {
  it('unión roscada hasta 2" y ranurada por encima', () => {
    const p = exampleWarehouse();
    expect(joinMethod(p, 'steel-sch40', '2')).toBe('Roscada');
    expect(joinMethod(p, 'steel-sch40', '2-1/2')).toBe('Ranurada');
    expect(joinMethod(p, 'cpvc', '1')).toBe('Cementada');
    p.fabrication = { threadedMax: '1-1/2' };
    expect(joinMethod(p, 'steel-sch40', '2')).toBe('Ranurada');
    // tee roscada de 1": 1,50 − 0,68 de rosca
    expect(takeOff('tee', '1', 'Roscada', '1', 'Roscada')).toBeCloseTo(0.82, 6);
    expect(takeOff('elbow90', '4', 'Ranurada', '4', 'Ranurada')).toBeCloseTo(5, 6);
  });

  it('piezas de la bodega de ejemplo', () => {
    const p = exampleWarehouse();
    const list = buildCutList(p);
    // sin la acometida enterrada: 83 tubos − 3 de alimentación = 80 piezas (no hay tramos que se junten)
    expect(list.pieces.length).toBe(80);
    expect(list.warnings).toEqual([]);
    // bajante de 1" de 0,30 m entre tee de 1½" y la salida al rociador
    const drop = list.pieces.find((x) => x.pipeIds[0] === p.pipes.find((y) => y.from === 'B1-1' && y.to === 'R1-1')!.id)!;
    expect(drop.endA.kind).toBe('tee');
    expect(drop.endB.kind).toBe('sprinkler');
    const expected = 0.3 / 0.3048 - (1.94 - 0.68 + 0.25) / 12;
    expect(drop.cutFt).toBeCloseTo(expected, 6);
    // resumen: los tubos alcanzan para todo el largo cortado
    for (const s of list.summary) expect(s.sticks * s.stickFt).toBeGreaterThanOrEqual(s.totalCutFt);
  });

  it('los nodos de dibujo en línea recta no cortan la pieza', () => {
    const p = exampleWarehouse();
    const before = buildCutList(p).pieces.length;
    const pipe = p.pipes.find((x) => x.from === 'B2-2' && x.to === 'B2-3')!;
    const a = p.nodes.find((n) => n.id === 'B2-2')!;
    splitPipe(p, pipe.id, a.x + 3, a.y, a.z);
    const list = buildCutList(p);
    expect(list.pieces.length).toBe(before);
    expect(list.pieces.some((x) => x.pipeIds.length === 2)).toBe(true);
  });

  it('un tramo más largo que el tubo comercial se parte con coples', () => {
    const p = emptyProject();
    const b = addNode(p, 50, 0, 0);
    addPipe(p, 'N1', b.id, { size: '4', material: 'steel-sch40', role: 'main' });
    const list = buildCutList(p);
    // 50 ft con tubos de 6 m (19,69 ft): 3 piezas
    expect(list.pieces.length).toBe(3);
    expect(list.pieces.filter((x) => x.endB.kind === 'coupling').length).toBe(2);
    const sum = list.pieces.reduce((s, x) => s + x.cutFt, 0);
    // el largo de corte total es el total menos los coples
    expect(sum).toBeCloseTo(50 - 4 * (0.0625 / 12), 6);
    expect(list.summary[0].sticks).toBe(3);
    const csv = cutListCsv(p, list, true);
    expect(csv.split('\r\n')[1]).toContain('P1');
  });
});
