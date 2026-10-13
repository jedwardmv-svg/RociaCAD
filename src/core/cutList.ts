/**
 * Lista de corte para fabricación.
 *
 * Cada pieza es un tramo recto de tubo entre accesorios (los nodos de dibujo en línea recta,
 * sin derivación ni rociador, no cortan la pieza). Los tramos más largos que el tubo comercial
 * se parten en tubos completos más un sobrante, unidos con coples.
 *
 * Largo de corte = largo centro a centro − descuento de cada extremo (take-off).
 * El descuento es la distancia del centro del accesorio al punto donde termina el tubo:
 *  - roscado: centro a extremo del accesorio menos lo que entra la rosca,
 *  - ranurado: centro a extremo del accesorio (el tubo llega al borde),
 *  - CPVC cementado y cobre soldado: centro al fondo del casquillo.
 * Los valores son típicos (ASME B16.3 para roscados y catálogos usuales de ranurados);
 * conviene revisarlos con los accesorios que se van a usar.
 */
import type { Pipe, Project } from './model';
import { getMaterial, materialFamily, NOMINAL_SIZES, type MaterialId, type NominalSize } from './pipes';

export type JoinMethod = 'Roscada' | 'Ranurada' | 'Cementada' | 'Soldada';
type FitKind = 'tee' | 'cross' | 'elbow90' | 'elbow45' | 'elbowx' | 'reducer' | 'coupling' | 'cap' | 'sprinkler' | 'supply';

type Table = Partial<Record<NominalSize, number>>;

// centro a extremo (in)
const THREADED_90: Table = { '3/4': 1.31, '1': 1.5, '1-1/4': 1.75, '1-1/2': 1.94, '2': 2.25, '2-1/2': 2.7, '3': 3.08, '3-1/2': 3.42, '4': 3.79 };
const THREADED_45: Table = { '3/4': 0.98, '1': 1.12, '1-1/4': 1.29, '1-1/2': 1.43, '2': 1.68, '2-1/2': 1.95, '3': 2.17, '3-1/2': 2.39, '4': 2.61 };
// largo de rosca que entra en el accesorio (in)
const THREAD_ENGAGE: Table = { '3/4': 0.55, '1': 0.68, '1-1/4': 0.71, '1-1/2': 0.72, '2': 0.76, '2-1/2': 1.14, '3': 1.2, '3-1/2': 1.25, '4': 1.3 };
const GROOVED_90: Table = { '1': 2.25, '1-1/4': 2.75, '1-1/2': 2.75, '2': 3.25, '2-1/2': 3.75, '3': 4.25, '3-1/2': 4.5, '4': 5, '5': 5.5, '6': 6.5, '8': 7.75, '10': 9, '12': 10 };
const GROOVED_45: Table = { '1': 1.75, '1-1/4': 1.75, '1-1/2': 1.75, '2': 2, '2-1/2': 2.25, '3': 2.5, '3-1/2': 2.75, '4': 3, '5': 3.25, '6': 3.5, '8': 4.25, '10': 4.75, '12': 5.25 };
const GROOVED_REDUCER: Table = { '1-1/4': 2.5, '1-1/2': 2.5, '2': 2.5, '2-1/2': 2.5, '3': 2.5, '3-1/2': 2.5, '4': 3, '5': 3.5, '6': 4, '8': 5, '10': 6, '12': 7 };
const SOCKET_90: Table = { '3/4': 0.5, '1': 0.69, '1-1/4': 0.88, '1-1/2': 1, '2': 1.25, '2-1/2': 1.5, '3': 1.75, '4': 2.25 };

const FIT_NAMES: Record<FitKind, string> = {
  tee: 'Tee',
  cross: 'Cruz',
  elbow90: 'Codo 90°',
  elbow45: 'Codo 45°',
  elbowx: 'Codo especial',
  reducer: 'Reducción',
  coupling: 'Cople',
  cap: 'Tapón',
  sprinkler: 'Salida a rociador',
  supply: 'Conexión al suministro',
};

const near = (t: Table, s: NominalSize): number => {
  if (t[s] !== undefined) return t[s]!;
  // tamaño fuera de la tabla: el más cercano
  const r = NOMINAL_SIZES.indexOf(s);
  let best = 0;
  let bd = Infinity;
  for (const [k, v] of Object.entries(t) as [NominalSize, number][]) {
    const d = Math.abs(NOMINAL_SIZES.indexOf(k) - r);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
};

/** Tipo de unión según material y diámetro */
export function joinMethod(p: Project, material: MaterialId, size: NominalSize): JoinMethod {
  const fam = materialFamily(material, p);
  if (fam === 'cpvc' || fam === 'buried') return 'Cementada';
  if (fam === 'copper') return 'Soldada';
  const max = p.fabrication?.threadedMax ?? '2';
  return NOMINAL_SIZES.indexOf(size) <= NOMINAL_SIZES.indexOf(max) ? 'Roscada' : 'Ranurada';
}

/** Descuento (in) de un extremo de pieza en un accesorio */
export function takeOff(kind: FitKind, fitSize: NominalSize, fitMethod: JoinMethod, pieceSize: NominalSize, pieceMethod: JoinMethod): number {
  if (kind === 'cap' || kind === 'supply') return 0;
  const engage = pieceMethod === 'Roscada' ? near(THREAD_ENGAGE, pieceSize) : 0;
  if (kind === 'coupling') return pieceMethod === 'Roscada' ? 0.125 : pieceMethod === 'Ranurada' ? 0.0625 : 0.06;
  if (kind === 'sprinkler') return pieceMethod === 'Roscada' ? 0.25 : 0.5; // cople reductor o salida
  if (kind === 'reducer') {
    if (fitMethod === 'Ranurada') return near(GROOVED_REDUCER, fitSize) / 2;
    return pieceMethod === 'Roscada' ? 0.25 : 0.4;
  }
  const is45 = kind === 'elbow45';
  // salida roscada de un accesorio ranurado: se descuenta lo que entra la rosca
  if (fitMethod === 'Ranurada') return Math.max(0, near(is45 ? GROOVED_45 : GROOVED_90, fitSize) - engage);
  if (fitMethod === 'Roscada') return Math.max(0, near(is45 ? THREADED_45 : THREADED_90, fitSize) - engage);
  const sock = near(SOCKET_90, fitSize);
  return is45 ? sock * 0.6 : sock;
}

export interface CutEnd {
  nodeId: string;
  kind: FitKind;
  /** nombre del accesorio, p. ej. "Tee 3" × 1"" */
  label: string;
  /** descuento en pulgadas */
  takeOffIn: number;
}

export interface CutPiece {
  id: string;
  pipeIds: string[];
  material: MaterialId;
  size: NominalSize;
  method: JoinMethod;
  /** largo centro a centro (ft) */
  ctcFt: number;
  /** largo de corte (ft) */
  cutFt: number;
  endA: CutEnd;
  endB: CutEnd;
  /** extremos de la pieza en el espacio, para dibujar etiquetas */
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  note?: string;
}

export interface CutSummaryRow {
  material: MaterialId;
  size: NominalSize;
  method: JoinMethod;
  pieces: number;
  totalCutFt: number;
  stickFt: number;
  /** tubos comerciales necesarios acomodando las piezas (primero las más largas) */
  sticks: number;
  /** sobrante total (ft) */
  wasteFt: number;
}

export interface CutList {
  pieces: CutPiece[];
  summary: CutSummaryRow[];
  warnings: string[];
}

const KERF_FT = 0.125 / 12; // 1/8 in por corte

/** Arma la lista de corte del proyecto (sin la alimentación enterrada) */
export function buildCutList(p: Project): CutList {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const pipes = p.pipes.filter((x) => x.role !== 'feed' && nodes.has(x.from) && nodes.has(x.to));
  const all = new Map<string, Pipe[]>();
  for (const x of p.pipes) {
    if (!nodes.has(x.from) || !nodes.has(x.to)) continue;
    (all.get(x.from) ?? all.set(x.from, []).get(x.from)!).push(x);
    (all.get(x.to) ?? all.set(x.to, []).get(x.to)!).push(x);
  }
  const heads = new Set(p.sprinklers.map((s) => s.nodeId));
  const dir = (x: Pipe, from: string) => {
    const a = nodes.get(from)!;
    const b = nodes.get(x.from === from ? x.to : x.from)!;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  const len = (x: Pipe) => {
    const a = nodes.get(x.from)!;
    const b = nodes.get(x.to)!;
    return x.lengthOverride ?? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  };
  // ¿la pieza sigue de largo por este nodo (mismo tubo, en línea, sin derivaciones)?
  const passThrough = (x: Pipe, nodeId: string): Pipe | undefined => {
    const list = all.get(nodeId) ?? [];
    if (list.length !== 2 || heads.has(nodeId) || nodeId === p.supply.nodeId) return undefined;
    const y = list[0].id === x.id ? list[1] : list[0];
    if (y.size !== x.size || y.material !== x.material || y.role === 'feed') return undefined;
    const a = dir(x, nodeId);
    const b = dir(y, nodeId);
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < -0.995 ? y : undefined;
  };
  const sz = (s: NominalSize) => `${s}"`;

  // accesorio en el extremo de una pieza
  const endAt = (nodeId: string, piece: Pipe, method: JoinMethod): CutEnd => {
    const list = all.get(nodeId) ?? [];
    const others = list.filter((x) => x.id !== piece.id);
    const mk = (kind: FitKind, fitSize: NominalSize, label: string): CutEnd => {
      const fitMethod = joinMethod(p, piece.material, fitSize);
      return { nodeId, kind, label, takeOffIn: takeOff(kind, fitSize, fitMethod, piece.size, method) };
    };
    if (!others.length) {
      if (nodeId === p.supply.nodeId) return mk('supply', piece.size, FIT_NAMES.supply);
      if (heads.has(nodeId)) {
        const d = dir(piece, nodeId);
        return Math.abs(d[2]) > 0.9 ? mk('sprinkler', piece.size, FIT_NAMES.sprinkler) : mk('elbow90', piece.size, `${FIT_NAMES.elbow90} a rociador`);
      }
      return mk('cap', piece.size, `${FIT_NAMES.cap} ${sz(piece.size)}`);
    }
    const maxSize = list.reduce<NominalSize>((m, x) => (NOMINAL_SIZES.indexOf(x.size) > NOMINAL_SIZES.indexOf(m) ? x.size : m), piece.size);
    if (others.length >= 3) return mk('cross', maxSize, `${FIT_NAMES.cross} ${sz(maxSize)}`);
    if (others.length === 2 || heads.has(nodeId)) {
      const label = maxSize === piece.size ? `${FIT_NAMES.tee} ${sz(maxSize)}` : `${FIT_NAMES.tee} ${sz(maxSize)} × ${sz(piece.size)}`;
      return mk('tee', maxSize, label);
    }
    // un solo tubo más: codo, reducción o cople
    const o = others[0];
    const a = dir(piece, nodeId);
    const b = dir(o, nodeId);
    const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (c < -0.995) {
      if (o.size !== piece.size) return mk('reducer', maxSize, `${FIT_NAMES.reducer} ${sz(maxSize)} × ${sz(NOMINAL_SIZES.indexOf(o.size) < NOMINAL_SIZES.indexOf(piece.size) ? o.size : piece.size)}`);
      return mk('coupling', piece.size, `${FIT_NAMES.coupling} ${sz(piece.size)}`);
    }
    const ang = (Math.acos(Math.max(-1, Math.min(1, -c))) * 180) / Math.PI;
    if (Math.abs(ang - 45) < 10) return mk('elbow45', maxSize, `${FIT_NAMES.elbow45} ${sz(maxSize)}`);
    if (Math.abs(ang - 90) < 10) return mk('elbow90', maxSize, `${FIT_NAMES.elbow90} ${sz(maxSize)}`);
    return mk('elbowx', maxSize, `Codo ${ang.toFixed(0)}° ${sz(maxSize)}`);
  };

  // armar las piezas
  const used = new Set<string>();
  const raw: Omit<CutPiece, 'id'>[] = [];
  const warnings: string[] = [];
  for (const start of pipes) {
    if (used.has(start.id)) continue;
    // ir al comienzo de la cadena
    let cur = start;
    let node = cur.from;
    const guard = new Set([cur.id]);
    for (;;) {
      const prev = passThrough(cur, node);
      if (!prev || guard.has(prev.id)) break;
      guard.add(prev.id);
      node = prev.from === node ? prev.to : prev.from;
      cur = prev;
    }
    const chain: Pipe[] = [];
    const startNode = node;
    let at = node;
    let x: Pipe | undefined = cur;
    let ctc = 0;
    while (x && !used.has(x.id)) {
      used.add(x.id);
      chain.push(x);
      ctc += len(x);
      at = x.from === at ? x.to : x.from;
      x = passThrough(x, at);
    }
    const first = chain[0];
    const method = joinMethod(p, first.material, first.size);
    const endA = endAt(startNode, first, method);
    const endB = endAt(at, chain[chain.length - 1], method);
    const A = nodes.get(startNode)!;
    const B = nodes.get(at)!;
    const mat = getMaterial(first.material, p);
    const stick = p.stickLengths?.[first.material] ?? mat.stickLengthFt;
    const ids = chain.map((c) => c.id);
    const total = ctc - (endA.takeOffIn + endB.takeOffIn) / 12;
    const lerp = (f: number) => ({ x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, z: A.z + (B.z - A.z) * f });
    if (total <= stick + 1e-9) {
      raw.push({ pipeIds: ids, material: first.material, size: first.size, method, ctcFt: ctc, cutFt: total, endA, endB, a: lerp(0), b: lerp(1) });
      continue;
    }
    // más largo que un tubo comercial: tubos completos + sobrante, unidos con coples
    const cpl = takeOff('coupling', first.size, method, first.size, method) / 12;
    let remaining = total;
    let offset = 0; // ft centro a centro recorridos
    let prevEnd = endA;
    let k = 0;
    while (remaining > 1e-9) {
      const isLast = remaining <= stick + 1e-9;
      const cut = isLast ? remaining : stick;
      const endHere: CutEnd = isLast ? endB : { nodeId: '', kind: 'coupling', label: `${FIT_NAMES.coupling} ${sz(first.size)}`, takeOffIn: cpl * 12 };
      const pieceCtc = cut + (prevEnd.takeOffIn + endHere.takeOffIn) / 12;
      raw.push({
        pipeIds: ids,
        material: first.material,
        size: first.size,
        method,
        ctcFt: pieceCtc,
        cutFt: cut,
        endA: prevEnd,
        endB: endHere,
        a: lerp(offset / ctc),
        b: lerp(Math.min(1, (offset + pieceCtc) / ctc)),
        note: `Tramo largo: tubo ${++k}`,
      });
      offset += pieceCtc;
      remaining -= cut + (isLast ? 0 : 2 * cpl);
      prevEnd = endHere;
    }
  }
  for (const r of raw) {
    if (r.cutFt <= 0.05) {
      r.note = 'Muy corto: los accesorios se tocan (use un niple corrido o cambie el trazado)';
      warnings.push(`Una pieza de ${r.size}" entre ${r.endA.label} y ${r.endB.label} queda sin largo de corte.`);
    }
  }

  // numerar: de mayor a menor diámetro, y por posición
  raw.sort(
    (a, b) =>
      NOMINAL_SIZES.indexOf(b.size) - NOMINAL_SIZES.indexOf(a.size) || a.material.localeCompare(b.material) || a.a.x - b.a.x || a.a.y - b.a.y || a.a.z - b.a.z,
  );
  const pieces: CutPiece[] = raw.map((r, i) => ({ id: `P${i + 1}`, ...r }));

  // acomodar piezas en tubos comerciales (primero las más largas)
  const groups = new Map<string, CutPiece[]>();
  for (const pc of pieces) {
    const k = `${pc.material}|${pc.size}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(pc);
  }
  const summary: CutSummaryRow[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const mat = getMaterial(first.material, p);
    const stick = p.stickLengths?.[first.material] ?? mat.stickLengthFt;
    const bins: number[] = [];
    for (const c of list.map((x) => Math.max(0, x.cutFt)).sort((a, b) => b - a)) {
      const need = c + KERF_FT;
      const i = bins.findIndex((free) => free + 1e-9 >= Math.min(need, stick));
      if (i >= 0) bins[i] -= Math.min(need, stick);
      else bins.push(stick - Math.min(need, stick));
    }
    const totalCut = list.reduce((a, x) => a + Math.max(0, x.cutFt), 0);
    summary.push({
      material: first.material,
      size: first.size,
      method: first.method,
      pieces: list.length,
      totalCutFt: totalCut,
      stickFt: stick,
      sticks: bins.length,
      wasteFt: bins.reduce((a, b) => a + Math.max(0, b), 0),
    });
  }
  summary.sort((a, b) => NOMINAL_SIZES.indexOf(b.size) - NOMINAL_SIZES.indexOf(a.size) || a.material.localeCompare(b.material));
  return { pieces, summary, warnings };
}

/** Lista de corte en CSV (separado por punto y coma, para Excel en español) */
export function cutListCsv(p: Project, list: CutList, metric: boolean): string {
  const num = (v: number, d: number) => v.toFixed(d).replace('.', ',');
  const len = (ft: number) => (metric ? num(ft * 304.8, 0) : num(ft * 12, 2));
  const unit = metric ? 'mm' : 'in';
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [
    ['Pieza', 'Tubos', 'Material', 'Diámetro', 'Unión', `Centro a centro (${unit})`, 'Extremo A', `Descuento A (${unit})`, 'Extremo B', `Descuento B (${unit})`, `Largo de corte (${unit})`, 'Nota'].map(q).join(';'),
  ];
  for (const pc of list.pieces) {
    rows.push(
      [
        q(pc.id),
        q(pc.pipeIds.join(' ')),
        q(getMaterial(pc.material, p).name),
        q(`${pc.size}"`),
        q(pc.method),
        len(pc.ctcFt),
        q(pc.endA.label),
        len(pc.endA.takeOffIn / 12),
        q(pc.endB.label),
        len(pc.endB.takeOffIn / 12),
        len(pc.cutFt),
        q(pc.note ?? ''),
      ].join(';'),
    );
  }
  rows.push('');
  rows.push(['Material', 'Diámetro', 'Unión', 'Piezas', `Largo total (${unit})`, `Tubo comercial (${unit})`, 'Tubos necesarios', `Sobrante (${unit})`].map(q).join(';'));
  for (const s of list.summary) {
    rows.push([q(getMaterial(s.material, p).name), q(`${s.size}"`), q(s.method), String(s.pieces), len(s.totalCutFt), len(s.stickFt), String(s.sticks), len(s.wasteFt)].join(';'));
  }
  return '﻿' + rows.join('\r\n');
}
