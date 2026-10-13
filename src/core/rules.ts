/**
 * Revisión del diseño contra NFPA 13 (rociadores estándar de cobertura normal).
 *
 * Reglas que se revisan (capítulo 10 de NFPA 13, edición 2022, salvo que se diga otra cosa):
 *  - Separación máxima entre rociadores de un ramal y entre ramales (15 ft; 12 ft en riesgo extra;
 *    rociadores de pared: 14 ft en riesgo leve y 10 ft en ordinario).
 *  - Área máxima por rociador, medida con la ubicación real (S × L).
 *  - Distancia mínima de 6 ft entre rociadores.
 *  - Distancia a los muros: máximo la mitad de la separación permitida y mínimo 4 in.
 *  - Deflector bajo la losa o el cielo: de 1 a 12 in (de pared: 4 a 6 in).
 *  - Presión mínima de 7 psi en cada rociador abierto (o la de su listado).
 *  - Diámetro mínimo de 1" en acero y cobre.
 *  - Factor K mínimo de 5.6 (fuera de riesgo leve) y de 11.2 en riesgo extra con densidad
 *    mayor de 0.34 gpm/ft².
 *  - Rociadores aptos para sistema seco, área de diseño y soportes (con las revisiones que ya
 *    tiene el programa).
 *
 * Son revisiones de geometría y de cálculo, no reemplazan la revisión de un ingeniero: no se
 * revisan obstrucciones, vigas, cielos inclinados ni rociadores especiales de cobertura extendida.
 */
import type { CalcResult } from './calculate';
import { getElementType, getSprinklerModel } from './catalog';
import { ELEMENT_KIND_SHAPE } from './catalog';
import { branchDirection, checkDesignArea, sprinklerLines, type SprinklerLine } from './designArea';
import { checkHangers } from './hangers';
import { HAZARDS } from './hazards';
import { spacingLimits } from './layout';
import type { Project, Sprinkler } from './model';
import { materialFamily, NOMINAL_SIZES, sizeLabel } from './pipes';
import { checkSystem } from './systemType';
import { fmt } from './units';

export type RuleSeverity = 'error' | 'warning' | 'info';

export type RuleId =
  | 'spacing-branch'
  | 'spacing-lines'
  | 'coverage'
  | 'coverage-calc'
  | 'min-distance'
  | 'wall-max'
  | 'wall-min'
  | 'deflector'
  | 'pressure'
  | 'pipe-size'
  | 'k-factor'
  | 'dry-type'
  | 'design-area'
  | 'hangers'
  | 'not-checked';

export const RULE_NAMES: Record<RuleId, string> = {
  'spacing-branch': 'Separación entre rociadores del ramal',
  'spacing-lines': 'Separación entre ramales',
  coverage: 'Área máxima por rociador',
  'coverage-calc': 'Cobertura usada en el cálculo',
  'min-distance': 'Distancia mínima entre rociadores',
  'wall-max': 'Distancia máxima al muro',
  'wall-min': 'Distancia mínima al muro',
  deflector: 'Deflector bajo la losa o el cielo',
  pressure: 'Presión mínima en los rociadores',
  'pipe-size': 'Diámetro mínimo de tubería',
  'k-factor': 'Factor K mínimo',
  'dry-type': 'Rociadores en sistema seco',
  'design-area': 'Área de diseño',
  hangers: 'Soportes',
  'not-checked': 'No revisado',
};

/** Referencia a la norma de cada regla */
export const RULE_REFS: Record<RuleId, string> = {
  'spacing-branch': 'NFPA 13, 10.2.5 (tablas 10.2.4.2.1) · 10.3.5',
  'spacing-lines': 'NFPA 13, 10.2.5 (tablas 10.2.4.2.1)',
  coverage: 'NFPA 13, 10.2.4',
  'coverage-calc': 'NFPA 13, 10.2.4 y método densidad/área',
  'min-distance': 'NFPA 13, 10.2.5 (6 ft)',
  'wall-max': 'NFPA 13, 10.2.5 (S/2)',
  'wall-min': 'NFPA 13, 10.2.5 (4 in)',
  deflector: 'NFPA 13, 10.2.6 · 10.3.6',
  pressure: 'NFPA 13, presión mínima de operación (7 psi)',
  'pipe-size': 'NFPA 13, diámetro mínimo de tubería',
  'k-factor': 'NFPA 13, factor K mínimo',
  'dry-type': 'NFPA 13, rociadores en sistemas secos',
  'design-area': 'NFPA 13, método densidad/área',
  hangers: 'NFPA 13, capítulo de soportes',
  'not-checked': '',
};

export interface RuleFinding {
  rule: RuleId;
  severity: RuleSeverity;
  message: string;
  sprinklerIds?: string[];
  pipeIds?: string[];
  /** punto en planta para ubicar el aviso (ft) */
  at?: { x: number; y: number; z: number };
}

export interface RuleReview {
  findings: RuleFinding[];
  /** reglas que se pudieron revisar */
  checked: RuleId[];
  errors: number;
  warnings: number;
}

const TOL = 0.05; // ft
const MIN_WALL = 4 / 12; // 4 in
const MIN_BETWEEN = 6; // ft

interface Limits {
  maxSpacing: number;
  maxCoverage: number;
}

/** Límites de un rociador: los de tipo estándar, los de pared o los de su hoja técnica */
function limitsFor(p: Project, s: Sprinkler): Limits {
  const base = spacingLimits(p, s.modelId);
  if (s.orientation !== 'sidewall') return base;
  const light = p.criteria.hazard === 'light' || (p.criteria.hazard === 'custom' && p.criteria.density <= 0.1);
  const maxCoverage = Math.min(light ? 196 : 100, getSprinklerModel(s.modelId, p)?.maxCoverage ?? Infinity);
  return { maxSpacing: light ? 14 : 10, maxCoverage };
}

interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  half: number;
}

function wallsOf(p: Project): Wall[] {
  const out: Wall[] = [];
  for (const e of p.elements ?? []) {
    const t = getElementType(e.typeId, p);
    if (t.kind !== 'wall') continue;
    const half = (e.width ?? t.width) / 2;
    for (let i = 0; i + 1 < e.points.length; i++) out.push({ ax: e.points[i].x, ay: e.points[i].y, bx: e.points[i + 1].x, by: e.points[i + 1].y, half });
  }
  return out;
}

/** Distancia desde (x, y) en la dirección (dx, dy) hasta la cara del primer muro (o Infinity) */
function rayToWall(walls: Wall[], x: number, y: number, dx: number, dy: number): number {
  let best = Infinity;
  for (const w of walls) {
    const ex = w.bx - w.ax;
    const ey = w.by - w.ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((w.ax - x) * ey - (w.ay - y) * ex) / den;
    const u = ((w.ax - x) * dy - (w.ay - y) * dx) / den;
    if (t <= 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
    // a la cara del muro: se resta medio espesor medido en la dirección del rayo
    const len = Math.hypot(ex, ey) || 1;
    const sin = Math.abs(den) / len; // |seno| del ángulo entre el rayo y el muro
    const d = t - w.half / Math.max(sin, 1e-3);
    if (d < best) best = Math.max(0, d);
  }
  return best;
}

/** Distancia horizontal desde un punto a la cara del muro más cercano */
function nearestWall(walls: Wall[], x: number, y: number): number {
  let best = Infinity;
  for (const w of walls) {
    const ex = w.bx - w.ax;
    const ey = w.by - w.ay;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - w.ax) * ex + (y - w.ay) * ey) / l2)) : 0;
    const d = Math.hypot(x - (w.ax + t * ex), y - (w.ay + t * ey)) - w.half;
    if (d < best) best = d;
  }
  return best;
}

/** ¿Algún muro corta el segmento entre dos puntos? */
function wallBetween(walls: Wall[], x0: number, y0: number, x1: number, y1: number): boolean {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (!(L > 0)) return false;
  return rayToWall(walls, x0, y0, (x1 - x0) / L, (y1 - y0) / L) < L;
}

const inPolygon = (pts: { x: number; y: number }[], x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** Altura de la losa o el cielo encima de un punto (la más baja), o undefined si no hay nada dibujado */
export function ceilingAbove(p: Project, x: number, y: number, z: number): number | undefined {
  let best = Infinity;
  for (const e of p.elements ?? []) {
    const t = getElementType(e.typeId, p);
    if (t.kind !== 'slab' && t.kind !== 'ceiling') continue;
    if (ELEMENT_KIND_SHAPE[t.kind] !== 'area' || e.points.length < 3) continue;
    if (e.z < z - 2) continue; // lo que está muy por debajo del rociador no es su techo
    if (!inPolygon(e.points, x, y)) continue;
    best = Math.min(best, e.z);
  }
  return Number.isFinite(best) ? best : undefined;
}

/** Revisa el proyecto. `result` es el cálculo hidráulico (para las presiones). */
export function reviewProject(p: Project, result?: CalcResult): RuleReview {
  const u = p.displayUnits;
  const metric = u === 'metric';
  const L = (ft: number) => fmt('length', ft, u, true);
  const A = (ft2: number) => fmt('area', ft2, u, true);
  const findings: RuleFinding[] = [];
  const checked = new Set<RuleId>();
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const spr = new Map(p.sprinklers.map((s) => [s.id, s]));
  const posOf = (id: string) => {
    const s = spr.get(id);
    const n = s ? nodes.get(s.nodeId) : undefined;
    return n ? { x: n.x, y: n.y, z: n.z } : undefined;
  };
  const add = (f: RuleFinding) => findings.push(f);
  const walls = wallsOf(p);

  // ---------- Separaciones y coberturas (geometría de los ramales) ----------
  if (p.sprinklers.length) {
    checked.add('spacing-branch');
    checked.add('min-distance');
    const dir = branchDirection(p);
    const perp = { x: -dir.y, y: dir.x };
    const lines = sprinklerLines(p, dir);
    const toXY = (a: number, c: number) => ({ x: a * dir.x - c * dir.y, y: a * dir.y + c * dir.x });
    const lim = new Map(p.sprinklers.map((s) => [s.id, limitsFor(p, s)]));

    // separación en el ramal
    for (const line of lines) {
      for (let i = 1; i < line.heads.length; i++) {
        const h0 = line.heads[i - 1];
        const h1 = line.heads[i];
        const gap = h1.a - h0.a;
        const max = Math.min(lim.get(h0.id)!.maxSpacing, lim.get(h1.id)!.maxSpacing);
        if (gap > max + TOL)
          add({
            rule: 'spacing-branch',
            severity: 'error',
            message: `Entre ${h0.id} y ${h1.id} hay ${L(gap)} sobre el ramal; el máximo es ${L(max)}.`,
            sprinklerIds: [h0.id, h1.id],
            at: posOf(h0.id),
          });
      }
    }

    // vecinos entre ramales: el ramal más cercano a cada lado que se traslapa a lo largo
    type Side = { line: SprinklerLine; gap: number } | undefined;
    const neighbors = new Map<SprinklerLine, { minus: Side; plus: Side }>();
    for (const l of lines) {
      const a0 = l.heads[0].a - l.s / 2;
      const a1 = l.heads[l.heads.length - 1].a + l.s / 2;
      let minus: Side;
      let plus: Side;
      for (const o of lines) {
        if (o === l || Math.abs(o.z - l.z) > 3) continue;
        const b0 = o.heads[0].a - o.s / 2;
        const b1 = o.heads[o.heads.length - 1].a + o.s / 2;
        if (Math.min(a1, b1) - Math.max(a0, b0) <= 0.5) continue;
        const gap = o.c - l.c;
        if (Math.abs(gap) < 0.75) continue;
        if (gap > 0 && (!plus || gap < plus.gap)) plus = { line: o, gap };
        if (gap < 0 && (!minus || -gap < minus.gap)) minus = { line: o, gap: -gap };
      }
      neighbors.set(l, { minus, plus });
    }
    const reported = new Set<string>();
    for (const l of lines) {
      const nb = neighbors.get(l)!.plus;
      if (!nb) continue;
      const max = Math.min(...l.heads.map((h) => lim.get(h.id)!.maxSpacing), ...nb.line.heads.map((h) => lim.get(h.id)!.maxSpacing));
      // más allá del doble ya suelen ser zonas distintas
      if (nb.gap <= max + TOL || nb.gap > 2 * max) continue;
      const aMid = (Math.max(l.heads[0].a, nb.line.heads[0].a) + Math.min(l.heads[l.heads.length - 1].a, nb.line.heads[nb.line.heads.length - 1].a)) / 2;
      const p0 = toXY(aMid, l.c);
      const p1 = toXY(aMid, nb.line.c);
      if (walls.length && wallBetween(walls, p0.x, p0.y, p1.x, p1.y)) continue;
      const key = `${l.heads[0].id}|${nb.line.heads[0].id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      checked.add('spacing-lines');
      add({
        rule: 'spacing-lines',
        severity: 'error',
        message: `Entre el ramal de ${l.heads[0].id} y el de ${nb.line.heads[0].id} hay ${L(nb.gap)}; el máximo es ${L(max)}.`,
        sprinklerIds: [l.heads[0].id, nb.line.heads[0].id],
        at: { ...p0, z: l.z },
      });
    }
    if (lines.length > 1) checked.add('spacing-lines');

    // área real por rociador (S × L): distancia al vecino o el doble de la distancia al muro
    checked.add('coverage');
    for (const l of lines) {
      const nb = neighbors.get(l)!;
      for (let i = 0; i < l.heads.length; i++) {
        const h = l.heads[i];
        const s = spr.get(h.id)!;
        const pos = posOf(h.id)!;
        const lm = lim.get(h.id)!;
        const toWall = (dx: number, dy: number) => {
          if (!walls.length) return undefined;
          const d = rayToWall(walls, pos.x, pos.y, dx, dy);
          return d <= 3 * lm.maxSpacing ? d : undefined;
        };
        const prev = i > 0 ? h.a - l.heads[i - 1].a : (() => { const w = toWall(-dir.x, -dir.y); return w === undefined ? undefined : 2 * w; })();
        const next = i < l.heads.length - 1 ? l.heads[i + 1].a - h.a : (() => { const w = toWall(dir.x, dir.y); return w === undefined ? undefined : 2 * w; })();
        const left = nb.minus ? nb.minus.gap : (() => { const w = toWall(-perp.x, -perp.y); return w === undefined ? undefined : 2 * w; })();
        const right = nb.plus ? nb.plus.gap : (() => { const w = toWall(perp.x, perp.y); return w === undefined ? undefined : 2 * w; })();
        const S = Math.max(prev ?? 0, next ?? 0);
        const Lw = Math.max(left ?? 0, right ?? 0);
        if (!(S > 0) || !(Lw > 0)) continue;
        // un ramal solo con vecinos a un lado y sin muros: no se sabe su L
        if ((prev === undefined && next === undefined) || (left === undefined && right === undefined)) continue;
        const area = S * Lw;
        if (area > lm.maxCoverage * 1.005)
          add({
            rule: 'coverage',
            severity: 'error',
            message: `${h.id} protege ${L(S)} × ${L(Lw)} = ${A(area)}; el máximo es ${A(lm.maxCoverage)}.`,
            sprinklerIds: [h.id],
            at: pos,
          });
        else if (s.inDesignArea && area > s.coverage * 1.03) {
          checked.add('coverage-calc');
          add({
            rule: 'coverage-calc',
            severity: 'warning',
            message: `${h.id} está en el área de diseño con una cobertura de ${A(s.coverage)}, pero por su ubicación protege ${A(area)}: el caudal calculado queda corto.`,
            sprinklerIds: [h.id],
            at: pos,
          });
        }
      }
    }
    checked.add('coverage-calc');

    // distancia mínima entre rociadores (rejilla para no comparar todos con todos)
    const cell = MIN_BETWEEN;
    const grid = new Map<string, string[]>();
    const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    for (const s of p.sprinklers) {
      const n = nodes.get(s.nodeId);
      if (!n) continue;
      const k = key(n.x, n.y);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(s.id);
    }
    const close = new Set<string>();
    for (const s of p.sprinklers) {
      const n = nodes.get(s.nodeId);
      if (!n) continue;
      const gx = Math.floor(n.x / cell);
      const gy = Math.floor(n.y / cell);
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const id of grid.get(`${gx + i},${gy + j}`) ?? []) {
            if (id <= s.id) continue;
            const m = nodes.get(spr.get(id)!.nodeId)!;
            if (Math.abs(m.z - n.z) > 2) continue;
            const d = Math.hypot(m.x - n.x, m.y - n.y);
            if (d < MIN_BETWEEN - TOL && !close.has(`${s.id}|${id}`)) {
              close.add(`${s.id}|${id}`);
              add({
                rule: 'min-distance',
                severity: 'warning',
                message: `${s.id} y ${id} están a ${L(d)}; deben quedar a ${L(MIN_BETWEEN)} o más (salvo que haya una pantalla entre ellos).`,
                sprinklerIds: [s.id, id],
                at: { x: n.x, y: n.y, z: n.z },
              });
            }
          }
    }

    // distancia a los muros
    if (walls.length) {
      checked.add('wall-min');
      checked.add('wall-max');
      for (const s of p.sprinklers) {
        const n = nodes.get(s.nodeId);
        if (!n) continue;
        const d = nearestWall(walls, n.x, n.y);
        // de pared: va pegado al muro, no aplica el mínimo
        if (s.orientation !== 'sidewall' && d < MIN_WALL - 0.01)
          add({
            rule: 'wall-min',
            severity: 'warning',
            message: `${s.id} queda a ${L(Math.max(0, d))} del muro; el mínimo es ${L(MIN_WALL)}.`,
            sprinklerIds: [s.id],
            at: { x: n.x, y: n.y, z: n.z },
          });
      }
      // los extremos de cada ramal y los ramales de las orillas
      for (const l of lines) {
        const nb = neighbors.get(l)!;
        const ends: { id: string; dx: number; dy: number }[] = [];
        ends.push({ id: l.heads[0].id, dx: -dir.x, dy: -dir.y });
        ends.push({ id: l.heads[l.heads.length - 1].id, dx: dir.x, dy: dir.y });
        if (!nb.minus) for (const h of l.heads) ends.push({ id: h.id, dx: -perp.x, dy: -perp.y });
        if (!nb.plus) for (const h of l.heads) ends.push({ id: h.id, dx: perp.x, dy: perp.y });
        const far: string[] = [];
        let worst = 0;
        let limit = 0;
        for (const e of ends) {
          const s = spr.get(e.id)!;
          if (s.orientation === 'sidewall') continue;
          const pos = posOf(e.id)!;
          const max = lim.get(e.id)!.maxSpacing / 2;
          const d = rayToWall(walls, pos.x, pos.y, e.dx, e.dy);
          if (d > max + TOL && d <= 3 * max) {
            if (!far.includes(e.id)) far.push(e.id);
            if (d > worst) (worst = d), (limit = max);
          }
        }
        if (far.length)
          add({
            rule: 'wall-max',
            severity: 'error',
            message:
              far.length === 1
                ? `${far[0]} queda a ${L(worst)} del muro; el máximo es ${L(limit)} (la mitad de la separación permitida).`
                : `${far.length} rociadores del ramal de ${l.heads[0].id} quedan lejos del muro (hasta ${L(worst)}; máximo ${L(limit)}).`,
            sprinklerIds: far,
            at: posOf(far[0]),
          });
      }
    }

    // deflector bajo la losa o el cielo
    let withCeiling = 0;
    const noCeiling: string[] = [];
    for (const s of p.sprinklers) {
      const n = nodes.get(s.nodeId);
      if (!n) continue;
      const deflZ = n.z + (s.orientation === 'upright' ? 0.25 : 0);
      const c = ceilingAbove(p, n.x, n.y, deflZ);
      if (c === undefined) {
        noCeiling.push(s.id);
        continue;
      }
      withCeiling++;
      const d = c - deflZ;
      const at = { x: n.x, y: n.y, z: n.z };
      if (d < -0.02) {
        add({ rule: 'deflector', severity: 'error', message: `${s.id} queda por encima de la losa o el cielo (${L(-d)}).`, sprinklerIds: [s.id], at });
        continue;
      }
      if (s.orientation === 'concealed') continue; // los ocultos van al ras del cielo según su listado
      const [lo, hi] = s.orientation === 'sidewall' ? [4 / 12, 6 / 12] : [1 / 12, 1];
      if (d < lo - 0.01 || d > hi + 0.01)
        add({
          rule: 'deflector',
          severity: 'warning',
          message:
            `El deflector de ${s.id} queda ${L(d)} bajo el techo; debe estar entre ${L(lo)} y ${L(hi)}` +
            (s.orientation === 'sidewall' ? ' (algunos de pared están listados hasta 12 in).' : ' en techo sin obstrucciones.'),
          sprinklerIds: [s.id],
          at,
        });
    }
    if (withCeiling) checked.add('deflector');
    if (noCeiling.length && (p.elements ?? []).length)
      add({
        rule: 'not-checked',
        severity: 'info',
        message: `${noCeiling.length} rociador(es) no tienen losa ni cielo dibujado encima: no se revisó la distancia del deflector.`,
        sprinklerIds: noCeiling,
      });
    if (!(p.elements ?? []).length)
      add({
        rule: 'not-checked',
        severity: 'info',
        message: 'No hay muros, losas ni cielos dibujados: no se revisaron las distancias a muros ni la altura del deflector.',
      });
  }

  // ---------- Presiones (del cálculo) ----------
  if (result?.ok) {
    checked.add('pressure');
    const low: string[] = [];
    let worst = Infinity;
    let need = 7;
    for (const r of Object.values(result.sprinklers)) {
      if (!r.flowing) continue;
      const s = spr.get(r.id);
      const min = Math.max(7, getSprinklerModel(s?.modelId, p)?.minPressure ?? 0);
      if (r.pressure < min - 0.01) {
        low.push(r.id);
        if (r.pressure < worst) (worst = r.pressure), (need = min);
      }
    }
    if (low.length)
      add({
        rule: 'pressure',
        severity: 'error',
        message: `${low.length} rociador(es) abiertos trabajan por debajo de la presión mínima (el peor a ${fmt('pressure', worst, u, true)}; mínimo ${fmt('pressure', need, u, true)}).`,
        sprinklerIds: low,
        at: posOf(low[0]),
      });
  }

  // ---------- Diámetros mínimos ----------
  checked.add('pipe-size');
  const small = p.pipes.filter((x) => {
    const fam = materialFamily(x.material, p);
    return (fam === 'steel' || fam === 'copper') && NOMINAL_SIZES.indexOf(x.size) < NOMINAL_SIZES.indexOf('1');
  });
  if (small.length)
    add({
      rule: 'pipe-size',
      severity: 'warning',
      message: `${small.length} tubo(s) de acero o cobre de ${sizeLabel('3/4', metric)}: el mínimo es ${sizeLabel('1', metric)} (salvo excepciones de la norma).`,
      pipeIds: small.map((x) => x.id),
    });

  // ---------- Factor K ----------
  checked.add('k-factor');
  const c = p.criteria;
  const light = c.hazard === 'light' || (c.hazard === 'custom' && c.density <= 0.1);
  const lowK = p.sprinklers.filter((s) => !light && s.k < 5.6 - 1e-6);
  if (lowK.length)
    add({
      rule: 'k-factor',
      severity: 'warning',
      message: `${lowK.length} rociador(es) con K menor de 5.6: fuera de riesgo leve se pide K 5.6 o mayor.`,
      sprinklerIds: lowK.map((s) => s.id),
    });
  if (c.density > 0.34) {
    const lowKx = p.sprinklers.filter((s) => s.k < 11.2 - 1e-6);
    if (lowKx.length)
      add({
        rule: 'k-factor',
        severity: 'warning',
        message: `Con densidad mayor de ${fmt('density', 0.34, u, true)} se piden rociadores de K 11.2 o mayor; ${lowKx.length} tienen K menor.`,
        sprinklerIds: lowKx.map((s) => s.id),
      });
  }

  // ---------- Sistema seco ----------
  const sys = checkSystem(p);
  if (sys.type === 'dry') {
    checked.add('dry-type');
    const wetOnly = p.sprinklers.filter((s) => s.orientation !== 'upright' && !getSprinklerModel(s.modelId, p)?.dry);
    if (wetOnly.length)
      add({
        rule: 'dry-type',
        severity: 'warning',
        message: `${wetOnly.length} rociador(es) colgantes, ocultos o de pared no son de tipo seco: en un sistema seco deben ser montantes o de tipo seco.`,
        sprinklerIds: wetOnly.map((s) => s.id),
      });
  }

  // ---------- Área de diseño ----------
  const area = checkDesignArea(p);
  if (area) {
    checked.add('design-area');
    const open = p.sprinklers.filter((s) => s.inDesignArea).map((s) => s.id);
    if (!area.countOk)
      add({ rule: 'design-area', severity: 'error', message: `El área de diseño tiene ${area.flowing} rociadores; se necesitan ${area.rule.count}.`, sprinklerIds: open });
    if (!area.coverageOk)
      add({ rule: 'design-area', severity: 'error', message: `Los rociadores abiertos cubren ${A(area.coverage)}; el área de diseño es de ${A(area.rule.area)}.`, sprinklerIds: open });
    if (!area.shapeOk)
      add({
        rule: 'design-area',
        severity: 'error',
        message: `El área de diseño mide ${L(area.parallel)} a lo largo de los ramales; debe medir al menos ${L(area.rule.minParallel)} (1,2·√A).`,
        sprinklerIds: open,
      });
  } else if (p.sprinklers.length)
    add({ rule: 'design-area', severity: 'warning', message: 'No hay área de diseño: marque los rociadores que abren o use Sugerir área remota.' });

  // ---------- Soportes ----------
  if ((p.hangers ?? []).length) {
    checked.add('hangers');
    for (const msg of checkHangers(p).problems) add({ rule: 'hangers', severity: 'warning', message: msg });
  }

  if (c.hazard !== 'custom' && !HAZARDS[c.hazard]) checked.delete('coverage');
  const order: Record<RuleSeverity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    findings,
    checked: [...checked],
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  };
}
