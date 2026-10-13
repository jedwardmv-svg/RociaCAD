/**
 * Lectura de planos DWG (AutoCAD) para usarlos como fondo.
 *
 * El archivo lo decodifica LibreDWG (proyecto GNU, licencia GPL) compilado a WebAssembly
 * (@mlightcad/libredwg-web). Aquí solo se traduce su base de datos a la misma forma que usa el
 * lector de DXF, así el resto del programa trata igual un DWG que un DXF.
 */
import { buildPlan, makeLayout, readViewport, type AnyEntity, type DxfResult, type LayerTable, type PlanBlocks, type PlanLayout, type RawViewport, type TextStyles } from './dxf';

type P = { x: number; y: number; z?: number };
// Forma mínima de la base de datos que entrega libredwg-web (se lee de forma defensiva)
type DwgEnt = Record<string, unknown> & { type: string; layer?: string; isVisible?: boolean; handle?: string };
interface DwgBlockRecord {
  name: string;
  handle?: string;
  basePoint?: P;
  entities?: DwgEnt[];
}
export interface DwgDatabaseLike {
  header?: { INSUNITS?: number };
  entities?: DwgEnt[];
  tables?: {
    BLOCK_RECORD?: { entries?: DwgBlockRecord[] };
    LAYER?: { entries?: { name: string; handle?: string; colorIndex?: number; color?: number; off?: boolean; frozen?: boolean }[] };
    STYLE?: { entries?: { name: string; font?: string; widthFactor?: number }[] };
  };
  objects?: { LAYOUT?: { layoutName?: string; paperSpaceTableId?: string; tabOrder?: number }[] };
}

const deg = (rad: unknown) => ((Number(rad) || 0) * 180) / Math.PI;

/** Texto de un atributo de bloque (libredwg lo guarda dentro de `text`) */
function attribEntity(at: DwgEnt): AnyEntity | null {
  const t = (at.text ?? {}) as Record<string, unknown>;
  if (typeof t !== 'object') return null;
  return {
    type: 'ATTRIB',
    layer: at.layer,
    visible: at.isVisible !== false,
    colorIndex: at.colorIndex,
    flags: at.flags,
    text: t.text,
    startPoint: t.startPoint,
    endPoint: t.endPoint,
    textHeight: t.textHeight,
    rotation: deg(t.rotation),
    halign: t.halign,
    valign: t.valign,
    xScale: t.xScale,
    styleName: t.styleName,
    extrusion: t.extrusionDirection,
  };
}

/** Traduce una entidad de libredwg-web a la forma que entrega dxf-parser */
function toPlanEntity(e: DwgEnt): AnyEntity | null {
  const base: AnyEntity = { type: e.type, layer: e.layer, visible: e.isVisible !== false, colorIndex: e.colorIndex };
  if (typeof e.color === 'number' && e.color >= 0) base.color = e.color;
  const ext = e.extrusionDirection as P | undefined;
  if (ext && (ext.x || ext.y || ext.z)) base.extrusion = ext;
  switch (e.type) {
    case 'LINE':
      return { ...base, vertices: [e.startPoint, e.endPoint] };
    case 'LWPOLYLINE':
      // en DWG el bit 512 indica polilínea cerrada
      return { ...base, vertices: e.vertices, shape: ((Number(e.flag) || 0) & 512) !== 0, elevation: e.elevation, width: e.constantWidth };
    case 'POLYLINE2D':
      return {
        ...base,
        type: 'POLYLINE',
        vertices: ((e.vertices as (P & { bulge?: number })[]) ?? []).map((v) => ({ x: v.x, y: v.y, bulge: v.bulge ?? 0 })),
        shape: ((Number(e.flag) || 0) & 1) !== 0,
        elevation: e.elevation,
      };
    case 'POLYLINE3D':
      return {
        ...base,
        type: 'POLYLINE',
        is3d: true,
        vertices: ((e.vertices as P[]) ?? []).map((v) => ({ x: v.x, y: v.y, z: v.z ?? 0 })),
        shape: ((Number(e.flag) || 0) & 1) !== 0,
      };
    case 'ARC':
    case 'CIRCLE':
      // libredwg entrega los ángulos en radianes, igual que dxf-parser
      return { ...base, center: e.center, radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'ELLIPSE':
      return { ...base, center: e.center, majorAxisEndPoint: e.majorAxisEndPoint, axisRatio: e.axisRatio, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'SPLINE':
      return {
        ...base,
        fitPoints: e.fitPoints,
        controlPoints: e.controlPoints,
        knotValues: e.knots,
        degreeOfSplineCurve: e.degree,
        closed: ((Number(e.flag) || 0) & 1) !== 0,
      };
    case 'SOLID':
    case 'TRACE': {
      const z = Number(e.elevation ?? 0) || 0;
      const pts = [e.corner1, e.corner2, e.corner3, e.corner4 ?? e.corner3].filter(Boolean).map((q) => ({ ...(q as P), z: (q as P).z ?? z }));
      return { ...base, points: pts };
    }
    case '3DFACE':
      return { ...base, points: [e.corner1, e.corner2, e.corner3, e.corner4 ?? e.corner3].filter(Boolean) };
    case 'HATCH':
      return {
        ...base,
        boundaryPaths: e.boundaryPaths,
        solidFill: e.solidFill,
        patternName: e.patternName,
        definitionLines: e.definitionLines,
        elevation: e.elevation ?? (e.elevationPoint as P | undefined)?.z,
      };
    case 'MULTILEADER':
      return { ...e, ...base };
    case 'INSERT':
      return {
        ...base,
        name: e.name,
        position: e.insertionPoint,
        xScale: e.xScale,
        yScale: e.yScale,
        zScale: e.zScale,
        // dxf-parser da el giro del bloque en grados; libredwg en radianes
        rotation: deg(e.rotation),
        columnCount: e.columnCount,
        rowCount: e.rowCount,
        columnSpacing: e.columnSpacing,
        rowSpacing: e.rowSpacing,
        attribs: Array.isArray(e.attribs) ? (e.attribs as DwgEnt[]).map(attribEntity).filter(Boolean) : undefined,
      };
    case 'DIMENSION':
      return { ...base, block: e.name };
    case 'POINT':
      return { ...base, position: e.position };
    case 'TEXT':
      return {
        ...base,
        text: e.text,
        startPoint: { ...(e.startPoint as P), z: (e.startPoint as P | undefined)?.z ?? Number(e.elevation ?? 0) },
        endPoint: e.endPoint,
        textHeight: e.textHeight,
        rotation: deg(e.rotation),
        halign: e.halign,
        valign: e.valign,
        xScale: e.xScale,
        styleName: e.styleName,
      };
    case 'MTEXT':
      return {
        ...base,
        text: e.text,
        position: e.insertionPoint,
        height: e.textHeight,
        width: e.rectWidth,
        attachmentPoint: e.attachmentPoint,
        direction: e.direction,
        rotation: deg(e.rotation),
        lineSpacing: e.lineSpacing,
        styleName: e.styleName,
        extentsWidth: e.extentsWidth,
      };
    default:
      // sombreados con patrón, imágenes, etc.: el lector los cuenta y no los dibuja
      return base;
  }
}

/** Convierte la base de datos de un DWG en el plano de fondo (segmentos por capa) */
export function planFromDwgDatabase(db: DwgDatabaseLike): DxfResult {
  const records = db.tables?.BLOCK_RECORD?.entries ?? [];
  const blocks: PlanBlocks = {};
  let model: DwgEnt[] | undefined;
  const paper: DwgBlockRecord[] = [];
  for (const b of records) {
    const name = b.name ?? '';
    if (/^\*model_space$/i.test(name)) {
      model = b.entities;
      continue;
    }
    if (/^\*paper_space/i.test(name)) {
      paper.push(b);
      continue;
    }
    blocks[name] = {
      position: b.basePoint ?? { x: 0, y: 0 },
      entities: (b.entities ?? []).map(toPlanEntity).filter((x): x is AnyEntity => !!x),
    };
  }
  // si el archivo no trae el espacio modelo como bloque, se usan todas las entidades
  const source = model && model.length ? model : (db.entities ?? []).filter((e) => e.type !== 'VIEWPORT');
  const entities = source.map(toPlanEntity).filter((x): x is AnyEntity => !!x);
  const table: LayerTable = {};
  const byHandle = new Map<string, string>();
  for (const l of db.tables?.LAYER?.entries ?? []) {
    table[l.name] = { colorIndex: l.colorIndex, color: l.color, off: !!l.off || !!l.frozen };
    if (l.handle) byHandle.set(String(l.handle).toUpperCase(), l.name);
  }
  const styles: TextStyles = {};
  for (const st of db.tables?.STYLE?.entries ?? []) if (st.name) styles[st.name] = { widthFactor: st.widthFactor, font: st.font };
  const insUnits = Number(db.header?.INSUNITS ?? 0) || 0;
  const plan = buildPlan(entities, blocks, insUnits, 'DWG', table, styles);

  // presentaciones (espacio papel): su dibujo propio y sus ventanas al modelo
  const layoutsMeta = db.objects?.LAYOUT ?? [];
  const layouts: PlanLayout[] = [];
  for (const rec of paper) {
    const meta = layoutsMeta.find((l) => rec.handle && String(l.paperSpaceTableId ?? '').toUpperCase() === String(rec.handle).toUpperCase());
    const ents = rec.entities ?? [];
    const vps = ents
      .filter((e) => e.type === 'VIEWPORT')
      .map((e) => readViewport(e as unknown as AnyEntity, byHandle))
      .filter((v): v is RawViewport => !!v);
    const paperEnts = ents.filter((e) => e.type !== 'VIEWPORT').map(toPlanEntity).filter((x): x is AnyEntity => !!x);
    const lay = makeLayout(meta?.layoutName || `Presentación ${layouts.length + 1}`, meta?.tabOrder ?? layouts.length + 1, paperEnts, vps, blocks, insUnits, 'DWG', table, styles);
    if (lay) layouts.push(lay);
  }
  layouts.sort((x, y) => x.order - y.order);
  if (layouts.length) plan.layouts = layouts;
  return plan;
}
