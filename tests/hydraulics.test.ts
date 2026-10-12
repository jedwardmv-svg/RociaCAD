import { describe, expect, it } from 'vitest';
import {
  cFactorMultiplier,
  equivalentLength,
  frictionLossPerFt,
  fromDisplay,
  supplyFlowAt,
  supplyPressureAt,
  toDisplay,
  velocity,
} from '../src/core';

describe('Hazen-Williams', () => {
  it('coincide con el cálculo manual: 1" Sch40, C=120, 30 gpm', () => {
    // 4.52 × 30^1.85 / (120^1.85 × 1.049^4.87) = 0.2755 psi/ft
    expect(frictionLossPerFt(30, 120, 1.049)).toBeCloseTo(0.2755, 4);
  });

  it('coincide con valores de tabla conocidos', () => {
    // 1" Sch40 a 25 gpm ≈ 0.197 psi/ft ; 2" Sch40 a 100 gpm ≈ 0.094 psi/ft (C=120)
    expect(frictionLossPerFt(25, 120, 1.049)).toBeCloseTo(0.197, 3);
    expect(frictionLossPerFt(100, 120, 2.067)).toBeCloseTo(0.094, 3);
  });

  it('la pérdida crece con Q^1.85', () => {
    const a = frictionLossPerFt(50, 120, 2.067);
    const b = frictionLossPerFt(100, 120, 2.067);
    expect(b / a).toBeCloseTo(Math.pow(2, 1.85), 6);
  });

  it('velocidad = 0.4085 Q / d²', () => {
    expect(velocity(100, 2.067)).toBeCloseTo(9.56, 2);
  });
});

describe('Accesorios', () => {
  it('multiplicadores de C según NFPA 13', () => {
    expect(cFactorMultiplier(100)).toBeCloseTo(0.713, 6);
    expect(cFactorMultiplier(120)).toBe(1);
    expect(cFactorMultiplier(150)).toBeCloseTo(1.51, 6);
  });

  it('tee de 2" en acero Sch40 C=120 = 10 ft', () => {
    expect(equivalentLength('tee', '2', 120, 2.067)).toBeCloseTo(10, 6);
  });

  it('ajusta por diámetro interno distinto a Sch40', () => {
    // Schedule 10 de 2": 10 × (2.157/2.067)^4.87
    expect(equivalentLength('tee', '2', 120, 2.157)).toBeCloseTo(10 * Math.pow(2.157 / 2.067, 4.87), 6);
  });
});

describe('Curva de suministro', () => {
  it('pasa por los puntos estático y residual', () => {
    expect(supplyPressureAt(0, 70, 55, 1000)).toBe(70);
    expect(supplyPressureAt(1000, 70, 55, 1000)).toBeCloseTo(55, 10);
  });

  it('flujo y presión son inversos', () => {
    const p = supplyPressureAt(640, 80, 50, 900);
    expect(supplyFlowAt(p, 80, 50, 900)).toBeCloseTo(640, 6);
  });
});

describe('Unidades', () => {
  it('convierte ida y vuelta', () => {
    for (const q of ['flow', 'pressure', 'length', 'kfactor', 'density'] as const) {
      expect(fromDisplay(q, toDisplay(q, 12.345, 'metric'), 'metric')).toBeCloseTo(12.345, 10);
    }
  });

  it('valores métricos conocidos', () => {
    expect(toDisplay('kfactor', 5.6, 'metric')).toBeCloseTo(80.6, 1);
    expect(toDisplay('density', 0.15, 'metric')).toBeCloseTo(6.11, 2);
    expect(toDisplay('pressure', 7, 'metric')).toBeCloseTo(0.483, 3);
  });
});
