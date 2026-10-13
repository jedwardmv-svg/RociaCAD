import { describe, expect, it } from 'vitest';
import { calculate, exampleWarehouse, fitScale, inchLabel, isoProject, networkDrawing } from '../src/core';

const opts = { sizes: true, lengths: true, elevations: false, nodes: true, fmtLength: (ft: number) => (ft * 0.3048).toFixed(2) };

describe('Planos de entrega', () => {
  it('elige la escala normalizada más grande que cabe', () => {
    // 30 m × 20 m en un recuadro de 600 × 400 mm: a 1:50 mide 600 × 400
    const s = fitScale(30 / 0.3048, 20 / 0.3048, 600, 400, true);
    expect(s.n).toBe(50);
    expect(fitScale(30 / 0.3048, 20 / 0.3048, 590, 400, true).n).toBe(75);
    // en pulgadas: escalas de arquitectura
    expect(fitScale(90, 60, 300, 200, false).label).toBe('1/8" = 1\'-0"');
  });

  it('escribe los diámetros con fracciones', () => {
    expect(inchLabel('2-1/2')).toBe('2½"');
    expect(inchLabel('3/4')).toBe('¾"');
    expect(inchLabel('4')).toBe('4"');
  });

  it('la planta tiene todos los rociadores y un rótulo por tramo recto', () => {
    const p = exampleWarehouse();
    const d = networkDrawing(p, calculate(p), 'plan', opts);
    expect(d.heads.length).toBe(p.sprinklers.length);
    const sizes = d.labels.filter((l) => l.kind === 'size');
    // menos rótulos que tubos: los tramos alineados del mismo diámetro van juntos
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.length).toBeLessThan(p.pipes.length);
    for (const l of sizes) expect(Math.abs(l.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    expect(d.area?.length).toBe(4);
    expect(d.supply).toBeTruthy();
  });

  it('el isométrico sube con la altura', () => {
    const a = isoProject(0, 0, 0);
    const b = isoProject(0, 0, 10);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y - a.y).toBeCloseTo(10, 9);
    const p = exampleWarehouse();
    const d = networkDrawing(p, calculate(p), 'iso', opts);
    expect(d.lines.length).toBe(p.pipes.length);
    expect(d.risers.length).toBe(0);
  });
});
