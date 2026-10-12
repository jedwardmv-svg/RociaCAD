import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/core/dxf';

/** Arma un DXF mínimo con los grupos (código, valor) dados */
function dxf(opts: { units?: number; blocks?: string[][]; entities: string[][] }): string {
  const lines: string[] = [];
  const g = (...pairs: (string | number)[]) => {
    for (const p of pairs) lines.push(String(p));
  };
  g(0, 'SECTION', 2, 'HEADER');
  if (opts.units !== undefined) g(9, '$INSUNITS', 70, opts.units);
  g(0, 'ENDSEC');
  g(0, 'SECTION', 2, 'BLOCKS');
  for (const b of opts.blocks ?? []) g(...b);
  g(0, 'ENDSEC');
  g(0, 'SECTION', 2, 'ENTITIES');
  for (const e of opts.entities) g(...e);
  g(0, 'ENDSEC', 0, 'EOF');
  return lines.join('\n');
}

const line = (x1: number, y1: number, x2: number, y2: number, layer = 'MUROS') => [
  '0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '30', '0', '11', String(x2), '21', String(y2), '31', '0',
];

describe('Planos DXF', () => {
  it('lee líneas, capas y unidades', () => {
    const r = parseDxf(dxf({ units: 6, entities: [line(0, 0, 10, 0), line(10, 0, 10, 5, 'EJES')] }));
    expect(r.ftPerUnit).toBeCloseTo(3.28084, 4);
    expect(r.layers.map((l) => l.name)).toEqual(['EJES', 'MUROS']);
    expect(r.layers.find((l) => l.name === 'MUROS')!.segments).toEqual([0, 0, 10, 0]);
    expect(r.stats.segments).toBe(2);
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
  });

  it('dibuja el arco de una polilínea con bulge', () => {
    // semicírculo antihorario de (0,0) a (2,0): pasa por (1,-1)
    const poly = ['0', 'LWPOLYLINE', '8', 'A', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '2', '20', '0'];
    const r = parseDxf(dxf({ entities: [poly] }));
    const s = r.layers[0].segments;
    let minY = Infinity;
    for (let i = 1; i < s.length; i += 2) minY = Math.min(minY, s[i]);
    expect(minY).toBeCloseTo(-1, 2);
    expect(s[s.length - 2]).toBeCloseTo(2, 6);
    expect(s[s.length - 1]).toBeCloseTo(0, 6);
  });

  it('aplica posición, escala y giro de los bloques', () => {
    const block = ['0', 'BLOCK', '8', '0', '2', 'COL', '70', '0', '10', '0', '20', '0', '30', '0', '3', 'COL', ...line(0, 0, 1, 0, '0'), '0', 'ENDBLK', '8', '0'];
    const insert = ['0', 'INSERT', '8', 'COLUMNAS', '2', 'COL', '10', '5', '20', '5', '30', '0', '41', '2', '42', '2', '50', '90'];
    const r = parseDxf(dxf({ blocks: [block], entities: [insert] }));
    expect(r.layers[0].name).toBe('COLUMNAS'); // la capa 0 del bloque hereda la del INSERT
    const [x1, y1, x2, y2] = r.layers[0].segments;
    expect([x1, y1]).toEqual([5, 5]);
    expect(x2).toBeCloseTo(5, 9); // girado 90° y escalado ×2
    expect(y2).toBeCloseTo(7, 9);
  });

  it('cierra los círculos', () => {
    const circle = ['0', 'CIRCLE', '8', 'C', '10', '3', '20', '4', '30', '0', '40', '2'];
    const r = parseDxf(dxf({ entities: [circle] }));
    const s = r.layers[0].segments;
    expect(s[0]).toBeCloseTo(5, 9);
    expect(s[s.length - 2]).toBeCloseTo(5, 9);
    expect(s[s.length - 1]).toBeCloseTo(4, 9);
    expect(r.snapPoints).toEqual([3, 4]);
  });

  it('avisa si no hay nada que dibujar', () => {
    expect(() => parseDxf(dxf({ entities: [] }))).toThrow(/no tiene líneas/);
  });
});
