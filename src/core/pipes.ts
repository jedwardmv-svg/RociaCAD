/**
 * Catálogo de tuberías: diámetros internos y coeficientes C de Hazen-Williams.
 *
 * Diámetros internos en pulgadas.
 *  - Acero Schedule 40 y Schedule 10: ASME B36.10 (dimensiones estándar de tubo de acero).
 *  - CPVC SDR 13.5: valores típicos de fabricante (ASTM F442). Verifique con su proveedor.
 *
 * El usuario puede sobrescribir el diámetro interno de cualquier tubo en el proyecto.
 */

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

export type MaterialId = 'steel-sch40' | 'steel-sch10' | 'cpvc';

export interface Material {
  id: MaterialId;
  name: string;
  /** C de Hazen-Williams recomendado para sistema húmedo (NFPA 13, tabla de coeficientes C) */
  cWet: number;
  /** C recomendado para sistema seco / preacción */
  cDry: number;
  /** Diámetro interno (in) por tamaño nominal. Solo se listan los tamaños existentes. */
  id_in: Partial<Record<NominalSize, number>>;
  /** Longitud comercial de un tubo (ft) — para contar tubos en la lista de materiales.
   *  Acero: 6 m, lo usual en Colombia y Latinoamérica (en EE. UU. se vende en 21 ft). */
  stickLengthFt: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  'steel-sch40': {
    id: 'steel-sch40',
    name: 'Acero Schedule 40',
    cWet: 120,
    cDry: 100,
    stickLengthFt: 6 / 0.3048,
    id_in: {
      '3/4': 0.824, '1': 1.049, '1-1/4': 1.380, '1-1/2': 1.610, '2': 2.067, '2-1/2': 2.469,
      '3': 3.068, '3-1/2': 3.548, '4': 4.026, '5': 5.047, '6': 6.065, '8': 7.981,
      '10': 10.020, '12': 11.938,
    },
  },
  'steel-sch10': {
    id: 'steel-sch10',
    name: 'Acero Schedule 10',
    cWet: 120,
    cDry: 100,
    stickLengthFt: 6 / 0.3048,
    id_in: {
      '1': 1.097, '1-1/4': 1.442, '1-1/2': 1.682, '2': 2.157, '2-1/2': 2.635, '3': 3.260,
      '3-1/2': 3.760, '4': 4.260, '5': 5.295, '6': 6.357, '8': 8.329, '10': 10.420,
    },
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
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

export function internalDiameter(material: MaterialId, size: NominalSize): number | undefined {
  return MATERIALS[material].id_in[size];
}

export function sizesFor(material: MaterialId): NominalSize[] {
  return NOMINAL_SIZES.filter((s) => MATERIALS[material].id_in[s] !== undefined);
}

/** Etiqueta del tamaño: 2-1/2" o DN65 según el sistema de unidades. */
export function sizeLabel(size: NominalSize, metric: boolean): string {
  return metric ? `DN${DN_MM[size]}` : `${size}"`;
}
