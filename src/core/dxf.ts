/**
 * Lectura de planos DXF para usarlos como fondo.
 *
 * Convierte las entidades del espacio modelo en segmentos de recta 2D (en unidades del dibujo),
 * agrupados por capa. Se soportan LINE, LWPOLYLINE/POLYLINE (con arcos por "bulge"), ARC,
 * CIRCLE, ELLIPSE, SPLINE, SOLID/3DFACE (contorno), bloques (INSERT, con escala, giro y
 * matrices) y cotas (su bloque gráfico). Los textos se cuentan pero no se dibujan.
 */
import DxfParser from 'dxf-parser';

export interface DxfLayer {
  name: string;
  /** segmentos x1,y1,x2,y2 consecutivos, en unidades del dibujo */
  segments: number[];
}

export interface DxfResult {
  layers: DxfLayer[];
  /** código $INSUNITS del archivo (0 = sin unidades) */
  insUnits: number;
  /** pies por unidad de dibujo según $INSUNITS, o undefined si el archivo no lo dice */
  ftPerUnit?: number;
  /** caja que contiene la mayor parte del dibujo (descarta elementos sueltos muy lejanos) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** puntos notables para el ajuste del cursor: extremos, vértices y centros */
  snapPoints: number[];
  stats: { entities: number; segments: number; texts: number; skipped: Record<string, number> };
}

/** Pies por unidad para los códigos $INSUNITS más comunes. */
export const INSUNITS_FT: Record<number, { name: string; ft: number }> = {
  1: { name: 'pulgadas', ft: 1 / 12 },
  2: { name: 'pies', ft: 1 },
  4: { name: 'milímetros', ft: 1 / 304.8 },
  5: { name: 'centímetros', ft: 1 / 30.48 },
  6: { name: 'metros', ft: 1 / 0.3048 },
};

/**
 * Escala razonable para un plano: muchos archivos traen mal declaradas las unidades
 * (por ejemplo, dibujado en metros pero marcado en milímetros). Si con las unidades declaradas
 * el dibujo mediría menos de 1 m o más de 9 km, se prueba con metros, milímetros, centímetros,
 * pies y pulgadas y se toma la primera que da un tamaño de edificio.
 */
export function plausibleScale(spanUnits: number, declaredFt?: number): { ft: number; code?: number; corrected: boolean } {
  const ok = (ft: number) => spanUnits * ft >= 3.3 && spanUnits * ft <= 30000;
  if (declaredFt && ok(declaredFt)) return { ft: declaredFt, corrected: false };
  // sin unidades: un dibujo de más de 2000 unidades de ancho casi siempre está en mm
  const order = declaredFt ? [6, 4, 5, 2, 1] : spanUnits > 2000 ? [4, 6, 5, 2, 1] : [6, 4, 5, 2, 1];
  for (const code of order) {
    // tamaño de edificio: entre 3 m y 3 km
    const ft = INSUNITS_FT[code].ft;
    if (spanUnits * ft >= 10 && spanUnits * ft <= 10000) return { ft, code, corrected: !!declaredFt };
  }
  return { ft: declaredFt ?? INSUNITS_FT[6].ft, corrected: false };
}

type Pt = { x: number; y: number };
/** Transformación afín 2D: x' = a x + c y + e ; y' = b x + d y + f */
type Mat = [number, number, number, number, number, number];
const I: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  // m ∘ n
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

const SEGS_PER_CIRCLE = 64;

// Tipos mínimos de lo que entrega dxf-parser (se leen de forma defensiva).
// Los DWG se convierten a esta misma forma (ver dwg.ts).
export interface AnyEntity {
  type: string;
  layer?: string;
  inPaperSpace?: boolean;
  visible?: boolean;
  [k: string]: unknown;
}

export type PlanBlocks = Record<string, { entities?: AnyEntity[]; position?: Pt }>;

export function parseDxf(text: string): DxfResult {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('El archivo DXF está vacío o no se pudo leer.');
  const header = (dxf.header ?? {}) as Record<string, unknown>;
  const insUnits = Number(header['$INSUNITS'] ?? 0) || 0;
  const blocks = (dxf.blocks ?? {}) as unknown as PlanBlocks;
  return buildPlan((dxf.entities ?? []) as unknown as AnyEntity[], blocks, insUnits, 'DXF');
}

/** Convierte entidades (con la forma de dxf-parser) en segmentos por capa. */
export function buildPlan(entities: AnyEntity[], blocks: PlanBlocks, insUnits: number, format = 'DXF'): DxfResult {
  const layers = new Map<string, number[]>();
  const snap: number[] = [];
  const stats = { entities: 0, segments: 0, texts: 0, skipped: {} as Record<string, number> };
  const MAX_SNAP = 400000;

  const seg = (layer: string, m: Mat, a: Pt, b: Pt) => {
    const p = apply(m, a);
    const q = apply(m, b);
    if (!Number.isFinite(p.x + p.y + q.x + q.y)) return;
    let arr = layers.get(layer);
    if (!arr) layers.set(layer, (arr = []));
    arr.push(p.x, p.y, q.x, q.y);
    stats.segments++;
  };
  const snapPt = (m: Mat, a: Pt) => {
    if (snap.length >= MAX_SNAP) return;
    const p = apply(m, a);
    if (Number.isFinite(p.x + p.y)) snap.push(p.x, p.y);
  };
  const polyline = (layer: string, m: Mat, pts: Pt[], closed: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) seg(layer, m, pts[i], pts[i + 1]);
    if (closed && pts.length > 2) seg(layer, m, pts[pts.length - 1], pts[0]);
  };
  const arcPoints = (c: Pt, r: number, a0: number, a1: number): Pt[] => {
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(2, Math.ceil((SEGS_PER_CIRCLE * sweep) / (Math.PI * 2)));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }
    return out;
  };
  /** puntos de un tramo de polilínea con "bulge" (arco) */
  const bulgePoints = (p: Pt, q: Pt, bulge: number): Pt[] => {
    if (!bulge) return [p, q];
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    if (chord === 0) return [p];
    const theta = 4 * Math.atan(bulge); // ángulo incluido, con signo
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const dist = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0));
    const ux = (q.x - p.x) / chord;
    const uy = (q.y - p.y) / chord;
    // el centro está a la izquierda si el arco es antihorario (bulge > 0) y mide < 180°
    const side = (bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
    const c = { x: mid.x - uy * dist * side, y: mid.y + ux * dist * side };
    const a0 = Math.atan2(p.y - c.y, p.x - c.x);
    const n = Math.max(2, Math.ceil((SEGS_PER_CIRCLE * Math.abs(theta)) / (Math.PI * 2)));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (theta * i) / n;
      out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
    }
    return out;
  };
  /** Las entidades con extrusión (0,0,-1) están espejadas en X (sistema de coordenadas del objeto) */
  const ocs = (e: AnyEntity, m: Mat): Mat => {
    const z =
      (e.extrusionDirectionZ as number | undefined) ??
      ((e.extrusionDirection as { z?: number } | undefined)?.z ?? 1);
    return z < 0 ? mul(m, [-1, 0, 0, 1, 0, 0]) : m;
  };

  const drawEntity = (e: AnyEntity, m: Mat, parentLayer: string, depth: number) => {
    if (e.inPaperSpace) return;
    if (e.visible === false) return;
    stats.entities++;
    const layer = !e.layer || (e.layer === '0' && parentLayer) ? parentLayer || '0' : e.layer;
    switch (e.type) {
      case 'LINE': {
        const v = e.vertices as Pt[] | undefined;
        if (v && v.length >= 2) {
          seg(layer, m, v[0], v[1]);
          snapPt(m, v[0]);
          snapPt(m, v[1]);
        }
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const v = (e.vertices as (Pt & { bulge?: number })[] | undefined) ?? [];
        if (v.length < 2) break;
        const mm = e.type === 'LWPOLYLINE' ? ocs(e, m) : m;
        const closed = !!e.shape;
        const pts: Pt[] = [];
        const n = v.length;
        const count = closed ? n : n - 1;
        for (let i = 0; i < count; i++) {
          const a = v[i];
          const b = v[(i + 1) % n];
          const part = bulgePoints(a, b, a.bulge ?? 0);
          if (pts.length) part.shift();
          pts.push(...part);
        }
        polyline(layer, mm, pts, false);
        for (const p of v) snapPt(mm, p);
        break;
      }
      case 'ARC': {
        const c = e.center as Pt;
        const mm = ocs(e, m);
        const pts = arcPoints(c, e.radius as number, e.startAngle as number, e.endAngle as number);
        polyline(layer, mm, pts, false);
        snapPt(mm, c);
        snapPt(mm, pts[0]);
        snapPt(mm, pts[pts.length - 1]);
        break;
      }
      case 'CIRCLE': {
        const c = e.center as Pt;
        const mm = ocs(e, m);
        polyline(layer, mm, arcPoints(c, e.radius as number, 0, Math.PI * 2), false);
        snapPt(mm, c);
        break;
      }
      case 'ELLIPSE': {
        const c = e.center as Pt;
        const ax = e.majorAxisEndPoint as Pt;
        const ratio = (e.axisRatio as number) ?? 1;
        let t0 = (e.startAngle as number) ?? 0;
        let t1 = (e.endAngle as number) ?? Math.PI * 2;
        if (t1 <= t0) t1 += Math.PI * 2;
        const bx = -ax.y * ratio;
        const by = ax.x * ratio;
        const n = Math.max(8, Math.ceil((SEGS_PER_CIRCLE * (t1 - t0)) / (Math.PI * 2)));
        const pts: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          pts.push({ x: c.x + ax.x * Math.cos(t) + bx * Math.sin(t), y: c.y + ax.y * Math.cos(t) + by * Math.sin(t) });
        }
        polyline(layer, ocs(e, m), pts, false);
        snapPt(m, c);
        break;
      }
      case 'SPLINE': {
        const pts = splinePoints(e);
        if (pts.length >= 2) {
          polyline(layer, m, pts, !!e.closed);
          snapPt(m, pts[0]);
          snapPt(m, pts[pts.length - 1]);
        }
        break;
      }
      case 'SOLID':
      case '3DFACE': {
        const v = ((e.points ?? e.vertices) as Pt[] | undefined) ?? [];
        // SOLID guarda las esquinas en orden 1-2-4-3
        const pts = e.type === 'SOLID' && v.length === 4 ? [v[0], v[1], v[3], v[2]] : v;
        if (pts.length >= 3) polyline(layer, m, pts, true);
        break;
      }
      case 'INSERT':
      case 'DIMENSION': {
        if (depth > 10) break;
        const name = (e.type === 'INSERT' ? e.name : e.block) as string | undefined;
        const block = name ? blocks[name] : undefined;
        if (!block?.entities) break;
        const base = block.position ?? { x: 0, y: 0 };
        if (e.type === 'DIMENSION') {
          // la geometría de la cota ya está en coordenadas del dibujo
          for (const child of block.entities) drawEntity(child, m, layer, depth + 1);
          break;
        }
        const pos = (e.position as Pt) ?? { x: 0, y: 0 };
        const sx = (e.xScale as number) ?? 1;
        const sy = (e.yScale as number) ?? 1;
        const rot = (((e.rotation as number) ?? 0) * Math.PI) / 180;
        const cols = Math.max(1, (e.columnCount as number) ?? 1);
        const rows = Math.max(1, (e.rowCount as number) ?? 1);
        const cs = (e.columnSpacing as number) ?? 0;
        const rs = (e.rowSpacing as number) ?? 0;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const ox = c * cs;
            const oy = r * rs;
            // T(pos) · R(rot) · T(ox,oy) · S(sx,sy) · T(-base)
            let local: Mat = [sx, 0, 0, sy, -base.x * sx + ox, -base.y * sy + oy];
            local = mul([cos, sin, -sin, cos, pos.x, pos.y], local);
            // la inserción está en el sistema del objeto: el espejo (si lo hay) va después
            const mm = mul(ocs(e, m), local);
            snapPt(mm, base);
            for (const child of block.entities) drawEntity(child, mm, layer, depth + 1);
          }
        }
        break;
      }
      case 'TEXT':
      case 'MTEXT':
      case 'ATTDEF':
      case 'ATTRIB':
        stats.texts++;
        break;
      case 'POINT': {
        const p = e.position as Pt | undefined;
        if (p) snapPt(m, p);
        break;
      }
      default:
        stats.skipped[e.type] = (stats.skipped[e.type] ?? 0) + 1;
    }
  };

  for (const e of entities) drawEntity(e, I, '', 0);

  const out: DxfLayer[] = [...layers.entries()]
    .map(([name, segments]) => ({ name, segments }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  if (!out.length) throw new Error(`El ${format} no tiene líneas en el espacio modelo que se puedan mostrar.`);

  return {
    layers: out,
    insUnits,
    ftPerUnit: INSUNITS_FT[insUnits]?.ft,
    bounds: robustBounds(out),
    snapPoints: snap,
    stats,
  };
}

/** Caja del 1 % al 99 % de los extremos (descarta elementos perdidos lejos del dibujo). */
function robustBounds(layers: DxfLayer[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const l of layers) {
    const s = l.segments;
    const step = Math.max(1, Math.floor(s.length / 4 / 50000)) * 4; // muestreo en dibujos grandes
    for (let i = 0; i < s.length; i += step) {
      xs.push(s[i], s[i + 2]);
      ys.push(s[i + 1], s[i + 3]);
    }
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const lo = xs.length > 200 ? 0.01 : 0;
  const hi = 1 - lo;
  return { minX: q(xs, lo), minY: q(ys, lo), maxX: q(xs, hi), maxY: q(ys, hi) };
}

/** Puntos de una curva SPLINE: puntos de ajuste si existen, si no se evalúa la B-spline. */
function splinePoints(e: AnyEntity): Pt[] {
  const fit = e.fitPoints as Pt[] | undefined;
  if (fit && fit.length >= 2) return fit;
  const ctrl = e.controlPoints as Pt[] | undefined;
  const knots = e.knotValues as number[] | undefined;
  const p = (e.degreeOfSplineCurve as number) ?? 3;
  if (!ctrl || ctrl.length < 2) return [];
  if (!knots || knots.length !== ctrl.length + p + 1) return ctrl;
  const lo = knots[p];
  const hi = knots[ctrl.length];
  const n = Math.max(16, ctrl.length * 8);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    out.push(deBoor(t, p, knots, ctrl));
  }
  return out;
}

function deBoor(t: number, p: number, knots: number[], ctrl: Pt[]): Pt {
  let k = p;
  while (k < ctrl.length - 1 && t >= knots[k + 1]) k++;
  const d: Pt[] = [];
  for (let j = 0; j <= p; j++) d.push({ ...ctrl[j + k - p] });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = knots[i + 1 + p - r] - knots[i];
      const a = den === 0 ? 0 : (t - knots[i]) / den;
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
    }
  }
  return d[p];
}
