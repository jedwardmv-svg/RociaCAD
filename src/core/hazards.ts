/**
 * Criterios de diseño por clasificación de riesgo (método densidad/área de NFPA 13).
 *
 * Se usan los puntos de 1500 ft² (riesgo leve y ordinario) y 2500 ft² (riesgo extra)
 * de las curvas densidad/área, y las asignaciones de mangueras y duraciones mínimas típicas.
 * Son valores de partida: el diseñador debe confirmarlos contra la edición de NFPA 13
 * (o la norma local, p. ej. NSR-10 Título J en Colombia) que exija la autoridad competente.
 */

export type HazardId = 'light' | 'oh1' | 'oh2' | 'eh1' | 'eh2' | 'custom';

export interface HazardPreset {
  id: HazardId;
  name: string;
  /** gpm/ft² */
  density: number;
  /** ft² */
  area: number;
  /** gpm (mangueras interiores + exteriores combinadas) */
  hoseAllowance: number;
  /** minutos */
  duration: number;
  /** cobertura máxima por rociador estándar, ft² */
  maxCoverage: number;
}

export const HAZARDS: Record<Exclude<HazardId, 'custom'>, HazardPreset> = {
  light: { id: 'light', name: 'Riesgo leve', density: 0.1, area: 1500, hoseAllowance: 100, duration: 30, maxCoverage: 225 },
  oh1: { id: 'oh1', name: 'Riesgo ordinario grupo 1', density: 0.15, area: 1500, hoseAllowance: 250, duration: 60, maxCoverage: 130 },
  oh2: { id: 'oh2', name: 'Riesgo ordinario grupo 2', density: 0.2, area: 1500, hoseAllowance: 250, duration: 60, maxCoverage: 130 },
  eh1: { id: 'eh1', name: 'Riesgo extra grupo 1', density: 0.3, area: 2500, hoseAllowance: 500, duration: 90, maxCoverage: 100 },
  eh2: { id: 'eh2', name: 'Riesgo extra grupo 2', density: 0.4, area: 2500, hoseAllowance: 500, duration: 120, maxCoverage: 100 },
};

export const HAZARD_NAMES: Record<HazardId, string> = {
  light: HAZARDS.light.name,
  oh1: HAZARDS.oh1.name,
  oh2: HAZARDS.oh2.name,
  eh1: HAZARDS.eh1.name,
  eh2: HAZARDS.eh2.name,
  custom: 'Personalizado',
};

/** Presión mínima en cualquier rociador según NFPA 13 (psi). */
export const NFPA_MIN_SPRINKLER_PRESSURE = 7;
