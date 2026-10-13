/**
 * Planos de entrega: hojas con marco y rótulo, planta a escala, isométrico y hoja de datos
 * (placa hidráulica, cuadro de rociadores, tubería, notas). Se arman en #print-root como SVG
 * (vectorial) y se guardan en PDF del tamaño de la hoja.
 */
import {
  buildBom,
  drawingSettings,
  fitScale,
  fmt,
  getSprinklerModel,
  HAZARD_NAMES,
  networkDrawing,
  ORIENTATION_NAMES,
  PAPER_SIZES,
  RULE_NAMES,
  standardScales,
  SYSTEM_TYPE_NAMES,
  effectiveDesignArea,
  type DrawingSettings,
  type DxfResult,
  type NetworkDrawing,
  type PaperSize,
  type Project,
  type SprinklerOrientation,
  type Underlay,
} from '../../core';
import { clear, h } from './dom';
import { store } from './state';
import { supplyChartSvg } from './supplyChart';
import { currentReview } from './review';

/** Lo que provee main.ts */
export const drawingsHooks = {
  /** plano de fondo en espacio modelo, con su escala y posición */
  underlay: (): { meta: Underlay; dxf?: DxfResult; canvas?: HTMLCanvasElement; width: number; height: number } | undefined => undefined,
  /** guarda el PDF (en la app de escritorio) o abre la impresión */
  export: async (_name: string, _paper: PaperSize) => {},
  version: '',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Ancho aproximado de un texto en Arial (mm) */
const textW = (s: string, fs: number) => s.length * fs * 0.52;

function wrap(s: string, fs: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/)) {
      const t = cur ? `${cur} ${w}` : w;
      if (cur && textW(t, fs) > maxW) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

const PIPE_COLOR = '#c8102e';
const PIPE_W: Record<string, number> = { feed: 0.7, riser: 0.7, main: 0.7, cross: 0.55, branch: 0.4, drop: 0.3 };

interface Sheet {
  title: string;
  /** convenciones que van en el rótulo */
  legend?: 'plan' | 'iso';
  /** contenido del área de dibujo (SVG) y, para la hoja de datos, HTML encima */
  svg: string;
  html?: HTMLElement;
  scale?: string;
}

interface Frame {
  W: number;
  H: number;
  m: number;
  /** recuadro del rótulo */
  tb: { x: number; y: number; w: number; h: number };
  /** área de dibujo */
  area: { x: number; y: number; w: number; h: number };
  fs: number;
}

function frameOf(paper: PaperSize): Frame {
  const W = paper.w;
  const H = paper.h;
  const m = W < 300 ? 7 : 10;
  const tbw = Math.min(115, Math.max(58, W * 0.16));
  const tb = { x: W - m - tbw, y: m, w: tbw, h: H - 2 * m };
  const pad = W < 300 ? 3 : 5;
  const area = { x: m + pad, y: m + pad, w: tb.x - m - 2 * pad, h: H - 2 * m - 2 * pad };
  const fs = Math.min(3.2, Math.max(2, W / 300));
  return { W, H, m, tb, area, fs };
}

// ---------- Símbolos ----------
function headSymbol(x: number, y: number, r: number, o: SprinklerOrientation, filled = false): string {
  const c = `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="${filled ? '#ffd5d5' : '#fff'}" stroke="#000" stroke-width="${n2(r * 0.18)}"/>`;
  const sw = n2(r * 0.18);
  if (o === 'pendent') return c + `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r * 0.38)}" fill="#000"/>`;
  if (o === 'upright') {
    const d = r * 0.68;
    return c + `<path d="M${n2(x - d)} ${n2(y - d)}L${n2(x + d)} ${n2(y + d)}M${n2(x - d)} ${n2(y + d)}L${n2(x + d)} ${n2(y - d)}" stroke="#000" stroke-width="${sw}"/>`;
  }
  if (o === 'sidewall') return c + `<path d="M${n2(x - r)} ${n2(y)}A${n2(r)} ${n2(r)} 0 0 0 ${n2(x + r)} ${n2(y)}Z" fill="#000"/>`;
  return c + `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r * 0.55)}" fill="none" stroke="#000" stroke-width="${sw}"/>`;
}

function riserSymbol(x: number, y: number, r: number): string {
  const d = r * 0.7;
  return (
    `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="#fff" stroke="${PIPE_COLOR}" stroke-width="${n2(r * 0.25)}"/>` +
    `<path d="M${n2(x - d)} ${n2(y + d)}L${n2(x + d)} ${n2(y - d)}" stroke="${PIPE_COLOR}" stroke-width="${n2(r * 0.25)}"/>`
  );
}

// ---------- Rótulo ----------
function titleBlock(f: Frame, p: Project, s: DrawingSettings, sheet: Sheet, index: number, total: number): string {
  const legend = sheet.legend;
  const { tb } = f;
  const fs = f.fs;
  const out: string[] = [];
  const line = (y: number) => out.push(`<line x1="${n2(tb.x)}" y1="${n2(y)}" x2="${n2(tb.x + tb.w)}" y2="${n2(y)}" stroke="#000" stroke-width="0.3"/>`);
  const text = (x: number, y: number, t: string, size: number, bold = false, color = '#000') =>
    out.push(`<text x="${n2(x)}" y="${n2(y)}" font-size="${n2(size)}" font-weight="${bold ? 700 : 400}" fill="${color}">${esc(t)}</text>`);
  out.push(`<rect x="${n2(tb.x)}" y="${n2(tb.y)}" width="${n2(tb.w)}" height="${n2(tb.h)}" fill="#fff" stroke="#000" stroke-width="0.5"/>`);
  const px = tb.x + fs * 0.9;
  const inner = tb.w - fs * 1.8;
  let y = tb.y + fs * 2;
  // encabezado
  for (const l of wrap(s.company || 'SISTEMA DE ROCIADORES AUTOMÁTICOS', fs * 1.25, inner)) {
    text(px, y, l, fs * 1.25, true);
    y += fs * 1.5;
  }
  text(px, y, 'Protección contra incendio · NFPA 13', fs * 0.85, false, '#444');
  y += fs * 1.1;
  line(y);
  y += fs * 1.6;
  // datos del proyecto
  const field = (label: string, value: string, size = fs) => {
    text(px, y, label.toUpperCase(), fs * 0.7, false, '#555');
    y += size * 1.15;
    for (const l of wrap(value || '—', size, inner).slice(0, 3)) {
      text(px, y, l, size, true);
      y += size * 1.25;
    }
    y += fs * 0.45;
  };
  field('Proyecto', p.info.name || 'Proyecto sin nombre', fs * 1.15);
  field('Cliente', p.info.client || '');
  field('Dirección', p.info.address || '');
  line(y);
  y += fs * 1.6;

  // leyenda
  const bottomH = fs * 23;
  if (legend) {
    text(px, y, 'CONVENCIONES', fs * 0.85, true);
    y += fs * 1.6;
    const r = fs * 0.7;
    const used = new Set(p.sprinklers.map((x) => x.orientation));
    const items: [string, string][] = [];
    if (legend === 'iso') {
      items.push([`<circle cx="${n2(px + r)}" cy="0" r="${n2(r * 0.6)}" fill="#fff" stroke="#000" stroke-width="0.18"/>`, 'Rociador']);
      items.push([`<circle cx="${n2(px + r)}" cy="0" r="${n2(r * 0.6)}" fill="#d0021b" stroke="#000" stroke-width="0.18"/>`, 'Rociador abierto (área de diseño)']);
    } else
      for (const o of ['pendent', 'upright', 'sidewall', 'concealed'] as SprinklerOrientation[])
        if (used.has(o)) items.push([headSymbol(px + r, 0, r, o), `Rociador ${ORIENTATION_NAMES[o].toLowerCase()}`]);
    items.push([`<line x1="${n2(px)}" y1="0" x2="${n2(px + 2 * r)}" y2="0" stroke="${PIPE_COLOR}" stroke-width="0.5"/>`, 'Tubería de rociadores']);
    if (legend === 'plan') items.push([riserSymbol(px + r, 0, r * 0.9), 'Montante (tubo vertical)']);
    if (legend === 'plan' && s.hangers && (p.hangers ?? []).length) items.push([`<line x1="${n2(px + r)}" y1="${n2(-r)}" x2="${n2(px + r)}" y2="${n2(r)}" stroke="#000" stroke-width="0.3"/>`, 'Soporte']);
    items.push([`<rect x="${n2(px)}" y="${n2(-r * 0.7)}" width="${n2(2 * r)}" height="${n2(1.4 * r)}" fill="none" stroke="#d0021b" stroke-width="0.35" stroke-dasharray="1 0.6"/>`, 'Área de diseño']);
    items.push([`<path d="M${n2(px)} ${n2(r)}L${n2(px + r)} ${n2(-r)}L${n2(px + 2 * r)} ${n2(r)}Z" fill="#000"/>`, 'Punto de suministro']);
    if (s.nodes) items.push([`<text x="${n2(px)}" y="${n2(r * 0.5)}" font-size="${n2(fs * 0.8)}" fill="#1f4e9a">N1</text>`, 'Nodo del cálculo hidráulico']);
    if (s.sizes) items.push([`<text x="${n2(px)}" y="${n2(r * 0.5)}" font-size="${n2(fs * 0.8)}">2"</text>`, s.lengths ? 'Diámetro · largo del tramo' : 'Diámetro del tramo']);
    for (const [sym, label] of items) {
      if (y > tb.y + tb.h - bottomH - fs * 2) break;
      out.push(`<g transform="translate(0 ${n2(y - fs * 0.35)})">${sym}</g>`);
      text(px + r * 2 + fs * 0.8, y, label, fs * 0.85);
      y += fs * 1.6;
    }
  }

  // bloque inferior: contenido, escala, fecha, hoja
  let yb = tb.y + tb.h - bottomH;
  line(yb);
  yb += fs * 1.6;
  const row = (label: string, value: string, size = fs) => {
    text(px, yb, label.toUpperCase(), fs * 0.7, false, '#555');
    yb += size * 1.15;
    for (const l of wrap(value, size, inner).slice(0, 2)) {
      text(px, yb, l, size, true);
      yb += size * 1.25;
    }
    yb += fs * 0.35;
  };
  row('Contenido', sheet.title, fs * 1.1);
  row('Escala', sheet.scale ?? 'Sin escala');
  row('Unidades', p.displayUnits === 'metric' ? 'Metros, bar, L/min · diámetros en pulgadas' : 'Pies, psi, gpm · diámetros en pulgadas', fs * 0.85);
  const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
  // dos columnas: fecha / revisión, diseñó / revisó
  const two = (l1: string, v1: string, l2: string, v2: string) => {
    const half = tb.w / 2;
    text(px, yb, l1.toUpperCase(), fs * 0.7, false, '#555');
    text(px + half, yb, l2.toUpperCase(), fs * 0.7, false, '#555');
    yb += fs * 1.15;
    text(px, yb, wrap(v1 || '—', fs, half - fs)[0], fs, true);
    text(px + half, yb, wrap(v2 || '—', fs, half - fs)[0], fs, true);
    yb += fs * 1.6;
  };
  two('Fecha', today, 'Revisión', s.revision || '0');
  two('Diseñó', p.info.designer || '', 'Revisó', s.checkedBy || '');
  line(yb - fs * 0.6);
  yb += fs * 0.9;
  text(px, yb, 'HOJA', fs * 0.7, false, '#555');
  text(px + tb.w / 2, yb, `RociaCAD ${drawingsHooks.version}`, fs * 0.7, false, '#777');
  yb += fs * 2.1;
  text(px, yb, `${index} de ${total}`, fs * 1.8, true);
  return out.join('');
}

// ---------- Dibujo de la red ----------
interface Mapper {
  (x: number, y: number): [number, number];
}

function placeLabels(nd: NetworkDrawing, map: Mapper, fs: number, area: Frame['area'], avoid: { x: number; y: number; r: number }[]): string {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const hits = (b: { x0: number; y0: number; x1: number; y1: number }) => placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
  const out: string[] = [];
  const labels = [...nd.labels].sort((a, b) => b.priority - a.priority);
  for (const l of labels) {
    const [x, y] = map(l.x, l.y);
    if (x < area.x || x > area.x + area.w || y < area.y || y > area.y + area.h) continue;
    const size = l.kind === 'node' ? fs * 0.8 : fs;
    const w = textW(l.text, size);
    // en papel el eje y va hacia abajo: el ángulo cambia de signo
    const a = -l.angle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let cx: number;
    let cy: number;
    if (l.kind === 'node') {
      cx = x + size * 0.9 + w / 2;
      cy = y - size * 0.9;
    } else {
      // arriba de la línea, a media altura de letra
      const off = size * 0.75;
      cx = x + sa * off;
      cy = y - ca * off;
    }
    // caja (aproximada) del texto girado
    const hw = (Math.abs(ca) * w + Math.abs(sa) * size) / 2;
    const hh = (Math.abs(sa) * w + Math.abs(ca) * size) / 2;
    const box = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
    if (hits(box)) continue;
    if (avoid.some((c) => Math.hypot(Math.max(box.x0 - c.x, 0, c.x - box.x1), Math.max(box.y0 - c.y, 0, c.y - box.y1)) < c.r)) continue;
    placed.push(box);
    const deg = (a * 180) / Math.PI;
    out.push(
      `<text x="${n2(cx)}" y="${n2(cy)}" font-size="${n2(size)}" text-anchor="middle" dominant-baseline="central" fill="${l.kind === 'node' ? '#1f4e9a' : '#000'}"` +
        (Math.abs(deg) > 0.01 && l.kind !== 'node' ? ` transform="rotate(${n2(deg)} ${n2(cx)} ${n2(cy)})"` : '') +
        `>${esc(l.text)}</text>`,
    );
  }
  return out.join('');
}

function drawNetwork(nd: NetworkDrawing, map: Mapper, f: Frame, opts: { k: number; hangers: boolean; iso: boolean }): string {
  const fs = f.fs;
  const out: string[] = [];
  // elementos del edificio (gris)
  for (const e of nd.elements) {
    if (e.kind === 'line' && e.pts.length >= 2) {
      const d = e.pts.map((q, i) => `${i ? 'L' : 'M'}${map(q.x, q.y).map(n2).join(' ')}`).join('');
      out.push(`<path d="${d}" fill="none" stroke="#9a9a9a" stroke-width="${n2(Math.max(0.25, e.width * opts.k))}" stroke-linejoin="miter"/>`);
    } else if (e.kind === 'point' && e.pts.length) {
      const [x, y] = map(e.pts[0].x, e.pts[0].y);
      const s = Math.max(0.6, e.width * opts.k);
      out.push(`<rect x="${n2(x - s / 2)}" y="${n2(y - s / 2)}" width="${n2(s)}" height="${n2(s)}" fill="#bdbdbd" stroke="#888" stroke-width="0.2"/>`);
    }
  }
  // área de diseño
  if (nd.area) {
    const pts = nd.area.map((q) => map(q.x, q.y));
    out.push(`<path d="${pts.map((q, i) => `${i ? 'L' : 'M'}${n2(q[0])} ${n2(q[1])}`).join('')}Z" fill="#d0021b" fill-opacity="0.05" stroke="#d0021b" stroke-width="0.4" stroke-dasharray="2 1"/>`);
    const top = pts.reduce((a, b) => (b[1] < a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a));
    out.push(`<text x="${n2(top[0])}" y="${n2(top[1] - fs * 0.6)}" font-size="${n2(fs * 0.9)}" font-weight="700" fill="#d0021b">ÁREA DE DISEÑO</text>`);
  }
  // tubos (los más gruesos al final para que queden encima)
  const lines = [...nd.lines].sort((a, b) => (PIPE_W[a.role] ?? 0.4) - (PIPE_W[b.role] ?? 0.4));
  for (const l of lines) {
    const [x1, y1] = map(l.x1, l.y1);
    const [x2, y2] = map(l.x2, l.y2);
    out.push(`<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${PIPE_COLOR}" stroke-width="${PIPE_W[l.role] ?? 0.4}" stroke-linecap="round"/>`);
  }
  // soportes
  if (opts.hangers)
    for (const hg of nd.hangers) {
      const [x, y] = map(hg.x, hg.y);
      const a = -hg.angle + Math.PI / 2;
      const d = fs * 0.55;
      out.push(`<line x1="${n2(x - Math.cos(a) * d)}" y1="${n2(y - Math.sin(a) * d)}" x2="${n2(x + Math.cos(a) * d)}" y2="${n2(y + Math.sin(a) * d)}" stroke="#000" stroke-width="0.25"/>`);
    }
  // montantes
  const r = opts.iso ? fs * 0.38 : fs * 0.55;
  for (const q of nd.risers) {
    const [x, y] = map(q.x, q.y);
    out.push(riserSymbol(x, y, r * 1.1));
  }
  // rociadores
  const avoid: { x: number; y: number; r: number }[] = [];
  for (const hd of nd.heads) {
    const [x, y] = map(hd.x, hd.y);
    if (opts.iso) out.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r * 0.8)}" fill="${hd.flowing ? '#d0021b' : '#fff'}" stroke="#000" stroke-width="0.18"/>`);
    else out.push(headSymbol(x, y, r, hd.orientation, hd.flowing));
    avoid.push({ x, y, r: r * 0.6 });
  }
  // suministro
  if (nd.supply) {
    const [x, y] = map(nd.supply.x, nd.supply.y);
    const s = fs * 0.9;
    out.push(`<path d="M${n2(x - s)} ${n2(y + s * 1.6)}L${n2(x)} ${n2(y + s * 0.2)}L${n2(x + s)} ${n2(y + s * 1.6)}Z" fill="#000"/>`);
    out.push(`<text x="${n2(x)}" y="${n2(y + s * 2.9)}" font-size="${n2(fs * 0.85)}" font-weight="700" text-anchor="middle">SUMINISTRO</text>`);
  }
  out.push(placeLabels(nd, map, fs * (opts.iso ? 0.8 : 0.85), f.area, avoid));
  return out.join('');
}

/** Barra de escala en papel */
function scaleBar(x: number, y: number, k: number, fs: number, metric: boolean): string {
  // un largo redondo que mida unos 40 a 80 mm
  const unitFt = metric ? 1 / 0.3048 : 1;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  let len = steps[0];
  for (const s of steps) if (s * unitFt * k <= 80) len = s;
  const total = len * unitFt * k;
  const out: string[] = [];
  for (let i = 0; i < 4; i++) out.push(`<rect x="${n2(x + (total / 4) * i)}" y="${n2(y)}" width="${n2(total / 4)}" height="${n2(fs * 0.5)}" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.2"/>`);
  out.push(`<text x="${n2(x)}" y="${n2(y + fs * 1.6)}" font-size="${n2(fs * 0.75)}">0</text>`);
  out.push(`<text x="${n2(x + total)}" y="${n2(y + fs * 1.6)}" font-size="${n2(fs * 0.75)}" text-anchor="end">${len} ${metric ? 'm' : 'ft'}</text>`);
  return out.join('');
}

/** Plano de fondo en gris, rasterizado al tamaño del área de dibujo */
function underlayImage(f: Frame, map: Mapper, k: number): string {
  const u = drawingsHooks.underlay();
  if (!u) return '';
  const { meta } = u;
  const ppm = Math.min(6, 6000 / f.area.w, 6000 / f.area.h); // píxeles por mm (hasta ~150 ppp)
  const cw = Math.round(f.area.w * ppm);
  const ch = Math.round(f.area.h * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  // lienzo en memoria (sin tarjeta de video): leerlo para el PDF es mucho más rápido
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) return '';
  const t0 = performance.now();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  // plano → mundo → papel → píxel
  const r = (meta.rotation * Math.PI) / 180;
  const [ox, oy] = map(meta.x, meta.y);
  const ax = Math.cos(r) * meta.scale * k * ppm;
  const ay = Math.sin(r) * meta.scale * k * ppm;
  const tx = (ox - f.area.x) * ppm;
  const ty = (oy - f.area.y) * ppm;
  // papel: x' = ox + k·(wx − mx); y' = oy − k·(wy − my) → matriz para (px, py) del plano
  ctx.setTransform(ax, -ay, -ay, -ax, tx, ty);
  const lw = 0.18 * ppm / Math.hypot(ax, ay); // 0.18 mm en el papel
  // caja visible en coordenadas del plano (inversa de la transformación) para saltar lo que no se ve
  const det = ax * -ax - -ay * -ay;
  const inv = (X: number, Y: number) => {
    const dx = X - tx;
    const dy = Y - ty;
    return [(-ax * dx + ay * dy) / det, (ay * dx + ax * dy) / det];
  };
  const corners = [inv(0, 0), inv(cw, 0), inv(0, ch), inv(cw, ch)];
  const vx0 = Math.min(...corners.map((q) => q[0]));
  const vx1 = Math.max(...corners.map((q) => q[0]));
  const vy0 = Math.min(...corners.map((q) => q[1]));
  const vy1 = Math.max(...corners.map((q) => q[1]));
  const out2 = (x1: number, y1: number, x2: number, y2: number) => (x1 < vx0 && x2 < vx0) || (x1 > vx1 && x2 > vx1) || (y1 < vy0 && y2 < vy0) || (y1 > vy1 && y2 > vy1);
  if (u.dxf) {
    const hidden = new Set(meta.hiddenLayers ?? []);
    ctx.fillStyle = '#e4e4e4';
    for (const l of u.dxf.layers) {
      if (hidden.has(l.name) || !l.fills?.length) continue;
      ctx.beginPath();
      const t = l.fills;
      for (let i = 0; i < t.length; i += 9) {
        if (out2(Math.min(t[i], t[i + 3], t[i + 6]), Math.min(t[i + 1], t[i + 4], t[i + 7]), Math.max(t[i], t[i + 3], t[i + 6]), Math.max(t[i + 1], t[i + 4], t[i + 7])) && out2(t[i], t[i + 1], t[i + 6], t[i + 7])) continue;
        ctx.moveTo(t[i], t[i + 1]);
        ctx.lineTo(t[i + 3], t[i + 4]);
        ctx.lineTo(t[i + 6], t[i + 7]);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.strokeStyle = '#a8a8a8';
    ctx.lineWidth = lw;
    for (const l of u.dxf.layers) {
      if (hidden.has(l.name)) continue;
      ctx.beginPath();
      const s = l.segments;
      for (let i = 0; i < s.length; i += 6) {
        if (out2(s[i], s[i + 1], s[i + 3], s[i + 4])) continue;
        ctx.moveTo(s[i], s[i + 1]);
        ctx.lineTo(s[i + 3], s[i + 4]);
      }
      ctx.stroke();
    }
  } else if (u.canvas) {
    // la imagen tiene el origen arriba: se voltea
    ctx.transform(1, 0, 0, -1, 0, u.height);
    ctx.filter = `grayscale(1)${meta.invert ? ' invert(1)' : ''} opacity(0.45)`;
    ctx.drawImage(u.canvas, 0, 0, u.width, u.height);
  }
  const t1 = performance.now();
  // JPEG: mucho más rápido de comprimir que PNG en imágenes grandes, y sin canal alfa
  const url = canvas.toDataURL('image/jpeg', 0.9);
  console.info(`[planos] fondo: dibujo ${(t1 - t0).toFixed(0)} ms, jpeg ${(performance.now() - t1).toFixed(0)} ms, ${cw}×${ch}`);
  return `<image x="${n2(f.area.x)}" y="${n2(f.area.y)}" width="${n2(f.area.w)}" height="${n2(f.area.h)}" href="${url}" preserveAspectRatio="none"/>`;
}

function underlayWorldBounds(): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const u = drawingsHooks.underlay();
  if (!u) return undefined;
  const b = u.dxf?.bounds ?? { minX: 0, minY: 0, maxX: u.width, maxY: u.height };
  const r = (u.meta.rotation * Math.PI) / 180;
  const pts = [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.minX, b.maxY],
    [b.maxX, b.maxY],
  ].map(([px, py]) => {
    const sx = px * u.meta.scale;
    const sy = py * u.meta.scale;
    return [u.meta.x + sx * Math.cos(r) - sy * Math.sin(r), u.meta.y + sx * Math.sin(r) + sy * Math.cos(r)];
  });
  return { minX: Math.min(...pts.map((q) => q[0])), minY: Math.min(...pts.map((q) => q[1])), maxX: Math.max(...pts.map((q) => q[0])), maxY: Math.max(...pts.map((q) => q[1])) };
}

function planSheet(f: Frame, p: Project, s: DrawingSettings): { sheet: Sheet; note?: string } {
  const metric = p.displayUnits === 'metric';
  const L = (ft: number) => fmt('length', ft, p.displayUnits, false);
  const nd = networkDrawing(p, store.result, 'plan', { sizes: s.sizes, lengths: s.lengths, elevations: s.elevations, nodes: s.nodes, fmtLength: L });
  const band = f.fs * 4.5; // título y barra de escala debajo
  const box = { ...f.area, h: f.area.h - band };
  let b = nd.bounds;
  const ub = s.underlay && store.project.underlay?.visible !== false ? underlayWorldBounds() : undefined;
  if (ub && p.nodes.length === 0) b = ub;
  else if (ub) {
    // el plano de fondo cuenta, pero sin dejar la red diminuta si el dibujo trae cosas muy lejos
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 10);
    b = {
      minX: Math.max(ub.minX, b.minX - span * 0.6),
      minY: Math.max(ub.minY, b.minY - span * 0.6),
      maxX: Math.min(ub.maxX, b.maxX + span * 0.6),
      maxY: Math.min(ub.maxY, b.maxY + span * 0.6),
    };
  }
  const marginFt = 2;
  const wFt = b.maxX - b.minX + 2 * marginFt;
  const hFt = b.maxY - b.minY + 2 * marginFt;
  let scale = fitScale(wFt, hFt, box.w, box.h, metric);
  let note: string | undefined;
  if (s.scale > 0) {
    const fixed = standardScales(metric).find((x) => x.n === s.scale) ?? { n: s.scale, label: `1:${s.scale}` };
    const k = 304.8 / fixed.n;
    if (wFt * k <= box.w * 1.001 && hFt * k <= box.h * 1.001) scale = fixed;
    else note = `La planta no cabe a ${fixed.label} en esta hoja: se usó ${scale.label}.`;
  }
  const k = 304.8 / scale.n;
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const map: Mapper = (x, y) => [cx + (x - mx) * k, cy - (y - my) * k];
  const parts: string[] = [];
  if (s.underlay && store.project.underlay?.visible !== false) parts.push(underlayImage(f, map, k));
  parts.push(drawNetwork(nd, map, f, { k, hangers: s.hangers, iso: false }));
  const ty = f.area.y + f.area.h - band + f.fs * 2;
  parts.push(`<text x="${n2(f.area.x)}" y="${n2(ty)}" font-size="${n2(f.fs * 1.3)}" font-weight="700">PLANTA DE LA RED DE ROCIADORES</text>`);
  parts.push(`<text x="${n2(f.area.x)}" y="${n2(ty + f.fs * 1.5)}" font-size="${n2(f.fs * 0.9)}">Escala ${esc(scale.label)}</text>`);
  parts.push(scaleBar(f.area.x + f.fs * 12, ty + f.fs * 0.6, k, f.fs, metric));
  return { sheet: { title: 'Planta de la red de rociadores', legend: 'plan', svg: parts.join(''), scale: scale.label }, note };
}

function isoSheet(f: Frame, p: Project, s: DrawingSettings): Sheet {
  const L = (ft: number) => fmt('length', ft, p.displayUnits, false);
  const nd = networkDrawing(p, store.result, 'iso', { sizes: s.sizes, lengths: s.lengths, elevations: false, nodes: s.nodes, fmtLength: L });
  const band = f.fs * 3;
  const box = { ...f.area, h: f.area.h - band };
  const b = nd.bounds;
  const wFt = Math.max(b.maxX - b.minX, 1);
  const hFt = Math.max(b.maxY - b.minY, 1);
  const k = Math.min((box.w * 0.92) / wFt, (box.h * 0.92) / hFt);
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const map: Mapper = (x, y) => [cx + (x - mx) * k, cy - (y - my) * k];
  const parts = [drawNetwork(nd, map, f, { k, hangers: false, iso: true })];
  const ty = f.area.y + f.area.h - band + f.fs * 2;
  parts.push(`<text x="${n2(f.area.x)}" y="${n2(ty)}" font-size="${n2(f.fs * 1.3)}" font-weight="700">ISOMÉTRICO DE LA RED</text>`);
  parts.push(`<text x="${n2(f.area.x + f.fs * 19)}" y="${n2(ty)}" font-size="${n2(f.fs * 0.9)}">Sin escala · los rociadores en rojo son los del área de diseño</text>`);
  return { title: 'Isométrico de la red', legend: 'iso', svg: parts.join(''), scale: 'Sin escala' };
}

function dataSheet(f: Frame, p: Project, s: DrawingSettings): Sheet {
  const r = store.result;
  const u = p.displayUnits;
  const c = p.criteria;
  const kv = (rows: [string, string][]) => h('table', { class: 'ds-kv' }, h('tbody', null, rows.map(([a, b]) => h('tr', null, h('th', null, a), h('td', null, b)))));
  const blocks: HTMLElement[] = [];
  // placa de datos hidráulicos (NFPA 13)
  const sup = r.ok ? r.supply : undefined;
  blocks.push(
    h(
      'section',
      { class: 'ds-placard' },
      h('h3', null, 'Placa de datos hidráulicos'),
      kv([
        ['Ubicación del área de diseño', 'Ver planta (área de diseño)'],
        ['Clasificación de riesgo', HAZARD_NAMES[c.hazard]],
        ['Tipo de sistema', SYSTEM_TYPE_NAMES[c.systemType ?? 'wet']],
        ['Densidad de diseño', fmt('density', c.density, u, true)],
        ['Área de diseño', fmt('area', effectiveDesignArea(p), u, true)],
        ['Rociadores abiertos', String(p.sprinklers.filter((x) => x.inDesignArea).length)],
        ['Caudal de rociadores', r.ok ? fmt('flow', r.sprinklerFlow + r.fixedFlow, u, true) : '—'],
        ['Asignación de mangueras', fmt('flow', c.hoseAllowance, u, true)],
        ['Demanda en el suministro', sup ? `${fmt('flow', sup.demandFlow, u, true)} a ${fmt('pressure', sup.demandPressure, u, true)}` : '—'],
        ['Duración', `${c.duration} min`],
        ['Fecha del cálculo', new Date().toLocaleDateString('es-CO')],
        ['Diseñó', p.info.designer || '—'],
      ]),
    ),
  );
  // suministro
  if (sup) {
    const chart = h('div', { class: 'ds-chart' });
    chart.innerHTML = supplyChartSvg(r, u, 360, 230, {}, p.supply);
    blocks.push(
      h(
        'section',
        null,
        h('h3', null, 'Suministro de agua'),
        kv([
          [sup.source === 'tank' ? 'Fuente' : 'Prueba de hidrante', sup.source === 'tank' ? 'Tanque' : `${fmt('pressure', sup.staticPressure, u, true)} estática · ${fmt('pressure', sup.residualPressure, u, true)} con ${fmt('flow', sup.residualFlow, u, true)}`],
          ...(sup.pump ? ([['Bomba', `${fmt('flow', sup.pump.ratedFlow, u, true)} a ${fmt('pressure', sup.pump.ratedPressure, u, true)}`]] as [string, string][]) : []),
          ['Presión disponible', fmt('pressure', sup.availablePressure, u, true)],
          ['Margen', `${fmt('pressure', sup.margin, u, true)} ${sup.pass ? '(cumple)' : '(NO CUMPLE)'}`],
        ]),
        chart,
      ),
    );
  }
  // cuadro de rociadores
  const groups = new Map<string, { name: string; k: number; o: SprinklerOrientation; t?: number; resp?: string; n: number }>();
  for (const sp of p.sprinklers) {
    const m = getSprinklerModel(sp.modelId, p);
    const key = `${sp.modelId ?? ''}|${sp.k}|${sp.orientation}|${sp.temperatureC ?? ''}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { name: m?.name ?? sp.model ?? `K${sp.k}`, k: sp.k, o: sp.orientation, t: sp.temperatureC ?? m?.temperatureC, resp: m?.response === 'quick' ? 'Rápida' : m?.response === 'standard' ? 'Estándar' : '—', n: 1 });
  }
  if (groups.size) {
    const sym = (o: SprinklerOrientation) => {
      const d = h('span', { class: 'ds-sym' });
      d.innerHTML = `<svg viewBox="-3 -3 6 6" width="4mm" height="4mm">${headSymbol(0, 0, 2.2, o)}</svg>`;
      return d;
    };
    blocks.push(
      h(
        'section',
        null,
        h('h3', null, 'Cuadro de rociadores'),
        h(
          'table',
          { class: 'ds-grid' },
          h('thead', null, h('tr', null, ['', 'Modelo', 'K', 'Tipo', 'Temp.', 'Resp.', 'Cant.'].map((x) => h('th', null, x)))),
          h(
            'tbody',
            null,
            [...groups.values()].map((g) =>
              h('tr', null, h('td', null, sym(g.o)), h('td', null, g.name), h('td', null, String(g.k)), h('td', null, ORIENTATION_NAMES[g.o]), h('td', null, g.t ? `${g.t} °C` : '—'), h('td', null, g.resp ?? '—'), h('td', null, String(g.n))),
            ),
          ),
        ),
      ),
    );
  }
  // tubería y materiales principales
  const bom = buildBom(p);
  const pipes = bom.items.filter((x) => x.category === 'Tubería');
  const rest = bom.items.filter((x) => x.category !== 'Tubería' && x.category !== 'Rociadores');
  if (pipes.length || rest.length) {
    const rows = [...pipes.map((x) => [x.description, x.lengthFt !== undefined ? fmt('length', x.lengthFt, u, true) : `${x.quantity} ${x.unit}`]), ...rest.slice(0, 30).map((x) => [x.description, `${x.quantity} ${x.unit}`])];
    blocks.push(
      h(
        'section',
        null,
        h('h3', null, 'Materiales'),
        h('table', { class: 'ds-grid' }, h('tbody', null, rows.map(([a, b]) => h('tr', null, h('td', null, a), h('td', { class: 'num' }, b))))),
        rest.length > 30 ? h('p', { class: 'ds-small' }, `… y ${rest.length - 30} ítems más (lista completa en la memoria de cálculo).`) : null,
      ),
    );
  }
  // notas
  const notes = s.notes.split('\n').map((x) => x.trim()).filter(Boolean);
  if (notes.length) blocks.push(h('section', null, h('h3', null, 'Notas generales'), h('ol', null, notes.map((n) => h('li', null, n)))));
  // revisión
  const rv = currentReview();
  const shown = rv.findings.filter((x) => x.severity !== 'info');
  blocks.push(
    h(
      'section',
      null,
      h('h3', null, 'Revisión NFPA 13'),
      h('p', null, shown.length ? `${rv.errors} incumplimiento(s) y ${rv.warnings} aviso(s) pendientes:` : 'Sin incumplimientos en las reglas revisadas por el programa.'),
      shown.length ? h('ul', null, shown.slice(0, 8).map((x) => h('li', null, `${RULE_NAMES[x.rule]}: ${x.message}`))) : null,
    ),
  );
  const html = h('div', { class: 'ds-body' }, blocks);
  html.style.left = `${f.area.x}mm`;
  html.style.top = `${f.area.y}mm`;
  html.style.width = `${f.area.w}mm`;
  html.style.height = `${f.area.h}mm`;
  html.style.fontSize = `${Math.min(3.2, Math.max(2.1, f.fs * 1.05))}mm`;
  html.style.columnCount = String(f.W > 500 ? 3 : 2);
  return { title: 'Datos hidráulicos, materiales y notas', svg: '', html };
}

/** Arma las hojas en `root`. Devuelve avisos (p. ej. escala cambiada). */
export function buildSheets(root: HTMLElement, s: DrawingSettings): { paper: PaperSize; notes: string[]; count: number } {
  const p = store.project;
  const paper = PAPER_SIZES.find((x) => x.id === s.paper) ?? PAPER_SIZES[4];
  const f = frameOf(paper);
  const sheets: Sheet[] = [];
  const notes: string[] = [];
  if (s.sheets.plan) {
    const r = planSheet(f, p, s);
    sheets.push(r.sheet);
    if (r.note) notes.push(r.note);
  }
  if (s.sheets.iso && p.pipes.length) sheets.push(isoSheet(f, p, s));
  if (s.sheets.data) sheets.push(dataSheet(f, p, s));
  const pages = sheets.map((sh, i) => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.w}mm" height="${paper.h}mm" viewBox="0 0 ${paper.w} ${paper.h}" font-family="Arial, Helvetica, sans-serif">` +
      `<rect x="${f.m}" y="${f.m}" width="${n2(paper.w - 2 * f.m)}" height="${n2(paper.h - 2 * f.m)}" fill="none" stroke="#000" stroke-width="0.6"/>` +
      `<defs><clipPath id="area${i}"><rect x="${n2(f.area.x)}" y="${n2(f.area.y)}" width="${n2(f.area.w)}" height="${n2(f.area.h)}"/></clipPath></defs>` +
      `<g clip-path="url(#area${i})">${sh.svg}</g>` +
      titleBlock(f, p, s, sh, i + 1, sheets.length) +
      `</svg>`;
    const page = h('div', { class: 'sheet' });
    page.style.width = `${paper.w}mm`;
    page.style.height = `${paper.h}mm`;
    page.innerHTML = svg;
    if (sh.html) page.append(sh.html);
    return page;
  });
  clear(root, h('div', { class: 'sheets' }, pages));
  return { paper, notes, count: sheets.length };
}

// ---------- Ventana de opciones ----------
let dlg: HTMLDialogElement | null = null;

export function openDrawingsDialog() {
  if (!dlg) {
    dlg = h('dialog', { class: 'drawings-dialog', 'aria-label': 'Planos de entrega' });
    document.body.append(dlg);
  }
  const s = drawingSettings(store.project);
  const metric = store.project.displayUnits === 'metric';
  const set = (fn: (d: DrawingSettings) => void) =>
    store.mutate((p) => {
      const d = drawingSettings(p);
      fn(d);
      p.drawings = d;
    }, 'drawings');
  const sel = (label: string, value: string, options: [string, string][], on: (v: string) => void) => {
    const el = h('select', null, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
    el.addEventListener('change', () => on(el.value));
    return h('label', { class: 'field select' }, h('span', null, label), el);
  };
  const check = (label: string, value: boolean, on: (v: boolean) => void) => {
    const el = h('input', { type: 'checkbox', checked: value });
    el.addEventListener('change', () => on(el.checked));
    return h('label', { class: 'check' }, el, label);
  };
  const textField = (label: string, value: string, on: (v: string) => void, placeholder = '') => {
    const el = h('input', { type: 'text', value, placeholder });
    el.addEventListener('change', () => on(el.value));
    return h('label', { class: 'field' }, h('span', null, label), el);
  };
  const notes = h('textarea', { rows: '6' }, s.notes);
  notes.addEventListener('change', () => set((d) => (d.notes = notes.value)));
  const go = h('button', { class: 'btn primary' }, 'Generar PDF');
  go.addEventListener('click', async () => {
    go.setAttribute('disabled', '');
    go.textContent = 'Generando…';
    try {
      await exportDrawings();
      dlg!.close();
    } finally {
      go.removeAttribute('disabled');
      go.textContent = 'Generar PDF';
    }
  });
  clear(
    dlg,
    h('header', null, h('h2', null, 'Planos de entrega'), h('button', { class: 'btn outline small', onclick: () => dlg!.close() }, 'Cerrar')),
    h(
      'div',
      { class: 'drawings-body' },
      h(
        'div',
        null,
        h('h3', null, 'Hoja'),
        sel('Tamaño', s.paper, PAPER_SIZES.map((x) => [x.id, x.name]), (v) => set((d) => (d.paper = v))),
        sel('Escala de la planta', String(s.scale), [['0', 'La que quepa'], ...standardScales(metric).map((x) => [String(x.n), x.label] as [string, string])], (v) => set((d) => (d.scale = Number(v)))),
        h('h3', null, 'Hojas'),
        check('Planta con el plano de fondo', s.sheets.plan, (v) => set((d) => (d.sheets.plan = v))),
        check('Isométrico', s.sheets.iso, (v) => set((d) => (d.sheets.iso = v))),
        check('Datos hidráulicos, materiales y notas', s.sheets.data, (v) => set((d) => (d.sheets.data = v))),
        h('h3', null, 'Qué mostrar'),
        check('Plano de fondo (en gris)', s.underlay, (v) => set((d) => (d.underlay = v))),
        check('Diámetros', s.sizes, (v) => set((d) => (d.sizes = v))),
        check('Largos de los tramos', s.lengths, (v) => set((d) => (d.lengths = v))),
        check('Elevaciones', s.elevations, (v) => set((d) => (d.elevations = v))),
        check('Nodos del cálculo', s.nodes, (v) => set((d) => (d.nodes = v))),
        check('Soportes', s.hangers, (v) => set((d) => (d.hangers = v))),
      ),
      h(
        'div',
        null,
        h('h3', null, 'Rótulo'),
        textField('Empresa', s.company ?? '', (v) => set((d) => (d.company = v || undefined)), 'Sistema de rociadores automáticos'),
        textField('Revisó', s.checkedBy ?? '', (v) => set((d) => (d.checkedBy = v || undefined))),
        textField('Revisión', s.revision, (v) => set((d) => (d.revision = v))),
        h('p', { class: 'muted-text' }, 'Proyecto, cliente, dirección y diseñador se toman de los datos del proyecto.'),
        h('h3', null, 'Notas generales'),
        notes,
        h('p', { class: 'muted-text' }, 'Una nota por línea.'),
      ),
    ),
    h('footer', null, go),
  );
  if (!dlg.open) dlg.showModal();
}

/**
 * Espera a que las imágenes de las hojas estén cargadas: las hojas se muestran fuera de la
 * pantalla mientras tanto, porque el PDF no espera a que se decodifiquen.
 */
export async function sheetsReady(root: HTMLElement) {
  root.classList.add('preparing');
  const imgs = [...root.querySelectorAll('image')];
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          const href = img.getAttribute('href') ?? '';
          const probe = new Image();
          probe.onload = probe.onerror = () => resolve();
          probe.src = href;
          probe.decode?.().then(() => resolve(), () => resolve());
          setTimeout(resolve, 15000);
        }),
    ),
  );
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 300));
  root.classList.remove('preparing');
}

export async function exportDrawings() {
  store.recalcNow();
  const s = drawingSettings(store.project);
  const root = document.getElementById('print-root')!;
  const res = buildSheets(root, s);
  // tamaño de página del PDF: el de la hoja
  let style = document.getElementById('sheet-page') as HTMLStyleElement | null;
  if (!style) {
    style = h('style', { id: 'sheet-page' }) as HTMLStyleElement;
    document.head.append(style);
  }
  style.textContent = `@page { size: ${res.paper.w}mm ${res.paper.h}mm; margin: 0 }`;
  await document.fonts.ready;
  await sheetsReady(root);
  try {
    await drawingsHooks.export(`Planos - ${store.project.info.name || 'proyecto'}`, res.paper);
  } finally {
    style.textContent = '';
  }
  return res;
}

