import { describe, expect, it } from 'vitest';
import { catalogTemplate, parseCatalogSheets, parseNominalSize, type Catalog, type Cell } from '../src/core';

const empty: Catalog = { materials: [], sprinklers: [], elements: [] };
const sheetsOf = (specs: ReturnType<typeof catalogTemplate>): Record<string, Cell[][]> =>
  Object.fromEntries(specs.map((s) => [s.name, [s.columns.map((c) => (c.required ? `${c.header} *` : c.header)), ...s.rows]]));

describe('Catálogo en Excel', () => {
  it('reconoce los tamaños nominales escritos de varias formas', () => {
    expect(parseNominalSize('1-1/4')).toBe('1-1/4');
    expect(parseNominalSize('1 1/4')).toBe('1-1/4');
    expect(parseNominalSize('1¼"')).toBe('1-1/4');
    expect(parseNominalSize(1.25)).toBe('1-1/4');
    expect(parseNominalSize('2,5')).toBe('2-1/2');
    expect(parseNominalSize('DN32')).toBe('1-1/4');
    expect(parseNominalSize('3/4')).toBe('3/4');
    expect(parseNominalSize(4)).toBe('4');
    expect(parseNominalSize('7')).toBeUndefined();
  });

  it('las filas de ejemplo de la plantilla no se importan', () => {
    const r = parseCatalogSheets(sheetsOf(catalogTemplate('metric', empty)), empty, 'metric');
    expect(r.errors).toEqual([]);
    expect(r.added).toBe(0);
  });

  it('importa tuberías, rociadores y elementos en unidades métricas', () => {
    const sheets: Record<string, Cell[][]> = {
      Tuberías: [
        ['Nombre de la tubería *', 'Tamaño nominal (pulgadas) *', 'Diámetro interno (mm) *', 'C sistema húmedo *', 'C sistema seco', 'Largo del tubo comercial (m)', 'Color en 3D'],
        ['Acero SCH 10 marca X', '1', 27.86, 120, '', 6, '#aa0000'],
        ['Acero SCH 10 marca X', '1¼', 36.63, '', '', '', ''],
        ['Acero SCH 10 marca X', '9', 50, '', '', '', ''],
      ],
      Rociadores: [
        ['Nombre *', 'Fabricante', 'Modelo / SIN', 'Factor K *', 'Unidad de K', 'Tipo *', 'Temperatura (°C)', 'Respuesta', 'Cobertura máxima (m²)', 'Presión mínima (bar)', 'Tipo seco'],
        ['Viking VK102', 'Viking', 'VK102', 80.6, 'L/min/bar½', 'colgante', 68, 'Rápida', 20.9, 0.5, 'No'],
        ['Sin tipo', '', '', 5.6, '', 'raro', '', '', '', '', ''],
      ],
      Elementos: [
        ['Nombre *', 'Clase *', 'Ancho o espesor (m) *', 'Altura o espesor (m) *', 'Color'],
        ['Muro de ladrillo 12', 'Muro', 0.12, 2.8, '#c9a68a'],
        ['Losa aligerada', 'losa', 0, 0.4, ''],
      ],
    };
    const r = parseCatalogSheets(sheets, empty, 'metric');
    expect(r.catalog.materials).toHaveLength(1);
    const m = r.catalog.materials[0];
    expect(m.id_in['1']).toBeCloseTo(27.86 / 25.4, 3);
    expect(m.id_in['1-1/4']).toBeCloseTo(36.63 / 25.4, 3);
    expect(m.cWet).toBe(120);
    expect(m.cDry).toBe(120);
    expect(m.stickLengthFt).toBeCloseTo(6 / 0.3048, 6);
    expect(m.color).toBe('#aa0000');
    const s = r.catalog.sprinklers[0];
    expect(s.k).toBeCloseTo(5.6, 1);
    expect(s.orientation).toBe('pendent');
    expect(s.response).toBe('quick');
    expect(s.maxCoverage).toBeCloseTo(20.9 / 0.3048 ** 2, 0);
    expect(s.minPressure).toBeCloseTo(7.25, 1);
    expect(r.catalog.elements.map((e) => e.kind)).toEqual(['wall', 'slab']);
    expect(r.catalog.elements[0].width).toBeCloseTo(0.12 / 0.3048, 6);
    // errores con su fila
    expect(r.errors.some((e) => /Tuberías, fila 4/.test(e))).toBe(true);
    expect(r.errors.some((e) => /Rociadores, fila 3/.test(e))).toBe(true);
    expect(r.added).toBe(4);
  });

  it('la plantilla vuelve a leerse igual (exportar y volver a importar)', () => {
    const first = parseCatalogSheets(
      {
        Tuberías: [
          ['Nombre de la tubería', 'Tamaño nominal (pulgadas)', 'Diámetro interno (in)', 'C sistema húmedo', 'C sistema seco', 'Largo del tubo comercial (ft)'],
          ['CPVC X', '3/4', 0.874, 150, 150, 15],
          ['CPVC X', '1', 1.101, 150, 150, 15],
        ],
      },
      empty,
      'us',
    );
    const cat = first.catalog;
    const again = parseCatalogSheets(sheetsOf(catalogTemplate('metric', cat)), cat, 'metric');
    expect(again.errors).toEqual([]);
    expect(again.updated).toBe(1);
    expect(again.added).toBe(0);
    const m = again.catalog.materials[0];
    expect(m.id).toBe(cat.materials[0].id);
    expect(m.id_in['1']).toBeCloseTo(1.101, 3);
    expect(m.stickLengthFt).toBeCloseTo(15, 2);
  });
});
