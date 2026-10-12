/**
 * Catálogo personal: las tuberías, rociadores y elementos que crea el usuario.
 * Se guarda en este computador y se puede exportar/importar como archivo .rcatalogo.
 * Cuando un ítem se usa en un proyecto, se copia dentro del proyecto (ver putInProjectCatalog).
 */
import {
  allElementTypes,
  allMaterials,
  allSprinklerModels,
  parseCatalog,
  type Catalog,
  type ElementType,
  type Material,
  type SprinklerModel,
} from '../../core';
import { store } from './state';

const KEY = 'rociacad.catalogo.v1';

function read(): Catalog {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseCatalog(JSON.parse(raw));
  } catch {
    /* catálogo dañado o sin acceso: empezar vacío */
  }
  return { materials: [], sprinklers: [], elements: [] };
}

export const personal: Catalog = read();

export function savePersonal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(personal));
  } catch {
    /* sin almacenamiento disponible */
  }
}

/** Fábrica + personal + lo que trae el proyecto abierto (el proyecto manda si se repite el id) */
function view(): Pick<import('../../core').Project, 'catalog'> {
  const p = store.project?.catalog ?? {};
  const merge = <T extends { id: string }>(a: T[], b: T[] | undefined) => {
    const ids = new Set((b ?? []).map((x) => x.id));
    return [...a.filter((x) => !ids.has(x.id)), ...(b ?? [])];
  };
  return {
    catalog: {
      materials: merge(personal.materials, p.materials),
      sprinklers: merge(personal.sprinklers, p.sprinklers),
      elements: merge(personal.elements, p.elements),
    },
  };
}

export const catalogMaterials = (): Material[] => allMaterials(view());
export const catalogSprinklers = (): SprinklerModel[] => allSprinklerModels(view());
export const catalogElements = (): ElementType[] => allElementTypes(view());

export function findMaterial(id: string) {
  return catalogMaterials().find((m) => m.id === id);
}
export function findSprinklerModel(id: string | undefined) {
  return id ? catalogSprinklers().find((m) => m.id === id) : undefined;
}
export function findElementType(id: string) {
  return catalogElements().find((m) => m.id === id);
}

/** Agrega al catálogo personal los ítems de otro catálogo (los de igual id se reemplazan) */
export function importInto(c: Catalog): number {
  let n = 0;
  for (const key of ['materials', 'sprinklers', 'elements'] as const) {
    for (const item of c[key]) {
      const list = personal[key] as { id: string }[];
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item;
      else list.push(item);
      n++;
    }
  }
  savePersonal();
  return n;
}

export function exportText(): string {
  return JSON.stringify({ format: 'rociacad-catalogo', version: 1, ...personal }, null, 1);
}

/** Al abrir un proyecto, sus ítems propios que no estén en el catálogo personal se agregan a él */
export function adoptFromProject(p: import('../../core').Project) {
  let changed = false;
  for (const key of ['materials', 'sprinklers', 'elements'] as const) {
    for (const item of (p.catalog?.[key] ?? []) as { id: string }[]) {
      const list = personal[key] as { id: string }[];
      if (!list.some((x) => x.id === item.id)) {
        list.push({ ...item });
        changed = true;
      }
    }
  }
  if (changed) savePersonal();
}
