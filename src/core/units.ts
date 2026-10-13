/**
 * Unidades.
 *
 * El motor calcula SIEMPRE en unidades US (las de las fórmulas de NFPA 13):
 *   caudal gpm · presión psi · longitud ft · diámetro in · densidad gpm/ft² · área ft²
 *   factor K en gpm/psi^0.5 · velocidad ft/s
 *
 * La interfaz puede mostrar en métrico; estas funciones convierten solo para mostrar
 * y para leer lo que escribe el usuario.
 */

export type UnitSystem = 'metric' | 'us';

export const CONV = {
  /** 1 psi en bar */
  PSI_TO_BAR: 0.0689475729,
  /** 1 gpm en L/min */
  GPM_TO_LPM: 3.785411784,
  /** 1 ft en m */
  FT_TO_M: 0.3048,
  /** 1 in en mm */
  IN_TO_MM: 25.4,
  /** 1 ft² en m² */
  FT2_TO_M2: 0.09290304,
  /** 1 gpm/ft² en mm/min (= L/min/m²) */
  DENSITY_US_TO_SI: 40.74583,
  /** K en (L/min)/bar^0.5 = K_US × 14.4 (valor exacto ≈ 14.4163; NFPA usa 14.4) */
  K_US_TO_SI: 14.4,
  /** 1 ft/s en m/s */
  FPS_TO_MPS: 0.3048,
  /** 1 galón US en litros */
  GAL_TO_L: 3.785411784,
} as const;

/** Presión de una columna de agua: psi por cada pie de altura. */
export const PSI_PER_FT_WATER = 0.433;

export interface QuantityDef {
  us: string;
  metric: string;
  /** factor que multiplica el valor US para obtener el valor métrico */
  factor: number;
  /** decimales sugeridos al mostrar */
  digits: { us: number; metric: number };
}

export const QUANTITIES = {
  flow: { us: 'gpm', metric: 'L/min', factor: CONV.GPM_TO_LPM, digits: { us: 1, metric: 0 } },
  pressure: { us: 'psi', metric: 'bar', factor: CONV.PSI_TO_BAR, digits: { us: 2, metric: 3 } },
  length: { us: 'ft', metric: 'm', factor: CONV.FT_TO_M, digits: { us: 2, metric: 2 } },
  elevation: { us: 'ft', metric: 'm', factor: CONV.FT_TO_M, digits: { us: 2, metric: 2 } },
  diameter: { us: 'in', metric: 'mm', factor: CONV.IN_TO_MM, digits: { us: 3, metric: 1 } },
  area: { us: 'ft²', metric: 'm²', factor: CONV.FT2_TO_M2, digits: { us: 0, metric: 1 } },
  density: { us: 'gpm/ft²', metric: 'mm/min', factor: CONV.DENSITY_US_TO_SI, digits: { us: 3, metric: 2 } },
  kfactor: { us: 'gpm/psi½', metric: 'L/min/bar½', factor: CONV.K_US_TO_SI, digits: { us: 1, metric: 0 } },
  velocity: { us: 'ft/s', metric: 'm/s', factor: CONV.FPS_TO_MPS, digits: { us: 1, metric: 2 } },
  volume: { us: 'gal', metric: 'L', factor: CONV.GAL_TO_L, digits: { us: 0, metric: 0 } },
  frictionRate: { us: 'psi/ft', metric: 'bar/m', factor: CONV.PSI_TO_BAR / CONV.FT_TO_M, digits: { us: 4, metric: 4 } },
} satisfies Record<string, QuantityDef>;

export type Quantity = keyof typeof QUANTITIES;

/** Convierte un valor interno (US) al sistema pedido. */
export function toDisplay(q: Quantity, valueUS: number, system: UnitSystem): number {
  return system === 'us' ? valueUS : valueUS * QUANTITIES[q].factor;
}

/** Convierte un valor escrito por el usuario (en el sistema pedido) a US interno. */
export function fromDisplay(q: Quantity, value: number, system: UnitSystem): number {
  return system === 'us' ? value : value / QUANTITIES[q].factor;
}

export function unitLabel(q: Quantity, system: UnitSystem): string {
  return QUANTITIES[q][system];
}

/** Formatea un valor interno para mostrarlo, con su unidad opcional. */
export function fmt(q: Quantity, valueUS: number, system: UnitSystem, withUnit = false, digits?: number): string {
  if (!Number.isFinite(valueUS)) return '—';
  const v = toDisplay(q, valueUS, system);
  const d = digits ?? QUANTITIES[q].digits[system];
  const s = v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  return withUnit ? `${s} ${unitLabel(q, system)}` : s;
}
