/**
 * Gráfica de suministro contra demanda en papel hidráulico N^1.85
 * (el eje horizontal está en escala Q^1.85, así la curva del suministro es una recta).
 */
import { fmt, toDisplay, unitLabel, type CalcResult, type UnitSystem } from '../../core';

export interface ChartColors {
  ink: string;
  muted: string;
  grid: string;
  supply: string;
  demand: string;
  pass: string;
  fail: string;
  font: string;
}

const DEFAULT: ChartColors = {
  ink: '#1d2731',
  muted: '#5d6b78',
  grid: '#d5dbe0',
  supply: '#2e7fb8',
  demand: '#c8102e',
  pass: '#2f8f5b',
  fail: '#c8102e',
  font: 'Barlow, sans-serif',
};

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function supplyChartSvg(result: CalcResult, units: UnitSystem, width = 340, height = 230, colors: Partial<ChartColors> = {}): string {
  const c = { ...DEFAULT, ...colors };
  const s = result.supply;
  if (!result.ok || !s) return '';
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;

  // dominio en unidades de pantalla (métrico o US)
  const qDisp = (q: number) => toDisplay('flow', q, units);
  const pDisp = (p: number) => toDisplay('pressure', p, units);
  const qMaxUS = Math.max(s.residualFlow * 1.2, s.demandFlow * 1.35);
  const qMax = qDisp(qMaxUS);
  const pMax = pDisp(Math.max(s.staticPressure, s.demandPressure) * 1.12);
  const X = (qUS: number) => pad.l + Math.pow(Math.max(0, qDisp(qUS)) / qMax, 1.85) * W;
  const Y = (pUS: number) => pad.t + H - (pDisp(pUS) / pMax) * H;

  const parts: string[] = [];
  const txt = (x: number, y: number, t: string, anchor = 'middle', size = 10, fill = c.muted, weight = 400) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="${c.font}">${t}</text>`;

  // cuadrícula vertical (caudal) — en escala N^1.85 las marcas quedan desiguales
  const qStep = niceStep(qMax, 5);
  for (let q = qStep; q <= qMax + 1e-9; q += qStep) {
    const x = pad.l + Math.pow(q / qMax, 1.85) * W;
    parts.push(`<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + H}" stroke="${c.grid}" stroke-width="1"/>`);
    parts.push(txt(x, pad.t + H + 13, q.toLocaleString('es-CO', { maximumFractionDigits: 0 })));
  }
  const pStep = niceStep(pMax, 5);
  for (let p = 0; p <= pMax + 1e-9; p += pStep) {
    const y = pad.t + H - (p / pMax) * H;
    parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + W}" y2="${y}" stroke="${c.grid}" stroke-width="1"/>`);
    parts.push(txt(pad.l - 6, y + 3.5, p.toLocaleString('es-CO', { maximumFractionDigits: units === 'metric' ? 1 : 0 }), 'end'));
  }
  parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${W}" height="${H}" fill="none" stroke="${c.muted}" stroke-width="1"/>`);
  parts.push(txt(pad.l + W / 2, height - 4, `Caudal (${unitLabel('flow', units)}), escala N^1.85`));
  parts.push(
    `<text transform="translate(11 ${pad.t + H / 2}) rotate(-90)" text-anchor="middle" font-size="10" fill="${c.muted}" font-family="${c.font}">Presión (${unitLabel('pressure', units)})</text>`,
  );

  // curva de suministro (recta en este papel)
  const pAtQmax = s.staticPressure - (s.staticPressure - s.residualPressure) * Math.pow(qMaxUS / s.residualFlow, 1.85);
  const endP = Math.max(pAtQmax, 0);
  const endQ = pAtQmax >= 0 ? qMaxUS : s.residualFlow * Math.pow(s.staticPressure / (s.staticPressure - s.residualPressure), 1 / 1.85);
  parts.push(
    `<line x1="${X(0)}" y1="${Y(s.staticPressure)}" x2="${X(endQ)}" y2="${Y(endP)}" stroke="${c.supply}" stroke-width="2.2"/>`,
  );
  parts.push(`<circle cx="${X(s.residualFlow)}" cy="${Y(s.residualPressure)}" r="3.2" fill="${c.supply}"/>`);

  // demanda: rociadores → + mangueras
  const qSpk = s.demandFlow - result.hoseAllowance;
  const ok = s.pass;
  parts.push(
    `<line x1="${X(qSpk)}" y1="${Y(s.demandPressure)}" x2="${X(s.demandFlow)}" y2="${Y(s.demandPressure)}" stroke="${c.demand}" stroke-width="1.6" stroke-dasharray="4 3"/>`,
  );
  parts.push(`<circle cx="${X(qSpk)}" cy="${Y(s.demandPressure)}" r="3.6" fill="#fff" stroke="${c.demand}" stroke-width="1.8"/>`);
  parts.push(`<circle cx="${X(s.demandFlow)}" cy="${Y(s.demandPressure)}" r="4.6" fill="${c.demand}"/>`);
  // margen
  parts.push(
    `<line x1="${X(s.demandFlow)}" y1="${Y(s.demandPressure)}" x2="${X(s.demandFlow)}" y2="${Y(s.availablePressure)}" stroke="${ok ? c.pass : c.fail}" stroke-width="2"/>`,
  );
  const labelY = (Y(s.demandPressure) + Y(s.availablePressure)) / 2 + 3;
  const right = X(s.demandFlow) > pad.l + W * 0.7;
  parts.push(
    txt(X(s.demandFlow) + (right ? -6 : 6), labelY, `margen ${fmt('pressure', s.margin, units, true)}`, right ? 'end' : 'start', 10, ok ? c.pass : c.fail, 600),
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Gráfica de suministro contra demanda">${parts.join('')}</svg>`;
}
