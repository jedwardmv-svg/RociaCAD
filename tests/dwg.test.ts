import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDxf, planFromDwgDatabase, type DwgDatabaseLike } from '../src/core';

// Dibujos de ejemplo del conjunto de pruebas de LibreDWG (GPL), en DWG y en DXF
const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
let lib: LibreDwg;

function readDwg(name: string): DwgDatabaseLike {
  const bytes = fx(name);
  const dwg = lib.dwg_read_data(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), Dwg_File_Type.DWG);
  if (!dwg) throw new Error('no se pudo leer');
  const db = lib.convert(dwg) as unknown as DwgDatabaseLike;
  lib.dwg_free(dwg);
  return db;
}

describe('Planos DWG', () => {
  beforeAll(async () => {
    lib = await LibreDwg.create(join(__dirname, '..', 'node_modules', '@mlightcad', 'libredwg-web', 'wasm') + '/');
  });

  it('lee un DWG de AutoCAD 2018 igual que su versión DXF', () => {
    const fromDwg = planFromDwgDatabase(readDwg('example_2018.dwg'));
    const fromDxf = parseDxf(fx('example_2018.dxf').toString('utf8'));
    expect(fromDwg.insUnits).toBe(fromDxf.insUnits);
    // mismas capas con dibujo
    expect(fromDwg.layers.map((l) => l.name).sort()).toEqual(fromDxf.layers.map((l) => l.name).sort());
    // mismo encuadre del dibujo (con tolerancia por diferencias en curvas)
    const span = Math.max(fromDxf.bounds.maxX - fromDxf.bounds.minX, fromDxf.bounds.maxY - fromDxf.bounds.minY);
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) {
      expect(Math.abs(fromDwg.bounds[k] - fromDxf.bounds[k])).toBeLessThan(span * 0.02);
    }
    // cantidad de segmentos parecida (las curvas se dividen igual en ambos)
    expect(fromDwg.stats.segments).toBeGreaterThan(fromDxf.stats.segments * 0.8);
    expect(fromDwg.stats.segments).toBeLessThan(fromDxf.stats.segments * 1.2);
  });

  it('lee un DWG antiguo (AutoCAD R14)', () => {
    const plan = planFromDwgDatabase(readDwg('example_r14.dwg'));
    expect(plan.layers.length).toBeGreaterThan(0);
    expect(plan.stats.segments).toBeGreaterThan(50);
  });
});
