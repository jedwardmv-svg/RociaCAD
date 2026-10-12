import DxfParser from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import {
  addElement,
  allMaterials,
  applySprinklerModel,
  buildBom,
  buildDxf,
  calculate,
  exampleWarehouse,
  getMaterial,
  parseCatalog,
  pruneProjectCatalog,
  putInProjectCatalog,
  type Material,
  type SprinklerModel,
} from '../src/core';

const myPipe: Material = {
  id: 'mat-prueba',
  name: 'Tubo de prueba',
  cWet: 120,
  cDry: 100,
  stickLengthFt: 20,
  id_in: { '1': 0.9, '1-1/4': 1.2, '1-1/2': 1.45, '2': 1.9, '3': 2.9, '4': 3.8, '6': 5.8 },
};

describe('Catálogo', () => {
  it('trae tuberías de fábrica con sus diámetros internos', () => {
    const ids = allMaterials().map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['steel-sch40', 'steel-sch80', 'copper-l', 'pvc-c900', 'cpvc']));
    expect(getMaterial('copper-l').id_in['1']).toBeCloseTo(1.025, 6);
    expect(getMaterial('steel-sch80').id_in['2']).toBeCloseTo(1.939, 6);
  });

  it('una tubería propia del proyecto entra al cálculo igual que una de fábrica con el mismo diámetro', () => {
    const a = exampleWarehouse();
    putInProjectCatalog(a, 'materials', myPipe);
    a.pipes.forEach((p) => (p.material = myPipe.id));
    const b = exampleWarehouse();
    b.pipes.forEach((p) => (p.idOverride = myPipe.id_in[p.size]));
    const ra = calculate(a);
    const rb = calculate(b);
    expect(ra.ok).toBe(true);
    expect(ra.requiredPressure).toBeCloseTo(rb.requiredPressure, 6);
    expect(buildBom(a).items.some((i) => i.description.startsWith('Tubo Tubo de prueba'))).toBe(true);
  });

  it('respeta la presión mínima de la hoja técnica del rociador', () => {
    const p = exampleWarehouse();
    const model: SprinklerModel = { id: 'spk-prueba', name: 'K5.6 con mínimo 15 psi', k: 5.6, orientation: 'pendent', minPressure: 15 };
    putInProjectCatalog(p, 'sprinklers', model);
    p.sprinklers.forEach((s) => applySprinklerModel(s, model));
    const r = calculate(p);
    expect(r.sprinklers[r.criticalSprinklerId!].pressure).toBeCloseTo(15, 4);
  });

  it('no copia al proyecto los ítems de fábrica y limpia los que ya no se usan', () => {
    const p = exampleWarehouse();
    putInProjectCatalog(p, 'materials', getMaterial('steel-sch40'));
    expect(p.catalog?.materials ?? []).toHaveLength(0);
    putInProjectCatalog(p, 'materials', myPipe);
    pruneProjectCatalog(p);
    expect(p.catalog?.materials).toHaveLength(0);
  });

  it('descarta los ítems inválidos al importar', () => {
    const c = parseCatalog({
      format: 'rociacad-catalogo',
      materials: [myPipe, { ...myPipe, id: 'malo', cWet: -1 }, { ...myPipe, id: 'malo2', id_in: { '7': 1 } }],
      sprinklers: [{ id: 's', name: 'ok', k: 8, orientation: 'upright' }, { id: 'x', name: 'sin K' }],
      elements: [{ id: 'e', name: 'Muro', kind: 'wall', width: 0.5, height: 9, color: '#ccc' }, { id: 'e2', name: 'raro', kind: 'nave', height: 1 }],
    });
    expect(c.materials.map((m) => m.id)).toEqual(['mat-prueba']);
    expect(c.sprinklers).toHaveLength(1);
    expect(c.elements.map((e) => e.id)).toEqual(['e']);
    expect(() => parseCatalog({ format: 'otra-cosa' })).toThrow();
  });
});

describe('Exportar DXF', () => {
  it('exporta tubería en 3D, rociadores y elementos en capas propias', () => {
    const p = exampleWarehouse();
    addElement(p, 'wall-block-15', [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }], 0);
    addElement(p, 'col-40', [{ x: 10, y: 10 }], 0);
    const text = buildDxf(p);
    const dxf = new DxfParser().parseSync(text)!;
    const ents = dxf.entities as unknown as { type: string; layer: string; vertices?: { z?: number }[] }[];
    const lines = ents.filter((e) => e.type === 'LINE');
    expect(lines).toHaveLength(p.pipes.length);
    expect(ents.filter((e) => e.type === 'CIRCLE' && e.layer === 'RC-ROCIADORES')).toHaveLength(36);
    expect(ents.filter((e) => e.layer === 'RC-MUROS')).toHaveLength(2); // un contorno por tramo de muro
    expect(ents.filter((e) => e.layer === 'RC-COLUMNAS')).toHaveLength(1);
    expect(Object.keys(dxf.tables.layer.layers)).toEqual(expect.arrayContaining(['RC-TUBERIA-DN25', 'RC-TUBERIA-DN150']));
    expect((dxf.header as Record<string, unknown>)['$INSUNITS']).toBe(4); // milímetros
    // el montante es vertical: de 0 a 4000 mm
    const zs = lines.flatMap((l) => (l.vertices ?? []).map((v) => v.z ?? 0));
    expect(Math.max(...zs)).toBeCloseTo(4000, 0);
  });

  it('usa las coordenadas y unidades del plano de fondo', () => {
    const p = exampleWarehouse();
    const text = buildDxf(p, { toPlan: (x, y) => ({ x: x * 304.8 + 1000, y: y * 304.8 + 2000 }), ftPerUnit: 1 / 304.8 });
    const dxf = new DxfParser().parseSync(text)!;
    expect((dxf.header as Record<string, unknown>)['$INSUNITS']).toBe(4);
    const s = p.nodes.find((n) => n.id === 'S')!;
    const circles = (dxf.entities as unknown as { type: string; layer: string; center: { x: number; y: number } }[]).filter(
      (e) => e.type === 'CIRCLE' && e.layer === 'RC-SUMINISTRO',
    );
    expect(circles[0].center.x).toBeCloseTo(s.x * 304.8 + 1000, 3);
    expect(circles[0].center.y).toBeCloseTo(s.y * 304.8 + 2000, 3);
  });
});
