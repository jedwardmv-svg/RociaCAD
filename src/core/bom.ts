/**
 * Lista de materiales (cantidades y costos).
 *
 *  - Tubería: longitud total por material y tamaño, y número de tubos comerciales.
 *  - Accesorios: se detectan de la geometría (codos, tees, cruces, reducciones, tapones).
 *  - Válvulas: las que el usuario puso en los tubos (compuerta, mariposa, cheque).
 *  - Rociadores: agrupados por factor K, orientación y temperatura.
 */
import { FITTING_NAMES, VALVE_TYPES } from './fittings';
import { ORIENTATION_NAMES, type Project } from './model';
import { getMaterial, NOMINAL_SIZES, sizeLabel, type MaterialId, type NominalSize } from './pipes';
import { pipeGeometry } from './calculate';

export type BomCategory = 'Tubería' | 'Accesorios' | 'Válvulas' | 'Rociadores';

export interface BomItem {
  /** clave estable para guardar precios */
  key: string;
  category: BomCategory;
  description: string;
  quantity: number;
  /** texto de unidad: "tubo", "und" */
  unit: string;
  /** para tubería: longitud total (ft) */
  lengthFt?: number;
  unitPrice?: number;
  total?: number;
}

export interface Bom {
  items: BomItem[];
  currency: string;
  grandTotal: number;
  /** true si a algún ítem le falta precio */
  missingPrices: boolean;
}

const sizeRank = (s: NominalSize) => NOMINAL_SIZES.indexOf(s);

function bigger(a: NominalSize, b: NominalSize): NominalSize {
  return sizeRank(a) >= sizeRank(b) ? a : b;
}

interface Incident {
  dir: [number, number, number];
  size: NominalSize;
}

export function buildBom(project: Project): Bom {
  const metric = project.displayUnits === 'metric';
  const sz = (s: NominalSize) => sizeLabel(s, metric);
  const prices = project.prices ?? {};
  const items = new Map<string, BomItem>();
  const add = (key: string, category: BomCategory, description: string, qty: number, unit: string, lengthFt?: number) => {
    const it = items.get(key);
    if (it) {
      it.quantity += qty;
      if (lengthFt !== undefined) it.lengthFt = (it.lengthFt ?? 0) + lengthFt;
    } else {
      items.set(key, { key, category, description, quantity: qty, unit, lengthFt });
    }
  };

  // --- Tubería
  const lengthBy = new Map<string, { material: MaterialId; size: NominalSize; ft: number }>();
  for (const p of project.pipes) {
    const g = pipeGeometry(project, p);
    const k = `${p.material}|${p.size}`;
    const cur = lengthBy.get(k) ?? { material: p.material, size: p.size, ft: 0 };
    cur.ft += g.lengthFt;
    lengthBy.set(k, cur);
  }
  for (const { material, size, ft } of lengthBy.values()) {
    const mat = getMaterial(material, project);
    const stick = project.stickLengths?.[material] ?? mat.stickLengthFt;
    const sticks = Math.ceil(ft / stick - 1e-9);
    add(`pipe|${material}|${size}`, 'Tubería', `Tubo ${mat.name} ${sz(size)}`, sticks, 'tubo', ft);
  }

  // --- Accesorios por geometría
  const nodeById = new Map(project.nodes.map((n) => [n.id, n]));
  const inc = new Map<string, Incident[]>();
  for (const p of project.pipes) {
    const a = nodeById.get(p.from);
    const b = nodeById.get(p.to);
    if (!a || !b) continue;
    const d = [b.x - a.x, b.y - a.y, b.z - a.z];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const u: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
    (inc.get(a.id) ?? inc.set(a.id, []).get(a.id)!).push({ dir: u, size: p.size });
    (inc.get(b.id) ?? inc.set(b.id, []).get(b.id)!).push({ dir: [-u[0], -u[1], -u[2]], size: p.size });
  }
  const sprinklerNodes = new Set(project.sprinklers.map((s) => s.nodeId));
  const dot = (a: Incident, b: Incident) => a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2];
  for (const [nodeId, list] of inc) {
    if (list.length === 1) {
      if (!sprinklerNodes.has(nodeId) && nodeId !== project.supply.nodeId)
        add(`fit|cap|${list[0].size}`, 'Accesorios', `Tapón ${sz(list[0].size)}`, 1, 'und');
      continue;
    }
    if (list.length === 2) {
      const c = dot(list[0], list[1]);
      const big = bigger(list[0].size, list[1].size);
      const small = big === list[0].size ? list[1].size : list[0].size;
      if (c < -0.985) {
        if (big !== small) add(`fit|reducer|${big}|${small}`, 'Accesorios', `Reducción ${sz(big)} × ${sz(small)}`, 1, 'und');
      } else {
        const angle = (Math.acos(Math.max(-1, Math.min(1, -c))) * 180) / Math.PI; // ángulo de desvío
        const type = Math.abs(angle - 90) < 10 ? 'elbow90' : Math.abs(angle - 45) < 10 ? 'elbow45' : 'elbowx';
        const name = type === 'elbow90' ? 'Codo 90°' : type === 'elbow45' ? 'Codo 45°' : `Codo ${angle.toFixed(0)}° (especial)`;
        const label = big === small ? sz(big) : `${sz(big)} × ${sz(small)}`;
        add(`fit|${type}|${big}|${small}`, 'Accesorios', `${name} ${label}`, 1, 'und');
      }
      continue;
    }
    if (list.length === 3) {
      // el "paso" (run) son los dos tubos más alineados; el tercero es la derivación
      let best = 0;
      let pair: [number, number] = [0, 1];
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as [number, number][]) {
        const c = -dot(list[i], list[j]);
        if (c > best) {
          best = c;
          pair = [i, j];
        }
      }
      const branch = list[3 - pair[0] - pair[1]];
      const run = bigger(list[pair[0]].size, list[pair[1]].size);
      const label = run === branch.size ? sz(run) : `${sz(run)} × ${sz(branch.size)}`;
      add(`fit|tee|${run}|${branch.size}`, 'Accesorios', `Tee ${label}`, 1, 'und');
      continue;
    }
    const maxS = list.reduce((s, x) => bigger(s, x.size), list[0].size);
    if (list.length === 4) add(`fit|cross|${maxS}`, 'Accesorios', `Cruz ${sz(maxS)}`, 1, 'und');
    else add(`fit|multi|${list.length}|${maxS}`, 'Accesorios', `Unión de ${list.length} tubos ${sz(maxS)} (revisar)`, 1, 'und');
  }

  // --- Válvulas
  for (const p of project.pipes) {
    for (const f of p.fittings) {
      if (!VALVE_TYPES.includes(f.type) || f.count <= 0) continue;
      add(`valve|${f.type}|${p.size}`, 'Válvulas', `${FITTING_NAMES[f.type]} ${sz(p.size)}`, f.count, 'und');
    }
  }

  // --- Rociadores
  for (const s of project.sprinklers) {
    const t = s.temperatureC ? ` ${s.temperatureC} °C` : '';
    const mdl = s.model ? ` (${s.model})` : '';
    add(
      `spk|${s.k}|${s.orientation}|${s.temperatureC ?? ''}|${s.model ?? ''}`,
      'Rociadores',
      `Rociador ${ORIENTATION_NAMES[s.orientation].toLowerCase()} K${s.k}${t}${mdl}`,
      1,
      'und',
    );
  }

  const order: BomCategory[] = ['Tubería', 'Accesorios', 'Válvulas', 'Rociadores'];
  const list = [...items.values()].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.description.localeCompare(b.description, 'es', { numeric: true }),
  );
  let grandTotal = 0;
  let missingPrices = false;
  for (const it of list) {
    const price = prices[it.key];
    if (price !== undefined && Number.isFinite(price)) {
      it.unitPrice = price;
      it.total = price * it.quantity;
      grandTotal += it.total;
    } else {
      missingPrices = true;
    }
  }
  return { items: list, currency: project.currency ?? 'COP', grandTotal, missingPrices };
}
