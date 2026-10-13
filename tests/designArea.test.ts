import { describe, expect, it } from 'vitest';
import { areaBox, areaRule, branchDirection, pickAreaAt, calculate, checkDesignArea, exampleGrid, exampleWarehouse, remoteArea, sprinklerLines, sprinklersInBox } from '../src/core';

describe('Área de diseño', () => {
  it('reconoce la dirección y las líneas de ramales', () => {
    const p = exampleWarehouse();
    const d = branchDirection(p);
    expect(Math.abs(d.x)).toBeCloseTo(1, 6);
    const lines = sprinklerLines(p);
    expect(lines.length).toBe(6);
    expect(lines.every((l) => l.heads.length === 6)).toBe(true);
  });

  it('regla de NFPA 13 para la bodega', () => {
    const p = exampleWarehouse();
    const r = areaRule(p);
    // 1500 ft² / 124,4 ft² → 13 rociadores; 1,2·√1500 = 46,5 ft; S = 11,15 ft → 5 por ramal
    expect(r.count).toBe(13);
    expect(r.minParallel).toBeCloseTo(46.48, 2);
    expect(r.perLine).toBe(5);
  });

  it('el área remota automática es la del cálculo a mano (5 + 5 + 3 al final de la matriz)', () => {
    const p = exampleWarehouse();
    const manual = p.sprinklers.filter((s) => s.inDesignArea).map((s) => s.id).sort();
    const ids = remoteArea(p).sort();
    expect(ids).toEqual(manual);
  });

  it('revisa la forma del área', () => {
    const p = exampleWarehouse();
    const c = checkDesignArea(p)!;
    expect(c.countOk).toBe(true);
    expect(c.shapeOk).toBe(true);
    expect(c.parallel).toBeCloseTo(5 * 11.155, 1);
    expect(c.outline.length).toBe(4);
    // un área "cuadrada" de 4 + 4 + 4 + 1 no cumple el lado de 1,2·√A
    const bad = ['S6-3', 'S6-4', 'S6-5', 'S6-6', 'S5-3', 'S5-4', 'S5-5', 'S5-6', 'S4-3', 'S4-4', 'S4-5', 'S4-6', 'S3-6'];
    p.sprinklers.forEach((s) => (s.inDesignArea = bad.includes(s.id)));
    const c2 = checkDesignArea(p)!;
    expect(c2.countOk).toBe(true);
    expect(c2.shapeOk).toBe(false);
  });

  it('caja alineada con los ramales', () => {
    const p = exampleWarehouse();
    const M = 1 / 0.3048;
    // caja centrada en el rociador del ramal 6, posición 4
    const ids = sprinklersInBox(p, (3.4 / 2 + 3 * 3.4) * M, (3.4 / 2 + 5 * 3.4) * M, 3 * 3.4 * M, 3.4 * M);
    expect(ids.sort()).toEqual(['S6-3', 'S6-4', 'S6-5']);
  });

  it('funciona en una malla', () => {
    const p = exampleGrid();
    const ids = remoteArea(p);
    expect(ids.length).toBe(areaRule(p).count);
    p.sprinklers.forEach((s) => (s.inDesignArea = ids.includes(s.id)));
    expect(calculate(p).ok).toBe(true);
    expect(checkDesignArea(p)!.shapeOk).toBe(true);
  });
});

describe('Ubicar el área de diseño', () => {
  it('medidas del rectángulo y rociadores al ubicarlo', () => {
    const p = exampleWarehouse();
    const b = areaBox(p);
    const M = 1 / 0.3048;
    expect(b.parallel).toBeCloseTo(5 * 3.4 * M, 3);
    expect(b.width).toBeCloseTo(3 * 3.4 * M, 3);
    // centrado en el rociador 4 del ramal 5: toma ramales 4, 5 y 6, posiciones 2 a 6 → 15, se quitan 2
    const ids = pickAreaAt(p, (3.4 / 2 + 3.5 * 3.4) * M, (3.4 / 2 + 4 * 3.4) * M, b);
    expect(ids.length).toBe(13);
    // el ramal incompleto es el 4 (más cercano al suministro) y pierde los rociadores más cercanos
    expect(ids.filter((id) => id.startsWith('S4-')).sort()).toEqual(['S4-4', 'S4-5', 'S4-6']);
  });
});
