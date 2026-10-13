/**
 * Accesorios automáticos: codos, tees y cruces deducidos del dibujo para el cálculo hidráulico.
 *
 * Reglas (práctica usual de cálculo según NFPA 13):
 *  - Nodo con 2 tubos que forman ángulo: codo de 90° (o de 45°), cargado al tubo de menor diámetro.
 *  - Nodo con 3 tubos: los dos más alineados son el paso de la tee; la tee (flujo que gira 90°)
 *    se carga al tercer tubo, la derivación, con el diámetro de esa derivación.
 *  - Nodo con 4 o más tubos (cruz): el par alineado de mayor diámetro es el paso; cada uno de los
 *    demás recibe una tee.
 *  - Los tubos en línea recta no llevan accesorio (las uniones no se cuentan).
 *  - Si el usuario puso a mano codos o tees en un tubo, en los dos extremos de ese tubo no se
 *    ponen accesorios automáticos (se supone que el usuario ya contó los de esa unión).
 *  - En el punto de suministro no se ponen: el agua entra por ahí y sus accesorios son parte
 *    de la acometida (la prueba de suministro).
 *
 * Se activa con `project.autoFittings` (los proyectos nuevos lo traen activado).
 */
import type { FittingType } from './fittings';
import type { FittingEntry, Project } from './model';
import { NOMINAL_SIZES, type NominalSize } from './pipes';

const GEOMETRIC: FittingType[] = ['elbow45', 'elbow90', 'elbow90long', 'tee'];

interface Inc {
  pipeId: string;
  size: NominalSize;
  dir: [number, number, number];
}

const rank = (s: NominalSize) => NOMINAL_SIZES.indexOf(s);
const dot = (a: Inc, b: Inc) => a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2];

/** Accesorios automáticos por tubo. Vacío si la opción está apagada. */
export function autoFittings(project: Project): Map<string, FittingEntry[]> {
  const out = new Map<string, FittingEntry[]>();
  if (!project.autoFittings) return out;

  const manual = new Set(project.pipes.filter((p) => p.fittings.some((f) => f.count > 0 && GEOMETRIC.includes(f.type))).map((p) => p.id));
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const inc = new Map<string, Inc[]>();
  for (const p of project.pipes) {
    const a = nodes.get(p.from);
    const b = nodes.get(p.to);
    if (!a || !b) continue;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-9) continue;
    const u: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
    const push = (id: string, v: [number, number, number]) => {
      const list = inc.get(id) ?? [];
      list.push({ pipeId: p.id, size: p.size, dir: v });
      inc.set(id, list);
    };
    push(a.id, u);
    push(b.id, [-u[0], -u[1], -u[2]]);
  }

  const charge = (pipeId: string, type: FittingType) => {
    const list = out.get(pipeId) ?? [];
    const e = list.find((f) => f.type === type);
    if (e) e.count++;
    else list.push({ type, count: 1 });
    out.set(pipeId, list);
  };

  for (const [nodeId, list] of inc) {
    if (list.length < 2 || nodeId === project.supply.nodeId) continue;
    if (list.some((x) => manual.has(x.pipeId))) continue;
    if (list.length === 2) {
      const [a, b] = list;
      const deviation = (Math.acos(Math.max(-1, Math.min(1, -dot(a, b)))) * 180) / Math.PI;
      if (deviation < 10) continue; // en línea recta
      const type: FittingType = Math.abs(deviation - 45) <= 15 ? 'elbow45' : 'elbow90';
      // al tubo de menor diámetro; si son iguales, a uno fijo para que el resultado sea estable
      const target = rank(a.size) < rank(b.size) ? a : rank(b.size) < rank(a.size) ? b : a.pipeId > b.pipeId ? a : b;
      charge(target.pipeId, type);
      continue;
    }
    // paso de la tee/cruz: el par más alineado (si hay varios casi rectos, el de mayor diámetro)
    let run: [Inc, Inc] | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const straight = -dot(list[i], list[j]);
        if (straight < 0.9) continue; // no están en línea
        const score = Math.max(rank(list[i].size), rank(list[j].size)) * 10 + straight;
        if (score > bestScore) {
          bestScore = score;
          run = [list[i], list[j]];
        }
      }
    }
    if (run) {
      for (const x of list) if (x !== run[0] && x !== run[1]) charge(x.pipeId, 'tee');
    } else {
      // sin paso recto: tee en todos menos el de mayor diámetro
      const sorted = [...list].sort((p, q) => rank(q.size) - rank(p.size));
      for (const x of sorted.slice(1)) charge(x.pipeId, 'tee');
    }
  }
  return out;
}
