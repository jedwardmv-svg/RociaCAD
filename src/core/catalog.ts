/**
 * Catálogo: modelos de rociador y tipos de elemento del edificio, de fábrica y propios.
 * Las tuberías están en pipes.ts. Lo propio del usuario viaja dentro de cada proyecto
 * (`project.catalog`) para que el archivo se abra igual en otro computador.
 */
import type { Material } from './pipes';
import type { Project, SprinklerOrientation } from './model';
import { NOMINAL_SIZES } from './pipes';

export interface SprinklerModel {
  id: string;
  /** nombre que ve el usuario, p. ej. "Genérico K5.6 colgante" */
  name: string;
  manufacturer?: string;
  /** referencia del fabricante (SIN, código) */
  model?: string;
  /** gpm/psi^0.5 */
  k: number;
  orientation: SprinklerOrientation;
  temperatureC?: number;
  response?: 'standard' | 'quick';
  /** cobertura máxima según su listado (ft²) */
  maxCoverage?: number;
  /** presión mínima según su listado (psi) */
  minPressure?: number;
  builtIn?: boolean;
}

export type ElementKind = 'wall' | 'column' | 'beam' | 'slab' | 'ceiling' | 'duct' | 'pipe-ref';

export const ELEMENT_KIND_NAMES: Record<ElementKind, string> = {
  wall: 'Muro',
  column: 'Columna',
  beam: 'Viga',
  slab: 'Losa',
  ceiling: 'Cielo falso',
  duct: 'Ducto',
  'pipe-ref': 'Tubería de otro sistema',
};

/** Cómo se dibuja cada clase de elemento */
export const ELEMENT_KIND_SHAPE: Record<ElementKind, 'line' | 'point' | 'area'> = {
  wall: 'line',
  column: 'point',
  beam: 'line',
  slab: 'area',
  ceiling: 'area',
  duct: 'line',
  'pipe-ref': 'line',
};

export interface ElementType {
  id: string;
  name: string;
  kind: ElementKind;
  /** ft: espesor del muro, ancho de viga/ducto/columna, diámetro de tubería */
  width: number;
  /** ft: altura del muro o columna, peralte de viga, espesor de losa/cielo, alto del ducto */
  height: number;
  /** color hex */
  color: string;
  builtIn?: boolean;
}

export interface Catalog {
  materials: Material[];
  sprinklers: SprinklerModel[];
  elements: ElementType[];
}

const m = (meters: number) => meters / 0.3048;

export const BUILTIN_SPRINKLERS: SprinklerModel[] = ([
  { id: 'gen-k28-pend', name: 'Genérico K2.8 colgante', k: 2.8, orientation: 'pendent', temperatureC: 68 },
  { id: 'gen-k42-pend', name: 'Genérico K4.2 colgante', k: 4.2, orientation: 'pendent', temperatureC: 68 },
  { id: 'gen-k56-pend', name: 'Genérico K5.6 colgante', k: 5.6, orientation: 'pendent', temperatureC: 68 },
  { id: 'gen-k56-up', name: 'Genérico K5.6 montante', k: 5.6, orientation: 'upright', temperatureC: 68 },
  { id: 'gen-k56-side', name: 'Genérico K5.6 de pared', k: 5.6, orientation: 'sidewall', temperatureC: 68 },
  { id: 'gen-k56-conc', name: 'Genérico K5.6 oculto', k: 5.6, orientation: 'concealed', temperatureC: 68 },
  { id: 'gen-k80-pend', name: 'Genérico K8.0 colgante', k: 8.0, orientation: 'pendent', temperatureC: 68 },
  { id: 'gen-k80-up', name: 'Genérico K8.0 montante', k: 8.0, orientation: 'upright', temperatureC: 68 },
  { id: 'gen-k112-pend', name: 'Genérico K11.2 colgante', k: 11.2, orientation: 'pendent', temperatureC: 68 },
  { id: 'gen-k112-up', name: 'Genérico K11.2 montante', k: 11.2, orientation: 'upright', temperatureC: 68 },
] as SprinklerModel[]).map((s) => ({ ...s, response: 'quick' as const, builtIn: true }));

export const BUILTIN_ELEMENTS: ElementType[] = ([
  { id: 'wall-block-15', name: 'Muro de bloque 15 cm', kind: 'wall', width: m(0.15), height: m(3), color: '#b9c2ca' },
  { id: 'wall-drywall-12', name: 'Muro de drywall 12 cm', kind: 'wall', width: m(0.12), height: m(2.6), color: '#d9dee3' },
  { id: 'wall-concrete-20', name: 'Muro de concreto 20 cm', kind: 'wall', width: m(0.2), height: m(3), color: '#a7b0b8' },
  { id: 'col-40', name: 'Columna 40 × 40 cm', kind: 'column', width: m(0.4), height: m(3.5), color: '#9aa3ab' },
  { id: 'beam-30x50', name: 'Viga 30 × 50 cm', kind: 'beam', width: m(0.3), height: m(0.5), color: '#9aa3ab' },
  { id: 'slab-15', name: 'Losa 15 cm', kind: 'slab', width: 0, height: m(0.15), color: '#8d969e' },
  { id: 'ceiling-drop', name: 'Cielo falso', kind: 'ceiling', width: 0, height: m(0.02), color: '#e8ecef' },
  { id: 'duct-60x40', name: 'Ducto 60 × 40 cm', kind: 'duct', width: m(0.6), height: m(0.4), color: '#7fb0c9' },
  { id: 'pipe-ref-4', name: 'Tubería de otro sistema 4"', kind: 'pipe-ref', width: 4.5 / 12, height: 4.5 / 12, color: '#6c9a5a' },
] as ElementType[]).map((e) => ({ ...e, builtIn: true }));

function merge<T extends { id: string }>(builtIn: T[], custom: T[] | undefined): T[] {
  const ids = new Set((custom ?? []).map((x) => x.id));
  return [...builtIn.filter((x) => !ids.has(x.id)), ...(custom ?? [])];
}

export function allSprinklerModels(project?: Pick<Project, 'catalog'>): SprinklerModel[] {
  return merge(BUILTIN_SPRINKLERS, project?.catalog?.sprinklers);
}

export function allElementTypes(project?: Pick<Project, 'catalog'>): ElementType[] {
  return merge(BUILTIN_ELEMENTS, project?.catalog?.elements);
}

export function getElementType(id: string, project?: Pick<Project, 'catalog'>): ElementType {
  return allElementTypes(project).find((e) => e.id === id) ?? BUILTIN_ELEMENTS[0];
}

export function getSprinklerModel(id: string | undefined, project?: Pick<Project, 'catalog'>): SprinklerModel | undefined {
  return id ? allSprinklerModels(project).find((s) => s.id === id) : undefined;
}

/** Id nuevo y único para un ítem del usuario */
export function customId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Revisa un catálogo leído de un archivo y devuelve solo los ítems válidos.
 * Lanza un error si el archivo no es un catálogo.
 */
export function parseCatalog(raw: unknown): Catalog {
  const r = raw as Partial<Catalog> & { format?: string };
  if (!r || typeof r !== 'object' || (r.format !== undefined && r.format !== 'rociacad-catalogo')) {
    throw new Error('El archivo no es un catálogo de RociaCAD.');
  }
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const materials = (r.materials ?? []).filter(
    (x) =>
      x && typeof x.id === 'string' && typeof x.name === 'string' && num(x.cWet) && num(x.cDry) && num(x.stickLengthFt) &&
      x.id_in && Object.entries(x.id_in).every(([k, v]) => NOMINAL_SIZES.includes(k as never) && num(v)),
  );
  const sprinklers = (r.sprinklers ?? []).filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string' && num(x.k));
  const elements = (r.elements ?? []).filter(
    (x) => x && typeof x.id === 'string' && typeof x.name === 'string' && x.kind in ELEMENT_KIND_NAMES && num(x.height),
  );
  const strip = <T extends { builtIn?: boolean }>(list: T[]) => list.map(({ builtIn: _b, ...rest }) => rest as T);
  return { materials: strip(materials), sprinklers: strip(sprinklers), elements: strip(elements) };
}
