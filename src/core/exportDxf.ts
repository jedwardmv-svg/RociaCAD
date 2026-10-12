/**
 * Exportación a DXF (lo abren AutoCAD, Revit, BricsCAD, LibreCAD y casi cualquier CAD).
 *
 * La tubería sale en 3D (cada tubo es una línea con su elevación), con una capa por diámetro.
 * Rociadores, textos y elementos del edificio van en capas propias que empiezan por "RC-".
 * Si el proyecto tiene un plano DXF de fondo, se exporta en las coordenadas y unidades de ese
 * plano, para que la red quede exactamente encima del dibujo del arquitecto.
 */
import { DxfWriter, LWPolylineFlags, point2d, point3d, TextHorizontalAlignment, TextVerticalAlignment, Units } from '@tarikjabiri/dxf';
import { ELEMENT_KIND_SHAPE, getElementType, type ElementKind } from './catalog';
import { INSUNITS_FT } from './dxf';
import type { Project } from './model';
import { DN_MM, type NominalSize } from './pipes';

export interface DxfFrame {
  /** de coordenadas del proyecto (ft) a coordenadas del plano */
  toPlan: (x: number, y: number) => { x: number; y: number };
  /** pies por unidad del plano */
  ftPerUnit: number;
}

const ELEMENT_LAYERS: Record<ElementKind, { name: string; color: number }> = {
  wall: { name: 'RC-MUROS', color: 8 },
  column: { name: 'RC-COLUMNAS', color: 8 },
  beam: { name: 'RC-VIGAS', color: 9 },
  slab: { name: 'RC-LOSAS', color: 9 },
  ceiling: { name: 'RC-CIELOS', color: 254 },
  duct: { name: 'RC-DUCTOS', color: 4 },
  'pipe-ref': { name: 'RC-OTRAS-TUBERIAS', color: 3 },
};

/** Colores AutoCAD por diámetro (rojos y naranjas para la red contra incendio) */
const SIZE_ACI: Partial<Record<NominalSize, number>> = {
  '3/4': 6, '1': 1, '1-1/4': 30, '1-1/2': 40, '2': 50, '2-1/2': 20, '3': 10, '3-1/2': 12,
  '4': 14, '5': 16, '6': 1, '8': 240, '10': 230, '12': 220,
};

export function buildDxf(project: Project, frame?: DxfFrame): string {
  const metric = project.displayUnits === 'metric';
  // unidades del archivo: las del plano de fondo, o mm (métrico) / pulgadas (US)
  let ftPerUnit: number;
  let units: Units;
  if (frame) {
    ftPerUnit = frame.ftPerUnit;
    const code = Object.entries(INSUNITS_FT).find(([, v]) => Math.abs(v.ft - ftPerUnit) / v.ft < 1e-6)?.[0];
    units = code ? (Number(code) as Units) : Units.Unitless;
  } else {
    ftPerUnit = metric ? 1 / 304.8 : 1 / 12;
    units = metric ? Units.Millimeters : Units.Inches;
  }
  const XY = (x: number, y: number) => (frame ? frame.toPlan(x, y) : { x: x / ftPerUnit, y: y / ftPerUnit });
  const Z = (z: number) => z / ftPerUnit;
  const L = (ft: number) => ft / ftPerUnit;

  const dxf = new DxfWriter();
  dxf.setUnits(units);
  const layers = new Set<string>();
  const layer = (name: string, color: number) => {
    if (!layers.has(name)) {
      dxf.addLayer(name, color, 'Continuous');
      layers.add(name);
    }
    return name;
  };
  const textH = L(metric ? 0.15 / 0.3048 : 0.5); // 15 cm o 6 in
  const text = (x: number, y: number, z: number, h: number, value: string, layerName: string, rotation = 0) =>
    dxf.addText(point3d(x, y, z), h, value, {
      layerName,
      rotation,
      horizontalAlignment: TextHorizontalAlignment.Center,
      verticalAlignment: TextVerticalAlignment.Bottom,
      secondAlignmentPoint: point3d(x, y, z),
    });

  // ---------- Tubería ----------
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  for (const p of project.pipes) {
    const a = nodes.get(p.from);
    const b = nodes.get(p.to);
    if (!a || !b) continue;
    const label = metric ? `DN${DN_MM[p.size]}` : `${p.size}"`;
    const lname = layer(`RC-TUBERIA-${metric ? `DN${DN_MM[p.size]}` : p.size.replace('/', '_')}`, SIZE_ACI[p.size] ?? 1);
    const pa = XY(a.x, a.y);
    const pb = XY(b.x, b.y);
    dxf.addLine(point3d(pa.x, pa.y, Z(a.z)), point3d(pb.x, pb.y, Z(b.z)), { layerName: lname });
    // rótulo del diámetro en tramos horizontales de más de 1 m
    const lenFt = Math.hypot(b.x - a.x, b.y - a.y);
    if (lenFt > 1 / 0.3048 && Math.abs(b.z - a.z) < 1e-6) {
      let ang = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
      if (ang > 90 || ang <= -90) ang += 180; // que el texto no quede al revés
      const off = textH * 0.4;
      const r = (ang * Math.PI) / 180;
      text((pa.x + pb.x) / 2 - off * Math.sin(r), (pa.y + pb.y) / 2 + off * Math.cos(r), Z(a.z), textH, label, layer('RC-TEXTO-TUBERIA', 7), ang);
    }
  }

  // ---------- Rociadores ----------
  const spkLayer = layer('RC-ROCIADORES', 5);
  const spkText = layer('RC-TEXTO-ROCIADORES', 5);
  for (const s of project.sprinklers) {
    const n = nodes.get(s.nodeId);
    if (!n) continue;
    const c = XY(n.x, n.y);
    dxf.addCircle(point3d(c.x, c.y, Z(n.z)), L(0.15 / 0.3048), { layerName: spkLayer });
    text(c.x, c.y + L(0.2 / 0.3048), Z(n.z), textH * 0.8, `${s.id} K${s.k}`, spkText);
  }

  // ---------- Suministro ----------
  const sup = nodes.get(project.supply.nodeId);
  if (sup) {
    const c = XY(sup.x, sup.y);
    const sl = layer('RC-SUMINISTRO', 4);
    dxf.addCircle(point3d(c.x, c.y, Z(sup.z)), L(0.3 / 0.3048), { layerName: sl });
    text(c.x, c.y + L(0.4 / 0.3048), Z(sup.z), textH, 'SUMINISTRO', sl);
  }

  // ---------- Elementos del edificio ----------
  for (const e of project.elements ?? []) {
    const t = getElementType(e.typeId, project);
    const w = e.width ?? t.width;
    const lname = layer(ELEMENT_LAYERS[t.kind].name, ELEMENT_LAYERS[t.kind].color);
    const shape = ELEMENT_KIND_SHAPE[t.kind];
    const poly = (pts: { x: number; y: number }[]) =>
      dxf.addLWPolyline(
        pts.map((q) => {
          const pp = XY(q.x, q.y);
          return { point: point2d(pp.x, pp.y) };
        }),
        { layerName: lname, flags: LWPolylineFlags.Closed, elevation: Z(e.z) },
      );
    if (shape === 'point') {
      const q = e.points[0];
      if (!q) continue;
      const h2 = w / 2;
      poly([
        { x: q.x - h2, y: q.y - h2 },
        { x: q.x + h2, y: q.y - h2 },
        { x: q.x + h2, y: q.y + h2 },
        { x: q.x - h2, y: q.y + h2 },
      ]);
    } else if (shape === 'area') {
      if (e.points.length >= 3) poly(e.points);
    } else {
      for (let i = 0; i + 1 < e.points.length; i++) {
        const a = e.points[i];
        const b = e.points[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        const nx = (-(b.y - a.y) / len) * (w / 2);
        const ny = ((b.x - a.x) / len) * (w / 2);
        poly([
          { x: a.x + nx, y: a.y + ny },
          { x: b.x + nx, y: b.y + ny },
          { x: b.x - nx, y: b.y - ny },
          { x: a.x - nx, y: a.y - ny },
        ]);
      }
    }
  }

  return dxf.stringify();
}
