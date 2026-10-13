/**
 * Operaciones de edición del proyecto (puras: modifican el objeto recibido).
 */
import { remoteArea } from './designArea';
import { HAZARDS } from './hazards';
import type { Catalog, SprinklerModel } from './catalog';
import { nextId, type BuildingElement, type Node, type Pipe, type Project, type Sprinkler } from './model';
import { getMaterial } from './pipes';

export function findNode(p: Project, id: string): Node | undefined {
  return p.nodes.find((n) => n.id === id);
}

export function addNode(p: Project, x: number, y: number, z: number): Node {
  const node: Node = { id: nextId('N', p.nodes), x, y, z };
  p.nodes.push(node);
  return node;
}

export function addPipe(p: Project, from: string, to: string, props: Pick<Pipe, 'size' | 'material' | 'role'> & Partial<Pipe>): Pipe {
  const pipe: Pipe = {
    id: nextId('T', p.pipes),
    from,
    to,
    c: props.c ?? getMaterial(props.material, p).cWet,
    fittings: [],
    ...props,
  };
  p.pipes.push(pipe);
  return pipe;
}

/** Nodo existente a menos de `tol` ft del punto, o undefined. */
export function nodeAt(p: Project, x: number, y: number, z: number, tol = 0.05): Node | undefined {
  let best: Node | undefined;
  let bd = tol;
  for (const n of p.nodes) {
    const d = Math.hypot(n.x - x, n.y - y, n.z - z);
    if (d <= bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Divide un tubo en el punto dado (proyectado sobre el tubo). Devuelve el nodo nuevo. */
export function splitPipe(p: Project, pipeId: string, x: number, y: number, z: number): Node | undefined {
  const pipe = p.pipes.find((pp) => pp.id === pipeId);
  if (!pipe) return;
  const a = findNode(p, pipe.from)!;
  const b = findNode(p, pipe.to)!;
  const d = [b.x - a.x, b.y - a.y, b.z - a.z];
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  if (len2 === 0) return;
  let t = ((x - a.x) * d[0] + (y - a.y) * d[1] + (z - a.z) * d[2]) / len2;
  t = Math.min(0.98, Math.max(0.02, t));
  const node = addNode(p, a.x + t * d[0], a.y + t * d[1], a.z + t * d[2]);
  const oldTo = pipe.to;
  const oldLen = pipe.lengthOverride;
  pipe.to = node.id;
  if (oldLen !== undefined) pipe.lengthOverride = oldLen * t;
  const second = addPipe(p, node.id, oldTo, {
    size: pipe.size,
    material: pipe.material,
    role: pipe.role,
    c: pipe.c,
    idOverride: pipe.idOverride,
  });
  if (oldLen !== undefined) second.lengthOverride = oldLen * (1 - t);
  return node;
}

export function addSprinkler(p: Project, nodeId: string, k = 5.6, coverage?: number): Sprinkler {
  const hz = p.criteria.hazard === 'custom' ? undefined : HAZARDS[p.criteria.hazard];
  const s: Sprinkler = {
    id: nextId('S', p.sprinklers),
    nodeId,
    k,
    coverage: coverage ?? hz?.maxCoverage ?? 130,
    inDesignArea: false,
    orientation: 'pendent',
    temperatureC: 68,
  };
  p.sprinklers.push(s);
  return s;
}

/** Agrega un bajante con rociador colgante bajo un nodo. Devuelve el rociador. */
export function addDropWithSprinkler(p: Project, nodeId: string, dropFt: number, k = 5.6): Sprinkler | undefined {
  const n = findNode(p, nodeId);
  if (!n) return;
  const head = addNode(p, n.x, n.y, n.z - dropFt);
  addPipe(p, n.id, head.id, { size: '1', material: 'steel-sch40', role: 'drop' });
  return addSprinkler(p, head.id, k);
}

export function deletePipe(p: Project, id: string) {
  p.pipes = p.pipes.filter((pp) => pp.id !== id);
  removeOrphans(p);
}

export function deleteSprinkler(p: Project, id: string) {
  p.sprinklers = p.sprinklers.filter((s) => s.id !== id);
}

export function deleteNode(p: Project, id: string) {
  if (id === p.supply.nodeId) return;
  p.pipes = p.pipes.filter((pp) => pp.from !== id && pp.to !== id);
  p.sprinklers = p.sprinklers.filter((s) => s.nodeId !== id);
  p.nodes = p.nodes.filter((n) => n.id !== id);
  removeOrphans(p);
}

/** Quita nodos que quedaron sin tubos, sin rociador y que no son el suministro. */
function removeOrphans(p: Project) {
  const used = new Set<string>([p.supply.nodeId]);
  for (const pp of p.pipes) {
    used.add(pp.from);
    used.add(pp.to);
  }
  p.nodes = p.nodes.filter((n) => used.has(n.id));
  p.sprinklers = p.sprinklers.filter((s) => used.has(s.nodeId));
}

/**
 * Sugiere el área de diseño: el rectángulo hidráulicamente más exigente que cumple NFPA 13
 * (N rociadores, con 1,2·√A paralelo a los ramales). Ver designArea.ts.
 */
export function suggestDesignArea(p: Project): string[] {
  return remoteArea(p);
}

// ---------- Elementos del edificio ----------

export function addElement(p: Project, typeId: string, points: { x: number; y: number }[], z: number): BuildingElement {
  const el: BuildingElement = { id: nextId('E', p.elements ?? []), typeId, points: points.map((q) => ({ x: q.x, y: q.y })), z };
  p.elements = [...(p.elements ?? []), el];
  return el;
}

export function deleteElement(p: Project, id: string) {
  p.elements = (p.elements ?? []).filter((e) => e.id !== id);
}

// ---------- Catálogo ----------

/** Aplica a un rociador los datos de un modelo del catálogo. */
export function applySprinklerModel(s: Sprinkler, model: SprinklerModel) {
  s.modelId = model.id;
  s.k = model.k;
  s.orientation = model.orientation;
  if (model.temperatureC !== undefined) s.temperatureC = model.temperatureC;
  s.model = model.builtIn ? undefined : [model.manufacturer, model.model].filter(Boolean).join(' ') || model.name;
}

type CatalogKey = keyof Catalog;

/**
 * Deja una copia de un ítem propio dentro del proyecto (para que el archivo sea autónomo).
 * Los de fábrica no se copian. Si ya hay uno con el mismo id, se reemplaza por la versión dada.
 */
export function putInProjectCatalog<K extends CatalogKey>(p: Project, key: K, item: Catalog[K][number]) {
  if ((item as { builtIn?: boolean }).builtIn) return;
  const cat = (p.catalog ??= {});
  const list = ((cat[key] as Catalog[K] | undefined) ?? []).filter((x) => x.id !== item.id) as Catalog[K];
  (list as unknown[]).push({ ...item });
  (cat as Record<string, unknown>)[key] = list;
}

/** Quita del catálogo del proyecto los ítems propios que ya nadie usa. */
export function pruneProjectCatalog(p: Project) {
  const cat = p.catalog;
  if (!cat) return;
  const usedMat = new Set(p.pipes.map((x) => x.material));
  const usedSpk = new Set(p.sprinklers.map((x) => x.modelId).filter(Boolean));
  const usedEl = new Set((p.elements ?? []).map((x) => x.typeId));
  if (cat.materials) cat.materials = cat.materials.filter((x) => usedMat.has(x.id));
  if (cat.sprinklers) cat.sprinklers = cat.sprinklers.filter((x) => usedSpk.has(x.id));
  if (cat.elements) cat.elements = cat.elements.filter((x) => usedEl.has(x.id));
}
