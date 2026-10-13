/**
 * Reglas de NFPA 13 que cambian con el tipo de sistema (húmedo, seco, preacción).
 *
 *  - Seco y preacción de doble enclavamiento: el área de diseño se aumenta 30 %
 *    (sin cambiar la densidad).
 *  - Seco y preacción: la tubería de acero se calcula con C = 100 (en húmedo, 120).
 *  - Seco (y doble enclavamiento): capacidad de la red. Hasta 500 gal no se exige tiempo de
 *    entrega del agua; hasta 750 gal tampoco si tiene dispositivo de apertura rápida (QOD).
 *    Más grande, hay que demostrar que el agua llega a tiempo (por cálculo o prueba):
 *    ligero 60 s, ordinario 50 s, extra 45 s.
 *  - Seco: los rociadores colgantes y de pared deben ser de tipo seco (salvo los montantes o
 *    los que queden en zona sin riesgo de congelamiento).
 *  - El CPVC está listado para sistemas húmedos.
 */
import type { HazardId } from './hazards';
import type { Pipe, Project, SystemType } from './model';
import { getMaterial, internalDiameter } from './pipes';
import { getSprinklerModel } from './catalog';

export const systemType = (p: Project): SystemType => p.criteria.systemType ?? 'wet';

const increasesArea = (t: SystemType) => t === 'dry' || t === 'preaction-double';
const usesDryC = (t: SystemType) => t !== 'wet';

/** Factor del área de diseño por el tipo de sistema (1,3 en seco y doble enclavamiento) */
export function areaFactor(p: Project): number {
  return increasesArea(systemType(p)) ? 1.3 : 1;
}

/** Área de diseño que se usa en el cálculo (ft²) */
export function effectiveDesignArea(p: Project): number {
  return p.criteria.area * areaFactor(p);
}

/** ¿El material es acero (negro o galvanizado)? */
export function isSteel(p: Project, materialId: string): boolean {
  const m = getMaterial(materialId, p);
  return /^steel/.test(m.id) || /acero|steel|galvaniz/i.test(m.name);
}

/** Coeficiente C con el que se calcula el tubo: en seco y preacción el acero va con C = 100 */
export function effectiveC(p: Project, pipe: Pipe): number {
  if (usesDryC(systemType(p)) && isSteel(p, pipe.material)) return Math.min(pipe.c, 100);
  return pipe.c;
}

const GAL_PER_FT3 = 7.48052;

/** Tubos de la parte seca (todo menos la alimentación y el montante, que llevan agua) */
export function dryPipes(p: Project): Pipe[] {
  return p.pipes.filter((x) => x.role !== 'feed' && x.role !== 'riser');
}

/** Volumen de agua que cabe en los tubos dados (gal) */
export function pipeVolumeGal(p: Project, pipes: Pipe[]): number {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  let v = 0;
  for (const x of pipes) {
    const a = nodes.get(x.from);
    const b = nodes.get(x.to);
    if (!a || !b) continue;
    const len = x.lengthOverride ?? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const d = x.idOverride ?? internalDiameter(x.material, x.size, p) ?? 0;
    v += (Math.PI / 4) * (d / 12) ** 2 * len * GAL_PER_FT3;
  }
  return v;
}

/** Tiempo máximo de entrega del agua en sistemas secos (s), NFPA 13 */
export function deliveryTimeLimit(h: HazardId, density: number): number {
  if (h === 'light') return 60;
  if (h === 'oh1' || h === 'oh2') return 50;
  if (h === 'eh1' || h === 'eh2') return 45;
  return density <= 0.1 ? 60 : density <= 0.2 ? 50 : 45;
}

export interface SystemCheck {
  type: SystemType;
  areaFactor: number;
  /** volumen de la parte seca (gal), solo seco y doble enclavamiento */
  volume?: number;
  /** volumen hasta el que no se exige tiempo de entrega (gal) */
  volumeLimit?: number;
  /** tiempo de entrega que hay que demostrar si se pasa del volumen (s) */
  deliveryTime?: number;
  notes: string[];
  warnings: string[];
}

/** Revisión de las reglas del tipo de sistema */
export function checkSystem(p: Project): SystemCheck {
  const type = systemType(p);
  const out: SystemCheck = { type, areaFactor: areaFactor(p), notes: [], warnings: [] };
  if (type === 'wet') return out;
  if (out.areaFactor > 1) out.notes.push(`Sistema ${type === 'dry' ? 'seco' : 'de preacción de doble enclavamiento'}: área de diseño aumentada 30 %.`);
  if (p.pipes.some((x) => isSteel(p, x.material) && x.c > 100)) out.notes.push('La tubería de acero se calcula con C = 100.');
  if (type === 'dry' || type === 'preaction-double') {
    const vol = pipeVolumeGal(p, dryPipes(p));
    const qod = !!p.criteria.quickOpening;
    const limit = type === 'dry' && qod ? 750 : 500;
    const t = deliveryTimeLimit(p.criteria.hazard, p.criteria.density);
    out.volume = vol;
    out.volumeLimit = limit;
    out.deliveryTime = t;
    if (vol > limit) {
      out.warnings.push(
        `La parte seca tiene ${vol.toFixed(0)} gal, más de ${limit} gal${type === 'dry' && !qod ? ' (sin acelerador)' : ''}: ` +
          `hay que demostrar que el agua llega al rociador más lejano en ${t} s o menos (cálculo de tiempo de entrega o prueba).`,
      );
    }
  }
  const wetOnly = type !== 'dry' ? [] : p.sprinklers.filter((s) => {
    if (s.orientation === 'upright') return false;
    return !getSprinklerModel(s.modelId, p)?.dry;
  });
  if (wetOnly.length)
    out.warnings.push(
      `${wetOnly.length} rociador(es) colgantes, ocultos o de pared no son de tipo seco: en un sistema seco deben ser montantes o de tipo seco (salvo zonas sin riesgo de congelamiento).`,
    );
  if (p.pipes.some((x) => /cpvc/i.test(x.material) || /cpvc/i.test(getMaterial(x.material, p).name)))
    out.warnings.push('El CPVC está listado para sistemas húmedos; no se usa en sistemas secos ni de preacción salvo listado especial.');
  return out;
}
