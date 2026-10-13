import { describe, expect, it } from 'vitest';
import { calculate, closeItems, emptyItems, exampleGrid, exampleWarehouse, moveItems, repeatItems, setDrops, setPipeSize, type ItemSet, type Project } from '../src/core';

const M = 1 / 0.3048;

/** Ramal b del ejemplo de bodega: su salida de la matriz, los tramos, los bajantes y los rociadores */
function branch(p: Project, b: number): ItemSet {
  const s = emptyItems();
  s.pipes = p.pipes.filter((x) => x.to.startsWith(`B${b}-`) || x.from.startsWith(`B${b}-`)).map((x) => x.id);
  return s;
}

describe('Repetir, mover y bajantes', () => {
  it('cierra la selección con rociadores y nodos', () => {
    const p = exampleWarehouse();
    const c = closeItems(p, branch(p, 1));
    expect(c.sprinklers.length).toBe(6);
    expect(c.pipes.length).toBe(12);
    expect(c.nodes).toContain('M1');
  });

  it('repite un ramal y la copia se une a la matriz partiendo el tubo', () => {
    const p = exampleWarehouse();
    const before = { pipes: p.pipes.length, spk: p.sprinklers.length };
    const r = repeatItems(p, branch(p, 1), 1, 0, 1.7 * M, 0);
    expect(p.sprinklers.length).toBe(before.spk + 6);
    expect(r.joined).toBe(1);
    // 12 tubos copiados + 1 de la matriz partida
    expect(p.pipes.length).toBe(before.pipes + 13);
    // la red sigue calculando y el ramal nuevo recibe agua
    p.sprinklers.forEach((s) => (s.inDesignArea = r.created.sprinklers.includes(s.id)));
    const res = calculate(p);
    expect(res.ok).toBe(true);
    expect(res.sprinklers[r.created.sprinklers[0]].flow).toBeGreaterThan(10);
  });

  it('repite varias veces en cadena', () => {
    const p = exampleWarehouse();
    const r = repeatItems(p, branch(p, 6), 3, 0, 3.4 * M, 0);
    expect(r.created.sprinklers.length).toBe(18);
    // las copias no tocan la matriz (está más atrás): quedan sueltas
    expect(r.joined).toBe(0);
  });

  it('mueve y estira los tubos conectados', () => {
    const p = exampleWarehouse();
    const before = p.nodes.find((n) => n.id === 'B1-6')!.x;
    const s = emptyItems();
    s.nodes = ['B1-6'];
    moveItems(p, s, 2, 0, 0);
    expect(p.nodes.find((n) => n.id === 'B1-6')!.x).toBeCloseTo(before + 2, 9);
    expect(p.nodes.find((n) => n.id === 'R1-6')!.x).not.toBeCloseTo(before + 2, 3);
  });

  it('pone, cambia y quita bajantes', () => {
    const p = exampleGrid();
    const ids = p.sprinklers.slice(0, 3).map((s) => s.id);
    const nodesBefore = p.nodes.length;
    expect(setDrops(p, ids, 1)).toBe(3);
    expect(p.nodes.length).toBe(nodesBefore + 3);
    const s0 = p.sprinklers.find((s) => s.id === ids[0])!;
    expect(s0.orientation).toBe('pendent');
    const drop = p.pipes.find((x) => x.to === s0.nodeId)!;
    expect(drop.role).toBe('drop');
    expect(drop.size).toBe('1');
    // cambiar el largo
    expect(setDrops(p, ids, 2)).toBe(3);
    const top = p.nodes.find((n) => n.id === drop.from)!;
    expect(p.nodes.find((n) => n.id === s0.nodeId)!.z).toBeCloseTo(top.z - 2, 9);
    // quitar
    expect(setDrops(p, ids, 0)).toBe(3);
    expect(p.nodes.length).toBe(nodesBefore);
    expect(p.sprinklers.find((s) => s.id === ids[0])!.orientation).toBe('upright');
    expect(calculate(p).ok).toBe(true);
  });

  it('cambia el diámetro de varios tubos', () => {
    const p = exampleWarehouse();
    const ids = branch(p, 2).pipes;
    expect(setPipeSize(p, ids, '2')).toBe(12);
  });
});
