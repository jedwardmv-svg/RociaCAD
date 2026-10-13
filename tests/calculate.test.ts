import { describe, expect, it } from 'vitest';
import {
  buildBom,
  calculate,
  emptyProject,
  equivalentLength,
  exampleGrid,
  exampleWarehouse,
  type Pipe,
  type Project,
} from '../src/core';

/** Fricción H-W de referencia, escrita aparte del motor a propósito */
const hw = (q: number, c: number, d: number, L: number) => (4.52 * Math.pow(q, 1.85) * L) / (Math.pow(c, 1.85) * Math.pow(d, 4.87));

/** Ramal recto: suministro S – N1 – N2 – N3, un rociador en cada N, todo a la misma altura. */
function straightBranch(): Project {
  const p = emptyProject();
  p.autoFittings = false; // comparación contra cálculo a mano sin accesorios
  p.criteria = { ...p.criteria, density: 0.15, minSprinklerPressure: 7, hoseAllowance: 0 };
  p.nodes = [
    { id: 'S', x: 0, y: 0, z: 0 },
    { id: 'N1', x: 10, y: 0, z: 0 },
    { id: 'N2', x: 22, y: 0, z: 0 },
    { id: 'N3', x: 34, y: 0, z: 0 },
  ];
  p.pipes = [
    { id: 'T1', from: 'S', to: 'N1', size: '1-1/2', material: 'steel-sch40', c: 120, fittings: [], role: 'branch' },
    { id: 'T2', from: 'N1', to: 'N2', size: '1-1/4', material: 'steel-sch40', c: 120, fittings: [], role: 'branch' },
    { id: 'T3', from: 'N2', to: 'N3', size: '1', material: 'steel-sch40', c: 120, fittings: [], role: 'branch' },
  ];
  p.sprinklers = ['N1', 'N2', 'N3'].map((n, i) => ({
    id: `S${i + 1}`,
    nodeId: n,
    k: 5.6,
    coverage: 130,
    inDesignArea: true,
    orientation: 'upright' as const,
  }));
  p.supply = { nodeId: 'S', staticPressure: 100, residualPressure: 80, residualFlow: 1000 };
  return p;
}

describe('Ramal en árbol contra cálculo manual', () => {
  it('reproduce el cálculo paso a paso de NFPA', () => {
    const p = straightBranch();
    const r = calculate(p);
    expect(r.ok).toBe(true);

    // Cálculo manual: el rociador final necesita 0.15 × 130 = 19.5 gpm
    const q3 = 19.5;
    const p3 = (q3 / 5.6) ** 2; // 12.13 psi > 7
    const p2 = p3 + hw(q3, 120, 1.049, 12);
    const q2 = 5.6 * Math.sqrt(p2);
    const p1 = p2 + hw(q3 + q2, 120, 1.38, 12);
    const q1 = 5.6 * Math.sqrt(p1);
    const ps = p1 + hw(q1 + q2 + q3, 120, 1.61, 10);

    expect(r.nodes.N3.pressure).toBeCloseTo(p3, 5);
    expect(r.nodes.N2.pressure).toBeCloseTo(p2, 5);
    expect(r.nodes.N1.pressure).toBeCloseTo(p1, 5);
    expect(r.requiredPressure).toBeCloseTo(ps, 5);
    expect(r.sprinklerFlow).toBeCloseTo(q1 + q2 + q3, 4);
    expect(r.criticalSprinklerId).toBe('S3');
    expect(r.sprinklers.S3.flow).toBeCloseTo(19.5, 5);
  });

  it('suma la elevación (0.433 psi/ft)', () => {
    const p = straightBranch();
    const base = calculate(p).requiredPressure;
    for (const n of p.nodes) if (n.id !== 'S') n.z = 10; // ramal 10 ft más arriba
    const up = calculate(p).requiredPressure;
    // la longitud del primer tubo cambia por la subida; corregimos esa fricción
    const r = calculate(p);
    const extraFriction = r.pipes.T1.frictionLoss - hw(r.pipes.T1.flow, 120, 1.61, 10);
    expect(up - base - extraFriction).toBeCloseTo(4.33, 4);
  });

  it('usa la presión mínima de 7 psi cuando la densidad pide menos', () => {
    const p = straightBranch();
    p.criteria.density = 0.05; // 6.5 gpm → 1.35 psi, menos que 7
    const r = calculate(p);
    expect(r.nodes.N3.pressure).toBeCloseTo(7, 5);
  });

  it('incluye la longitud equivalente de los accesorios', () => {
    const p = straightBranch();
    p.pipes[0].fittings = [{ type: 'tee', count: 1 }, { type: 'elbow90', count: 2 }];
    const r = calculate(p);
    const eq = equivalentLength('tee', '1-1/2', 120, 1.61) + 2 * equivalentLength('elbow90', '1-1/2', 120, 1.61);
    expect(eq).toBeCloseTo(8 + 2 * 4, 6);
    expect(r.pipes.T1.totalFt).toBeCloseTo(10 + eq, 6);
    expect(r.pipes.T1.frictionLoss).toBeCloseTo(hw(r.pipes.T1.flow, 120, 1.61, 10 + eq), 6);
  });
});

describe('Redes con lazos', () => {
  it('un lazo simétrico reparte el caudal por igual', () => {
    const p = emptyProject();
    p.autoFittings = false;
  p.autoFittings = false; // comparación contra cálculo a mano sin accesorios
    p.criteria = { ...p.criteria, density: 0.1, hoseAllowance: 0 };
    p.nodes = [
      { id: 'S', x: 0, y: 0, z: 0 },
      { id: 'A', x: 20, y: 10, z: 0 },
      { id: 'B', x: 20, y: -10, z: 0 },
      { id: 'E', x: 40, y: 0, z: 0 },
    ];
    const pipe = (id: string, from: string, to: string): Pipe => ({ id, from, to, size: '2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' });
    p.pipes = [pipe('T1', 'S', 'A'), pipe('T2', 'S', 'B'), pipe('T3', 'A', 'E'), pipe('T4', 'B', 'E')];
    p.sprinklers = [{ id: 'X', nodeId: 'E', k: 8, coverage: 200, inDesignArea: true, orientation: 'upright' }];
    p.supply = { nodeId: 'S', staticPressure: 90, residualPressure: 70, residualFlow: 800 };
    const r = calculate(p);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.pipes.T1.flow)).toBeCloseTo(Math.abs(r.pipes.T2.flow), 6);
    expect(Math.abs(r.pipes.T1.flow) * 2).toBeCloseTo(r.sprinklers.X.flow, 6);
  });

  it('en un lazo asimétrico la pérdida es igual por ambos caminos', () => {
    const p = emptyProject();
    p.autoFittings = false;
  p.autoFittings = false; // comparación contra cálculo a mano sin accesorios
    p.criteria = { ...p.criteria, density: 0.2, hoseAllowance: 0 };
    p.nodes = [
      { id: 'S', x: 0, y: 0, z: 0 },
      { id: 'A', x: 0, y: 30, z: 0 },
      { id: 'E', x: 40, y: 30, z: 0 },
    ];
    p.pipes = [
      { id: 'T1', from: 'S', to: 'A', size: '2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' },
      { id: 'T2', from: 'A', to: 'E', size: '2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' },
      { id: 'T3', from: 'S', to: 'E', size: '1-1/2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' },
    ];
    p.sprinklers = [{ id: 'X', nodeId: 'E', k: 11.2, coverage: 400, inDesignArea: true, orientation: 'upright' }];
    p.supply = { nodeId: 'S', staticPressure: 90, residualPressure: 70, residualFlow: 800 };
    const r = calculate(p);
    const path1 = r.pipes.T1.frictionLoss + r.pipes.T2.frictionLoss;
    const path2 = r.pipes.T3.frictionLoss;
    expect(path1).toBeCloseTo(path2, 6);
    expect(Math.abs(r.pipes.T1.flow) + Math.abs(r.pipes.T3.flow)).toBeCloseTo(r.sprinklers.X.flow, 6);
  });

  it('resuelve el ejemplo mallado con continuidad y requisitos cumplidos', () => {
    const p = exampleGrid();
    const r = calculate(p);
    expect(r.ok).toBe(true);
    expect(r.solver.converged).toBe(true);
    expect(r.solver.maxResidual).toBeLessThan(1e-5);
    let minGap = Infinity;
    for (const s of Object.values(r.sprinklers)) {
      if (!s.flowing) continue;
      minGap = Math.min(minGap, s.pressure - s.requiredPressure);
      expect(s.flow).toBeGreaterThanOrEqual(s.requiredFlow - 1e-4);
    }
    expect(minGap).toBeCloseTo(0, 4);
    // conservación: lo que entra por el suministro = lo que sale por los rociadores
    expect(r.totalFlow - r.hoseAllowance).toBeCloseTo(r.sprinklerFlow + r.fixedFlow, 4);
  });
});

describe('Ejemplo de bodega', () => {
  it('cumple con el suministro y el área de diseño', () => {
    const p = exampleWarehouse();
    const r = calculate(p);
    expect(r.ok).toBe(true);
    expect(r.designArea.flowingCount).toBe(13);
    expect(r.designArea.totalCoverage).toBeGreaterThanOrEqual(1500);
    expect(r.criticalSprinklerId).toBe('S6-6');
    expect(r.supply?.pass).toBe(true);
    expect(r.totalFlow).toBeCloseTo(r.sprinklerFlow + 250, 4);
    // Rango razonable para 13 rociadores K5.6 en OH1
    expect(r.sprinklerFlow).toBeGreaterThan(13 * 18.6);
    expect(r.sprinklerFlow).toBeLessThan(13 * 35);
  });

  it('cuenta los materiales de la geometría', () => {
    const bom = buildBom(exampleWarehouse());
    const qty = (key: string) => bom.items.find((i) => i.key === key)?.quantity ?? 0;
    const sum = (prefix: string) => bom.items.filter((i) => i.key.startsWith(prefix)).reduce((a, i) => a + i.quantity, 0);
    expect(sum('spk|')).toBe(36);
    expect(sum('fit|tee|')).toBe(35); // 5 por ramal × 6 + 5 en la matriz
    expect(qty('fit|elbow90|1|1')).toBe(6); // final de cada ramal
    expect(qty('fit|reducer|6|4')).toBe(1);
    expect(qty('fit|reducer|4|3')).toBe(1);
    expect(qty('valve|check|6')).toBe(1);
    expect(qty('valve|butterfly|4')).toBe(1);
  });
});

describe('Errores de entrada', () => {
  it('avisa si no hay rociadores en el área de diseño', () => {
    const p = straightBranch();
    p.sprinklers.forEach((s) => (s.inDesignArea = false));
    const r = calculate(p);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/área de diseño/);
  });

  it('avisa si un tubo apunta a un nodo inexistente', () => {
    const p = straightBranch();
    p.pipes[1].to = 'NO_EXISTE';
    expect(calculate(p).ok).toBe(false);
  });
});
