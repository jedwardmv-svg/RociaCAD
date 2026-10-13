import { describe, expect, it } from 'vitest';
import {
  availableFlowAt,
  availablePressureAt,
  calculate,
  checkSystem,
  defaultPump,
  effectiveDesignArea,
  exampleWarehouse,
  pipeVolumeGal,
  pumpNetPressure,
  remoteArea,
  suggestPump,
  type FirePump,
} from '../src/core';

const pump: FirePump = { enabled: true, ratedFlow: 500, ratedPressure: 100, churnPct: 120, at150Pct: 65 };

describe('Bomba contra incendio', () => {
  it('curva por los tres puntos de NFPA 20', () => {
    expect(pumpNetPressure(pump, 0)).toBeCloseTo(120, 9);
    expect(pumpNetPressure(pump, 250)).toBeCloseTo(110, 9);
    expect(pumpNetPressure(pump, 500)).toBeCloseTo(100, 9);
    expect(pumpNetPressure(pump, 750)).toBeCloseTo(65, 9);
    expect(pumpNetPressure(pump, 5000)).toBe(0);
  });

  it('suma la bomba a la red pública', () => {
    const p = exampleWarehouse();
    const city = availablePressureAt(p.supply, 600);
    p.supply.pump = pump;
    expect(availablePressureAt(p.supply, 600)).toBeCloseTo(city + pumpNetPressure(pump, 600), 9);
    // caudal disponible a una presión: inverso de la curva
    const q = availableFlowAt(p.supply, 120);
    expect(availablePressureAt(p.supply, q)).toBeCloseTo(120, 4);
  });

  it('el cálculo usa la bomba y revisa el 150 %', () => {
    const p = exampleWarehouse();
    const before = calculate(p);
    p.supply.pump = pump;
    const r = calculate(p);
    expect(r.ok).toBe(true);
    // la demanda no cambia; lo disponible sí
    expect(r.requiredPressure).toBeCloseTo(before.requiredPressure, 6);
    expect(r.supply!.availablePressure - before.supply!.availablePressure).toBeCloseTo(pumpNetPressure(pump, r.totalFlow), 6);
    expect(r.supply!.pump!.percentOfRated).toBeCloseTo((100 * r.totalFlow) / 500, 6);
    p.supply.pump = { ...pump, ratedFlow: 200 };
    expect(calculate(p).warnings.some((w) => w.includes('150 %'))).toBe(true);
  });

  it('sugiere la bomba mínima', () => {
    const p = exampleWarehouse();
    p.supply = { ...p.supply, staticPressure: 40, residualPressure: 20, residualFlow: 800 };
    const r = calculate(p);
    expect(r.supply!.pass).toBe(false);
    const s = suggestPump(p.supply, r.totalFlow, r.requiredPressure, p.criteria.minSafetyMargin);
    expect(s.pump).not.toBeNull();
    expect(s.pump!.ratedFlow).toBeGreaterThanOrEqual(r.totalFlow);
    p.supply.pump = s.pump!;
    const r2 = calculate(p);
    expect(r2.supply!.pass).toBe(true);
    // si la red sola alcanza, no hace falta bomba
    expect(suggestPump(exampleWarehouse().supply, r.totalFlow, r.requiredPressure, 5).pump).toBeNull();
  });

  it('tanque: presión por altura y volumen por duración', () => {
    const p = exampleWarehouse();
    p.supply = { ...p.supply, source: 'tank', tankHeadFt: 10, tankVolume: 1000, pump: { ...defaultPump(), ratedFlow: 750, ratedPressure: 75 } };
    const r = calculate(p);
    expect(r.ok).toBe(true);
    expect(r.supply!.sourcePressure).toBeCloseTo(4.33, 6);
    expect(r.supply!.tank!.requiredVolume).toBeCloseTo(r.totalFlow * 60, 6);
    expect(r.warnings.some((w) => w.includes('El tanque'))).toBe(true);
  });
});

describe('Sistemas secos y de preacción', () => {
  it('aumenta el área 30 % y usa C = 100 en acero', () => {
    const p = exampleWarehouse();
    const wet = calculate(p);
    p.criteria.systemType = 'dry';
    expect(effectiveDesignArea(p)).toBeCloseTo(1950, 6);
    const ids = remoteArea(p);
    // 1950 / 124,4 → 16 rociadores
    expect(ids.length).toBe(16);
    p.sprinklers.forEach((s) => (s.inDesignArea = ids.includes(s.id)));
    const dry = calculate(p);
    expect(dry.ok).toBe(true);
    expect(dry.pipes.T10.c).toBe(100);
    expect(dry.requiredPressure).toBeGreaterThan(wet.requiredPressure);
    expect(dry.notes!.some((n) => n.includes('30 %'))).toBe(true);
    // los colgantes no son de tipo seco
    expect(dry.warnings.some((w) => w.includes('tipo seco'))).toBe(true);
  });

  it('volumen de la parte seca y límite de 500 / 750 gal', () => {
    const p = exampleWarehouse();
    p.criteria.systemType = 'dry';
    const c = checkSystem(p);
    expect(c.volume).toBeGreaterThan(0);
    expect(c.volumeLimit).toBe(500);
    expect(c.deliveryTime).toBe(50);
    // un tubo de 1" sch 40 (1,049") de 100 ft tiene 4,49 gal
    const one = { ...p, pipes: [{ ...p.pipes[0], from: 'S', to: 'A1', size: '1' as const, lengthOverride: 100 }] };
    expect(pipeVolumeGal(one, one.pipes)).toBeCloseTo(4.49, 2);
    p.criteria.quickOpening = true;
    expect(checkSystem(p).volumeLimit).toBe(750);
  });

  it('preacción sencilla: sin aumento de área', () => {
    const p = exampleWarehouse();
    p.criteria.systemType = 'preaction-single';
    expect(effectiveDesignArea(p)).toBe(1500);
    expect(calculate(p).pipes.T10.c).toBe(100);
  });
});
