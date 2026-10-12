/**
 * Fórmulas hidráulicas básicas de NFPA 13 (unidades US).
 */
import { PSI_PER_FT_WATER } from './units';

/**
 * Pérdida por fricción de Hazen-Williams, psi por pie de tubo.
 *   p = 4.52 · Q^1.85 / (C^1.85 · d^4.87)
 * @param q caudal gpm (se usa su valor absoluto)
 * @param c coeficiente C
 * @param d diámetro interno en pulgadas
 */
export function frictionLossPerFt(q: number, c: number, d: number): number {
  const a = Math.abs(q);
  if (a === 0) return 0;
  return (4.52 * Math.pow(a, 1.85)) / (Math.pow(c, 1.85) * Math.pow(d, 4.87));
}

/**
 * Resistencia R de un tubo: pérdida total (psi) = R · Q^1.85
 * @param lengthFt longitud total (real + equivalente de accesorios), ft
 */
export function pipeResistance(lengthFt: number, c: number, d: number): number {
  return (4.52 * lengthFt) / (Math.pow(c, 1.85) * Math.pow(d, 4.87));
}

/** Caudal de un rociador: Q = K · √P */
export function sprinklerFlow(k: number, pressurePsi: number): number {
  return pressurePsi > 0 ? k * Math.sqrt(pressurePsi) : 0;
}

/** Presión necesaria para que un rociador descargue Q: P = (Q/K)² */
export function sprinklerPressure(k: number, flowGpm: number): number {
  return (flowGpm / k) ** 2;
}

/** Velocidad en el tubo, ft/s:  V = 0.4085 · Q / d² */
export function velocity(q: number, d: number): number {
  return (0.4085 * Math.abs(q)) / (d * d);
}

/** Diferencia de presión por elevación (psi). Positiva si el destino está más alto. */
export function elevationLoss(zFromFt: number, zToFt: number): number {
  return PSI_PER_FT_WATER * (zToFt - zFromFt);
}

/**
 * Curva de suministro de agua (prueba de hidrante), forma N^1.85 de NFPA:
 *   P(Q) = Ps − (Ps − Pr) · (Q / Qr)^1.85
 */
export function supplyPressureAt(q: number, staticP: number, residualP: number, residualQ: number): number {
  return staticP - (staticP - residualP) * Math.pow(Math.max(q, 0) / residualQ, 1.85);
}

/** Caudal disponible a una presión dada según la curva de suministro. */
export function supplyFlowAt(p: number, staticP: number, residualP: number, residualQ: number): number {
  if (p >= staticP) return 0;
  return residualQ * Math.pow((staticP - p) / (staticP - residualP), 1 / 1.85);
}
