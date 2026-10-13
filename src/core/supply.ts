/**
 * Fuentes de agua y bomba contra incendio.
 *
 *  - Red pública (prueba de hidrante): P(Q) = Pe − (Pe − Pr)·(Q/Qr)^1.85
 *  - Tanque: la presión es la de la columna de agua sobre el punto de suministro (0,433 psi/ft);
 *    no depende del caudal (las pérdidas de la succión se desprecian).
 *  - Bomba (NFPA 20): curva por tres puntos — a caudal cero (churn, ≤ 140 % de la nominal),
 *    al caudal nominal (100 %) y al 150 % del caudal (≥ 65 % de la nominal). Entre puntos se
 *    une con rectas, lo que queda por debajo de la curva real (del lado seguro).
 *  - Lo disponible en el punto de suministro es la fuente más la presión neta de la bomba.
 */
import { supplyPressureAt } from './hydraulics';
import type { FirePump, WaterSupply } from './model';
import { PSI_PER_FT_WATER } from './units';

/** Caudales nominales de bombas contra incendio (NFPA 20), gpm */
export const PUMP_RATINGS = [25, 50, 100, 150, 200, 250, 300, 400, 450, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

export const defaultPump = (): FirePump => ({ enabled: true, ratedFlow: 500, ratedPressure: 100, churnPct: 120, at150Pct: 65 });

/** Presión neta que da la bomba a un caudal (psi) */
export function pumpNetPressure(pump: FirePump, q: number): number {
  const qr = pump.ratedFlow;
  const pr = pump.ratedPressure;
  const p0 = (pump.churnPct / 100) * pr;
  const p15 = (pump.at150Pct / 100) * pr;
  const x = Math.max(0, q);
  if (x <= qr) return p0 + ((pr - p0) * x) / qr;
  // del 100 % al 150 %, y más allá se sigue la misma recta hasta cero
  return Math.max(0, pr + ((p15 - pr) * (x - qr)) / (0.5 * qr));
}

/** Presión de la fuente (red o tanque) sin la bomba, psi */
export function sourcePressureAt(s: WaterSupply, q: number): number {
  if (s.source === 'tank') return PSI_PER_FT_WATER * (s.tankHeadFt ?? 0);
  return supplyPressureAt(q, s.staticPressure, s.residualPressure, s.residualFlow);
}

/** Presión disponible en el punto de suministro (fuente + bomba), psi */
export function availablePressureAt(s: WaterSupply, q: number): number {
  return sourcePressureAt(s, q) + (s.pump?.enabled ? pumpNetPressure(s.pump, q) : 0);
}

/** Caudal máximo que el suministro da a una presión (la curva baja con el caudal) */
export function availableFlowAt(s: WaterSupply, p: number): number {
  if (availablePressureAt(s, 0) <= p) return 0;
  let hi = 100;
  for (let i = 0; i < 60 && availablePressureAt(s, hi) > p; i++) hi *= 2;
  if (availablePressureAt(s, hi) > p) return Infinity; // tanque sin bomba: no depende del caudal
  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (availablePressureAt(s, m) > p) lo = m;
    else hi = m;
  }
  return lo;
}

/** Puntos de las curvas para la gráfica (caudal en gpm, presión en psi) */
export function supplyCurves(s: WaterSupply, qMax: number, n = 48): { source: [number, number][]; pump?: [number, number][]; total: [number, number][] } {
  const qs: number[] = [];
  for (let i = 0; i <= n; i++) qs.push((qMax * i) / n);
  // puntos exactos de la curva de la bomba para que se vean los quiebres
  if (s.pump?.enabled) for (const f of [1, 1.5]) if (s.pump.ratedFlow * f < qMax) qs.push(s.pump.ratedFlow * f);
  qs.sort((a, b) => a - b);
  const clip = (p: number) => Math.max(0, p);
  return {
    source: qs.map((q) => [q, clip(sourcePressureAt(s, q))]),
    pump: s.pump?.enabled ? qs.map((q) => [q, pumpNetPressure(s.pump!, q)]) : undefined,
    total: qs.map((q) => [q, clip(availablePressureAt(s, q))]),
  };
}

export interface PumpSuggestion {
  /** null si la fuente sola alcanza */
  pump: FirePump | null;
  /** presión que le falta a la fuente con el caudal de la demanda (psi) */
  deficit: number;
}

/**
 * Bomba mínima para una demanda: el caudal nominal más pequeño que cubre la demanda y la presión
 * nominal (redondeada a 5 psi) que suma lo que le falta a la fuente, con el margen pedido.
 * Hasta el caudal nominal la bomba da al menos su presión nominal.
 */
export function suggestPump(s: WaterSupply, demandFlow: number, demandPressure: number, margin: number): PumpSuggestion {
  const deficit = demandPressure + margin - sourcePressureAt(s, demandFlow);
  if (deficit <= 0) return { pump: null, deficit };
  const ratedFlow = PUMP_RATINGS.find((r) => r >= demandFlow) ?? Math.ceil(demandFlow / 500) * 500;
  const ratedPressure = Math.ceil(deficit / 5) * 5;
  return { pump: { ...(s.pump ?? defaultPump()), enabled: true, ratedFlow, ratedPressure }, deficit };
}
