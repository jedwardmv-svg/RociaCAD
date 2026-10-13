import { describe, expect, it } from 'vitest';
import { downstreamCounts, exampleGrid, exampleWarehouse, scheduleSize, sizeBySchedule } from '../src/core';

describe('Dimensionamiento por tabla de NFPA 13', () => {
  it('tabla de acero, riesgo ordinario', () => {
    expect(scheduleSize('ordinary', false, 2)).toBe('1');
    expect(scheduleSize('ordinary', false, 3)).toBe('1-1/4');
    expect(scheduleSize('ordinary', false, 10)).toBe('2');
    expect(scheduleSize('ordinary', false, 11)).toBe('2-1/2');
    expect(scheduleSize('ordinary', false, 275)).toBe('6');
    expect(scheduleSize('ordinary', false, 276)).toBeUndefined();
    expect(scheduleSize('light', true, 12)).toBe('2');
    expect(scheduleSize('extra', false, 1)).toBe('1');
    expect(scheduleSize('extra', false, 2)).toBe('1-1/4');
  });

  it('cuenta los rociadores aguas abajo', () => {
    const p = exampleWarehouse();
    const { counts, loops } = downstreamCounts(p);
    const id = (a: string, b: string) => p.pipes.find((x) => x.from === a && x.to === b)!.id;
    expect(loops).toEqual([]);
    expect(counts.get(id('RB', 'RT'))).toBe(36);
    expect(counts.get(id('M1', 'B1-1'))).toBe(6);
    expect(counts.get(id('B1-5', 'B1-6'))).toBe(1);
    expect(counts.get(id('B1-6', 'R1-6'))).toBe(1);
    expect(counts.get(id('M5', 'M6'))).toBe(6);
  });

  it('dimensiona la bodega de ejemplo (riesgo ordinario, acero)', () => {
    const p = exampleWarehouse();
    const id = (a: string, b: string) => p.pipes.find((x) => x.from === a && x.to === b)!.id;
    const r = sizeBySchedule(p);
    const size = (a: string, b: string) => p.pipes.find((x) => x.id === id(a, b))!.size;
    expect(size('M1', 'B1-1')).toBe('2'); // 6 rociadores
    expect(size('B1-1', 'B1-2')).toBe('1-1/2'); // 5
    expect(size('B1-3', 'B1-4')).toBe('1-1/4'); // 3
    expect(size('B1-4', 'B1-5')).toBe('1'); // 2
    expect(size('M0', 'M1')).toBe('3'); // 36
    expect(size('M5', 'M6')).toBe('2'); // 6
    expect(size('RB', 'RT')).toBe('3'); // 36
    expect(size('S', 'A1')).toBe('6'); // la alimentación no se toca
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.changed).length).toBeGreaterThan(0);
  });

  it('en una malla avisa que hay lazos', () => {
    const p = exampleGrid();
    const r = sizeBySchedule(p);
    expect(r.warnings.some((w) => w.includes('lazos'))).toBe(true);
  });
});
