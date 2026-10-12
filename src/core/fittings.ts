/**
 * Longitudes equivalentes de accesorios y válvulas.
 *
 * Tabla base: NFPA 13, "Equivalent Schedule 40 Steel Pipe Length Chart" (pies),
 * válida para acero Schedule 40 con C = 120.
 *
 * Ajustes que exige la norma:
 *  1. Si C ≠ 120 se multiplica por un factor (C=100 → 0.713, 130 → 1.16, 140 → 1.33, 150 → 1.51).
 *  2. Si el diámetro interno no es el de Schedule 40 se multiplica por (d_real / d_sch40)^4.87.
 */
import { MATERIALS, type NominalSize } from './pipes';

export type FittingType =
  | 'elbow45'
  | 'elbow90'
  | 'elbow90long'
  | 'tee'
  | 'butterfly'
  | 'gate'
  | 'check';

export const FITTING_NAMES: Record<FittingType, string> = {
  elbow45: 'Codo 45°',
  elbow90: 'Codo 90° estándar',
  elbow90long: 'Codo 90° radio largo',
  tee: 'Tee o cruz (flujo a 90°)',
  butterfly: 'Válvula mariposa',
  gate: 'Válvula de compuerta',
  check: 'Válvula de retención (cheque)',
};

/** Accesorios que son válvulas (se listan aparte en materiales). */
export const VALVE_TYPES: FittingType[] = ['butterfly', 'gate', 'check'];

type Row = Partial<Record<NominalSize, number>>;

// Pies de tubo Schedule 40 equivalentes (C = 120)
const TABLE: Record<FittingType, Row> = {
  elbow45: { '3/4': 1, '1': 1, '1-1/4': 1, '1-1/2': 2, '2': 2, '2-1/2': 3, '3': 3, '3-1/2': 3, '4': 4, '5': 5, '6': 7, '8': 9, '10': 11, '12': 13 },
  elbow90: { '3/4': 2, '1': 2, '1-1/4': 3, '1-1/2': 4, '2': 5, '2-1/2': 6, '3': 7, '3-1/2': 8, '4': 10, '5': 12, '6': 14, '8': 18, '10': 22, '12': 27 },
  elbow90long: { '3/4': 1, '1': 2, '1-1/4': 2, '1-1/2': 2, '2': 3, '2-1/2': 4, '3': 5, '3-1/2': 5, '4': 6, '5': 8, '6': 9, '8': 13, '10': 16, '12': 18 },
  tee: { '3/4': 3, '1': 5, '1-1/4': 6, '1-1/2': 8, '2': 10, '2-1/2': 12, '3': 15, '3-1/2': 17, '4': 20, '5': 25, '6': 30, '8': 35, '10': 50, '12': 60 },
  butterfly: { '2': 6, '2-1/2': 7, '3': 10, '4': 12, '5': 9, '6': 10, '8': 12, '10': 19, '12': 21 },
  gate: { '2': 1, '2-1/2': 1, '3': 1, '3-1/2': 1, '4': 2, '5': 2, '6': 3, '8': 4, '10': 5, '12': 6 },
  check: { '1': 5, '1-1/4': 7, '1-1/2': 9, '2': 11, '2-1/2': 14, '3': 16, '3-1/2': 19, '4': 22, '5': 27, '6': 32, '8': 45, '10': 55, '12': 65 },
};

/** Factor de ajuste por coeficiente C (NFPA 13). Interpolación lineal entre valores de la tabla. */
export function cFactorMultiplier(c: number): number {
  const pts: [number, number][] = [
    [100, 0.713],
    [120, 1.0],
    [130, 1.16],
    [140, 1.33],
    [150, 1.51],
  ];
  if (c <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [c1, m1] = pts[i];
    const [c0, m0] = pts[i - 1];
    if (c <= c1) return m0 + ((c - c0) / (c1 - c0)) * (m1 - m0);
  }
  // Por encima de 150 se extrapola con la relación teórica (C/120)^1.85
  return Math.pow(c / 120, 1.85);
}

/** Longitud equivalente de la tabla (ft), sin ajustes; undefined si no existe para ese tamaño. */
export function tableEquivalentLength(type: FittingType, size: NominalSize): number | undefined {
  return TABLE[type][size];
}

/**
 * Longitud equivalente ajustada (ft) para un accesorio instalado en un tubo con
 * diámetro interno `idIn` y coeficiente `c`.
 */
export function equivalentLength(type: FittingType, size: NominalSize, c: number, idIn: number): number {
  const base = TABLE[type][size];
  if (base === undefined) return 0;
  const sch40 = MATERIALS['steel-sch40'].id_in[size] ?? idIn;
  const diameterAdj = Math.pow(idIn / sch40, 4.87);
  return base * cFactorMultiplier(c) * diameterAdj;
}
