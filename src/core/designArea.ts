/**
 * Área de diseño (área remota) según NFPA 13, método densidad/área.
 *
 *  - Número de rociadores: N = área de diseño / cobertura por rociador (se redondea hacia arriba).
 *  - Forma: rectangular, con el lado paralelo a los ramales de al menos 1,2·√A.
 *    Rociadores por ramal: n = 1,2·√A / S (S = separación en el ramal), hacia arriba.
 *  - Ubicación: la hidráulicamente más exigente.
 *
 * Los ramales se reconocen por la geometría: rociadores alineados en la dirección de los ramales
 * del proyecto, a la misma altura. Así sirve también para redes dibujadas a mano.
 */
import { calculate, type CalcResult } from './calculate';
import type { Project } from './model';

const FT_TOL = 0.75; // tolerancia para considerar dos rociadores en la misma línea (ft)

export interface Dir2 {
  x: number;
  y: number;
}

/** Dirección de los ramales: la dirección dominante de los tubos de ramal (o de todos los horizontales) */
export function branchDirection(p: Project): Dir2 {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const acc = (filter: (role: string) => boolean) => {
    let c = 0;
    let s = 0;
    for (const pp of p.pipes) {
      if (!filter(pp.role)) continue;
      const a = nodes.get(pp.from);
      const b = nodes.get(pp.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const h = Math.hypot(dx, dy);
      if (h < 1e-6 || Math.abs(b.z - a.z) > h) continue; // tramos verticales no cuentan
      const ang = 2 * Math.atan2(dy, dx); // ángulo doble: 0° y 180° son la misma dirección
      c += h * Math.cos(ang);
      s += h * Math.sin(ang);
    }
    return { c, s };
  };
  let v = acc((r) => r === 'branch');
  if (Math.hypot(v.c, v.s) < 1e-6) v = acc((r) => r !== 'feed');
  if (Math.hypot(v.c, v.s) < 1e-6) return { x: 1, y: 0 };
  const ang = Math.atan2(v.s, v.c) / 2;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}

export interface HeadPos {
  id: string;
  /** coordenada a lo largo de los ramales y perpendicular (ft) */
  a: number;
  c: number;
  z: number;
  coverage: number;
}

export interface SprinklerLine {
  heads: HeadPos[]; // ordenados a lo largo
  /** separación típica entre rociadores (ft) */
  s: number;
  c: number;
  z: number;
}

const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Rociadores agrupados en líneas (ramales) */
export function sprinklerLines(p: Project, dir = branchDirection(p)): SprinklerLine[] {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const heads: HeadPos[] = [];
  for (const s of p.sprinklers) {
    const n = nodes.get(s.nodeId);
    if (!n) continue;
    heads.push({ id: s.id, a: n.x * dir.x + n.y * dir.y, c: -n.x * dir.y + n.y * dir.x, z: n.z, coverage: s.coverage });
  }
  // agrupar por altura y coordenada perpendicular
  heads.sort((h1, h2) => h1.z - h2.z || h1.c - h2.c);
  const groups: HeadPos[][] = [];
  for (const h of heads) {
    const g = groups.find((x) => Math.abs(x[0].z - h.z) < 3 && Math.abs(x[0].c - h.c) < FT_TOL);
    if (g) g.push(h);
    else groups.push([h]);
  }
  // dentro de cada grupo, partir donde hay un hueco grande (otro cuarto)
  const lines: SprinklerLine[] = [];
  for (const g of groups) {
    g.sort((h1, h2) => h1.a - h2.a);
    const gaps = g.slice(1).map((h, i) => h.a - g[i].a);
    const s0 = median(gaps.filter((x) => x > 0.5));
    const sTyp = Number.isFinite(s0) ? s0 : Math.sqrt(g[0].coverage);
    let cur: HeadPos[] = [g[0]];
    const flush = () => {
      const gg = cur.slice(1).map((h, i) => h.a - cur[i].a);
      const s = median(gg);
      lines.push({ heads: cur, s: Number.isFinite(s) ? s : sTyp, c: median(cur.map((h) => h.c)), z: median(cur.map((h) => h.z)) });
    };
    for (let i = 1; i < g.length; i++) {
      if (g[i].a - g[i - 1].a > Math.max(1.6 * sTyp, sTyp + 3)) {
        flush();
        cur = [];
      }
      cur.push(g[i]);
    }
    flush();
  }
  return lines;
}

export interface AreaRule {
  /** área de diseño (ft²) */
  area: number;
  /** cobertura típica por rociador (ft²) */
  coverage: number;
  /** rociadores necesarios */
  count: number;
  /** lado mínimo paralelo a los ramales: 1,2·√A (ft) */
  minParallel: number;
  /** separación típica en los ramales (ft) */
  s: number;
  /** rociadores por ramal */
  perLine: number;
}

/** Lo que pide la norma para este proyecto */
export function areaRule(p: Project, lines = sprinklerLines(p)): AreaRule {
  const area = p.criteria.area;
  const coverage = p.sprinklers.length ? median(p.sprinklers.map((s) => s.coverage)) : NaN;
  const count = Number.isFinite(coverage) && coverage > 0 ? Math.max(1, Math.ceil(area / coverage - 1e-9)) : 0;
  const minParallel = 1.2 * Math.sqrt(area);
  const multi = lines.filter((l) => l.heads.length > 1);
  const s = multi.length ? median(multi.map((l) => l.s)) : Math.sqrt(coverage || 100);
  const perLine = Math.max(1, Math.ceil(minParallel / s - 1e-9));
  return { area, coverage, count, minParallel, s, perLine };
}

export interface AreaCheck {
  rule: AreaRule;
  flowing: number;
  coverage: number;
  /** largo del área paralelo a los ramales (ft) y ancho */
  parallel: number;
  width: number;
  /** cumple cada regla */
  countOk: boolean;
  coverageOk: boolean;
  shapeOk: boolean;
  /** contorno del área en planta (4 esquinas) y su altura */
  outline: { x: number; y: number }[];
  z: number;
}

/** Revisa el área de diseño actual (los rociadores abiertos) contra la norma */
export function checkDesignArea(p: Project): AreaCheck | null {
  const dir = branchDirection(p);
  const lines = sprinklerLines(p, dir);
  const rule = areaRule(p, lines);
  const flowing = new Set(p.sprinklers.filter((s) => s.inDesignArea).map((s) => s.id));
  if (!flowing.size) return null;
  const coverage = p.sprinklers.filter((s) => flowing.has(s.id)).reduce((a, s) => a + s.coverage, 0);
  const used = lines.map((l) => ({ l, open: l.heads.filter((h) => flowing.has(h.id)) })).filter((x) => x.open.length);
  const all = used.flatMap((x) => x.open);
  const s = rule.s;
  // separación entre ramales
  const cs = [...new Set(used.map((x) => Math.round(x.l.c * 100) / 100))].sort((a, b) => a - b);
  const lineGap = cs.length > 1 ? median(cs.slice(1).map((c, i) => c - cs[i])) : rule.coverage / s;
  const aMin = Math.min(...all.map((h) => h.a)) - s / 2;
  const aMax = Math.max(...all.map((h) => h.a)) + s / 2;
  const cMin = Math.min(...all.map((h) => h.c)) - lineGap / 2;
  const cMax = Math.max(...all.map((h) => h.c)) + lineGap / 2;
  const parallel = Math.max(...used.map((x) => x.open.length)) * s;
  // si los ramales son más cortos que lo pedido y están abiertos completos, también cumple
  const wholeShortLines = used.every((x) => x.open.length === x.l.heads.length && x.l.heads.length < rule.perLine);
  const toXY = (a: number, c: number) => ({ x: a * dir.x - c * dir.y, y: a * dir.y + c * dir.x });
  return {
    rule,
    flowing: flowing.size,
    coverage,
    parallel,
    width: cMax - cMin,
    countOk: flowing.size >= rule.count,
    coverageOk: coverage + 1e-6 >= rule.area,
    shapeOk: parallel + 0.05 * s >= rule.minParallel || wholeShortLines,
    outline: [toXY(aMin, cMin), toXY(aMax, cMin), toXY(aMax, cMax), toXY(aMin, cMax)],
    z: median(all.map((h) => h.z)),
  };
}

/** Rociadores dentro de un rectángulo alineado con los ramales (centro y medidas en ft) */
export function sprinklersInBox(p: Project, cx: number, cy: number, parallel: number, width: number, dir = branchDirection(p)): string[] {
  const ca = cx * dir.x + cy * dir.y;
  const cc = -cx * dir.y + cy * dir.x;
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  return p.sprinklers
    .filter((s) => {
      const n = nodes.get(s.nodeId);
      if (!n) return false;
      const a = n.x * dir.x + n.y * dir.y - ca;
      const c = -n.x * dir.y + n.y * dir.x - cc;
      return Math.abs(a) <= parallel / 2 && Math.abs(c) <= width / 2;
    })
    .map((s) => s.id);
}

/** Margen del suministro con estos rociadores abiertos (más bajo = más exigente) */
function demandScore(p: Project, ids: string[]): number {
  const probe: Project = { ...p, sprinklers: p.sprinklers.map((s) => ({ ...s, inDesignArea: ids.includes(s.id) })) };
  const r: CalcResult = calculate(probe);
  if (!r.ok) return Infinity;
  return r.supply ? r.supply.margin : -r.requiredPressure;
}

/**
 * Área remota: el rectángulo de N rociadores con n por ramal que exige más al suministro.
 * Si la red no deja reconocer ramales, se escogen los N rociadores más remotos.
 */
export function remoteArea(p: Project): string[] {
  if (!p.sprinklers.length) return [];
  const dir = branchDirection(p);
  const lines = sprinklerLines(p, dir);
  const rule = areaRule(p, lines);
  const n = Math.min(rule.count, p.sprinklers.length);

  // presión de cada rociador con todos abiertos: indica qué tan remoto es
  const probe: Project = JSON.parse(JSON.stringify(p));
  probe.sprinklers.forEach((s) => (s.inDesignArea = true));
  probe.criteria.hoseAllowance = 0;
  const pr = calculate(probe);
  if (!pr.ok) return [];
  const remote = (id: string) => {
    const r = pr.sprinklers[id];
    return r ? r.pressure - r.requiredPressure : 0;
  };

  // líneas ordenadas por altura y posición perpendicular; vecinas si están a menos de 1,6 veces la separación típica
  const sorted = [...lines].sort((l1, l2) => l1.z - l2.z || l1.c - l2.c);
  const gaps = sorted.slice(1).map((l, i) => (Math.abs(l.z - sorted[i].z) < 3 ? l.c - sorted[i].c : Infinity));
  const typGap = median(gaps.filter((g) => Number.isFinite(g) && g > FT_TOL)) || Math.sqrt(rule.coverage);

  interface Cand {
    ids: string[];
    score: number;
  }
  const cands: Cand[] = [];
  const seen = new Set<string>();
  const add = (ids: string[]) => {
    const key = [...ids].sort().join(',');
    if (seen.has(key) || ids.length < n) return;
    seen.add(key);
    cands.push({ ids, score: ids.reduce((a, id) => a + remote(id), 0) / ids.length });
  };

  for (let i = 0; i < sorted.length; i++) {
    // juntar líneas vecinas desde la i hasta tener N rociadores en la ventana
    for (let k = 1; i + k <= sorted.length && k <= 60; k++) {
      const run = sorted.slice(i, i + k);
      if (k > 1 && !(gaps[i + k - 2] < 1.6 * typGap)) break;
      // posiciones de inicio de la ventana a lo largo de los ramales
      const starts = [...new Set(run.flatMap((l) => l.heads.map((h) => Math.round(h.a * 10) / 10)))];
      let enough = false;
      for (const a0 of starts) {
        for (const sense of [1, -1]) {
          // ventana de n por ramal desde a0 hacia un lado
          const lo = sense > 0 ? a0 - rule.s / 2 : a0 - (rule.perLine - 0.5) * rule.s;
          const hi = sense > 0 ? a0 + (rule.perLine - 0.5) * rule.s : a0 + rule.s / 2;
          const perLine = run.map((l) => l.heads.filter((h) => h.a >= lo - 0.01 && h.a <= hi + 0.01));
          const total = perLine.reduce((a, x) => a + x.length, 0);
          if (total < n) continue;
          enough = true;
          // sobran rociadores: se quitan del ramal de un extremo, dejando los más remotos
          for (const trimEnd of [0, run.length - 1]) {
            const extra = total - n;
            const sets = perLine.map((x) => [...x]);
            const t = sets[trimEnd];
            if (extra >= t.length) continue;
            t.sort((h1, h2) => remote(h1.id) - remote(h2.id));
            sets[trimEnd] = t.slice(0, t.length - extra);
            add(sets.flat().map((h) => h.id));
          }
        }
      }
      if (enough) break;
    }
  }

  if (!cands.length) {
    // sin ramales reconocibles: los N más remotos
    return [...p.sprinklers].sort((s1, s2) => remote(s1.id) - remote(s2.id)).slice(0, n).map((s) => s.id);
  }
  // los más prometedores se calculan de verdad
  cands.sort((c1, c2) => c1.score - c2.score);
  let best = cands[0];
  let bestScore = Infinity;
  for (const c of cands.slice(0, 16)) {
    const sc = demandScore(p, c.ids);
    if (sc < bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  return best.ids;
}

export interface AreaBox {
  dir: Dir2;
  /** largo paralelo a los ramales y ancho (ft) */
  parallel: number;
  width: number;
  rule: AreaRule;
  /** separación típica entre ramales (ft) */
  lineGap: number;
}

/** Medidas del rectángulo del área de diseño: n rociadores por ramal × los ramales necesarios */
export function areaBox(p: Project): AreaBox {
  const dir = branchDirection(p);
  const lines = sprinklerLines(p, dir);
  const rule = areaRule(p, lines);
  const sorted = [...lines].sort((l1, l2) => l1.z - l2.z || l1.c - l2.c);
  const gaps = sorted
    .slice(1)
    .map((l, i) => (Math.abs(l.z - sorted[i].z) < 3 ? l.c - sorted[i].c : NaN))
    .filter((g) => Number.isFinite(g) && g > FT_TOL);
  const lineGap = median(gaps) || rule.coverage / rule.s;
  const nLines = Math.max(1, Math.ceil(rule.count / rule.perLine));
  return { dir, parallel: rule.perLine * rule.s, width: nLines * lineGap, rule, lineGap };
}

/**
 * Rociadores del área de diseño ubicada con centro en (x, y). Si el rectángulo toma más de los
 * necesarios, se quitan del ramal del borde más cercano al suministro, empezando por los más
 * cercanos a él (el ramal incompleto queda del lado de la alimentación, como en un cálculo a mano).
 */
export function pickAreaAt(p: Project, x: number, y: number, box = areaBox(p)): string[] {
  const { dir, rule } = box;
  // un poco más grande para no perder rociadores justo en el borde
  const ids = new Set(sprinklersInBox(p, x, y, box.parallel + 0.1, box.width + 0.1, dir));
  const lines = sprinklerLines(p, dir)
    .map((l) => ({ ...l, heads: l.heads.filter((h) => ids.has(h.id)) }))
    .filter((l) => l.heads.length);
  let extra = ids.size - rule.count;
  if (extra <= 0 || !lines.length) return [...ids];
  const supply = p.nodes.find((n) => n.id === p.supply.nodeId);
  const sa = supply ? supply.x * dir.x + supply.y * dir.y : 0;
  const sc = supply ? -supply.x * dir.y + supply.y * dir.x : 0;
  // ramales de borde: el más cercano al suministro primero
  lines.sort((l1, l2) => Math.abs(l1.c - sc) - Math.abs(l2.c - sc));
  for (const l of lines) {
    if (extra <= 0) break;
    const hs = [...l.heads].sort((h1, h2) => Math.abs(h1.a - sa) - Math.abs(h2.a - sa));
    for (const h of hs) {
      if (extra <= 0) break;
      ids.delete(h.id);
      extra--;
    }
  }
  return [...ids];
}
