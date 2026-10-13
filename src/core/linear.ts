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

/**
 * Factorización LDLᵀ dispersa con orden de mínimo grado.
 * Las redes de rociadores son casi árboles: eliminando primero los nodos con menos conexiones
 * (los extremos de los ramales) casi no aparecen términos nuevos, así que el costo crece
 * linealmente con el tamaño de la red. La matriz es simétrica definida positiva: no hace falta
 * pivoteo.
 */
export function solveLDL(A: SparseSym, b: Float64Array): Float64Array {
  const n = A.n;
  const rows: Map<number, number>[] = A.off.map((r) => new Map(r));
  const diag = Float64Array.from(A.diag);
  const rhs = Float64Array.from(b);
  const done = new Uint8Array(n);
  const order = new Int32Array(n);
  const dv = new Float64Array(n);
  const lIdx: Int32Array[] = new Array(n);
  const lVal: Float64Array[] = new Array(n);

  // montículo (grado, nodo) con entradas perezosas
  const heapD: number[] = [];
  const heapV: number[] = [];
  const push = (d: number, v: number) => {
    let i = heapD.length;
    heapD.push(d);
    heapV.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= heapD[i]) break;
      [heapD[p], heapD[i]] = [heapD[i], heapD[p]];
      [heapV[p], heapV[i]] = [heapV[i], heapV[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const d = heapD[0];
    const v = heapV[0];
    const ld = heapD.pop()!;
    const lv = heapV.pop()!;
    if (heapD.length) {
      heapD[0] = ld;
      heapV[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heapD.length && heapD[l] < heapD[m]) m = l;
        if (r < heapD.length && heapD[r] < heapD[m]) m = r;
        if (m === i) break;
        [heapD[m], heapD[i]] = [heapD[i], heapD[m]];
        [heapV[m], heapV[i]] = [heapV[i], heapV[m]];
        i = m;
      }
    }
    return [d, v];
  };
  for (let i = 0; i < n; i++) push(rows[i].size, i);

  for (let k = 0; k < n; k++) {
    let v = -1;
    while (heapD.length) {
      const [d, u] = pop();
      if (!done[u] && d === rows[u].size) {
        v = u;
        break;
      }
    }
    if (v < 0) throw new Error('Error interno al resolver la red.');
    const d = diag[v];
    if (!(d > 0) || !Number.isFinite(d)) throw new Error('Sistema singular: revise que todos los tubos estén conectados al suministro.');
    done[v] = 1;
    order[k] = v;
    dv[v] = d;
    const nb = [...rows[v].entries()];
    const idx = new Int32Array(nb.length);
    const val = new Float64Array(nb.length);
    for (let a = 0; a < nb.length; a++) {
      const [i, aiv] = nb[a];
      const li = aiv / d;
      idx[a] = i;
      val[a] = li;
      rows[i].delete(v);
      rhs[i] -= li * rhs[v];
      diag[i] -= li * aiv;
      for (let c = 0; c < nb.length; c++) {
        if (c === a) continue;
        const [j, avj] = nb[c];
        rows[i].set(j, (rows[i].get(j) ?? 0) - li * avj);
      }
    }
    lIdx[v] = idx;
    lVal[v] = val;
    for (const i of idx) push(rows[i].size, i);
  }
  const x = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const v = order[k];
    let s = rhs[v] / dv[v];
    const idx = lIdx[v];
    const val = lVal[v];
    for (let a = 0; a < idx.length; a++) s -= val[a] * x[idx[a]];
    x[v] = s;
  }
  return x;
}

export function solveSym(A: SparseSym, b: Float64Array): Float64Array {
  return solveLDL(A, b);
}
