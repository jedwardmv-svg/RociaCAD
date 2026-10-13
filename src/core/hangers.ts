/**
 * Soportes de la tubería (NFPA 13, capítulo de soportes y colgantes).
 *
 * Reglas que se aplican al colocarlos automáticamente:
 *  - Distancia máxima entre soportes según material y diámetro (tabla de NFPA 13).
 *  - Al menos un soporte en cada tramo de tubería entre accesorios o rociadores
 *    (los niples de menos de 1 ft no llevan).
 *  - Extremo libre de una línea: el último soporte a no más de 36 in (1"), 48 in (1¼")
 *    o 60 in (1½" y mayores) del extremo.
 *  - A no menos de 3 in de un rociador o accesorio.
 *  - Montantes (tubos verticales): una abrazadera de montante.
 *  - Varilla según el diámetro: hasta 4" de 3/8", de 5" a 8" de 1/2", de 10" y 12" de 5/8".
 * La tubería enterrada (alimentación) no lleva soportes. No incluye arriostramiento sísmico.
 */
import type { BuildingElement, Pipe, Project } from './model';
import { nextId } from './model';
import { getElementType } from './catalog';
import { ELEMENT_KIND_SHAPE } from './catalog';
import { materialFamily, NOMINAL_SIZES, OD_IN, type NominalSize } from './pipes';

export interface Hanger {
  id: string;
  pipeId: string;
  /** posición a lo largo del tubo, de 0 (nodo "from") a 1 (nodo "to") */
  t: number;
  kind: 'hanger' | 'riser-clamp';
  /** altura de la estructura donde se ancla (ft); si falta, se busca o se usa la del proyecto */
  structureZ?: number;
}

const ft = (feet: number, inches = 0) => feet + inches / 12;

/** Distancia máxima entre soportes (ft) por familia y tamaño; undefined = no aplica */
const SPACING: Record<'steel' | 'copper' | 'cpvc', Partial<Record<NominalSize, number>>> = {
  steel: { '3/4': 12, '1': 12, '1-1/4': 12, '1-1/2': 15, '2': 15, '2-1/2': 15, '3': 15, '3-1/2': 15, '4': 15, '5': 15, '6': 15, '8': 15, '10': 15, '12': 15 },
  copper: { '3/4': 8, '1': 8, '1-1/4': 10, '1-1/2': 10, '2': 12, '2-1/2': 12, '3': 12, '3-1/2': 15, '4': 15, '5': 15, '6': 15, '8': 15 },
  cpvc: { '3/4': ft(5, 6), '1': 6, '1-1/4': ft(6, 6), '1-1/2': 7, '2': 8, '2-1/2': 9, '3': 10 },
};

/** Distancia máxima entre soportes de un tubo (ft), o undefined si no lleva (enterrado) */
export function maxHangerSpacing(p: Project, pipe: Pipe): number | undefined {
  if (pipe.role === 'feed') return undefined;
  const fam = materialFamily(pipe.material, p);
  if (fam === 'buried') return undefined;
  const table = fam === 'copper' ? SPACING.copper : fam === 'cpvc' ? SPACING.cpvc : SPACING.steel;
  return table[pipe.size] ?? 15;
}

/** Distancia máxima del extremo libre de una línea al último soporte (ft) */
export function maxEndOverhang(size: NominalSize): number {
  const r = NOMINAL_SIZES.indexOf(size);
  if (r <= NOMINAL_SIZES.indexOf('1')) return 3;
  if (size === '1-1/4') return 4;
  return 5;
}

/** Diámetro de la varilla roscada (in) */
export function rodDiameter(size: NominalSize): '3/8' | '1/2' | '5/8' {
  const r = NOMINAL_SIZES.indexOf(size);
  if (r <= NOMINAL_SIZES.indexOf('4')) return '3/8';
  if (r <= NOMINAL_SIZES.indexOf('8')) return '1/2';
  return '5/8';
}

/** Nombre del soporte según el tamaño */
export function hangerTypeName(h: Hanger, size: NominalSize): string {
  if (h.kind === 'riser-clamp') return 'Abrazadera de montante';
  return NOMINAL_SIZES.indexOf(size) <= NOMINAL_SIZES.indexOf('4') ? 'Colgante tipo pera' : 'Colgante tipo clevis';
}

// ---------- Geometría ----------

interface Seg {
  pipe: Pipe;
  /** sentido: true si el recorrido va de from a to */
  fwd: boolean;
  len: number;
}

const EPS_START = 0.25; // ft: 3 in de un accesorio o rociador

/** Punto de un soporte en el espacio (eje del tubo) */
export function hangerPoint(p: Project, h: Hanger): { x: number; y: number; z: number; pipe: Pipe } | null {
  const pipe = p.pipes.find((x) => x.id === h.pipeId);
  if (!pipe) return null;
  const a = p.nodes.find((n) => n.id === pipe.from);
  const b = p.nodes.find((n) => n.id === pipe.to);
  if (!a || !b) return null;
  return { x: a.x + (b.x - a.x) * h.t, y: a.y + (b.y - a.y) * h.t, z: a.z + (b.z - a.z) * h.t, pipe };
}

const inPolygon = (pts: { x: number; y: number }[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const distToPolyline = (pts: { x: number; y: number }[], x: number, y: number) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - x, a.y + t * dy - y));
  }
  return best;
};

/**
 * Altura de la estructura sobre un punto: la cara inferior de la losa o viga dibujada más baja
 * por encima del tubo; si no hay, la altura de estructura del proyecto (o 1,5 ft sobre el tubo).
 */
export function structureAbove(p: Project, x: number, y: number, z: number): number {
  let best = Infinity;
  for (const e of p.elements ?? ([] as BuildingElement[])) {
    const t = getElementType(e.typeId, p);
    if (t.kind !== 'slab' && t.kind !== 'beam') continue;
    if (e.z <= z) continue;
    const shape = ELEMENT_KIND_SHAPE[t.kind];
    const w = e.width ?? t.width;
    const hit = shape === 'area' ? e.points.length >= 3 && inPolygon(e.points, x, y) : distToPolyline(e.points, x, y) <= w / 2;
    if (hit) best = Math.min(best, e.z);
  }
  if (Number.isFinite(best)) return best;
  return Math.max(p.hangerStructureZ ?? -Infinity, z + 1.5);
}

/** Largo de la varilla de un soporte (ft): de la parte de arriba del tubo a la estructura */
export function hangerRodLength(p: Project, h: Hanger): number {
  const pt = hangerPoint(p, h);
  if (!pt) return NaN;
  const top = pt.z + OD_IN[pt.pipe.size] / 24;
  const s = h.structureZ ?? structureAbove(p, pt.x, pt.y, pt.z);
  return s - top;
}

/** Tramos rectos horizontales (líneas) formados por tubos alineados */
export function horizontalRuns(p: Project): { segs: Seg[]; freeStart: boolean; freeEnd: boolean }[] {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const dirOf = (pipe: Pipe): [number, number, number] | null => {
    const a = nodes.get(pipe.from);
    const b = nodes.get(pipe.to);
    if (!a || !b) return null;
    const d: [number, number, number] = [b.x - a.x, b.y - a.y, b.z - a.z];
    const l = Math.hypot(...d);
    return l > 1e-6 ? [d[0] / l, d[1] / l, d[2] / l] : null;
  };
  const horiz = p.pipes.filter((x) => {
    const d = dirOf(x);
    return d && Math.abs(d[2]) < 0.05 && maxHangerSpacing(p, x) !== undefined && x.role !== 'drop';
  });
  const horizSet = new Set(horiz.map((x) => x.id));
  const at = new Map<string, Pipe[]>();
  for (const x of horiz) {
    (at.get(x.from) ?? at.set(x.from, []).get(x.from)!).push(x);
    (at.get(x.to) ?? at.set(x.to, []).get(x.to)!).push(x);
  }
  // continuación recta de un tubo en un nodo
  const cont = (pipe: Pipe, nodeId: string): Pipe | undefined => {
    const d = dirOf(pipe)!;
    const out = pipe.to === nodeId ? d : ([-d[0], -d[1], -d[2]] as [number, number, number]);
    let best: Pipe | undefined;
    let bestDot = 0.995;
    for (const q of at.get(nodeId) ?? []) {
      if (q.id === pipe.id) continue;
      const e = dirOf(q)!;
      const qOut = q.from === nodeId ? e : ([-e[0], -e[1], -e[2]] as [number, number, number]);
      const dd = out[0] * qOut[0] + out[1] * qOut[1] + out[2] * qOut[2];
      if (dd > bestDot) {
        bestDot = dd;
        best = q;
      }
    }
    return best;
  };
  // ¿el nodo queda sostenido por otra línea horizontal (la tee de una matriz)?
  const supportedElsewhere = (nodeId: string, run: Set<string>) => (at.get(nodeId) ?? []).some((q) => !run.has(q.id) && horizSet.has(q.id));

  const used = new Set<string>();
  const runs: { segs: Seg[]; freeStart: boolean; freeEnd: boolean }[] = [];
  for (const start of horiz) {
    if (used.has(start.id)) continue;
    // ir hacia atrás hasta el comienzo de la línea
    let cur = start;
    let node = cur.from;
    const guard = new Set<string>([cur.id]);
    for (;;) {
      const prev = cont(cur, node);
      if (!prev || guard.has(prev.id)) break;
      guard.add(prev.id);
      node = prev.from === node ? prev.to : prev.from;
      cur = prev;
    }
    // ahora `cur` es el primer tubo y `node` su extremo libre; recorrer hacia adelante
    const segs: Seg[] = [];
    const startNode = node;
    let at0 = node;
    let pipe: Pipe | undefined = cur;
    while (pipe && !used.has(pipe.id)) {
      used.add(pipe.id);
      const fwd = pipe.from === at0;
      const a = nodes.get(pipe.from)!;
      const b = nodes.get(pipe.to)!;
      segs.push({ pipe, fwd, len: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) });
      at0 = fwd ? pipe.to : pipe.from;
      pipe = cont(pipe, at0);
    }
    const ids = new Set(segs.map((s) => s.pipe.id));
    runs.push({ segs, freeStart: !supportedElsewhere(startNode, ids), freeEnd: !supportedElsewhere(at0, ids) });
  }
  return runs;
}

/** Posición en el tubo (t de 0 a 1) para una distancia d desde el comienzo del tramo recorrido */
const tOf = (s: Seg, d: number) => {
  const f = Math.max(0, Math.min(1, d / s.len));
  return s.fwd ? f : 1 - f;
};

export interface PlaceResult {
  added: number;
  removed: number;
}

/** Coloca soportes automáticamente (reemplaza los que había en los tubos tratados). */
export function placeHangers(p: Project, opts: { pipeIds?: string[] } = {}): PlaceResult {
  const only = opts.pipeIds ? new Set(opts.pipeIds) : null;
  const before = p.hangers ?? [];
  const keep = before.filter((h) => only && !only.has(h.pipeId));
  const out: Hanger[] = [...keep];
  const add = (pipeId: string, t: number, kind: Hanger['kind']) => out.push({ id: nextId('H', out), pipeId, t, kind });

  for (const run of horizontalRuns(p)) {
    if (only && !run.segs.some((s) => only.has(s.pipe.id))) continue;
    // posiciones a lo largo de la línea
    const starts: number[] = [];
    let acc = 0;
    for (const s of run.segs) {
      starts.push(acc);
      acc += s.len;
    }
    const L = acc;
    const pos: { d: number; seg: number }[] = [];
    // 1) uno por tramo (a 1 ft del extremo libre, o en el centro)
    run.segs.forEach((s, i) => {
      if (s.len < 1) return;
      const firstFree = i === 0 && run.freeStart;
      const lastFree = i === run.segs.length - 1 && run.freeEnd;
      const e = Math.min(1, s.len / 2);
      if (firstFree && lastFree && s.len > 2 * maxEndOverhang(s.pipe.size)) {
        pos.push({ d: starts[i] + e, seg: i }, { d: starts[i] + s.len - e, seg: i });
      } else if (firstFree) pos.push({ d: starts[i] + e, seg: i });
      else if (lastFree) pos.push({ d: starts[i] + s.len - e, seg: i });
      else pos.push({ d: starts[i] + s.len / 2, seg: i });
    });
    if (!pos.length) {
      // línea de solo niples cortos: uno en el centro del tramo más largo
      const i = run.segs.reduce((bi, s, k) => (s.len > run.segs[bi].len ? k : bi), 0);
      if (L >= 0.5) pos.push({ d: starts[i] + run.segs[i].len / 2, seg: i });
    }
    // 2) cumplir la distancia máxima entre soportes
    const segAt = (d: number) => {
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1] <= d) i++;
      return i;
    };
    const spacing = (d1: number, d2: number) => {
      let m = Infinity;
      for (let i = segAt(d1); i <= segAt(d2); i++) m = Math.min(m, maxHangerSpacing(p, run.segs[i].pipe) ?? Infinity);
      return m;
    };
    pos.sort((a, b) => a.d - b.d);
    const filled: { d: number; seg: number }[] = [];
    for (let k = 0; k < pos.length; k++) {
      filled.push(pos[k]);
      if (k + 1 >= pos.length) break;
      const d1 = pos[k].d;
      const d2 = pos[k + 1].d;
      const S = spacing(d1, d2);
      const n = Math.ceil((d2 - d1) / S - 1e-9);
      for (let j = 1; j < n; j++) {
        let d = d1 + ((d2 - d1) * j) / n;
        // no encima de un nodo (rociador o accesorio)
        for (const st of starts.slice(1)) if (Math.abs(d - st) < EPS_START) d = st + (d < st ? -EPS_START : EPS_START);
        filled.push({ d, seg: segAt(d) });
      }
    }
    for (const { d, seg } of filled) {
      const s = run.segs[seg];
      add(s.pipe.id, tOf(s, d - starts[seg]), 'hanger');
    }
  }

  // montantes: una abrazadera por tubo vertical de más de 3 ft
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  for (const pipe of p.pipes) {
    if (only && !only.has(pipe.id)) continue;
    if (pipe.role === 'drop' || maxHangerSpacing(p, pipe) === undefined) continue;
    const a = nodes.get(pipe.from);
    const b = nodes.get(pipe.to);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len < 3 || Math.abs(b.z - a.z) < 0.9 * len) continue;
    // a 1 ft sobre el extremo de abajo
    const lowIsFrom = a.z <= b.z;
    const f = Math.min(0.5, 1 / len);
    add(pipe.id, lowIsFrom ? f : 1 - f, 'riser-clamp');
  }

  p.hangers = out;
  return { added: out.length - keep.length, removed: before.length - keep.length };
}

export interface HangerCheck {
  problems: string[];
  count: number;
}

/** Revisa los soportes actuales: distancias, extremos libres, tramos sin soporte, varillas */
export function checkHangers(p: Project): HangerCheck {
  const hangers = (p.hangers ?? []).filter((h) => p.pipes.some((x) => x.id === h.pipeId));
  const problems: string[] = [];
  const byPipe = new Map<string, Hanger[]>();
  for (const h of hangers) (byPipe.get(h.pipeId) ?? byPipe.set(h.pipeId, []).get(h.pipeId)!).push(h);
  for (const run of horizontalRuns(p)) {
    const ds: number[] = [];
    let acc = 0;
    for (const s of run.segs) {
      for (const h of byPipe.get(s.pipe.id) ?? []) if (h.kind === 'hanger') ds.push(acc + (s.fwd ? h.t : 1 - h.t) * s.len);
      acc += s.len;
    }
    const L = acc;
    const name = run.segs.map((s) => s.pipe.id).join('-');
    const label = run.segs.length > 3 ? `${run.segs[0].pipe.id}…${run.segs[run.segs.length - 1].pipe.id}` : name;
    if (!ds.length) {
      if (L >= 1) problems.push(`La línea ${label} no tiene soportes.`);
      continue;
    }
    ds.sort((a, b) => a - b);
    const smallest = run.segs.reduce((m, s) => Math.min(m, maxHangerSpacing(p, s.pipe) ?? Infinity), Infinity);
    for (let i = 0; i + 1 < ds.length; i++) {
      if (ds[i + 1] - ds[i] > smallest + 1e-6) {
        problems.push(`En la línea ${label} hay ${(ds[i + 1] - ds[i]).toFixed(1)} ft entre soportes (máximo ${smallest.toFixed(1)} ft).`);
        break;
      }
    }
    const first = run.segs[0];
    const last = run.segs[run.segs.length - 1];
    if (run.freeStart && ds[0] > maxEndOverhang(first.pipe.size) + 1e-6)
      problems.push(`En la línea ${label} el extremo queda a ${ds[0].toFixed(1)} ft del último soporte (máximo ${maxEndOverhang(first.pipe.size)} ft).`);
    if (run.freeEnd && L - ds[ds.length - 1] > maxEndOverhang(last.pipe.size) + 1e-6)
      problems.push(`En la línea ${label} el extremo queda a ${(L - ds[ds.length - 1]).toFixed(1)} ft del último soporte (máximo ${maxEndOverhang(last.pipe.size)} ft).`);
  }
  const bad = hangers.filter((h) => h.kind === 'hanger' && !(hangerRodLength(p, h) > 0));
  if (bad.length) problems.push(`${bad.length} soporte(s) quedan por encima de la estructura (varilla de largo cero o negativo): revise la altura de la estructura.`);
  return { problems, count: hangers.length };
}

/** Quita los soportes de tubos que ya no existen */
export function pruneHangers(p: Project) {
  if (!p.hangers) return;
  const ids = new Set(p.pipes.map((x) => x.id));
  p.hangers = p.hangers.filter((h) => ids.has(h.pipeId));
}
