/**
 * Trazado rápido: llenar un recinto rectangular con rociadores y su tubería.
 *
 * Los rociadores se reparten en una cuadrícula regular:
 *  - se usa el menor número de filas y columnas que respeta la separación máxima entre
 *    rociadores y la cobertura máxima por rociador (NFPA 13, rociadores estándar),
 *  - la distancia al muro queda en la mitad de la separación (máximo permitido: S/2),
 *  - la cobertura de cada rociador es S × L.
 * La tubería (opcional) son ramales paralelos y una matriz que los une por un extremo.
 */
import { addNode, addPipe, addSprinkler, applySprinklerModel, nodeAt, splitPipe } from './edit';
import { getSprinklerModel } from './catalog';
import { HAZARDS } from './hazards';
import type { MaterialId, NominalSize } from './pipes';
import type { Pipe, Project, SprinklerOrientation } from './model';
import { scheduleClassFor, scheduleSize, sizeBySchedule } from './sizing';

export interface SpacingLimits {
  /** separación máxima entre rociadores y entre ramales (ft) */
  maxSpacing: number;
  /** cobertura máxima por rociador (ft²) */
  maxCoverage: number;
}

/** Límites de rociadores estándar de cobertura normal según el riesgo del proyecto */
export function spacingLimits(project: Project, modelId?: string): SpacingLimits {
  const c = project.criteria;
  const hz = c.hazard === 'custom' ? undefined : HAZARDS[c.hazard];
  const extra = c.hazard === 'eh1' || c.hazard === 'eh2' || (c.hazard === 'custom' && c.density > 0.2);
  let maxCoverage = hz?.maxCoverage ?? (c.density <= 0.1 ? 225 : c.density <= 0.2 ? 130 : 100);
  const model = getSprinklerModel(modelId, project);
  if (model?.maxCoverage) maxCoverage = Math.min(maxCoverage, model.maxCoverage);
  return { maxSpacing: extra ? 12 : 15, maxCoverage };
}

export interface GridPlan {
  /** número de rociadores a lo largo de los ramales y número de ramales */
  along: number;
  across: number;
  /** separación entre rociadores en el ramal (S) y entre ramales (L), ft */
  s: number;
  l: number;
  coverage: number;
}

/**
 * Cuántos rociadores caben: `lenAlong` es el largo en la dirección de los ramales y
 * `lenAcross` el ancho perpendicular (ft).
 */
export function planGrid(lenAlong: number, lenAcross: number, lim: SpacingLimits): GridPlan {
  const minAlong = Math.max(1, Math.ceil(lenAlong / lim.maxSpacing - 1e-9));
  const minAcross = Math.max(1, Math.ceil(lenAcross / lim.maxSpacing - 1e-9));
  // la combinación con menos rociadores; si empatan, la más pareja (S y L parecidos)
  let best: GridPlan | null = null;
  for (let along = minAlong; along <= minAlong + 60; along++) {
    const s = lenAlong / along;
    const across = Math.max(minAcross, Math.ceil((lenAcross * s) / lim.maxCoverage - 1e-9));
    const l = lenAcross / across;
    const n = along * across;
    const cand = { along, across, s, l, coverage: s * l };
    if (!best || n < best.along * best.across || (n === best.along * best.across && Math.abs(s - l) < Math.abs(best.s - best.l))) best = cand;
    if (across === minAcross) break; // con más rociadores por ramal ya no mejora
  }
  return best!;
}

export interface FillOptions {
  /** esquinas opuestas del recinto en planta (ft) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** dirección de los ramales */
  direction: 'x' | 'y';
  /** límites (por omisión, los del riesgo del proyecto) */
  limits?: SpacingLimits;
  /** altura de la tubería de ramales (ft) */
  pipeZ: number;
  /** para rociadores colgantes: largo del bajante bajo el ramal (ft); 0 = rociador sobre el ramal */
  dropFt: number;
  /** rociador */
  k: number;
  modelId?: string;
  orientation?: SprinklerOrientation;
  /** qué tubería crear */
  piping: 'none' | 'branches' | 'branches-main';
  /** lado donde va la matriz: al inicio (x0/y0) o al final de los ramales */
  mainSide: 'start' | 'end';
  material: MaterialId;
  /** poner diámetros con la tabla de NFPA 13 */
  sizeBySchedule: boolean;
  /** diámetros si no se usa la tabla */
  branchSize?: NominalSize;
  mainSize?: NominalSize;
}

export interface FillResult {
  plan: GridPlan;
  sprinklerIds: string[];
  pipeIds: string[];
  /** nodos de la matriz que quedaron unidos a la red existente */
  connected: number;
}

/** Llena el recinto. Modifica el proyecto. */
export function fillRoom(project: Project, o: FillOptions): FillResult {
  const lim = o.limits ?? spacingLimits(project, o.modelId);
  const minX = Math.min(o.x0, o.x1);
  const maxX = Math.max(o.x0, o.x1);
  const minY = Math.min(o.y0, o.y1);
  const maxY = Math.max(o.y0, o.y1);
  const alongX = o.direction === 'x';
  const lenAlong = alongX ? maxX - minX : maxY - minY;
  const lenAcross = alongX ? maxY - minY : maxX - minX;
  const plan = planGrid(lenAlong, lenAcross, lim);
  // coordenada (a lo largo, a través) → planta
  const toXY = (a: number, c: number) => (alongX ? { x: minX + a, y: minY + c } : { x: minX + c, y: minY + a });

  const nodesBefore = project.nodes.length;
  const existingPipes = project.pipes.map((p) => p.id);
  const sprinklerIds: string[] = [];
  const pipeIds: string[] = [];
  const model = getSprinklerModel(o.modelId, project);
  const pendent = o.dropFt > 1e-6;
  const cls = scheduleClassFor(project.criteria.hazard, project.criteria.density);
  const steelSize = (n: number, fallback?: NominalSize): NominalSize =>
    o.sizeBySchedule ? (scheduleSize(cls, false, n) ?? '6') : (fallback ?? '1-1/4');

  const pipe = (from: string, to: string, size: NominalSize, role: Pipe['role']) => {
    pipeIds.push(addPipe(project, from, to, { size, material: o.material, role }).id);
  };

  // índice del ramal por donde entra la matriz (para los diámetros de la matriz):
  // el más cercano al punto de suministro
  const supply = project.nodes.find((n) => n.id === project.supply.nodeId);
  const crossAt = (j: number) => plan.l / 2 + j * plan.l;
  let feedJ = 0;
  if (supply) {
    let best = Infinity;
    for (let j = 0; j < plan.across; j++) {
      const p = toXY(0, crossAt(j));
      const d = Math.hypot(p.x - supply.x, p.y - supply.y);
      if (d < best) {
        best = d;
        feedJ = j;
      }
    }
  }

  // matriz: separada del muro lo menor entre 1 ft y un cuarto de la separación
  const mainOffset = Math.min(1, plan.s / 4);
  const mainA = o.mainSide === 'start' ? mainOffset : lenAlong - mainOffset;
  const mainNodes: string[] = [];

  for (let j = 0; j < plan.across; j++) {
    const c = crossAt(j);
    const branchNodes: string[] = [];
    for (let i = 0; i < plan.along; i++) {
      // en orden desde la matriz hacia el extremo del ramal
      const ii = o.mainSide === 'start' ? i : plan.along - 1 - i;
      const a = plan.s / 2 + ii * plan.s;
      const { x, y } = toXY(a, c);
      let headNode: string;
      if (o.piping === 'none') {
        headNode = addNode(project, x, y, o.pipeZ - o.dropFt).id;
      } else {
        const bn = addNode(project, x, y, o.pipeZ).id;
        branchNodes.push(bn);
        if (pendent) {
          headNode = addNode(project, x, y, o.pipeZ - o.dropFt).id;
          pipe(bn, headNode, '1', 'drop');
        } else headNode = bn;
      }
      const spk = addSprinkler(project, headNode, o.k, plan.coverage);
      if (model) applySprinklerModel(spk, model);
      else if (o.orientation) spk.orientation = o.orientation;
      sprinklerIds.push(spk.id);
    }
    if (o.piping === 'none') continue;
    for (let i = 0; i + 1 < branchNodes.length; i++) pipe(branchNodes[i], branchNodes[i + 1], steelSize(plan.along - 1 - i, o.branchSize), 'branch');
    if (o.piping === 'branches-main') {
      const { x, y } = toXY(mainA, c);
      const mn = addNode(project, x, y, o.pipeZ).id;
      mainNodes.push(mn);
      pipe(mn, branchNodes[0], steelSize(plan.along, o.branchSize), 'branch');
    }
  }

  let connected = 0;
  if (mainNodes.length) {
    for (let j = 0; j + 1 < mainNodes.length; j++) {
      // rociadores aguas abajo de este tramo según el lado por donde entra el agua
      const n = j < feedJ ? (j + 1) * plan.along : (plan.across - 1 - j) * plan.along;
      pipe(mainNodes[j], mainNodes[j + 1], steelSize(Math.max(n, 1), o.mainSize), 'cross');
    }
    // unir los extremos de la matriz a la red existente (nodo o tubo a menos de 0,5 m)
    const tol = 0.5 / 0.3048;
    const feedSize = steelSize(plan.along * plan.across, o.mainSize);
    const link = (existingId: string, newId: string) => {
      const a = project.nodes.find((x) => x.id === existingId)!;
      const b = project.nodes.find((x) => x.id === newId)!;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.05) {
        // prácticamente el mismo punto: se usa el nodo existente
        for (const pp of project.pipes) {
          if (pp.from === newId) pp.from = existingId;
          if (pp.to === newId) pp.to = existingId;
        }
        project.nodes = project.nodes.filter((x) => x.id !== newId);
        const k = mainNodes.indexOf(newId);
        if (k >= 0) mainNodes[k] = existingId;
      } else pipe(existingId, newId, feedSize, 'cross');
      connected++;
    };
    const ends = mainNodes.length > 1 ? [mainNodes[0], mainNodes[mainNodes.length - 1]] : [mainNodes[0]];
    for (const id of ends) {
      const n = project.nodes.find((x) => x.id === id)!;
      const near = nodeAt({ ...project, nodes: project.nodes.slice(0, nodesBefore) }, n.x, n.y, n.z, tol);
      if (near) {
        link(near.id, id);
        continue;
      }
      const hit = nearestPipe(project, existingPipes, n.x, n.y, n.z, tol);
      if (hit) {
        const mid = splitPipe(project, hit, n.x, n.y, n.z);
        if (mid) link(mid.id, id);
      }
    }
  }

  // si la red nueva quedó unida al suministro, los diámetros se ajustan con la cuenta real
  if (o.sizeBySchedule && pipeIds.length) sizeBySchedule(project, { pipeIds });
  project.autoFittings ??= true;
  return { plan, sprinklerIds, pipeIds, connected };
}

/** Tubo existente más cercano a un punto (dentro de la tolerancia), entre los dados */
function nearestPipe(p: Project, ids: string[], x: number, y: number, z: number, tol: number): string | undefined {
  let best: string | undefined;
  let bd = tol;
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  for (const id of ids) {
    const pp = p.pipes.find((q) => q.id === id);
    if (!pp) continue;
    const a = nodes.get(pp.from)!;
    const b = nodes.get(pp.to)!;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * d[0] + (y - a.y) * d[1] + (z - a.z) * d[2]) / len2));
    const dist = Math.hypot(a.x + t * d[0] - x, a.y + t * d[1] - y, a.z + t * d[2] - z);
    if (dist < bd && t > 0.02 && t < 0.98) {
      bd = dist;
      best = id;
    }
  }
  return best;
}
