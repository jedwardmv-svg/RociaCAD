import { describe, expect, it } from 'vitest';
import { SparseSym, solveCG, solveDense } from '../src/core/linear';

describe('Solucionadores lineales', () => {
  it('gradiente conjugado y eliminación gaussiana dan lo mismo', () => {
    // Laplaciano ponderado de una malla 15×15 + diagonal positiva (como la matriz hidráulica)
    const side = 15;
    const n = side * side;
    const A = new SparseSym(n);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const link = (i: number, j: number) => {
      const w = 0.1 + 100 * rnd();
      A.add(i, i, w);
      A.add(j, j, w);
      A.add(i, j, -w);
      A.add(j, i, -w);
    };
    for (let r = 0; r < side; r++)
      for (let c = 0; c < side; c++) {
        const i = r * side + c;
        if (c + 1 < side) link(i, i + 1);
        if (r + 1 < side) link(i, i + side);
        A.add(i, i, 0.5 * rnd());
      }
    const b = Float64Array.from({ length: n }, () => rnd() - 0.5);
    const x1 = solveDense(A, b);
    const x2 = solveCG(A, b);
    for (let i = 0; i < n; i++) expect(x2[i]).toBeCloseTo(x1[i], 6);
  });
});
