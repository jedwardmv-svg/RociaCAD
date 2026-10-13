/**
 * Dimensionamiento de tubería por tabla (pipe schedule) de NFPA 13.
 *
 * Cada tubo toma el diámetro mínimo que permite la tabla según cuántos rociadores alimenta
 * aguas abajo. Sirve para un primer tamaño rápido; el cálculo hidráulico es el que decide
 * si el sistema funciona (después se puede subir o bajar tramos a mano).
 *
 * Tablas (número máximo de rociadores por diámetro), NFPA 13 capítulo de "pipe schedules":
 *  - Riesgo ligero: acero y cobre.
 *  - Riesgo ordinario: acero y cobre.
 *  - Riesgo extra: acero y cobre.
 * Para CPVC y otros plásticos se usa la tabla de acero.
 */
import type { HazardId } from './hazards';
import type { Pipe, PipeRole, Project } from './model';
import { getMaterial, NOMINAL_SIZES, sizesFor, type NominalSize } from './pipes';

type Schedule = [NominalSize, number][];

const SCHEDULES: Record<'light' | 'ordinary' | 'extra', { steel: Schedule; copper: Schedule }> = {
  light: {
    steel: [['1', 2], ['1-1/4', 3], ['1-1/2', 5], ['2', 10], ['2-1/2', 30], ['3', 60], ['3-1/2', 100]],
    copper: [['1', 2], ['1-1/4', 3], ['1-1/2', 5], ['2', 12], ['2-1/2', 40], ['3', 65], ['3-1/2', 115]],
  },
  ordinary: {
    steel: [['1', 2], ['1-1/4', 3], ['1-1/2', 5], ['2', 10], ['2-1/2', 20], ['3', 40], ['3-1/2', 65], ['4', 100], ['5', 160], ['6', 275]],
    copper: [['1', 2], ['1-1/4', 3], ['1-1/2', 5], ['2', 12], ['2-1/2', 25], ['3', 45], ['3-1/2', 75], ['4', 115], ['5', 180], ['6', 300]],
  },
  extra: {
    steel: [['1', 1], ['1-1/4', 2], ['1-1/2', 5], ['2', 8], ['2-1/2', 15], ['3', 27], ['3-1/2', 40], ['4', 55], ['5', 90], ['6', 150]],
    copper: [['1', 1], ['1-1/4', 2], ['1-1/2', 5], ['2', 8], ['2-1/2', 20], ['3', 30], ['3-1/2', 45], ['4', 65], ['5', 100], ['6', 170]],
  },
};

export type ScheduleClass = keyof typeof SCHEDULES;

export const SCHEDULE_CLASS_NAMES: Record<ScheduleClass, string> = {
  light: 'Riesgo ligero',
  ordinary: 'Riesgo ordinario',
  extra: 'Riesgo extra',
};

/** Tabla que corresponde al riesgo del proyecto */
export function scheduleClassFor(hazard: HazardId, density: number): ScheduleClass {
  if (hazard === 'light') return 'light';
  if (hazard === 'oh1' || hazard === 'oh2') return 'ordinary';
  if (hazard === 'eh1' || hazard === 'eh2') return 'extra';
  return density <= 0.1 + 1e-9 ? 'light' : density <= 0.2 + 1e-9 ? 'ordinary' : 'extra';
}

const isCopper = (project: Project, pipe: Pipe) => {
  const m = getMaterial(pipe.material, project);
  return /copper|cobre/i.test(m.id) || /cobre|copper/i.test(m.name);
};

/** Diámetro mínimo por tabla para `count` rociadores, o undefined si pasa del máximo de la tabla */
export function scheduleSize(cls: ScheduleClass, copper: boolean, count: number): NominalSize | undefined {
  const table = SCHEDULES[cls][copper ? 'copper' : 'steel'];
  return table.find(([, max]) => count <= max)?.[0];
}

export interface SizingOptions {
  /** Tabla a usar; por omisión, la del riesgo del proyecto */
  cls?: ScheduleClass;
  /** Solo estos tubos (por omisión, todos menos la alimentación enterrada) */
  pipeIds?: string[];
  /** Funciones de tubo que se dimensionan (por omisión todas menos 'feed') */
  roles?: PipeRole[];
}

export interface SizingResult {
  /** tubos cambiados: id → [antes, después] */
  changed: Record<string, [NominalSize, NominalSize]>;
  /** rociadores que alimenta cada tubo (los que se pudieron contar) */
  counts: Record<string, number>;
  warnings: string[];
}

/**
 * Cuenta los rociadores aguas abajo de cada tubo, recorriendo la red desde el suministro.
 * Si la red tiene lazos, se usa un árbol (los tubos que cierran lazos no se cuentan).
 */
export function downstreamCounts(project: Project): { counts: Map<string, number>; loops: string[]; unreachable: string[] } {
  const adj = new Map<string, { pipe: Pipe; other: string }[]>();
  for (const p of project.pipes) {
    (adj.get(p.from) ?? adj.set(p.from, []).get(p.from)!).push({ pipe: p, other: p.to });
    (adj.get(p.to) ?? adj.set(p.to, []).get(p.to)!).push({ pipe: p, other: p.from });
  }
  const heads = new Map<string, number>();
  for (const s of project.sprinklers) heads.set(s.nodeId, (heads.get(s.nodeId) ?? 0) + 1);

  // recorrido en anchura: padre de cada nodo y orden de visita
  const parentPipe = new Map<string, Pipe>();
  const seen = new Set<string>([project.supply.nodeId]);
  const order: string[] = [project.supply.nodeId];
  const treePipes = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    for (const { pipe, other } of adj.get(n) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      parentPipe.set(other, pipe);
      treePipes.add(pipe.id);
      order.push(other);
    }
  }
  const sub = new Map<string, number>();
  const counts = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    const total = (sub.get(n) ?? 0) + (heads.get(n) ?? 0);
    const pp = parentPipe.get(n);
    if (!pp) continue;
    counts.set(pp.id, total);
    const up = pp.from === n ? pp.to : pp.from;
    sub.set(up, (sub.get(up) ?? 0) + total);
  }
  const loops = project.pipes.filter((p) => !treePipes.has(p.id) && seen.has(p.from) && seen.has(p.to)).map((p) => p.id);
  const unreachable = project.pipes.filter((p) => !seen.has(p.from) || !seen.has(p.to)).map((p) => p.id);
  return { counts, loops, unreachable };
}

/** Cambia el diámetro de los tubos según la tabla. Modifica el proyecto. */
export function sizeBySchedule(project: Project, opts: SizingOptions = {}): SizingResult {
  const cls = opts.cls ?? scheduleClassFor(project.criteria.hazard, project.criteria.density);
  const roles = new Set<PipeRole>(opts.roles ?? ['riser', 'main', 'cross', 'branch', 'drop']);
  const only = opts.pipeIds ? new Set(opts.pipeIds) : null;
  const { counts, loops, unreachable } = downstreamCounts(project);
  const result: SizingResult = { changed: {}, counts: Object.fromEntries(counts), warnings: [] };
  let tooMany = 0;

  for (const p of project.pipes) {
    if (only && !only.has(p.id)) continue;
    if (!roles.has(p.role)) continue;
    const n = counts.get(p.id);
    if (!n) continue; // no alimenta rociadores (o no se pudo contar)
    let size = scheduleSize(cls, isCopper(project, p), n);
    if (!size) {
      tooMany++;
      const table = SCHEDULES[cls][isCopper(project, p) ? 'copper' : 'steel'];
      size = table[table.length - 1][0];
    }
    // el tamaño más cercano hacia arriba que exista para ese material
    const available = sizesFor(p.material, project);
    const wanted = NOMINAL_SIZES.indexOf(size);
    const pick = available.find((s) => NOMINAL_SIZES.indexOf(s) >= wanted);
    if (!pick) {
      result.warnings.push(`El tubo ${p.id}: el material no tiene un diámetro de ${size}" o mayor`);
      continue;
    }
    if (pick !== p.size) {
      result.changed[p.id] = [p.size, pick];
      p.size = pick;
    }
  }
  if (loops.length)
    result.warnings.push(
      `La red tiene lazos (${loops.length} tubo${loops.length > 1 ? 's' : ''}); la tabla es para redes en árbol, así que esos tubos no se dimensionaron. Use el cálculo hidráulico.`,
    );
  if (unreachable.length) result.warnings.push(`${unreachable.length} tubo(s) no están conectados al suministro y no se dimensionaron`);
  if (tooMany) result.warnings.push(`${tooMany} tubo(s) alimentan más rociadores de los que permite la tabla; quedaron con el diámetro mayor de la tabla`);
  return result;
}
