/**
 * Solucionador de redes de tubería (árboles, lazos y mallas) por el método nodal de Newton-Raphson.
 *
 * Incógnitas: la "cabeza" de cada nodo, H = P + 0.433·z (psi), excepto en el nodo de suministro,
 * donde la presión es dada. En cada tubo el caudal sale de Hazen-Williams invertido:
 *     Q = signo(ΔH) · (|ΔH| / R)^(1/1.85)
 * En cada rociador abierto sale Q = K·√P. En cada nodo la suma de caudales debe ser cero.
 *
 * Funciona igual para sistemas ramificados (árbol) y mallados (grid/loop), porque no supone
 * ninguna dirección de flujo.
 */
import { PSI_PER_FT_WATER } from './units';
import { SparseSym, solveSym } from './linear';

export interface NetNode {
  z: number;
  /** K del rociador abierto en el nodo (0 si no hay o está cerrado) */
  k: number;
  /** demanda fija, gpm */
  fixed: number;
}

export interface NetPipe {
  a: number;
  b: number;
  /** pérdida = R · |Q|^1.85 */
  r: number;
}

export interface NetResult {
  /** presión en cada nodo, psi */
  pressure: Float64Array;
  /** caudal en cada tubo, gpm (positivo = de a hacia b) */
  flow: Float64Array;
  /** caudal de cada nodo hacia rociador + demanda fija, gpm */
  outflow: Float64Array;
  /** caudal total que entra por el suministro, gpm */
  sourceFlow: number;
  iterations: number;
  converged: boolean;
  /** residuo máximo de continuidad (gpm) */
  maxResidual: number;
  /** cabezas H = P + 0.433·z, útiles como punto de partida del siguiente cálculo */
  head: Float64Array;
}

const INV = 1 / 1.85; // 0.5405…
const DELTA_H = 1e-7; // psi: debajo de esto la relación Q(ΔH) se toma lineal
const DELTA_P = 1e-4; // psi: idem para rociadores

function pipeFlow(dh: number, r: number): { q: number; dq: number } {
  const a = Math.abs(dh);
  if (a < DELTA_H) {
    const g = Math.pow(DELTA_H / r, INV) / DELTA_H;
    return { q: g * dh, dq: g };
  }
  const q = Math.pow(a / r, INV);
  return { q: dh > 0 ? q : -q, dq: (INV * q) / a };
}

function nozzleFlow(p: number, k: number): { q: number; dq: number } {
  if (p < DELTA_P) {
    const g = k / Math.sqrt(DELTA_P);
    return { q: g * p, dq: g };
  }
  const s = Math.sqrt(p);
  return { q: k * s, dq: k / (2 * s) };
}

export interface SolveOptions {
  /** cabezas iniciales (por ejemplo, de una solución anterior) */
  initialHead?: Float64Array;
  tolerance?: number;
  maxIterations?: number;
}

/**
 * Resuelve la red con la presión del nodo `source` fija en `sourcePressure`.
 * Todos los nodos deben estar conectados al suministro (ver `connectedFrom`).
 */
export function solveNetwork(
  nodes: NetNode[],
  pipes: NetPipe[],
  source: number,
  sourcePressure: number,
  opts: SolveOptions = {},
): NetResult {
  const n = nodes.length;
  const tol = opts.tolerance ?? 1e-7;
  const maxIt = opts.maxIterations ?? 200;
  const hs = sourcePressure + PSI_PER_FT_WATER * nodes[source].z;

  // Índices de incógnitas (todos menos el suministro)
  const unk = new Int32Array(n).fill(-1);
  let m = 0;
  for (let i = 0; i < n; i++) if (i !== source) unk[i] = m++;

  const H = new Float64Array(n);
  if (opts.initialHead) H.set(opts.initialHead);
  else H.set(initialGuess(nodes, pipes, source, hs));
  H[source] = hs;

  const F = new Float64Array(m);
  const evalResidual = (h: Float64Array, J?: SparseSym): number => {
    F.fill(0);
    for (const p of pipes) {
      const { q, dq } = pipeFlow(h[p.a] - h[p.b], p.r);
      const ia = unk[p.a];
      const ib = unk[p.b];
      if (ia >= 0) F[ia] -= q;
      if (ib >= 0) F[ib] += q;
      if (J) {
        // J = -dF/dH (definida positiva)
        if (ia >= 0) J.add(ia, ia, dq);
        if (ib >= 0) J.add(ib, ib, dq);
        if (ia >= 0 && ib >= 0) {
          J.add(ia, ib, -dq);
          J.add(ib, ia, -dq);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const iu = unk[i];
      if (iu < 0) continue;
      const nd = nodes[i];
      F[iu] -= nd.fixed;
      if (nd.k > 0) {
        const { q, dq } = nozzleFlow(h[i] - PSI_PER_FT_WATER * nd.z, nd.k);
        F[iu] -= q;
        if (J) J.add(iu, iu, dq);
      }
    }
    let norm = 0;
    for (let i = 0; i < m; i++) norm += F[i] * F[i];
    return norm;
  };

  let converged = false;
  let it = 0;
  let norm = evalResidual(H);
  const trial = new Float64Array(n);
  for (; it < maxIt; it++) {
    const J = new SparseSym(m);
    norm = evalResidual(H, J);
    if (Math.sqrt(norm) < tol) {
      converged = true;
      break;
    }
    // J·Δ = F   (porque J = −dF/dH  →  Newton: Δ = −(dF/dH)⁻¹ F = J⁻¹ F)
    const delta = solveSym(J, Float64Array.from(F));
    // Búsqueda lineal: reducir el paso hasta que baje el residuo
    let lambda = 1;
    let accepted = false;
    for (let ls = 0; ls < 40; ls++) {
      trial.set(H);
      for (let i = 0; i < n; i++) {
        const iu = unk[i];
        if (iu >= 0) trial[i] = H[i] + lambda * delta[iu];
      }
      const tn = evalResidual(trial);
      if (tn < norm || tn < tol * tol) {
        H.set(trial);
        norm = tn;
        accepted = true;
        break;
      }
      lambda *= 0.5;
    }
    if (!accepted) {
      // aceptar un paso pequeño para no quedar atascados
      for (let i = 0; i < n; i++) {
        const iu = unk[i];
        if (iu >= 0) H[i] += lambda * delta[iu];
      }
      norm = evalResidual(H);
    }
    let maxStep = 0;
    for (let i = 0; i < m; i++) maxStep = Math.max(maxStep, Math.abs(delta[i] * lambda));
    if (Math.sqrt(norm) < tol && maxStep < 1e-9) {
      converged = true;
      it++;
      break;
    }
  }
  if (!converged && Math.sqrt(norm) < tol * 10) converged = true;

  // Resultados
  const pressure = new Float64Array(n);
  for (let i = 0; i < n; i++) pressure[i] = H[i] - PSI_PER_FT_WATER * nodes[i].z;
  const flow = new Float64Array(pipes.length);
  pipes.forEach((p, idx) => {
    flow[idx] = pipeFlow(H[p.a] - H[p.b], p.r).q;
  });
  const outflow = new Float64Array(n);
  let sourceFlow = 0;
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    if (i === source) continue;
    outflow[i] = nd.fixed + (nd.k > 0 ? Math.max(0, nozzleFlow(pressure[i], nd.k).q) : 0);
  }
  pipes.forEach((p, idx) => {
    if (p.a === source) sourceFlow += flow[idx];
    if (p.b === source) sourceFlow -= flow[idx];
  });
  // Residuo de continuidad
  evalResidual(H);
  let maxResidual = 0;
  for (let i = 0; i < m; i++) maxResidual = Math.max(maxResidual, Math.abs(F[i]));

  return { pressure, flow, outflow, sourceFlow, iterations: it, converged, maxResidual, head: H };
}

/**
 * Estimación inicial: reparte un caudal tentativo de cada rociador por un árbol de
 * recorrido (BFS) desde el suministro y calcula cabezas aguas abajo con esas pérdidas.
 * Para redes en árbol esto ya da la distribución de caudales exacta salvo escala.
 */
function initialGuess(nodes: NetNode[], pipes: NetPipe[], source: number, hs: number): Float64Array {
  const n = nodes.length;
  const adj: { pipe: number; other: number }[][] = Array.from({ length: n }, () => []);
  pipes.forEach((p, i) => {
    adj[p.a].push({ pipe: i, other: p.b });
    adj[p.b].push({ pipe: i, other: p.a });
  });
  const parent = new Int32Array(n).fill(-1);
  const parentPipe = new Int32Array(n).fill(-1);
  const order: number[] = [source];
  const seen = new Uint8Array(n);
  seen[source] = 1;
  for (let qi = 0; qi < order.length; qi++) {
    const u = order[qi];
    for (const { pipe, other } of adj[u]) {
      if (!seen[other]) {
        seen[other] = 1;
        parent[other] = u;
        parentPipe[other] = pipe;
        order.push(other);
      }
    }
  }
  // caudal tentativo: cada rociador a 10 psi
  const sub = new Float64Array(n);
  for (let i = 0; i < n; i++) sub[i] = nodes[i].fixed + (nodes[i].k > 0 ? nodes[i].k * Math.sqrt(10) : 0);
  for (let qi = order.length - 1; qi > 0; qi--) {
    const u = order[qi];
    sub[parent[u]] += sub[u];
  }
  const H = new Float64Array(n).fill(hs);
  for (let qi = 1; qi < order.length; qi++) {
    const u = order[qi];
    const r = pipes[parentPipe[u]].r;
    H[u] = H[parent[u]] - r * Math.pow(sub[u], 1.85);
  }
  return H;
}

/** Nodos alcanzables desde `source` a través de los tubos. */
export function connectedFrom(n: number, pipes: { a: number; b: number }[], source: number): Uint8Array {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const p of pipes) {
    adj[p.a].push(p.b);
    adj[p.b].push(p.a);
  }
  const seen = new Uint8Array(n);
  const stack = [source];
  seen[source] = 1;
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of adj[u]) {
      if (!seen[v]) {
        seen[v] = 1;
        stack.push(v);
      }
    }
  }
  return seen;
}
