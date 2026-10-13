/**
 * Catálogo de tuberías: diámetros internos y coeficientes C de Hazen-Williams.
 *
 * Diámetros internos en pulgadas.
 *  - Acero Schedule 40, 80 y 10: ASME B36.10.
 *  - Cobre tipos K, L y M: ASTM B88.
 *  - CPVC SDR 13.5: valores típicos de fabricante (ASTM F442). Verifique con su proveedor.
 *  - PVC C900 DR18: AWWA C900 (diámetro exterior de hierro fundido, espesor = DE/18).
 *
 * Además de los de fábrica, cada proyecto puede traer tuberías propias en `project.catalog`
 * (las crea el usuario en el catálogo de la app). El usuario también puede forzar el
 * diámetro interno de cualquier tubo.
 */
import type { Project } from './model';

export type NominalSize =
  | '3/4' | '1' | '1-1/4' | '1-1/2' | '2' | '2-1/2' | '3' | '3-1/2'
  | '4' | '5' | '6' | '8' | '10' | '12';

export const NOMINAL_SIZES: NominalSize[] = [
  '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4', '5', '6', '8', '10', '12',
];

/** Diámetro nominal en mm (DN) para mostrar en métrico. */
export const DN_MM: Record<NominalSize, number> = {
  '3/4': 20, '1': 25, '1-1/4': 32, '1-1/2': 40, '2': 50, '2-1/2': 65, '3': 80,
  '3-1/2': 90, '4': 100, '5': 125, '6': 150, '8': 200, '10': 250, '12': 300,
};

/** Diámetro exterior (in) de la tubería de acero por tamaño (ASME B36.10); aproximado para otros materiales */
export const OD_IN: Record<NominalSize, number> = {
  '3/4': 1.05, '1': 1.315, '1-1/4': 1.66, '1-1/2': 1.9, '2': 2.375, '2-1/2': 2.875, '3': 3.5,
  '3-1/2': 4.0, '4': 4.5, '5': 5.563, '6': 6.625, '8': 8.625, '10': 10.75, '12': 12.75,
};

/** Familia del material, para reglas que dependen de él (soportes, uniones) */
export type MaterialFamily = 'steel' | 'copper' | 'cpvc' | 'buried' | 'other';

export function materialFamily(id: string, project?: Pick<Project, 'catalog'>): MaterialFamily {
  const m = getMaterial(id, project);
  const t = `${m.id} ${m.name}`.toLowerCase();
  if (/cpvc/.test(t)) return 'cpvc';
  if (/pvc|c900|hdpe|polietileno|enterrad/.test(t)) return 'buried';
  if (/copper|cobre/.test(t)) return 'copper';
  if (/steel|acero|galv/.test(t)) return 'steel';
  return 'other';
}

/** Identificador de material: los de fábrica o uno creado por el usuario. */
export type MaterialId = string;

export interface Material {
  id: MaterialId;
  name: string;
  /** C de Hazen-Williams para sistema húmedo (NFPA 13, tabla de coeficientes C) */
  cWet: number;
  /** C para sistema seco / preacción */
  cDry: number;
  /** Diámetro interno (in) por tamaño nominal. Solo se listan los tamaños existentes. */
  id_in: Partial<Record<NominalSize, number>>;
  /** Longitud comercial de un tubo (ft) — para contar tubos en la lista de materiales.
   *  Acero: 6 m, lo usual en Colombia y Latinoamérica (en EE. UU. se vende en 21 ft). */
  stickLengthFt: number;
  /** color en la vista 3D (hex) */
  color?: string;
  /** true para los que vienen con el programa */
  builtIn?: boolean;
}

const SIX_M = 6 / 0.3048;
const TWENTY_FT = 20;

const SCH40: Partial<Record<NominalSize, number>> = {
  '3/4': 0.824, '1': 1.049, '1-1/4': 1.380, '1-1/2': 1.610, '2': 2.067, '2-1/2': 2.469,
  '3': 3.068, '3-1/2': 3.548, '4': 4.026, '5': 5.047, '6': 6.065, '8': 7.981,
  '10': 10.020, '12': 11.938,
};

/** Materiales de fábrica */
export const MATERIALS: Record<MaterialId, Material> = {
  'steel-sch40': {
    id: 'steel-sch40',
    name: 'Acero Schedule 40',
    cWet: 120,
    cDry: 100,
    stickLengthFt: SIX_M,
    id_in: SCH40,
    color: '#c8102e',
    builtIn: true,
  },
  'steel-sch10': {
    id: 'steel-sch10',
    name: 'Acero Schedule 10',
    cWet: 120,
    cDry: 100,
    stickLengthFt: SIX_M,
    id_in: {
      '1': 1.097, '1-1/4': 1.442, '1-1/2': 1.682, '2': 2.157, '2-1/2': 2.635, '3': 3.260,
      '3-1/2': 3.760, '4': 4.260, '5': 5.295, '6': 6.357, '8': 8.329, '10': 10.420,
    },
    color: '#d6334c',
    builtIn: true,
  },
  'steel-sch80': {
    id: 'steel-sch80',
    name: 'Acero Schedule 80',
    cWet: 120,
    cDry: 100,
    stickLengthFt: SIX_M,
    id_in: {
      '3/4': 0.742, '1': 0.957, '1-1/4': 1.278, '1-1/2': 1.500, '2': 1.939, '2-1/2': 2.323,
      '3': 2.900, '3-1/2': 3.364, '4': 3.826, '5': 4.813, '6': 5.761, '8': 7.625,
      '10': 9.562, '12': 11.374,
    },
    color: '#a30d25',
    builtIn: true,
  },
  'steel-galv': {
    id: 'steel-galv',
    name: 'Acero galvanizado Schedule 40',
    cWet: 120,
    cDry: 100,
    stickLengthFt: SIX_M,
    id_in: SCH40,
    color: '#9aa7b3',
    builtIn: true,
  },
  cpvc: {
    id: 'cpvc',
    name: 'CPVC SDR 13.5',
    cWet: 150,
    cDry: 150,
    stickLengthFt: 15,
    id_in: {
      '3/4': 0.874, '1': 1.101, '1-1/4': 1.394, '1-1/2': 1.598, '2': 2.003, '2-1/2': 2.423,
      '3': 2.951,
    },
    color: '#e58a3a',
    builtIn: true,
  },
  'copper-k': {
    id: 'copper-k',
    name: 'Cobre tipo K',
    cWet: 150,
    cDry: 150,
    stickLengthFt: TWENTY_FT,
    id_in: { '3/4': 0.745, '1': 0.995, '1-1/4': 1.245, '1-1/2': 1.481, '2': 1.959, '2-1/2': 2.435, '3': 2.907, '4': 3.857 },
    color: '#c77b30',
    builtIn: true,
  },
  'copper-l': {
    id: 'copper-l',
    name: 'Cobre tipo L',
    cWet: 150,
    cDry: 150,
    stickLengthFt: TWENTY_FT,
    id_in: { '3/4': 0.785, '1': 1.025, '1-1/4': 1.265, '1-1/2': 1.505, '2': 1.985, '2-1/2': 2.465, '3': 2.945, '4': 3.905 },
    color: '#d28a3f',
    builtIn: true,
  },
  'copper-m': {
    id: 'copper-m',
    name: 'Cobre tipo M',
    cWet: 150,
    cDry: 150,
    stickLengthFt: TWENTY_FT,
    id_in: { '3/4': 0.811, '1': 1.055, '1-1/4': 1.291, '1-1/2': 1.527, '2': 2.009, '2-1/2': 2.495, '3': 2.981, '4': 3.935 },
    color: '#dd9a52',
    builtIn: true,
  },
  'pvc-c900': {
    id: 'pvc-c900',
    name: 'PVC C900 DR18 (enterrada)',
    cWet: 150,
    cDry: 150,
    stickLengthFt: TWENTY_FT,
    id_in: { '4': 4.267, '6': 6.133, '8': 8.044, '10': 9.867, '12': 11.733 },
    color: '#4a8fd4',
    builtIn: true,
  },
};

/** Materiales de fábrica más los propios del proyecto (los del proyecto mandan si repiten id). */
export function allMaterials(project?: Pick<Project, 'catalog'>): Material[] {
  const custom = project?.catalog?.materials ?? [];
  const ids = new Set(custom.map((m) => m.id));
  return [...Object.values(MATERIALS).filter((m) => !ids.has(m.id)), ...custom];
}

/** Material por id; si no existe se usa acero Schedule 40 para no romper el cálculo. */
export function getMaterial(id: MaterialId, project?: Pick<Project, 'catalog'>): Material {
  return project?.catalog?.materials?.find((m) => m.id === id) ?? MATERIALS[id] ?? MATERIALS['steel-sch40'];
}

export function materialExists(id: MaterialId, project?: Pick<Project, 'catalog'>): boolean {
  return !!(project?.catalog?.materials?.some((m) => m.id === id) || MATERIALS[id]);
}

export function internalDiameter(material: MaterialId, size: NominalSize, project?: Pick<Project, 'catalog'>): number | undefined {
  return getMaterial(material, project).id_in[size];
}

export function sizesFor(material: MaterialId, project?: Pick<Project, 'catalog'>): NominalSize[] {
  const m = getMaterial(material, project);
  return NOMINAL_SIZES.filter((s) => m.id_in[s] !== undefined);
}

/** Etiqueta del tamaño: 2-1/2" o DN65 según el sistema de unidades. */
export function sizeLabel(size: NominalSize, metric: boolean): string {
  return metric ? `DN${DN_MM[size]}` : `${size}"`;
}
