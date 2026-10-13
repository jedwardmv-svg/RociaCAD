/**
 * Lectura de planos DXF para usarlos como fondo.
 *
 * Convierte las entidades del espacio modelo en segmentos de recta 2D (en unidades del dibujo),
 * agrupados por capa. Se soportan LINE, LWPOLYLINE/POLYLINE (con arcos por "bulge"), ARC,
 * CIRCLE, ELLIPSE, SPLINE, SOLID/3DFACE (contorno), bloques (INSERT, con escala, giro y
 * matrices) y cotas (su bloque gráfico). Los textos se cuentan pero no se dibujan.
 */
import DxfParser from 'dxf-parser';
import { ShapeUtils, Vector2 } from 'three';
import { mtextPlain, textLineStrokes, textLineWidth, wrapText } from './planText';

/** Triangula un polígono con huecos (índices de los vértices) */
function earcut(flat: number[], holeStarts: number[]): number[] {
  const toV = (from: number, to: number) => {
    const out: Vector2[] = [];
    for (let i = from; i < to; i++) out.push(new Vector2(flat[2 * i], flat[2 * i + 1]));
    return out;
  };
  const n = flat.length / 2;
  const bounds = [0, ...holeStarts, n];
  const contour = toV(0, bounds[1]);
  const holes = holeStarts.map((s, k) => toV(s, bounds[k + 2]));
  const faces = ShapeUtils.triangulateShape(contour, holes);
  return faces.flat();
}

export interface DxfLayer {
  name: string;
  /** segmentos x1,y1,z1,x2,y2,z2 consecutivos, en unidades del dibujo */
  segments: number[];
  /** color RGB (0xRRGGBB) de cada segmento */
  colors: number[];
  /** triángulos rellenos (x,y,z ×3) de sólidos, caras 3D, sombreados sólidos y polilíneas con ancho */
  fills: number[];
  /** color de cada triángulo */
  fillColors: number[];
  /** color de la capa */
  color: number;
  /** la capa venía apagada o congelada en el archivo */
  off: boolean;
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
  stats: { entities: number; segments: number; texts: number; fills: number; skipped: Record<string, number> };
  /** el dibujo tiene alturas distintas (modelo en 3D) */
  is3D: boolean;
  zRange: { min: number; max: number };
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

type Pt = { x: number; y: number; z?: number };
type V3 = { x: number; y: number; z: number };

/**
 * Transformación afín 3D en filas: x' = m0 x + m1 y + m2 z + m3 ; y' = m4 x + … ; z' = m8 x + …
 */
type Mat = [number, number, number, number, number, number, number, number, number, number, number, number];
const I: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function mul(m: Mat, n: Mat): Mat {
  // m ∘ n
  const r = new Array(12) as Mat;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = m[i * 4] * n[j] + m[i * 4 + 1] * n[4 + j] + m[i * 4 + 2] * n[8 + j];
    r[i * 4 + 3] = m[i * 4] * n[3] + m[i * 4 + 1] * n[7] + m[i * 4 + 2] * n[11] + m[i * 4 + 3];
  }
  return r;
}

const translate = (x: number, y: number, z: number): Mat => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const scale3 = (sx: number, sy: number, sz: number): Mat => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0];
const rotZ = (a: number): Mat => [Math.cos(a), -Math.sin(a), 0, 0, Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0];

/** Sistema de coordenadas del objeto (OCS) a partir de la dirección de extrusión: algoritmo del eje arbitrario */
function ocsMatrix(n: V3 | undefined): Mat {
  if (!n) return I;
  const len = Math.hypot(n.x, n.y, n.z);
  if (!(len > 1e-12)) return I;
  const N = { x: n.x / len, y: n.y / len, z: n.z / len };
  if (Math.abs(N.x) < 1e-12 && Math.abs(N.y) < 1e-12 && N.z > 0) return I;
  const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  let Ax = Math.abs(N.x) < 1 / 64 && Math.abs(N.y) < 1 / 64 ? cross({ x: 0, y: 1, z: 0 }, N) : cross({ x: 0, y: 0, z: 1 }, N);
  const la = Math.hypot(Ax.x, Ax.y, Ax.z);
  Ax = { x: Ax.x / la, y: Ax.y / la, z: Ax.z / la };
  const Ay = cross(N, Ax);
  return [Ax.x, Ay.x, N.x, 0, Ax.y, Ay.y, N.y, 0, Ax.z, Ay.z, N.z, 0];
}

function apply(m: Mat, p: Pt): V3 {
  const z = p.z ?? 0;
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * z + m[3],
    y: m[4] * p.x + m[5] * p.y + m[6] * z + m[7],
    z: m[8] * p.x + m[9] * p.y + m[10] * z + m[11],
  };
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

/** Datos de las capas del archivo: color y si está apagada o congelada */
export type LayerTable = Record<string, { color?: number; colorIndex?: number; off?: boolean }>;

export function parseDxf(text: string): DxfResult {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('El archivo DXF está vacío o no se pudo leer.');
  const header = (dxf.header ?? {}) as Record<string, unknown>;
  const insUnits = Number(header['$INSUNITS'] ?? 0) || 0;
  const blocks = (dxf.blocks ?? {}) as unknown as PlanBlocks;
  const table: LayerTable = {};
  const raw = ((dxf.tables as unknown as { layer?: { layers?: Record<string, { color?: number; colorIndex?: number; visible?: boolean; frozen?: boolean }> } })?.layer?.layers ?? {});
  for (const [name, l] of Object.entries(raw)) table[name] = { color: l.color, colorIndex: l.colorIndex, off: l.visible === false || !!l.frozen };
  return buildPlan((dxf.entities ?? []) as unknown as AnyEntity[], blocks, insUnits, 'DXF', table);
}

// ---------- Colores ----------

/** Color RGB (0xRRGGBB) de un índice de color de AutoCAD (ACI) */
export function aciColor(i: number): number {
  const fixed: Record<number, number> = { 1: 0xff0000, 2: 0xffff00, 3: 0x00ff00, 4: 0x00ffff, 5: 0x0000ff, 6: 0xff00ff, 7: 0xffffff, 8: 0x808080, 9: 0xc0c0c0 };
  if (fixed[i] !== undefined) return fixed[i];
  if (i >= 250 && i <= 255) return [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff][i - 250];
  if (i < 10 || i > 249) return 0xffffff;
  const hue = Math.floor((i - 10) / 10) * 15;
  const j = (i - 10) % 10;
  const v = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][j];
  const sat = j % 2 === 0 ? 1 : 0.5;
  // HSV → RGB
  const c = v * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  const to = (t: number) => Math.floor((t + m) * 255 + 1e-9);
  return (to(r1) << 16) | (to(g1) << 8) | to(b1);
}

const WHITE = 0xffffff;

/** Convierte entidades (con la forma de dxf-parser) en segmentos, rellenos y textos por capa. */
export function buildPlan(entities: AnyEntity[], blocks: PlanBlocks, insUnits: number, format = 'DXF', layerTable: LayerTable = {}): DxfResult {
  interface Acc {
    segments: number[];
    colors: number[];
    fills: number[];
    fillColors: number[];
  }
  const layers = new Map<string, Acc>();
  const snap: number[] = [];
  const stats = { entities: 0, segments: 0, texts: 0, fills: 0, skipped: {} as Record<string, number> };
  const MAX_SNAP = 400000;
  let zMin = Infinity;
  let zMax = -Infinity;

  const acc = (layer: string): Acc => {
    let a = layers.get(layer);
    if (!a) layers.set(layer, (a = { segments: [], colors: [], fills: [], fillColors: [] }));
    return a;
  };
  const layerColor = (layer: string): number => {
    const l = layerTable[layer];
    if (!l) return WHITE;
    if (l.colorIndex !== undefined && l.colorIndex >= 1 && l.colorIndex <= 255) return aciColor(Math.abs(l.colorIndex));
    if (l.color !== undefined && l.color >= 0) return l.color & 0xffffff;
    return WHITE;
  };
  /** color de una entidad: propio, de su capa (ByLayer) o del bloque que la contiene (ByBlock) */
  const colorOf = (e: AnyEntity, layer: string, blockColor: number): number => {
    const idx = e.colorIndex as number | undefined;
    const tc = e.color as number | undefined;
    if (idx === 0) return blockColor;
    if (idx !== undefined && idx >= 1 && idx <= 255) return tc !== undefined && tc >= 0 && tc !== aciColor(idx) && tc !== 0xffffff ? tc & 0xffffff : aciColor(idx);
    if ((idx === undefined || idx === 256) && tc !== undefined && tc >= 0 && idx === undefined) return tc & 0xffffff;
    return layerColor(layer);
  };

  const seg = (a: Acc, color: number, m: Mat, p0: Pt, p1: Pt) => {
    const p = apply(m, p0);
    const q = apply(m, p1);
    if (!Number.isFinite(p.x + p.y + p.z + q.x + q.y + q.z)) return;
    a.segments.push(p.x, p.y, p.z, q.x, q.y, q.z);
    a.colors.push(color);
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
    stats.segments++;
  };
  const tri = (a: Acc, color: number, m: Mat, p0: Pt, p1: Pt, p2: Pt) => {
    const A = apply(m, p0);
    const B = apply(m, p1);
    const C = apply(m, p2);
    if (!Number.isFinite(A.x + A.y + A.z + B.x + B.y + B.z + C.x + C.y + C.z)) return;
    a.fills.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
    a.fillColors.push(color);
    stats.fills++;
  };
  const snapPt = (m: Mat, p0: Pt) => {
    if (snap.length >= MAX_SNAP) return;
    const p = apply(m, p0);
    if (Number.isFinite(p.x + p.y)) snap.push(p.x, p.y);
  };
  const polyline = (a: Acc, color: number, m: Mat, pts: Pt[], closed: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) seg(a, color, m, pts[i], pts[i + 1]);
    if (closed && pts.length > 2) seg(a, color, m, pts[pts.length - 1], pts[0]);
  };
  const arcPoints = (c: Pt, r: number, a0: number, a1: number, z = 0): Pt[] => {
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    const n = Math.max(2, Math.ceil((SEGS_PER_CIRCLE * sweep) / (Math.PI * 2)));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t), z });
    }
    return out;
  };
  /** puntos de un tramo de polilínea con "bulge" (arco) */
  const bulgePoints = (p: Pt, q: Pt, bulge: number, z = 0): Pt[] => {
    if (!bulge) return [{ x: p.x, y: p.y, z }, { x: q.x, y: q.y, z }];
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    if (chord === 0) return [{ x: p.x, y: p.y, z }];
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
      out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t), z });
    }
    return out;
  };
  /** dirección de extrusión de la entidad (normal de su plano) */
  const extOf = (e: AnyEntity): V3 | undefined => {
    const v = (e.extrusion ?? e.extrusionDirection) as Partial<V3> | undefined;
    if (v && (v.x !== undefined || v.y !== undefined || v.z !== undefined)) return { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 1 };
    const X = e.extrusionDirectionX as number | undefined;
    const Y = e.extrusionDirectionY as number | undefined;
    const Z = e.extrusionDirectionZ as number | undefined;
    if (X !== undefined || Y !== undefined || Z !== undefined) return { x: X ?? 0, y: Y ?? 0, z: Z ?? 1 };
    return undefined;
  };
  const ocs = (e: AnyEntity, m: Mat): Mat => {
    const o = ocsMatrix(extOf(e));
    return o === I ? m : mul(m, o);
  };
  const triangulate = (a: Acc, color: number, m: Mat, loops: Pt[][]) => {
    const clean = loops
      .map((l) => {
        const c = l.filter((p, i) => i === 0 || Math.hypot(p.x - l[i - 1].x, p.y - l[i - 1].y) > 1e-12);
        // sin el punto final repetido (el triangulador lo quitaría y movería los índices)
        while (c.length > 1 && Math.hypot(c[0].x - c[c.length - 1].x, c[0].y - c[c.length - 1].y) <= 1e-12) c.pop();
        return c;
      })
      .filter((l) => l.length >= 3);
    if (!clean.length) return;
    const area = (l: Pt[]) => {
      let s = 0;
      for (let i = 0; i < l.length; i++) {
        const p = l[i];
        const q = l[(i + 1) % l.length];
        s += p.x * q.y - q.x * p.y;
      }
      return s / 2;
    };
    // el contorno más grande es el exterior; los demás, huecos
    clean.sort((x, y) => Math.abs(area(y)) - Math.abs(area(x)));
    const outer = clean[0];
    const holes = clean.slice(1);
    const flat: number[] = [];
    const holeIdx: number[] = [];
    for (const p of outer) flat.push(p.x, p.y);
    for (const h of holes) {
      holeIdx.push(flat.length / 2);
      for (const p of h) flat.push(p.x, p.y);
    }
    const all = [...outer, ...holes.flat()];
    const z = outer[0].z ?? 0;
    const idx = earcut(flat, holeIdx);
    for (let i = 0; i + 2 < idx.length; i += 3) tri(a, color, m, { ...all[idx[i]], z }, { ...all[idx[i + 1]], z }, { ...all[idx[i + 2]], z });
  };

  /** dibuja un texto (una o varias líneas) con su origen, altura, giro y alineación */
  const drawText = (
    a: Acc,
    color: number,
    m: Mat,
    lines: string[],
    o: { x: number; y: number; z: number; h: number; rot: number; wf: number; hAlign: 'left' | 'center' | 'right'; vAlign: 'baseline' | 'top' | 'middle' | 'bottom'; lineGap: number },
  ) => {
    if (!(o.h > 0) || !lines.length) return;
    const widths = lines.map((l) => textLineWidth(l, o.h, o.wf));
    const total = o.h + (lines.length - 1) * o.lineGap;
    // y de la línea base de la primera línea, relativa al origen
    const y0 = o.vAlign === 'top' ? -o.h : o.vAlign === 'middle' ? total / 2 - o.h : o.vAlign === 'bottom' ? total - o.h + 0.3 * o.h : 0;
    const tm = mul(m, mul(translate(o.x, o.y, o.z), rotZ(o.rot)));
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const dx = o.hAlign === 'center' ? -widths[i] / 2 : o.hAlign === 'right' ? -widths[i] : 0;
      const dy = y0 - i * o.lineGap;
      const { strokes } = textLineStrokes(line, o.h, o.wf);
      for (const s of strokes) for (let k = 0; k + 1 < s.length; k++) seg(a, color, tm, { x: s[k][0] + dx, y: s[k][1] + dy }, { x: s[k + 1][0] + dx, y: s[k + 1][1] + dy });
    });
  };

  const drawEntity = (e: AnyEntity, m: Mat, parentLayer: string, blockColor: number, depth: number) => {
    if (e.inPaperSpace) return;
    if (e.visible === false) return;
    stats.entities++;
    const layer = !e.layer || (e.layer === '0' && parentLayer) ? parentLayer || '0' : e.layer;
    const color = colorOf(e, layer, blockColor);
    const a = acc(layer);
    switch (e.type) {
      case 'LINE': {
        const v = e.vertices as Pt[] | undefined;
        if (v && v.length >= 2) {
          seg(a, color, m, v[0], v[1]);
          snapPt(m, v[0]);
          snapPt(m, v[1]);
        }
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const v = (e.vertices as (Pt & { bulge?: number })[] | undefined) ?? [];
        if (v.length < 2) break;
        const is3d = e.type === 'POLYLINE' && (e.is3d === true || v.some((p) => (p as { threeDPolylineVertex?: boolean }).threeDPolylineVertex));
        const mm = is3d ? m : ocs(e, m);
        const elev = is3d ? 0 : Number(e.elevation ?? 0) || 0;
        const closed = !!e.shape;
        const pts: Pt[] = [];
        const n = v.length;
        const count = closed ? n : n - 1;
        for (let i = 0; i < count; i++) {
          const p = v[i];
          const q = v[(i + 1) % n];
          if (is3d) {
            const part = [{ x: p.x, y: p.y, z: p.z ?? 0 }, { x: q.x, y: q.y, z: q.z ?? 0 }];
            if (pts.length) part.shift();
            pts.push(...part);
          } else {
            const part = bulgePoints(p, q, p.bulge ?? 0, elev);
            if (pts.length) part.shift();
            pts.push(...part);
          }
        }
        // polilínea con ancho: se rellena como una franja
        const w = Number(e.width ?? e.constantWidth ?? 0) || 0;
        if (!is3d && w > 0 && pts.length >= 2) {
          for (let i = 0; i + 1 < pts.length; i++) {
            const p = pts[i];
            const q = pts[i + 1];
            const L = Math.hypot(q.x - p.x, q.y - p.y);
            if (!L) continue;
            const nx = (-(q.y - p.y) / L) * (w / 2);
            const ny = ((q.x - p.x) / L) * (w / 2);
            const c1 = { x: p.x + nx, y: p.y + ny, z: elev };
            const c2 = { x: q.x + nx, y: q.y + ny, z: elev };
            const c3 = { x: q.x - nx, y: q.y - ny, z: elev };
            const c4 = { x: p.x - nx, y: p.y - ny, z: elev };
            tri(a, color, mm, c1, c2, c3);
            tri(a, color, mm, c1, c3, c4);
          }
        } else polyline(a, color, mm, pts, false);
        for (const p of v) snapPt(mm, { ...p, z: is3d ? p.z : elev });
        break;
      }
      case 'ARC': {
        const c = e.center as Pt;
        const mm = ocs(e, m);
        const pts = arcPoints(c, e.radius as number, e.startAngle as number, e.endAngle as number, c.z ?? 0);
        polyline(a, color, mm, pts, false);
        snapPt(mm, c);
        snapPt(mm, pts[0]);
        snapPt(mm, pts[pts.length - 1]);
        break;
      }
      case 'CIRCLE': {
        const c = e.center as Pt;
        const mm = ocs(e, m);
        polyline(a, color, mm, arcPoints(c, e.radius as number, 0, Math.PI * 2, c.z ?? 0), false);
        snapPt(mm, c);
        break;
      }
      case 'ELLIPSE': {
        // centro y eje mayor en coordenadas del dibujo; el eje menor es N × eje mayor
        const c = e.center as Pt;
        const ax = e.majorAxisEndPoint as Pt;
        const ratio = (e.axisRatio as number) ?? 1;
        const N = extOf(e) ?? { x: 0, y: 0, z: 1 };
        const axz = ax.z ?? 0;
        const bx = (N.y * axz - N.z * ax.y) * ratio;
        const by = (N.z * ax.x - N.x * axz) * ratio;
        const bz = (N.x * ax.y - N.y * ax.x) * ratio;
        let t0 = (e.startAngle as number) ?? 0;
        let t1 = (e.endAngle as number) ?? Math.PI * 2;
        if (t1 <= t0) t1 += Math.PI * 2;
        const n = Math.max(8, Math.ceil((SEGS_PER_CIRCLE * (t1 - t0)) / (Math.PI * 2)));
        const pts: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          const co = Math.cos(t);
          const si = Math.sin(t);
          pts.push({ x: c.x + ax.x * co + bx * si, y: c.y + ax.y * co + by * si, z: (c.z ?? 0) + axz * co + bz * si });
        }
        polyline(a, color, m, pts, false);
        snapPt(m, c);
        break;
      }
      case 'SPLINE': {
        const pts = splinePoints(e);
        if (pts.length >= 2) {
          polyline(a, color, m, pts, !!e.closed);
          snapPt(m, pts[0]);
          snapPt(m, pts[pts.length - 1]);
        }
        break;
      }
      case 'SOLID':
      case 'TRACE': {
        const v = ((e.points ?? e.vertices) as Pt[] | undefined) ?? [];
        if (v.length < 3) break;
        const mm = ocs(e, m);
        // SOLID guarda las esquinas en orden 1-2-4-3
        const p = v.length >= 4 ? [v[0], v[1], v[3], v[2]] : v;
        tri(a, color, mm, p[0], p[1], p[2]);
        if (p.length >= 4) tri(a, color, mm, p[0], p[2], p[3]);
        break;
      }
      case '3DFACE': {
        const v = (((e.points ?? e.vertices) as Pt[] | undefined) ?? []).filter((p) => p && p.x !== undefined);
        if (v.length < 3) break;
        tri(a, color, m, v[0], v[1], v[2]);
        if (v.length >= 4) tri(a, color, m, v[0], v[2], v[3]);
        polyline(a, color, m, v, true);
        break;
      }
      case 'HATCH': {
        // solo los rellenos sólidos (los patrones de rayado se omiten)
        const solid = !!e.solidFill || /^solid$/i.test(String(e.patternName ?? ''));
        if (!solid) {
          stats.skipped.HATCH = (stats.skipped.HATCH ?? 0) + 1;
          break;
        }
        const loops = hatchLoops(e);
        if (!loops.length) break;
        const elev = Number(e.elevation ?? (e.elevationPoint as Pt | undefined)?.z ?? 0) || 0;
        triangulate(a, color, ocs(e, m), loops.map((l) => l.map((p) => ({ ...p, z: elev }))));
        break;
      }
      case 'INSERT':
      case 'DIMENSION': {
        if (depth > 12) break;
        const name = (e.type === 'INSERT' ? e.name : e.block) as string | undefined;
        const block = name ? blocks[name] : undefined;
        // atributos visibles del bloque (sus textos ya vienen ubicados)
        if (e.type === 'INSERT' && Array.isArray(e.attribs)) for (const at of e.attribs as AnyEntity[]) drawEntity(at, m, layer, color, depth + 1);
        if (!block?.entities) break;
        if (e.type === 'DIMENSION') {
          // la geometría de la cota ya está en coordenadas del dibujo
          for (const child of block.entities) drawEntity(child, m, layer, color, depth + 1);
          break;
        }
        const base = block.position ?? { x: 0, y: 0 };
        const pos = (e.position as Pt) ?? { x: 0, y: 0 };
        const sx = (e.xScale as number) ?? 1;
        const sy = (e.yScale as number) ?? 1;
        const sz = (e.zScale as number) ?? 1;
        const rot = (((e.rotation as number) ?? 0) * Math.PI) / 180;
        const cols = Math.max(1, (e.columnCount as number) ?? 1);
        const rows = Math.max(1, (e.rowCount as number) ?? 1);
        const cs = (e.columnSpacing as number) ?? 0;
        const rs = (e.rowSpacing as number) ?? 0;
        const om = ocs(e, m);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            // OCS · T(pos) · R(rot) · T(columna, fila) · S · T(−base)
            const local = mul(
              mul(translate(pos.x, pos.y, pos.z ?? 0), rotZ(rot)),
              mul(translate(c * cs, r * rs, 0), mul(scale3(sx, sy, sz), translate(-base.x, -base.y, -(base.z ?? 0)))),
            );
            const mm = mul(om, local);
            snapPt(mm, base);
            for (const child of block.entities) drawEntity(child, mm, layer, color, depth + 1);
          }
        }
        break;
      }
      case 'TEXT':
      case 'ATTRIB': {
        stats.texts++;
        if (e.type === 'ATTRIB' && (e.invisible || ((Number(e.flags) || 0) & 1))) break;
        const text = String(e.text ?? '');
        const h = Number(e.textHeight ?? e.height ?? 0);
        if (!text.trim() || !(h > 0)) break;
        const ha = Number(e.halign ?? e.horizontalJustification ?? 0) || 0;
        const va = Number(e.valign ?? e.verticalJustification ?? 0) || 0;
        const start = (e.startPoint ?? e.position) as Pt | undefined;
        const end = e.endPoint as Pt | undefined;
        // alineado o ajustado: se usa el punto inicial; los demás alineados usan el segundo punto
        const useEnd = (ha !== 0 || va !== 0) && ha !== 3 && ha !== 5 && end && (end.x !== 0 || end.y !== 0);
        const p = (useEnd ? end : start) ?? { x: 0, y: 0 };
        let rot = (((e.rotation as number) ?? 0) * Math.PI) / 180;
        if ((ha === 3 || ha === 5) && start && end) rot = Math.atan2(end.y - start.y, end.x - start.x);
        drawText(a, color, ocs(e, m), [text], {
          x: p.x,
          y: p.y,
          z: p.z ?? Number(e.elevation ?? 0) ?? 0,
          h,
          rot,
          wf: Number(e.xScale ?? e.widthFactor ?? 1) || 1,
          hAlign: ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left',
          vAlign: ha === 4 ? 'middle' : va === 3 ? 'top' : va === 2 ? 'middle' : va === 1 ? 'bottom' : 'baseline',
          lineGap: h * 1.667,
        });
        break;
      }
      case 'MTEXT': {
        stats.texts++;
        const raw = String(e.text ?? '');
        const h = Number(e.height ?? e.textHeight ?? 0);
        const p = (e.position ?? e.insertionPoint) as Pt | undefined;
        if (!raw.trim() || !(h > 0) || !p) break;
        const width = Number(e.width ?? e.rectWidth ?? 0) || 0;
        const paras = mtextPlain(raw).split('\n');
        const lines = paras.flatMap((para) => wrapText(para, h, width));
        const ap = Number(e.attachmentPoint ?? 1) || 1;
        const col = (ap - 1) % 3;
        const row = Math.floor((ap - 1) / 3);
        const dir = (e.directionVector ?? e.direction) as Pt | undefined;
        const spacing = Number(e.lineSpacing ?? e.lineSpacingFactor ?? 1) || 1;
        // el MTEXT guarda su punto y su dirección en coordenadas del dibujo (no del objeto)
        const N = extOf(e) ?? { x: 0, y: 0, z: 1 };
        let X: V3;
        if (dir && (dir.x !== 0 || dir.y !== 0 || (dir.z ?? 0) !== 0)) {
          const l = Math.hypot(dir.x, dir.y, dir.z ?? 0);
          X = { x: dir.x / l, y: dir.y / l, z: (dir.z ?? 0) / l };
        } else {
          // sin dirección: el eje X del objeto girado lo que diga la rotación
          const o = ocsMatrix(N);
          const r = (((e.rotation as number) ?? 0) * Math.PI) / 180;
          X = { x: o[0] * Math.cos(r) + o[1] * Math.sin(r), y: o[4] * Math.cos(r) + o[5] * Math.sin(r), z: o[8] * Math.cos(r) + o[9] * Math.sin(r) };
        }
        const Y = { x: N.y * X.z - N.z * X.y, y: N.z * X.x - N.x * X.z, z: N.x * X.y - N.y * X.x };
        const frame: Mat = [X.x, Y.x, N.x, p.x, X.y, Y.y, N.y, p.y, X.z, Y.z, N.z, p.z ?? 0];
        drawText(a, color, mul(m, frame), lines, {
          x: 0,
          y: 0,
          z: 0,
          h,
          rot: 0,
          wf: 1,
          hAlign: col === 1 ? 'center' : col === 2 ? 'right' : 'left',
          vAlign: row === 0 ? 'top' : row === 1 ? 'middle' : 'bottom',
          lineGap: h * 1.667 * spacing,
        });
        break;
      }
      case 'ATTDEF':
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

  for (const e of entities) drawEntity(e, I, '', WHITE, 0);

  const out: DxfLayer[] = [...layers.entries()]
    .filter(([, a]) => a.segments.length || a.fills.length)
    .map(([name, a]) => ({ name, segments: a.segments, colors: a.colors, fills: a.fills, fillColors: a.fillColors, color: layerColor(name), off: !!layerTable[name]?.off }))
    .sort((x, y) => x.name.localeCompare(y.name, 'es', { numeric: true }));
  if (!out.length) throw new Error(`El ${format} no tiene líneas en el espacio modelo que se puedan mostrar.`);

  return {
    layers: out,
    insUnits,
    ftPerUnit: INSUNITS_FT[insUnits]?.ft,
    bounds: robustBounds(out),
    snapPoints: snap,
    stats,
    is3D: Number.isFinite(zMin) && zMax - zMin > 1e-6,
    zRange: Number.isFinite(zMin) ? { min: zMin, max: zMax } : { min: 0, max: 0 },
  };
}

/** Contornos de un sombreado (polilíneas o bordes de líneas y arcos) en coordenadas del objeto */
function hatchLoops(e: AnyEntity): Pt[][] {
  const paths = (e.boundaryPaths ?? e.boundaries) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(paths)) return [];
  const loops: Pt[][] = [];
  for (const bp of paths) {
    const pts: Pt[] = [];
    const verts = bp.vertices as (Pt & { bulge?: number })[] | undefined;
    if (Array.isArray(verts) && verts.length >= 2) {
      for (let i = 0; i < verts.length; i++) {
        const p = verts[i];
        const q = verts[(i + 1) % verts.length];
        const b = p.bulge ?? 0;
        if (!b) {
          pts.push({ x: p.x, y: p.y });
          continue;
        }
        // arco por bulge
        const chord = Math.hypot(q.x - p.x, q.y - p.y);
        if (!chord) continue;
        const theta = 4 * Math.atan(b);
        const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const dist = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0));
        const ux = (q.x - p.x) / chord;
        const uy = (q.y - p.y) / chord;
        const side = (b > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
        const c = { x: mid.x - uy * dist * side, y: mid.y + ux * dist * side };
        const a0 = Math.atan2(p.y - c.y, p.x - c.x);
        const n = Math.max(2, Math.ceil((SEGS_PER_CIRCLE * Math.abs(theta)) / (Math.PI * 2)));
        for (let k = 0; k < n; k++) pts.push({ x: c.x + r * Math.cos(a0 + (theta * k) / n), y: c.y + r * Math.sin(a0 + (theta * k) / n) });
      }
    }
    const edges = bp.edges as Record<string, unknown>[] | undefined;
    if (Array.isArray(edges)) {
      for (const ed of edges) {
        const t = Number(ed.type ?? ed.edgeType ?? 0);
        if (t === 1) {
          const s = (ed.start ?? ed.startPoint) as Pt | undefined;
          if (s) pts.push({ x: s.x, y: s.y });
        } else if (t === 2) {
          const c = ed.center as Pt;
          const r = Number(ed.radius) || 0;
          let a0 = Number(ed.startAngle) || 0;
          let a1 = Number(ed.endAngle) || 0;
          // algunos lectores dan grados
          if (Math.abs(a0) > 2 * Math.PI + 0.01 || Math.abs(a1) > 2 * Math.PI + 0.01) {
            a0 = (a0 * Math.PI) / 180;
            a1 = (a1 * Math.PI) / 180;
          }
          const ccw = ed.isCCW ?? ed.ccw ?? ed.counterClockwise ?? true;
          let sweep = ccw ? a1 - a0 : -(a1 - a0);
          if (ccw) while (sweep <= 0) sweep += 2 * Math.PI;
          const n = Math.max(2, Math.ceil((SEGS_PER_CIRCLE * Math.abs(sweep)) / (Math.PI * 2)));
          for (let k = 0; k < n; k++) {
            const ang = ccw ? a0 + (sweep * k) / n : -(a0 + (sweep * k) / n);
            pts.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
          }
        } else if (t === 3) {
          const c = ed.center as Pt;
          const ax = (ed.majorAxisEndPoint ?? ed.end) as Pt;
          const ratio = Number(ed.axisRatio ?? ed.lengthOfMinorAxis ?? 1) || 1;
          const a0 = Number(ed.startAngle) || 0;
          let a1 = Number(ed.endAngle) || 2 * Math.PI;
          if (a1 <= a0) a1 += 2 * Math.PI;
          const n = 24;
          for (let k = 0; k < n; k++) {
            const tt = a0 + ((a1 - a0) * k) / n;
            pts.push({ x: c.x + ax.x * Math.cos(tt) - ax.y * ratio * Math.sin(tt), y: c.y + ax.y * Math.cos(tt) + ax.x * ratio * Math.sin(tt) });
          }
        } else if (t === 4) {
          const ctrl = (ed.controlPoints ?? ed.fitDatum) as Pt[] | undefined;
          if (Array.isArray(ctrl)) for (const p of ctrl) pts.push({ x: p.x, y: p.y });
        }
      }
    }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

/** Caja del 1 % al 99 % de los extremos (descarta elementos perdidos lejos del dibujo). */
function robustBounds(layers: DxfLayer[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const l of layers) {
    const s = l.segments;
    const step = Math.max(1, Math.floor(s.length / 6 / 50000)) * 6; // muestreo en dibujos grandes
    for (let i = 0; i < s.length; i += step) {
      xs.push(s[i], s[i + 3]);
      ys.push(s[i + 1], s[i + 4]);
    }
    const f = l.fills;
    const stepF = Math.max(1, Math.floor(f.length / 9 / 20000)) * 9;
    for (let i = 0; i < f.length; i += stepF) {
      xs.push(f[i]);
      ys.push(f[i + 1]);
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
