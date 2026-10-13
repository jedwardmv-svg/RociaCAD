/**
 * Edición de varios objetos a la vez: repetir (copiar con desplazamiento), mover, borrar,
 * cambiar diámetro y poner o quitar bajantes de los rociadores.
 */
import { addNode, addPipe, deleteElement, deleteNode, deletePipe, deleteSprinkler, findNode, splitPipe } from './edit';
import type { Project } from './model';
import { nextId } from './model';
import type { NominalSize } from './pipes';
import { sizesFor } from './pipes';

export interface ItemSet {
  nodes: string[];
  pipes: string[];
  sprinklers: string[];
  elements: string[];
}

export const emptyItems = (): ItemSet => ({ nodes: [], pipes: [], sprinklers: [], elements: [] });

export function itemCount(s: ItemSet): number {
  return s.nodes.length + s.pipes.length + s.sprinklers.length + s.elements.length;
}

/** Todos los nodos que tocan los objetos elegidos (extremos de tubos, nodos de rociadores) */
export function involvedNodes(p: Project, s: ItemSet): Set<string> {
  const out = new Set(s.nodes);
  const pipes = new Set(s.pipes);
  for (const pp of p.pipes) if (pipes.has(pp.id)) out.add(pp.from).add(pp.to);
  const spk = new Set(s.sprinklers);
  for (const x of p.sprinklers) if (spk.has(x.id)) out.add(x.nodeId);
  return out;
}

/**
 * Todo lo que va con los objetos elegidos al copiarlos: además de lo elegido, los tubos entre
 * dos nodos elegidos y los rociadores en nodos elegidos.
 */
export function closeItems(p: Project, s: ItemSet): ItemSet {
  const nodes = involvedNodes(p, s);
  const pipes = new Set(s.pipes);
  for (const pp of p.pipes) if (nodes.has(pp.from) && nodes.has(pp.to)) pipes.add(pp.id);
  const spk = new Set(s.sprinklers);
  for (const x of p.sprinklers) if (nodes.has(x.nodeId)) spk.add(x.id);
  return { nodes: [...nodes], pipes: [...pipes], sprinklers: [...spk], elements: [...s.elements] };
}

/** Une un nodo nuevo con lo que ya existe en ese punto: un nodo (se funden) o un tubo (se parte) */
function attach(p: Project, nodeId: string, protectedIds: Set<string>, tol: number): boolean {
  const n = findNode(p, nodeId);
  if (!n) return false;
  // nodo existente en el mismo punto
  for (const m of p.nodes) {
    if (m.id === nodeId || protectedIds.has(m.id)) continue;
    if (Math.hypot(m.x - n.x, m.y - n.y, m.z - n.z) <= tol) {
      for (const pp of p.pipes) {
        if (pp.from === nodeId) pp.from = m.id;
        if (pp.to === nodeId) pp.to = m.id;
      }
      for (const s of p.sprinklers) if (s.nodeId === nodeId) s.nodeId = m.id;
      p.nodes = p.nodes.filter((x) => x.id !== nodeId);
      // un tubo que quedó con los dos extremos iguales se quita
      p.pipes = p.pipes.filter((pp) => pp.from !== pp.to);
      return true;
    }
  }
  // tubo existente que pasa por el punto
  for (const pp of [...p.pipes]) {
    if (pp.from === nodeId || pp.to === nodeId) continue;
    if (protectedIds.has(pp.from) || protectedIds.has(pp.to)) continue;
    const a = findNode(p, pp.from)!;
    const b = findNode(p, pp.to)!;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    if (!len2) continue;
    const t = ((n.x - a.x) * d[0] + (n.y - a.y) * d[1] + (n.z - a.z) * d[2]) / len2;
    if (t <= 0.001 || t >= 0.999) continue;
    if (Math.hypot(a.x + t * d[0] - n.x, a.y + t * d[1] - n.y, a.z + t * d[2] - n.z) > tol) continue;
    const mid = splitPipe(p, pp.id, n.x, n.y, n.z);
    if (!mid) continue;
    // el nodo de la división queda exactamente donde está el nodo nuevo, y se funden
    mid.x = n.x;
    mid.y = n.y;
    mid.z = n.z;
    for (const q of p.pipes) {
      if (q.from === nodeId) q.from = mid.id;
      if (q.to === nodeId) q.to = mid.id;
    }
    for (const s of p.sprinklers) if (s.nodeId === nodeId) s.nodeId = mid.id;
    p.nodes = p.nodes.filter((x) => x.id !== nodeId);
    return true;
  }
  return false;
}

export interface RepeatResult {
  created: ItemSet;
  /** uniones hechas con la red existente */
  joined: number;
}

/**
 * Repite los objetos `count` veces con desplazamiento (dx, dy, dz) en ft.
 * Cada copia se une sola a la red existente donde un nodo copiado cae sobre un nodo o un tubo.
 */
export function repeatItems(p: Project, sel: ItemSet, count: number, dx: number, dy: number, dz: number, tol = 0.1): RepeatResult {
  const src = closeItems(p, sel);
  const created = emptyItems();
  let joined = 0;
  const srcPipes = p.pipes.filter((x) => src.pipes.includes(x.id));
  const srcSpk = p.sprinklers.filter((x) => src.sprinklers.includes(x.id));
  const srcNodes = p.nodes.filter((x) => src.nodes.includes(x.id));
  const srcEls = (p.elements ?? []).filter((x) => src.elements.includes(x.id));
  for (let k = 1; k <= count; k++) {
    const map = new Map<string, string>();
    for (const n of srcNodes) {
      const c = addNode(p, n.x + k * dx, n.y + k * dy, n.z + k * dz);
      if (n.label && n.id !== p.supply.nodeId) c.label = n.label;
      map.set(n.id, c.id);
    }
    for (const pp of srcPipes) {
      const { id: _id, from, to, ...rest } = pp;
      const c = addPipe(p, map.get(from)!, map.get(to)!, { ...JSON.parse(JSON.stringify(rest)) });
      created.pipes.push(c.id);
    }
    for (const s of srcSpk) {
      const c = { ...JSON.parse(JSON.stringify(s)), id: nextId('S', p.sprinklers), nodeId: map.get(s.nodeId)!, inDesignArea: false };
      p.sprinklers.push(c);
      created.sprinklers.push(c.id);
    }
    for (const e of srcEls) {
      const c = { ...JSON.parse(JSON.stringify(e)), id: nextId('E', p.elements ?? []) };
      c.points = e.points.map((q) => ({ x: q.x + k * dx, y: q.y + k * dy }));
      c.z = e.z + k * dz;
      p.elements = [...(p.elements ?? []), c];
      created.elements.push(c.id);
    }
    // uniones con la red: solo los nodos copiados, contra lo que no es de esta misma copia
    const own = new Set(map.values());
    for (const id of map.values()) {
      if (attach(p, id, own, tol)) joined++;
    }
    for (const id of map.values()) if (p.nodes.some((n) => n.id === id)) created.nodes.push(id);
  }
  // los tubos que quedaron en un solo punto ya se quitaron; limpiar la lista
  created.pipes = created.pipes.filter((id) => p.pipes.some((x) => x.id === id));
  return { created, joined };
}

/** Mueve los objetos (sus nodos y elementos). Los tubos conectados se estiran. */
export function moveItems(p: Project, sel: ItemSet, dx: number, dy: number, dz: number) {
  const nodes = involvedNodes(p, sel);
  for (const n of p.nodes)
    if (nodes.has(n.id)) {
      n.x += dx;
      n.y += dy;
      n.z += dz;
    }
  const els = new Set(sel.elements);
  for (const e of p.elements ?? [])
    if (els.has(e.id)) {
      e.points = e.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      e.z += dz;
    }
}

/** Borra los objetos elegidos (el punto de suministro no se borra) */
export function deleteItems(p: Project, sel: ItemSet) {
  for (const id of sel.sprinklers) deleteSprinkler(p, id);
  for (const id of sel.pipes) deletePipe(p, id);
  for (const id of sel.nodes) if (id !== p.supply.nodeId) deleteNode(p, id);
  for (const id of sel.elements) deleteElement(p, id);
}

/** Cambia el diámetro de los tubos elegidos (solo donde el material tiene ese diámetro) */
export function setPipeSize(p: Project, pipeIds: string[], size: NominalSize): number {
  let n = 0;
  const ids = new Set(pipeIds);
  for (const pp of p.pipes)
    if (ids.has(pp.id) && sizesFor(pp.material, p).includes(size) && pp.size !== size) {
      pp.size = size;
      n++;
    }
  return n;
}

/**
 * Bajantes de los rociadores elegidos.
 *  - dropFt > 0: cada rociador queda colgado `dropFt` bajo su ramal con un bajante de 1"
 *    (si ya tiene bajante, se cambia su largo).
 *  - dropFt = 0: se quita el bajante y el rociador queda sobre el ramal.
 * Devuelve cuántos rociadores cambiaron.
 */
export function setDrops(p: Project, sprinklerIds: string[], dropFt: number): number {
  let changed = 0;
  for (const id of sprinklerIds) {
    const s = p.sprinklers.find((x) => x.id === id);
    if (!s) continue;
    const node = findNode(p, s.nodeId);
    if (!node) continue;
    const pipes = p.pipes.filter((pp) => pp.from === node.id || pp.to === node.id);
    // ¿ya está en el extremo de un bajante vertical?
    const drop =
      pipes.length === 1 && pipes[0].role === 'drop'
        ? (() => {
            const other = findNode(p, pipes[0].from === node.id ? pipes[0].to : pipes[0].from)!;
            return Math.hypot(other.x - node.x, other.y - node.y) < 0.05 && other.z > node.z ? { pipe: pipes[0], top: other } : null;
          })()
        : null;
    if (drop) {
      if (dropFt > 1e-6) {
        if (Math.abs(drop.top.z - dropFt - node.z) < 1e-6) continue;
        node.z = drop.top.z - dropFt;
        delete drop.pipe.lengthOverride;
      } else {
        // quitar el bajante: el rociador sube al ramal
        s.nodeId = drop.top.id;
        if (s.orientation === 'pendent') s.orientation = 'upright';
        p.pipes = p.pipes.filter((pp) => pp.id !== drop.pipe.id);
        if (!p.sprinklers.some((x) => x.nodeId === node.id) && node.id !== p.supply.nodeId) p.nodes = p.nodes.filter((n) => n.id !== node.id);
      }
      changed++;
      continue;
    }
    if (dropFt <= 1e-6) continue; // ya está sobre el ramal
    if (!pipes.length) {
      // rociador suelto (sin tubería): solo se baja
      node.z -= dropFt;
      changed++;
      continue;
    }
    const head = addNode(p, node.x, node.y, node.z - dropFt);
    const branch = pipes[0];
    addPipe(p, node.id, head.id, { size: sizesFor(branch.material, p).includes('1') ? '1' : sizesFor(branch.material, p)[0], material: branch.material, role: 'drop' });
    s.nodeId = head.id;
    if (s.orientation === 'upright') s.orientation = 'pendent';
    changed++;
  }
  return changed;
}
