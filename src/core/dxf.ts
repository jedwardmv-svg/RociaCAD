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
import { addHatchHandler } from './dxfHatch';
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
  /** presentaciones (espacio papel), si el archivo las trae */
  layouts?: PlanLayout[];
}

/** Ventana de una presentación que muestra una parte del modelo */
export interface LayoutViewport {
  /** centro y tamaño en la hoja (unidades de papel) */
  center: { x: number; y: number };
  width: number;
  height: number;
  /** centro de la vista y altura que muestra, en unidades del modelo */
  viewCenter: { x: number; y: number };
  viewHeight: number;
  target: { x: number; y: number; z?: number };
  direction: { x: number; y: number; z?: number };
  /** giro de la vista (radianes) */
  twist: number;
  /** capas congeladas en esta ventana */
  frozenLayers: string[];
}

/** Presentación: lo dibujado en la hoja más las ventanas al modelo */
export interface PlanLayout {
  name: string;
  order: number;
  layers: DxfLayer[];
  snapPoints: number[];
  /** caja de la hoja */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  viewports: LayoutViewport[];
}

/**
 * Arma una presentación lista para dibujar: su contenido propio más el modelo visto por cada
 * ventana (proyectado, escalado y recortado al rectángulo de la ventana).
 */
export function layoutPlan(model: DxfResult, layout: PlanLayout): DxfResult {
  const layers = new Map<string, DxfLayer>();
  const get = (src: DxfLayer) => {
    let l = layers.get(src.name);
    if (!l) layers.set(src.name, (l = { name: src.name, segments: [], colors: [], fills: [], fillColors: [], color: src.color, off: src.off }));
    return l;
  };
  for (const l of layout.layers) {
    const d = get(l);
    d.segments.push(...l.segments.map((v, i) => (i % 3 === 2 ? 0 : v)));
    d.colors.push(...l.colors);
    d.fills.push(...l.fills.map((v, i) => (i % 3 === 2 ? 0 : v)));
    d.fillColors.push(...l.fillColors);
  }
  let segs = 0;
  for (const vp of layout.viewports) {
    // ejes de la vista: Z hacia el observador, X horizontal en la hoja
    const dz = vp.direction;
    let len = Math.hypot(dz.x, dz.y, dz.z ?? 0) || 1;
    const Z = { x: dz.x / len, y: dz.y / len, z: (dz.z ?? 0) / len };
    let X = Math.abs(Z.x) < 1e-9 && Math.abs(Z.y) < 1e-9 ? { x: 1, y: 0, z: 0 } : { x: -Z.y, y: Z.x, z: 0 };
    len = Math.hypot(X.x, X.y, X.z) || 1;
    X = { x: X.x / len, y: X.y / len, z: X.z / len };
    const Y = { x: Z.y * X.z - Z.z * X.y, y: Z.z * X.x - Z.x * X.z, z: Z.x * X.y - Z.y * X.x };
    const k = vp.height / vp.viewHeight;
    const ct = Math.cos(-vp.twist);
    const st = Math.sin(-vp.twist);
    const tx = vp.target.x;
    const ty = vp.target.y;
    const tz = vp.target.z ?? 0;
    const x0 = vp.center.x - vp.width / 2;
    const x1 = vp.center.x + vp.width / 2;
    const y0 = vp.center.y - vp.height / 2;
    const y1 = vp.center.y + vp.height / 2;
    const proj = (x: number, y: number, z: number): [number, number] => {
      const px = x - tx;
      const py = y - ty;
      const pz = z - tz;
      const u = (px * X.x + py * X.y + pz * X.z - vp.viewCenter.x) * k;
      const v = (px * Y.x + py * Y.y + pz * Y.z - vp.viewCenter.y) * k;
      return [vp.center.x + u * ct - v * st, vp.center.y + u * st + v * ct];
    };
    const frozen = new Set(vp.frozenLayers);
    for (const src of model.layers) {
      if (frozen.has(src.name) || src.off) continue;
      const d = get(src);
      const s = src.segments;
      for (let i = 0, t = 0; i < s.length; i += 6, t++) {
        const [ax, ay] = proj(s[i], s[i + 1], s[i + 2]);
        const [bx, by] = proj(s[i + 3], s[i + 4], s[i + 5]);
        // recorte de Liang-Barsky al rectángulo de la ventana
        let u0 = 0;
        let u1 = 1;
        const dx = bx - ax;
        const dy = by - ay;
        let ok = true;
        for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as [number, number][]) {
          if (p === 0) {
            if (q < 0) {
              ok = false;
              break;
            }
          } else {
            const r = q / p;
            if (p < 0) {
              if (r > u1) {
                ok = false;
                break;
              }
              if (r > u0) u0 = r;
            } else {
              if (r < u0) {
                ok = false;
                break;
              }
              if (r < u1) u1 = r;
            }
          }
        }
        if (!ok) continue;
        d.segments.push(ax + dx * u0, ay + dy * u0, 0, ax + dx * u1, ay + dy * u1, 0);
        d.colors.push(src.colors[t]);
        segs++;
      }
      // rellenos: los triángulos que quedan dentro de la ventana
      const f = src.fills;
      for (let i = 0, t = 0; i < f.length; i += 9, t++) {
        const A = proj(f[i], f[i + 1], f[i + 2]);
        const B = proj(f[i + 3], f[i + 4], f[i + 5]);
        const C = proj(f[i + 6], f[i + 7], f[i + 8]);
        const inside = (q: [number, number]) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
        if (!inside(A) || !inside(B) || !inside(C)) continue;
        d.fills.push(A[0], A[1], 0, B[0], B[1], 0, C[0], C[1], 0);
        d.fillColors.push(src.fillColors[t]);
      }
    }
    // borde de la ventana
  }
  const out = [...layers.values()].filter((l) => l.segments.length || l.fills.length).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  return {
    layers: out,
    insUnits: 0,
    ftPerUnit: undefined,
    bounds: layout.bounds,
    snapPoints: layout.snapPoints,
    stats: { entities: 0, segments: segs, texts: 0, fills: 0, skipped: {} },
    is3D: false,
    zRange: { min: 0, max: 0 },
  };
}

/** Ventana leída del archivo (DXF o DWG), antes de decidir si es la hoja o una vista */
export interface RawViewport extends LayoutViewport {
  id?: number;
  visible?: boolean;
}

/** Pasa una entidad VIEWPORT (campos al estilo LibreDWG) a una ventana */
export function readViewport(e: AnyEntity, layerByHandle: Map<string, string>): RawViewport | undefined {
  const c = e.viewportCenter as Pt | undefined;
  if (!c) return undefined;
  return {
    id: Number(e.viewportId) || undefined,
    visible: e.isVisible !== false,
    center: { x: c.x, y: c.y },
    width: Number(e.width) || 0,
    height: Number(e.height) || 0,
    viewCenter: (e.displayCenter as Pt | undefined) ?? { x: 0, y: 0 },
    viewHeight: Number(e.viewHeight) || 0,
    target: (e.targetPoint as Pt | undefined) ?? { x: 0, y: 0, z: 0 },
    direction: (e.viewDirection as Pt | undefined) ?? { x: 0, y: 0, z: 1 },
    twist: Number(e.viewTwistAngle) || 0,
    frozenLayers: ((e.frozenLayerIds as string[] | undefined) ?? []).map((hd) => layerByHandle.get(String(hd).toUpperCase())).filter((n): n is string => !!n),
  };
}

/**
 * Arma una presentación con lo dibujado en la hoja y sus ventanas. Devuelve undefined si está vacía.
 */
export function makeLayout(
  name: string,
  order: number,
  paperEntities: AnyEntity[],
  rawViewports: RawViewport[],
  blocks: PlanBlocks,
  insUnits: number,
  format: string,
  table: LayerTable,
  styles: TextStyles = {},
): PlanLayout | undefined {
  const viewports: LayoutViewport[] = [];
  let sheet: RawViewport | undefined;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  for (const vp of rawViewports) {
    if (vp.visible === false) continue;
    // la ventana 1 es la hoja misma (muestra el papel a escala 1:1, centrada en sí misma)
    const isSheet = vp.id === 1 || (near(vp.viewHeight, vp.height) && near(vp.viewCenter.x, vp.center.x) && near(vp.viewCenter.y, vp.center.y));
    if (isSheet) sheet = vp;
    else if (vp.width > 0 && vp.height > 0 && vp.viewHeight > 0) {
      const { id: _id, visible: _v, ...rest } = vp;
      viewports.push(rest);
    }
  }
  let paper: DxfResult | undefined;
  try {
    paper = paperEntities.length ? buildPlan(paperEntities, blocks, insUnits, format, table, styles) : undefined;
  } catch {
    paper = undefined;
  }
  const hasPaper = !!paper && paper.layers.some((l) => l.segments.length || l.fills.length);
  if (!hasPaper && !viewports.length) return undefined;
  // caja: el dibujo de la hoja más las ventanas (la ventana 1 solo si no hay nada más)
  let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    b = { minX: Math.min(b.minX, x0), minY: Math.min(b.minY, y0), maxX: Math.max(b.maxX, x1), maxY: Math.max(b.maxY, y1) };
  };
  const rect = (v: LayoutViewport) => grow(v.center.x - v.width / 2, v.center.y - v.height / 2, v.center.x + v.width / 2, v.center.y + v.height / 2);
  if (hasPaper) grow(paper!.bounds.minX, paper!.bounds.minY, paper!.bounds.maxX, paper!.bounds.maxY);
  viewports.forEach(rect);
  if (!isFinite(b.minX) && sheet) rect(sheet);
  if (!isFinite(b.minX)) b = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { name, order, layers: hasPaper ? paper!.layers : [], snapPoints: paper?.snapPoints ?? [], bounds: b, viewports };
}

/**
 * Datos del DXF que dxf-parser no lee: los identificadores de las capas y las presentaciones
 * (nombre, orden y el bloque *Paper_Space de cada una), sacados del texto del archivo.
 */
function scanDxfExtras(text: string) {
  const lines = text.split(/\r?\n/);
  const layerByHandle = new Map<string, string>();
  const layouts: { name: string; order: number; record: string }[] = [];
  let section = '';
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1].trim();
    if (code !== '0') continue;
    if (value === 'SECTION') {
      section = (lines[i + 3] ?? '').trim();
      continue;
    }
    if (section === 'TABLES' && value === 'LAYER') {
      let handle = '';
      let name = '';
      for (let j = i + 2; j + 1 < lines.length && lines[j].trim() !== '0'; j += 2) {
        const c = lines[j].trim();
        if (c === '5') handle = lines[j + 1].trim();
        else if (c === '2') name = lines[j + 1].trim();
      }
      if (handle && name) layerByHandle.set(handle.toUpperCase(), name);
    } else if (section === 'OBJECTS' && value === 'LAYOUT') {
      let name = '';
      let order = 0;
      let record = '';
      let inLayout = false;
      for (let j = i + 2; j + 1 < lines.length && lines[j].trim() !== '0'; j += 2) {
        const c = lines[j].trim();
        const v = lines[j + 1].trim();
        if (c === '100' && v === 'AcDbLayout') inLayout = true;
        else if (inLayout && c === '1') name = v;
        else if (inLayout && c === '71') order = Number(v) || 0;
        else if (inLayout && c === '330') record = v;
      }
      if (name && record) layouts.push({ name, order, record: record.toUpperCase() });
    }
  }
  return { layerByHandle, layouts };
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

/** Estilos de texto del archivo: factor de ancho y archivo de letra (romans.shx, arial.ttf…) */
export type TextStyles = Record<string, { widthFactor?: number; font?: string }>;

/**
 * Ancho de una letra TrueType respecto a la fuente de trazos (que tiene las proporciones de romans.shx).
 * AutoCAD toma la altura del texto como la altura de las mayúsculas; con eso Arial sale más angosta.
 */
export function fontWidthFactor(font: string | undefined): number {
  const f = (font ?? '').toLowerCase();
  if (!/\.(ttf|ttc|otf)$/.test(f)) return 1;
  if (/narrow|arialn|condensed|cn|swis721_cn/.test(f)) return 0.72;
  if (/bd|bold|black|heavy/.test(f)) return 0.9;
  return 0.87;
}

/** Datos de las capas del archivo: color y si está apagada o congelada */
export type LayerTable = Record<string, { color?: number; colorIndex?: number; off?: boolean }>;

export function parseDxf(text: string): DxfResult {
  const parser = new DxfParser();
  addHatchHandler(parser);
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('El archivo DXF está vacío o no se pudo leer.');
  const header = (dxf.header ?? {}) as Record<string, unknown>;
  const insUnits = Number(header['$INSUNITS'] ?? 0) || 0;
  const blocks = (dxf.blocks ?? {}) as unknown as PlanBlocks;
  const table: LayerTable = {};
  const raw = ((dxf.tables as unknown as { layer?: { layers?: Record<string, { color?: number; colorIndex?: number; visible?: boolean; frozen?: boolean }> } })?.layer?.layers ?? {});
  for (const [name, l] of Object.entries(raw)) table[name] = { color: l.color, colorIndex: l.colorIndex, off: l.visible === false || !!l.frozen };
  const all = (dxf.entities ?? []) as unknown as AnyEntity[];
  // lo que está en el espacio papel es de la presentación activa, no del modelo
  const modelEnts = all.filter((e) => !e.inPaperSpace && e.type !== 'VIEWPORT');
  const plan = buildPlan(modelEnts, blocks, insUnits, 'DXF', table);
  try {
    const layouts = dxfLayouts(text, all, blocks, insUnits, table);
    if (layouts.length) plan.layouts = layouts;
  } catch {
    // si las presentaciones no se pueden leer, queda el modelo
  }
  return plan;
}

function dxfLayouts(text: string, all: AnyEntity[], blocks: PlanBlocks, insUnits: number, table: LayerTable): PlanLayout[] {
  const { layerByHandle, layouts: meta } = scanDxfExtras(text);
  const out: PlanLayout[] = [];
  const blockList = Object.entries(blocks as Record<string, { entities?: AnyEntity[]; ownerHandle?: string }>);
  const paperBlocks = blockList.filter(([name]) => /^\*paper_space/i.test(name));
  for (const [name, blk] of paperBlocks) {
    // la presentación activa guarda su dibujo en ENTITIES; las demás, en su bloque
    const active = /^\*paper_space$/i.test(name);
    const ents = active ? all.filter((e) => e.inPaperSpace) : (blk.entities ?? []);
    const m = meta.find((l) => blk.ownerHandle && l.record === String(blk.ownerHandle).toUpperCase());
    const vps = ents.filter((e) => e.type === 'VIEWPORT').map((e) => readViewport(e, layerByHandle)).filter((v): v is RawViewport => !!v);
    const lay = makeLayout(
      m?.name ?? `Presentación ${out.length + 1}`,
      m?.order ?? out.length + 1,
      ents.filter((e) => e.type !== 'VIEWPORT'),
      vps,
      blocks,
      insUnits,
      'DXF',
      table,
    );
    if (lay) out.push(lay);
  }
  return out.sort((a, b) => a.order - b.order);
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
export function buildPlan(entities: AnyEntity[], blocks: PlanBlocks, insUnits: number, format = 'DXF', layerTable: LayerTable = {}, styles: TextStyles = {}): DxfResult {
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

  // ---------- estilos de texto ----------
  const styleIdx = new Map<string, { widthFactor?: number; font?: string }>();
  for (const [k, v] of Object.entries(styles)) styleIdx.set(k.toLowerCase(), v);
  /** factor de ancho del estilo y de su letra */
  const styleWidth = (e: AnyEntity, withStyleFactor: boolean): number => {
    const st = styleIdx.get(String(e.styleName ?? e.style ?? 'standard').toLowerCase());
    const wf = withStyleFactor ? Number(st?.widthFactor) || 1 : 1;
    return wf * fontWidthFactor(st?.font);
  };

  // ---------- tuberías en 3D ----------
  // AutoSPRINK y otros programas dibujan cada tubo como su eje (LINE) con un círculo del
  // diámetro del tubo en un extremo, perpendicular al eje. Esos ejes se dibujan como tubos.
  const pipeRadius = new WeakMap<AnyEntity, number>();
  const pipeScanned = new WeakSet<AnyEntity[]>();
  const markPipes = (list: AnyEntity[]) => {
    if (pipeScanned.has(list)) return;
    pipeScanned.add(list);
    const circles: { c: V3; n: V3; r: number }[] = [];
    for (const e of list) {
      if (e.type !== 'CIRCLE') continue;
      const r = Number(e.radius) || 0;
      const n = extOf(e);
      const c = e.center as Pt | undefined;
      if (!(r > 0) || !n || !c) continue;
      const len = Math.hypot(n.x, n.y, n.z) || 1;
      circles.push({ c: apply(ocsMatrix(n), c), n: { x: n.x / len, y: n.y / len, z: n.z / len }, r });
    }
    if (!circles.length) return;
    const seen = new Set<string>();
    for (const e of list) {
      if (e.type !== 'LINE') continue;
      const v = e.vertices as Pt[] | undefined;
      if (!v || v.length < 2) continue;
      const p = v[0];
      const q = v[1];
      const d = { x: q.x - p.x, y: q.y - p.y, z: (q.z ?? 0) - (p.z ?? 0) };
      const L = Math.hypot(d.x, d.y, d.z);
      if (!(L > 0)) continue;
      const tol = L * 1e-6 + 1e-9;
      const at = (c: V3, pt: Pt) => Math.abs(c.x - pt.x) <= tol && Math.abs(c.y - pt.y) <= tol && Math.abs(c.z - (pt.z ?? 0)) <= tol;
      const hit = circles.find(
        (k) => (at(k.c, p) || at(k.c, q)) && Math.abs((k.n.x * d.x + k.n.y * d.y + k.n.z * d.z) / L) > 0.999 && k.r < L * 2,
      );
      if (!hit) continue;
      // el mismo eje suele venir dos veces (con y sin grosor de línea): un solo tubo
      const key = [p.x, p.y, p.z ?? 0, q.x, q.y, q.z ?? 0].map((x) => x.toFixed(6)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      pipeRadius.set(e, hit.r);
    }
  };
  const TUBE_SIDES = 12;
  const LIGHT = (() => {
    const l = { x: -0.35, y: -0.45, z: 0.82 };
    const n = Math.hypot(l.x, l.y, l.z);
    return { x: l.x / n, y: l.y / n, z: l.z / n };
  })();
  const shade = (color: number, k: number) => {
    const ch = (sh: number) => Math.min(255, Math.round(((color >> sh) & 255) * k));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  /** tubo (cilindro sin tapas) entre p y q, sombreado según su orientación en el dibujo */
  const tube = (a: Acc, color: number, m: Mat, p: Pt, q: Pt, r: number) => {
    const P = apply(m, p);
    const Q = apply(m, q);
    const d = { x: Q.x - P.x, y: Q.y - P.y, z: Q.z - P.z };
    const L = Math.hypot(d.x, d.y, d.z);
    if (!(L > 0)) return;
    // el radio también se escala con el bloque
    const unit = apply(m, { x: (p.x ?? 0) + r, y: p.y, z: p.z ?? 0 });
    const R0 = apply(m, { x: p.x, y: p.y + r, z: p.z ?? 0 });
    const rr = Math.max(Math.hypot(unit.x - P.x, unit.y - P.y, unit.z - P.z), Math.hypot(R0.x - P.x, R0.y - P.y, R0.z - P.z));
    if (!(rr > 0) || !Number.isFinite(rr)) return;
    const w = { x: d.x / L, y: d.y / L, z: d.z / L };
    const ref = Math.abs(w.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    let u = { x: w.y * ref.z - w.z * ref.y, y: w.z * ref.x - w.x * ref.z, z: w.x * ref.y - w.y * ref.x };
    const ul = Math.hypot(u.x, u.y, u.z);
    u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
    const v = { x: w.y * u.z - w.z * u.y, y: w.z * u.x - w.x * u.z, z: w.x * u.y - w.y * u.x };
    const ring = (C: V3, t: number) => ({
      x: C.x + rr * (u.x * Math.cos(t) + v.x * Math.sin(t)),
      y: C.y + rr * (u.y * Math.cos(t) + v.y * Math.sin(t)),
      z: C.z + rr * (u.z * Math.cos(t) + v.z * Math.sin(t)),
    });
    for (let i = 0; i < TUBE_SIDES; i++) {
      const t0 = (2 * Math.PI * i) / TUBE_SIDES;
      const t1 = (2 * Math.PI * (i + 1)) / TUBE_SIDES;
      const tm = (t0 + t1) / 2;
      const n = { x: u.x * Math.cos(tm) + v.x * Math.sin(tm), y: u.y * Math.cos(tm) + v.y * Math.sin(tm), z: u.z * Math.cos(tm) + v.z * Math.sin(tm) };
      const k = 0.4 + 0.7 * Math.max(0, n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
      const c = shade(color, k);
      const a0 = ring(P, t0);
      const a1 = ring(P, t1);
      const b0 = ring(Q, t0);
      const b1 = ring(Q, t1);
      tri(a, c, I, a0, a1, b1);
      tri(a, c, I, a0, b1, b0);
    }
    stats.fills += TUBE_SIDES * 2;
  };

  const drawEntity = (e: AnyEntity, m: Mat, parentLayer: string, blockColor: number, depth: number) => {
    if (e.visible === false) return;
    stats.entities++;
    const layer = !e.layer || (e.layer === '0' && parentLayer) ? parentLayer || '0' : e.layer;
    const color = colorOf(e, layer, blockColor);
    const a = acc(layer);
    switch (e.type) {
      case 'LINE': {
        const v = e.vertices as Pt[] | undefined;
        if (v && v.length >= 2) {
          const pr = pipeRadius.get(e);
          if (pr) tube(a, color, m, v[0], v[1], pr);
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
        const loops = hatchLoops(e);
        if (!loops.length) break;
        const elev = Number(e.elevation ?? (e.elevationPoint as Pt | undefined)?.z ?? 0) || 0;
        const mm = ocs(e, m);
        const solid = !!e.solidFill || /^solid$/i.test(String(e.patternName ?? ''));
        if (solid) {
          triangulate(a, color, mm, loops.map((l) => l.map((p) => ({ ...p, z: elev }))));
          break;
        }
        // rayado: líneas del patrón recortadas por el contorno
        const lines = (e.definitionLines ?? e.patternLines) as HatchLine[] | undefined;
        if (!Array.isArray(lines) || !lines.length) {
          stats.skipped.HATCH = (stats.skipped.HATCH ?? 0) + 1;
          break;
        }
        const out: number[] = [];
        hatchPattern(loops, lines, out);
        for (let i = 0; i + 3 < out.length; i += 4) seg(a, color, mm, { x: out[i], y: out[i + 1], z: elev }, { x: out[i + 2], y: out[i + 3], z: elev });
        break;
      }
      case 'MULTILEADER': {
        // líneas guía con su flecha y el texto
        const sections = (e.leaderSections ?? []) as { lastLeaderLinePoint?: Pt; doglegVector?: Pt; doglegLength?: number; leaderLines?: { vertices?: Pt[] }[] }[];
        const arrow = Number(e.arrowheadSize ?? 0) || 0;
        for (const sec of sections) {
          const last = sec.lastLeaderLinePoint;
          for (const ll of sec.leaderLines ?? []) {
            const pts = [...(ll.vertices ?? [])];
            if (last) pts.push(last);
            polyline(a, color, m, pts, false);
            // flecha en la punta
            if (pts.length >= 2 && arrow > 0) {
              const p0 = pts[0];
              const p1 = pts[1];
              const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
              const ux = (p1.x - p0.x) / L;
              const uy = (p1.y - p0.y) / L;
              const w = arrow / 3;
              tri(a, color, m, p0, { x: p0.x + ux * arrow - uy * w, y: p0.y + uy * arrow + ux * w, z: p0.z }, { x: p0.x + ux * arrow + uy * w, y: p0.y + uy * arrow - ux * w, z: p0.z });
            }
          }
          if (last && sec.doglegVector && sec.doglegLength) {
            const d = sec.doglegVector;
            seg(a, color, m, last, { x: last.x + d.x * sec.doglegLength, y: last.y + d.y * sec.doglegLength, z: last.z });
          }
        }
        const txt = String(e.textContent ?? '');
        const anchor = e.textAnchor as Pt | undefined;
        const h = Number(e.textHeight ?? 0);
        if (txt.trim() && anchor && h > 0) {
          stats.texts++;
          drawEntity(
            {
              type: 'MTEXT',
              layer: e.layer,
              colorIndex: (e.colorIndex as number) ?? 256,
              text: txt,
              position: anchor,
              height: h,
              width: Number(e.textWidth ?? 0) || 0,
              attachmentPoint: Number(e.textAttachmentPoint ?? 1) || 1,
              direction: e.textDirection,
            },
            m,
            parentLayer,
            blockColor,
            depth + 1,
          );
          stats.texts--;
        }
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
          markPipes(block.entities);
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
        markPipes(block.entities);
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
        let rot = (((e.rotation as number) ?? 0) * Math.PI) / 180;
        if ((ha === 3 || ha === 5) && start && end) rot = Math.atan2(end.y - start.y, end.x - start.x);
        const xs = Number(e.xScale ?? e.widthFactor ?? 1) || 1;
        const wfFont = xs * styleWidth(e, false);
        const z = (p: Pt) => p.z ?? Number(e.elevation ?? 0) ?? 0;
        const base = { h, rot, lineGap: h * 1.667 };
        // AutoCAD guarda en el primer punto el inicio real del texto (sobre la línea base) y en el
        // segundo el punto de alineación: con los dos se sabe cuánto mide de ancho
        const hasEnd = !!end && !!start && (end.x !== 0 || end.y !== 0) && (ha !== 0 || va !== 0);
        if (hasEnd && ha !== 0 && start) {
          const along = (end!.x - start.x) * Math.cos(rot) + (end!.y - start.y) * Math.sin(rot);
          const real = ha === 1 || ha === 4 ? 2 * along : along;
          const natural = textLineWidth(text, h, 1);
          const k = natural > 0 ? real / natural : 0;
          if (k > 0.2 && k < 5) {
            drawText(a, color, ocs(e, m), [text], { ...base, x: start.x, y: start.y, z: z(start), wf: k, hAlign: 'left', vAlign: 'baseline' });
            break;
          }
        }
        const p = (hasEnd ? end : start) ?? { x: 0, y: 0 };
        drawText(a, color, ocs(e, m), [text], {
          ...base,
          x: p.x,
          y: p.y,
          z: z(p),
          wf: wfFont,
          hAlign: ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left',
          vAlign: ha === 4 ? 'middle' : va === 3 ? 'top' : va === 2 ? 'middle' : va === 1 ? 'bottom' : 'baseline',
        });
        break;
      }
      case 'MTEXT': {
        stats.texts++;
        const raw = String(e.text ?? '');
        const h0 = Number(e.height ?? e.textHeight ?? 0);
        const p = (e.position ?? e.insertionPoint) as Pt | undefined;
        if (!raw.trim() || !(h0 > 0) || !p) break;
        // altura cambiada dentro del texto (\H2.5; o \H0.7x;)
        const inlineH = /\\H(\d*\.?\d+)(x?);/.exec(raw);
        const hv = inlineH ? Number(inlineH[1]) : 0;
        const h = hv > 0 ? (inlineH![2] ? h0 * hv : hv) : h0;
        const width = Number(e.width ?? e.rectWidth ?? 0) || 0;
        // ancho de letra: estilo, letra TrueType y el código \W del propio texto
        const inlineW = /\\W(\d*\.?\d+)x?;/.exec(raw);
        let wf = styleWidth(e, true) * (inlineW ? Number(inlineW[1]) || 1 : 1);
        const paras = mtextPlain(raw).split('\n');
        const lines = paras.flatMap((para) => wrapText(para, h, width, wf));
        // AutoCAD guarda el ancho real del texto: se ajusta para que ocupe lo mismo
        const ext = Number(e.extentsWidth ?? 0) || 0;
        const natural = Math.max(...lines.map((l) => textLineWidth(l, h, wf)));
        if (ext > 0 && natural > 0 && ext / natural > 0.6 && ext / natural < 1.6) wf *= ext / natural;
        // párrafo centrado o a la derecha (\pxqc; \pxqr;) dentro del ancho del cuadro
        const pq = /\\p[^;]*q([lcr])[^;]*;/.exec(raw)?.[1];
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
        let hAlign: 'left' | 'center' | 'right' = col === 1 ? 'center' : col === 2 ? 'right' : 'left';
        let x0 = 0;
        if (pq && width > 0 && pq !== 'l') {
          // el cuadro empieza en x = 0, −ancho/2 o −ancho según el punto de inserción
          const left = col === 0 ? 0 : col === 1 ? -width / 2 : -width;
          x0 = pq === 'c' ? left + width / 2 : left + width;
          hAlign = pq === 'c' ? 'center' : 'right';
        }
        drawText(a, color, mul(m, frame), lines, {
          x: x0,
          y: 0,
          z: 0,
          h,
          rot: 0,
          wf,
          hAlign,
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

  markPipes(entities);
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

export interface HatchLine {
  /** ángulo de la familia de líneas (radianes) */
  angle: number;
  base: Pt;
  /** desplazamiento entre líneas sucesivas */
  offset: Pt;
  /** trazos: positivos dibujados, negativos huecos, cero puntos */
  dashLengths?: number[];
}

/**
 * Líneas de un patrón de rayado dentro de los contornos (regla par-impar).
 * Agrega a `out` los segmentos x1,y1,x2,y2. Limita la cantidad para dibujos enormes.
 */
export function hatchPattern(loops: Pt[][], lines: HatchLine[], out: number[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const edges: [number, number, number, number][] = [];
  for (const l of loops)
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const q = l[(i + 1) % l.length];
      edges.push([p.x, p.y, q.x, q.y]);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  if (!edges.length) return;
  const MAX_LINES = 4000;
  const MAX_SEGS = 60000;
  for (const dl of lines) {
    const a = Number(dl.angle) || 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const o = dl.offset ?? { x: 0, y: 0 };
    const d = o.x * nx + o.y * ny; // separación perpendicular
    if (!(Math.abs(d) > 1e-9)) continue;
    const shift = o.x * ux + o.y * uy; // corrimiento a lo largo de la línea
    const b = dl.base ?? { x: 0, y: 0 };
    const bn = b.x * nx + b.y * ny;
    const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => x * nx + y * ny);
    const nMin = Math.min(...corners);
    const nMax = Math.max(...corners);
    let k0 = Math.ceil((nMin - bn) / d);
    let k1 = Math.floor((nMax - bn) / d);
    if (k0 > k1) [k0, k1] = [k1, k0];
    if (k1 - k0 > MAX_LINES) continue; // demasiado denso para verlo: se omite esta familia
    const dashes = (dl.dashLengths ?? []).filter((v) => Number.isFinite(v));
    const period = dashes.reduce((s, v) => s + Math.abs(v), 0);
    for (let k = k0; k <= k1; k++) {
      // punto de la línea k y su parámetro de inicio del patrón
      const px = b.x + k * o.x;
      const py = b.y + k * o.y;
      const ts: number[] = [];
      for (const [x1, y1, x2, y2] of edges) {
        // intersección de la recta (px,py)+t·u con el borde
        const ex = x2 - x1;
        const ey = y2 - y1;
        const den = ux * ey - uy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = x1 - px;
        const wy = y1 - py;
        const t = (wx * ey - wy * ex) / den;
        const sEdge = (wx * uy - wy * ux) / den;
        if (sEdge >= 0 && sEdge < 1) ts.push(t);
      }
      ts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const t0 = ts[i];
        const t1 = ts[i + 1];
        if (!dashes.length || !(period > 1e-12)) {
          out.push(px + ux * t0, py + uy * t0, px + ux * t1, py + uy * t1);
          continue;
        }
        // trazos: el patrón empieza en el punto base de la línea, corrido k·shift
        const phase0 = k * shift;
        let t = Math.floor((t0 - phase0) / period) * period + phase0;
        let guard = 0;
        while (t < t1 && guard++ < 2000) {
          for (const dv of dashes) {
            const len = Math.abs(dv);
            const s0 = t;
            const s1 = t + (dv === 0 ? period * 0.002 : len);
            if (dv >= 0) {
              const c0 = Math.max(s0, t0);
              const c1 = Math.min(s1, t1);
              if (c1 > c0) out.push(px + ux * c0, py + uy * c0, px + ux * c1, py + uy * c1);
            }
            t += len;
            if (t >= t1) break;
          }
        }
        if (out.length / 4 > MAX_SEGS * lines.length) return;
      }
    }
  }
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
