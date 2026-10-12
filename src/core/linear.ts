/**
 * Solucionadores de sistemas lineales usados por el método de Newton.
 * La matriz del sistema hidráulico es simétrica y (con signo cambiado) definida positiva,
 * así que para redes grandes se usa gradiente conjugado con precondicionador de Jacobi.
 */

/** Matriz dispersa simétrica en formato de listas por fila. */
export class SparseSym {
  readonly n: number;
  readonly diag: Float64Array;
  /** off[i] = mapa columna → valor (j ≠ i) */
  readonly off: Map<number, number>[];

  constructor(n: number) {
    this.n = n;
    this.diag = new Float64Array(n);
    this.off = Array.from({ length: n }, () => new Map<number, number>());
  }

  add(i: number, j: number, v: number): void {
    if (i === j) {
      this.diag[i] += v;
    } else {
      const row = this.off[i];
      row.set(j, (row.get(j) ?? 0) + v);
    }
  }

  mul(x: Float64Array, out: Float64Array): void {
    for (let i = 0; i < this.n; i++) {
      let s = this.diag[i] * x[i];
      for (const [j, v] of this.off[i]) s += v * x[j];
      out[i] = s;
    }
  }
}

/** Eliminación gaussiana con pivoteo parcial (para redes pequeñas y medianas). */
export function solveDense(A: SparseSym, b: Float64Array): Float64Array {
  const n = A.n;
  const M = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    M[i * n + i] = A.diag[i];
    for (const [j, v] of A.off[i]) M[i * n + j] = v;
  }
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i * n + k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (best === 0) throw new Error('Sistema singular: revise que todos los tubos estén conectados al suministro.');
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = M[k * n + j];
        M[k * n + j] = M[p * n + j];
        M[p * n + j] = t;
      }
      const t = x[k];
      x[k] = x[p];
      x[p] = t;
    }
    const pivot = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / pivot;
      if (f === 0) continue;
      for (let j = k; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      x[i] -= f * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = s / M[i * n + i];
  }
  return x;
}

/**
 * Gradiente conjugado precondicionado (Jacobi) para A x = b con A simétrica definida positiva.
 */
export function solveCG(A: SparseSym, b: Float64Array, tol = 1e-13, maxIter?: number): Float64Array {
  const n = A.n;
  const x = new Float64Array(n);
  const r = Float64Array.from(b);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);
  const inv = new Float64Array(n);
  for (let i = 0; i < n; i++) inv[i] = A.diag[i] !== 0 ? 1 / A.diag[i] : 1;
  let bnorm = 0;
  for (let i = 0; i < n; i++) bnorm += b[i] * b[i];
  bnorm = Math.sqrt(bnorm);
  if (bnorm === 0) return x;
  for (let i = 0; i < n; i++) {
    z[i] = inv[i] * r[i];
    p[i] = z[i];
  }
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  const limit = maxIter ?? Math.max(1000, 20 * n);
  for (let it = 0; it < limit; it++) {
    A.mul(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (pAp <= 0) break;
    const alpha = rz / pAp;
    let rnorm = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
      rnorm += r[i] * r[i];
    }
    if (Math.sqrt(rnorm) <= tol * bnorm) break;
    let rzNew = 0;
    for (let i = 0; i < n; i++) {
      z[i] = inv[i] * r[i];
      rzNew += r[i] * z[i];
    }
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return x;
}

export function solveSym(A: SparseSym, b: Float64Array): Float64Array {
  return A.n <= 600 ? solveDense(A, b) : solveCG(A, b);
}
