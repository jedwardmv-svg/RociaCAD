/**
 * Planos de entrega: tamaños de hoja, escalas normalizadas y el dibujo de la red en planta y en
 * isométrico, listo para pasar a papel (coordenadas del dibujo en ft; el que dibuja escala a mm).
 */
import type { CalcResult } from './calculate';
import { getElementType } from './catalog';
import { ELEMENT_KIND_SHAPE } from './catalog';
import { checkDesignArea } from './designArea';
import { hangerPoint } from './hangers';
import type { PipeRole, Project, SprinklerOrientation } from './model';
import type { NominalSize } from './pipes';

export interface PaperSize {
  id: string;
  name: string;
  /** mm, horizontal */
  w: number;
  h: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: 'carta', name: 'Carta (279 × 216 mm)', w: 279.4, h: 215.9 },
  { id: 'tabloide', name: 'Tabloide (432 × 279 mm)', w: 431.8, h: 279.4 },
  { id: 'a3', name: 'A3 (420 × 297 mm)', w: 420, h: 297 },
  { id: 'a2', name: 'A2 (594 × 420 mm)', w: 594, h: 420 },
  { id: 'a1', name: 'A1 (841 × 594 mm)', w: 841, h: 594 },
  { id: 'archd', name: 'ARCH D (36 × 24 in)', w: 914.4, h: 609.6 },
];

export interface DrawingScale {
  /** 1:n */
  n: number;
  label: string;
}

/** Escalas de planos: métricas 1:n y de arquitectura en pulgadas (1/8" = 1'-0" es 1:96) */
export function standardScales(metric: boolean): DrawingScale[] {
  if (metric) return [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000].map((n) => ({ n, label: `1:${n}` }));
  return [
    { n: 24, label: '1/2" = 1\'-0"' },
    { n: 32, label: '3/8" = 1\'-0"' },
    { n: 48, label: '1/4" = 1\'-0"' },
    { n: 64, label: '3/16" = 1\'-0"' },
    { n: 96, label: '1/8" = 1\'-0"' },
    { n: 120, label: '1" = 10\'' },
    { n: 192, label: '1/16" = 1\'-0"' },
    { n: 240, label: '1" = 20\'' },
    { n: 360, label: '1" = 30\'' },
    { n: 480, label: '1" = 40\'' },
    { n: 600, label: '1" = 50\'' },
    { n: 1200, label: '1" = 100\'' },
    { n: 2400, label: '1" = 200\'' },
  ];
}

/** La escala más grande (más detalle) con la que el dibujo cabe en el recuadro (mm) */
export function fitScale(widthFt: number, heightFt: number, boxW: number, boxH: number, metric: boolean): DrawingScale {
  const list = standardScales(metric);
  for (const s of list) {
    const k = 304.8 / s.n; // mm de papel por ft
    if (widthFt * k <= boxW && heightFt * k <= boxH) return s;
  }
  const n = Math.ceil(Math.max((widthFt * 304.8) / boxW, (heightFt * 304.8) / boxH) / 100) * 100;
  return { n, label: `1:${n}` };
}

/** Pulgadas con fracciones para las etiquetas: 2-1/2 → 2½" */
export function inchLabel(size: NominalSize): string {
  const frac: Record<string, string> = { '1/4': '¼', '1/2': '½', '3/4': '¾' };
  const [whole, f] = size.includes('-') ? size.split('-') : size.includes('/') ? ['', size] : [size, ''];
  return `${whole}${f ? frac[f] ?? `-${f}` : ''}"`;
}

export type DrawingView = 'plan' | 'iso';

export interface DrawLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: PipeRole;
  size: NominalSize;
  pipeId: string;
}

export interface DrawHead {
  id: string;
  x: number;
  y: number;
  orientation: SprinklerOrientation;
  flowing: boolean;
}

export interface DrawLabel {
  x: number;
  y: number;
  /** giro del texto (rad), ya ajustado para leerse de izquierda a derecha */
  angle: number;
  text: string;
  kind: 'size' | 'node';
  /** más alto, más importante (se pone primero si no caben todas) */
  priority: number;
}

export interface NetworkDrawing {
  view: DrawingView;
  lines: DrawLine[];
  heads: DrawHead[];
  /** montantes y bajantes vistos de punta (solo en planta) */
  risers: { x: number; y: number }[];
  supply?: { x: number; y: number };
  labels: DrawLabel[];
  /** contorno del área de diseño */
  area?: { x: number; y: number }[];
  hangers: { x: number; y: number; angle: number }[];
  /** muros, vigas (líneas con espesor en ft), columnas y losas */
  elements: { kind: 'line' | 'area' | 'point'; pts: { x: number; y: number }[]; width: number }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface DrawingOptions {
  /** etiquetas de diámetro y largo de cada tramo */
  sizes: boolean;
  lengths: boolean;
  /** elevación del tramo */
  elevations: boolean;
  /** nombres de los nodos del cálculo */
  nodes: boolean;
  /** formato de largo y elevación */
  fmtLength: (ft: number) => string;
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Proyección isométrica (30°): x hacia abajo a la derecha, y hacia arriba a la derecha, z vertical */
export const isoProject = (x: number, y: number, z: number) => ({ x: (x - y) * COS30, y: (x + y) * SIN30 + z });

const readable = (a: number) => {
  let r = a;
  while (r > Math.PI / 2) r -= Math.PI;
  while (r < -Math.PI / 2) r += Math.PI;
  return r;
};

/** Arma el dibujo de la red para una vista */
export function networkDrawing(p: Project, result: CalcResult | undefined, view: DrawingView, o: DrawingOptions): NetworkDrawing {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const proj = view === 'plan' ? (x: number, y: number) => ({ x, y }) : (x: number, y: number, z: number) => isoProject(x, y, z);
  const P = (n: { x: number; y: number; z: number }) => proj(n.x, n.y, n.z);
  const out: NetworkDrawing = { view, lines: [], heads: [], risers: [], labels: [], hangers: [], elements: [], bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
  const grow = (x: number, y: number) => {
    const b = out.bounds;
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  };

  // tubos
  const vertical = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(b.x - a.x, b.y - a.y) < 0.02 && Math.abs(b.z - a.z) > 0.02;
  const riserAt = new Map<string, { x: number; y: number }>();
  for (const x of p.pipes) {
    const a = nodes.get(x.from);
    const b = nodes.get(x.to);
    if (!a || !b) continue;
    if (view === 'plan' && vertical(a, b)) {
      // de punta: un símbolo de montante (los bajantes a rociadores los tapa el rociador)
      const key = `${a.x.toFixed(2)},${a.y.toFixed(2)}`;
      if (!riserAt.has(key)) riserAt.set(key, { x: a.x, y: a.y });
      grow(a.x, a.y);
      continue;
    }
    const pa = P(a);
    const pb = P(b);
    out.lines.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, role: x.role, size: x.size, pipeId: x.id });
    grow(pa.x, pa.y);
    grow(pb.x, pb.y);
  }
  const headNodes = new Set(p.sprinklers.map((s) => s.nodeId));
  for (const [k, r] of riserAt) {
    // si el tubo vertical termina en un rociador, no se dibuja aparte
    const hasHead = p.sprinklers.some((s) => {
      const n = nodes.get(s.nodeId);
      return n && `${n.x.toFixed(2)},${n.y.toFixed(2)}` === k;
    });
    if (!hasHead) out.risers.push(r);
  }

  // rociadores
  for (const s of p.sprinklers) {
    const n = nodes.get(s.nodeId);
    if (!n) continue;
    const q = P(n);
    out.heads.push({ id: s.id, x: q.x, y: q.y, orientation: s.orientation, flowing: s.inDesignArea });
    grow(q.x, q.y);
  }

  // suministro
  const sup = nodes.get(p.supply.nodeId);
  if (sup) out.supply = P(sup);

  // tramos: tubos seguidos, alineados, del mismo diámetro y sin rociador ni derivación en medio
  const at = new Map<string, typeof p.pipes>();
  for (const x of p.pipes) {
    if (!nodes.has(x.from) || !nodes.has(x.to)) continue;
    (at.get(x.from) ?? at.set(x.from, []).get(x.from)!).push(x);
    (at.get(x.to) ?? at.set(x.to, []).get(x.to)!).push(x);
  }
  const done = new Set<string>();
  const dirOf = (x: (typeof p.pipes)[number], from: string) => {
    const a = nodes.get(from)!;
    const b = nodes.get(x.from === from ? x.to : x.from)!;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  const passThrough = (nodeId: string, x: (typeof p.pipes)[number]) => {
    if (headNodes.has(nodeId) || nodeId === p.supply.nodeId) return undefined;
    const list = at.get(nodeId) ?? [];
    if (list.length !== 2) return undefined;
    const y = list[0] === x ? list[1] : list[0];
    if (y.size !== x.size || y.role !== x.role) return undefined;
    const d1 = dirOf(x, nodeId);
    const d2 = dirOf(y, nodeId);
    return d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2] < -0.999 ? y : undefined;
  };
  if (o.sizes || o.lengths || o.elevations) {
    for (const x of p.pipes) {
      if (done.has(x.id) || !nodes.has(x.from) || !nodes.has(x.to)) continue;
      const run = [x];
      done.add(x.id);
      let startNode = x.from;
      let endNode = x.to;
      for (let cur = x, n = x.to; ; ) {
        const nx = passThrough(n, cur);
        if (!nx || done.has(nx.id)) break;
        run.push(nx);
        done.add(nx.id);
        n = nx.from === n ? nx.to : nx.from;
        endNode = n;
        cur = nx;
      }
      for (let cur = x, n = x.from; ; ) {
        const nx = passThrough(n, cur);
        if (!nx || done.has(nx.id)) break;
        run.unshift(nx);
        done.add(nx.id);
        n = nx.from === n ? nx.to : nx.from;
        startNode = n;
        cur = nx;
      }
      const a = nodes.get(startNode)!;
      const b = nodes.get(endNode)!;
      const len = run.reduce((s, r) => {
        const ra = nodes.get(r.from)!;
        const rb = nodes.get(r.to)!;
        return s + (r.lengthOverride ?? Math.hypot(rb.x - ra.x, rb.y - ra.y, rb.z - ra.z));
      }, 0);
      if (view === 'plan' && vertical(a, b)) continue;
      if (len < 0.3) continue;
      const pa = P(a);
      const pb = P(b);
      const parts: string[] = [];
      if (o.sizes) parts.push(inchLabel(x.size));
      if (o.lengths) parts.push(o.fmtLength(len));
      if (o.elevations && view === 'plan' && Math.abs(a.z - b.z) < 0.02) parts.push(`+${o.fmtLength(a.z)}`);
      if (!parts.length) continue;
      const rank: Record<PipeRole, number> = { feed: 5, riser: 5, main: 4, cross: 3, branch: 2, drop: 1 };
      out.labels.push({
        x: (pa.x + pb.x) / 2,
        y: (pa.y + pb.y) / 2,
        angle: readable(Math.atan2(pb.y - pa.y, pb.x - pa.x)),
        text: parts.join(' · '),
        kind: 'size',
        priority: rank[x.role] * 1000 + len,
      });
    }
  }

  // nodos del cálculo: derivaciones, suministro y rociadores abiertos
  if (o.nodes && result?.ok) {
    const flowingNodes = new Set(p.sprinklers.filter((s) => s.inDesignArea).map((s) => s.nodeId));
    for (const n of p.nodes) {
      const deg = at.get(n.id)?.length ?? 0;
      if (!(deg >= 3 || n.id === p.supply.nodeId || flowingNodes.has(n.id))) continue;
      const q = P(n);
      out.labels.push({ x: q.x, y: q.y, angle: 0, text: n.label || n.id, kind: 'node', priority: 500 + deg });
    }
  }

  // área de diseño
  const area = checkDesignArea(p);
  if (area) out.area = area.outline.map((q) => proj(q.x, q.y, area.z));

  // soportes (solo planta)
  if (view === 'plan')
    for (const h of p.hangers ?? []) {
      const pt = hangerPoint(p, h);
      if (!pt || h.kind !== 'hanger') continue;
      const a = nodes.get(pt.pipe.from)!;
      const b = nodes.get(pt.pipe.to)!;
      out.hangers.push({ x: pt.x, y: pt.y, angle: Math.atan2(b.y - a.y, b.x - a.x) });
    }

  // elementos del edificio (solo planta)
  if (view === 'plan')
    for (const e of p.elements ?? []) {
      const t = getElementType(e.typeId, p);
      if (t.kind === 'ceiling' || t.kind === 'pipe-ref' || t.kind === 'duct') continue;
      out.elements.push({ kind: ELEMENT_KIND_SHAPE[t.kind], pts: e.points, width: e.width ?? t.width });
    }

  if (!Number.isFinite(out.bounds.minX)) out.bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  return out;
}
