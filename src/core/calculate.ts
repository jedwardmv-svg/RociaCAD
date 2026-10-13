/**
 * Cálculo hidráulico de demanda de un proyecto (método densidad/área de NFPA 13).
 *
 * Procedimiento:
 *  1. Cada rociador del área de diseño necesita al menos:
 *        caudal  q = densidad × área de cobertura   y   presión ≥ presión mínima (7 psi)
 *     → presión requerida  P_req = max(P_min, (q/K)²)
 *  2. Se busca la presión en el punto de suministro con la que el rociador más exigido
 *     queda EXACTAMENTE en su presión requerida y todos los demás por encima
 *     (los demás descargan más de su mínimo, como en un cálculo hecho a mano).
 *  3. Cada evaluación resuelve la red completa (árbol o malla) con Newton-Raphson.
 *  4. Se suma la asignación de mangueras y se compara contra la curva de suministro.
 */
import { getSprinklerModel } from './catalog';
import { autoFittings } from './autoFittings';
import { equivalentLength, FITTING_NAMES } from './fittings';
import { HAZARDS } from './hazards';
import { frictionLossPerFt, pipeResistance, supplyFlowAt, supplyPressureAt, velocity } from './hydraulics';
import type { FittingEntry, Pipe, Project } from './model';
import { validateProject } from './model';
import { connectedFrom, solveNetwork, type NetNode, type NetPipe, type NetResult } from './network';
import { internalDiameter } from './pipes';
import { PSI_PER_FT_WATER } from './units';

export interface PipeGeometry {
  lengthFt: number;
  fittingFt: number;
  totalFt: number;
  idIn: number;
}

export interface PipeResult extends PipeGeometry {
  id: string;
  /** caudal con signo (positivo = de `from` hacia `to`), gpm */
  flow: number;
  /** nodo aguas arriba y aguas abajo según el sentido real del flujo */
  upstream: string;
  downstream: string;
  pUpstream: number;
  pDownstream: number;
  velocity: number;
  frictionPerFt: number;
  frictionLoss: number;
  /** pérdida por elevación de aguas arriba a aguas abajo (psi, positiva si sube) */
  elevationLoss: number;
  c: number;
  fittingsText: string;
}

export interface NodeResult {
  id: string;
  pressure: number;
  elevation: number;
  /** caudal que sale en el nodo (rociador + demanda fija), gpm */
  outflow: number;
}

export interface SprinklerResult {
  id: string;
  nodeId: string;
  k: number;
  flowing: boolean;
  pressure: number;
  flow: number;
  requiredFlow: number;
  requiredPressure: number;
  /** densidad lograda, gpm/ft² */
  density: number;
}

export interface SupplyCheck {
  staticPressure: number;
  residualPressure: number;
  residualFlow: number;
  /** demanda total incluyendo mangueras, gpm */
  demandFlow: number;
  /** presión requerida en el punto de suministro, psi */
  demandPressure: number;
  /** presión que da el suministro con ese caudal, psi */
  availablePressure: number;
  margin: number;
  minMargin: number;
  pass: boolean;
  /** caudal máximo que el suministro puede dar a la presión requerida */
  availableFlowAtDemandPressure: number;
}

export interface CalcResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** presión requerida en el punto de suministro, sin mangueras, psi */
  requiredPressure: number;
  sprinklerFlow: number;
  fixedFlow: number;
  hoseAllowance: number;
  totalFlow: number;
  criticalSprinklerId?: string;
  supply?: SupplyCheck;
  nodes: Record<string, NodeResult>;
  pipes: Record<string, PipeResult>;
  sprinklers: Record<string, SprinklerResult>;
  designArea: {
    flowingCount: number;
    totalCoverage: number;
    requiredArea: number;
    suggestedCount: number;
  };
  solver: { evaluations: number; iterations: number; converged: boolean; maxResidual: number };
}

function emptyResult(errors: string[]): CalcResult {
  return {
    ok: false,
    errors,
    warnings: [],
    requiredPressure: NaN,
    sprinklerFlow: 0,
    fixedFlow: 0,
    hoseAllowance: 0,
    totalFlow: 0,
    nodes: {},
    pipes: {},
    sprinklers: {},
    designArea: { flowingCount: 0, totalCoverage: 0, requiredArea: 0, suggestedCount: 0 },
    solver: { evaluations: 0, iterations: 0, converged: false, maxResidual: NaN },
  };
}

/** Longitudes y diámetro de un tubo según el proyecto. */
export function pipeGeometry(project: Project, pipe: Pipe, auto?: FittingEntry[]): PipeGeometry {
  const a = project.nodes.find((n) => n.id === pipe.from);
  const b = project.nodes.find((n) => n.id === pipe.to);
  const dist = a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;
  const lengthFt = pipe.lengthOverride ?? dist;
  const idIn = pipe.idOverride ?? internalDiameter(pipe.material, pipe.size, project) ?? NaN;
  let fittingFt = 0;
  for (const f of pipe.fittings) fittingFt += f.count * equivalentLength(f.type, pipe.size, pipe.c, idIn);
  for (const f of auto ?? []) fittingFt += f.count * equivalentLength(f.type, pipe.size, pipe.c, idIn);
  return { lengthFt, fittingFt, totalFt: lengthFt + fittingFt, idIn };
}

const listText = (list: FittingEntry[]) =>
  list
    .filter((f) => f.count > 0)
    .map((f) => `${f.count} ${FITTING_NAMES[f.type]}`)
    .join(', ');

/** Texto de accesorios del tubo; `auto` son los deducidos del dibujo */
export function fittingsText(pipe: Pipe, auto?: FittingEntry[]): string {
  const manual = listText(pipe.fittings);
  const a = auto ? listText(auto) : '';
  if (!a) return manual;
  return manual ? `${manual} + auto: ${a}` : `auto: ${a}`;
}

/** Ejecuta el cálculo hidráulico completo del proyecto. */
export function calculate(project: Project): CalcResult {
  const errors = validateProject(project);
  if (errors.length) return emptyResult(errors);
  const warnings: string[] = [];
  const crit = project.criteria;

  // --- Construir la red
  const index = new Map<string, number>();
  project.nodes.forEach((n, i) => index.set(n.id, i));
  const source = index.get(project.supply.nodeId)!;

  const auto = autoFittings(project);
  const geom = new Map<string, PipeGeometry>();
  for (const p of project.pipes) {
    const g = pipeGeometry(project, p, auto.get(p.id));
    if (!Number.isFinite(g.idIn)) {
      errors.push(`El tubo ${p.id} no tiene diámetro interno: el tamaño ${p.size}" no existe para ese material`);
    } else if (g.totalFt <= 0) {
      errors.push(`El tubo ${p.id} tiene longitud cero`);
    }
    geom.set(p.id, g);
  }
  if (errors.length) return emptyResult(errors);

  const allPipes: NetPipe[] = project.pipes.map((p) => {
    const g = geom.get(p.id)!;
    return { a: index.get(p.from)!, b: index.get(p.to)!, r: pipeResistance(g.totalFt, p.c, g.idIn) };
  });
  const reach = connectedFrom(project.nodes.length, allPipes, source);

  const flowingAt = new Map<number, number>(); // nodo → K total abierto
  const design = project.sprinklers.filter((s) => s.inDesignArea);
  if (design.length === 0) return emptyResult(['No hay rociadores marcados en el área de diseño.']);
  for (const s of design) {
    const i = index.get(s.nodeId)!;
    if (!reach[i]) errors.push(`El rociador ${s.id} no está conectado al suministro`);
    flowingAt.set(i, (flowingAt.get(i) ?? 0) + s.k);
  }
  if (errors.length) return emptyResult(errors);

  // Sub-red conectada
  const map = new Int32Array(project.nodes.length).fill(-1);
  const netNodes: NetNode[] = [];
  project.nodes.forEach((n, i) => {
    if (!reach[i]) return;
    map[i] = netNodes.length;
    netNodes.push({ z: n.z, k: flowingAt.get(i) ?? 0, fixed: n.fixedDemand ?? 0 });
  });
  const unconnected = project.nodes.filter((_, i) => !reach[i]).map((n) => n.id);
  if (unconnected.length) warnings.push(`Nodos sin conexión al suministro (se ignoran): ${unconnected.join(', ')}`);
  const netPipes: NetPipe[] = [];
  const netPipeOf: number[] = [];
  allPipes.forEach((p, i) => {
    if (map[p.a] >= 0 && map[p.b] >= 0) {
      netPipeOf.push(i);
      netPipes.push({ a: map[p.a], b: map[p.b], r: p.r });
    }
  });
  const src = map[source];

  // --- Requisitos de cada rociador abierto
  /** presión mínima de un rociador: la del criterio o la de su hoja técnica, la mayor */
  const minP = (s: (typeof project.sprinklers)[number]) =>
    Math.max(crit.minSprinklerPressure, getSprinklerModel(s.modelId, project)?.minPressure ?? 0);
  const req = design.map((s) => {
    const qMin = crit.density * s.coverage;
    const pReq = Math.max(minP(s), (qMin / s.k) ** 2);
    return { s, node: map[index.get(s.nodeId)!], qMin, pReq };
  });

  // Holgura del rociador más exigido para una presión de suministro dada
  let evaluations = 0;
  let iterations = 0;
  let last: NetResult | undefined;
  let lastPs = 0;
  const evaluate = (ps: number): { gap: number; res: NetResult } => {
    evaluations++;
    let init: Float64Array | undefined;
    if (last) {
      // reutilizar la solución anterior desplazada
      init = Float64Array.from(last.head, (h) => h + (ps - lastPs));
    }
    const res = solveNetwork(netNodes, netPipes, src, ps, { initialHead: init });
    iterations += res.iterations;
    last = res;
    lastPs = ps;
    let gap = Infinity;
    for (const r of req) {
      // Si hay dos rociadores en el mismo nodo comparten presión
      gap = Math.min(gap, res.pressure[r.node] - r.pReq);
    }
    return { gap, res };
  };

  const zs = netNodes[src].z;
  let lo = -Infinity;
  for (const r of req) lo = Math.max(lo, r.pReq + PSI_PER_FT_WATER * (netNodes[r.node].z - zs));
  lo = Math.max(lo, 0.01);
  let flo = evaluate(lo).gap;
  let hi = lo * 1.5 + 5;
  let fhi = evaluate(hi).gap;
  let guard = 0;
  while (fhi < 0 && guard++ < 40) {
    lo = hi;
    flo = fhi;
    hi = hi * 2;
    fhi = evaluate(hi).gap;
  }
  if (fhi < 0) return emptyResult(['No fue posible encontrar una presión de suministro que alimente el área de diseño.']);

  // Método de Illinois (regula falsi modificada)
  let ps = hi;
  let best = last!;
  if (flo >= 0) {
    ps = lo;
    best = evaluate(lo).res;
  } else {
    let side = 0;
    for (let k = 0; k < 100; k++) {
      ps = (lo * fhi - hi * flo) / (fhi - flo);
      const { gap, res } = evaluate(ps);
      best = res;
      if (Math.abs(gap) < 1e-6 || hi - lo < 1e-9) break;
      if (gap > 0) {
        hi = ps;
        fhi = gap;
        if (side === 1) flo /= 2;
        side = 1;
      } else {
        lo = ps;
        flo = gap;
        if (side === -1) fhi /= 2;
        side = -1;
      }
    }
  }
  const res = best;
  if (!res.converged) warnings.push('El solucionador no convergió por completo; revise la red (tubos muy cortos o lazos raros).');

  // --- Armar resultados
  const nodes: Record<string, NodeResult> = {};
  project.nodes.forEach((n, i) => {
    const j = map[i];
    if (j < 0) return;
    nodes[n.id] = { id: n.id, pressure: res.pressure[j], elevation: n.z, outflow: res.outflow[j] };
  });

  const pipes: Record<string, PipeResult> = {};
  const maxVel = crit.maxVelocity;
  netPipeOf.forEach((orig, j) => {
    const p = project.pipes[orig];
    const g = geom.get(p.id)!;
    const q = res.flow[j];
    const forward = q >= 0;
    const up = forward ? p.from : p.to;
    const down = forward ? p.to : p.from;
    const zUp = project.nodes[index.get(up)!].z;
    const zDown = project.nodes[index.get(down)!].z;
    const v = velocity(q, g.idIn);
    const fpf = frictionLossPerFt(q, p.c, g.idIn);
    pipes[p.id] = {
      id: p.id,
      ...g,
      flow: q,
      upstream: up,
      downstream: down,
      pUpstream: nodes[up].pressure,
      pDownstream: nodes[down].pressure,
      velocity: v,
      frictionPerFt: fpf,
      frictionLoss: fpf * g.totalFt,
      elevationLoss: PSI_PER_FT_WATER * (zDown - zUp),
      c: p.c,
      fittingsText: fittingsText(p, auto.get(p.id)),
    };
    if (v > maxVel) warnings.push(`Velocidad alta en el tubo ${p.id}: ${v.toFixed(1)} ft/s (límite ${maxVel} ft/s)`);
  });

  const sprinklers: Record<string, SprinklerResult> = {};
  let sprinklerFlow = 0;
  let critical: string | undefined;
  let worst = Infinity;
  for (const s of project.sprinklers) {
    const ni = index.get(s.nodeId)!;
    const j = map[ni];
    const pressure = j >= 0 ? res.pressure[j] : NaN;
    const flowing = s.inDesignArea && j >= 0;
    const flow = flowing ? s.k * Math.sqrt(Math.max(pressure, 0)) : 0;
    const qMin = crit.density * s.coverage;
    const pReq = Math.max(minP(s), (qMin / s.k) ** 2);
    sprinklers[s.id] = {
      id: s.id,
      nodeId: s.nodeId,
      k: s.k,
      flowing,
      pressure,
      flow,
      requiredFlow: flowing ? Math.max(qMin, s.k * Math.sqrt(minP(s))) : 0,
      requiredPressure: pReq,
      density: flowing && s.coverage > 0 ? flow / s.coverage : 0,
    };
    if (flowing) {
      sprinklerFlow += flow;
      const gap = pressure - pReq;
      if (gap < worst) {
        worst = gap;
        critical = s.id;
      }
    }
  }

  let fixedFlow = 0;
  for (const n of netNodes) fixedFlow += n.fixed;
  const requiredPressure = ps;
  const totalFlow = res.sourceFlow + crit.hoseAllowance;

  // --- Comparación con el suministro
  const sup = project.supply;
  const available = supplyPressureAt(totalFlow, sup.staticPressure, sup.residualPressure, sup.residualFlow);
  const margin = available - requiredPressure;
  const supply: SupplyCheck = {
    staticPressure: sup.staticPressure,
    residualPressure: sup.residualPressure,
    residualFlow: sup.residualFlow,
    demandFlow: totalFlow,
    demandPressure: requiredPressure,
    availablePressure: available,
    margin,
    minMargin: crit.minSafetyMargin,
    pass: margin >= crit.minSafetyMargin,
    availableFlowAtDemandPressure: supplyFlowAt(requiredPressure, sup.staticPressure, sup.residualPressure, sup.residualFlow),
  };
  if (!supply.pass) {
    warnings.push(
      margin < 0
        ? `El suministro NO alcanza: faltan ${(-margin).toFixed(2)} psi con ${totalFlow.toFixed(0)} gpm.`
        : `El margen de seguridad (${margin.toFixed(2)} psi) es menor que el mínimo exigido (${crit.minSafetyMargin} psi).`,
    );
  }

  // --- Revisión del área de diseño
  let totalCoverage = 0;
  let coverageSum = 0;
  for (const s of design) totalCoverage += s.coverage;
  for (const s of project.sprinklers) coverageSum += s.coverage;
  const avgCov = project.sprinklers.length ? coverageSum / project.sprinklers.length : 0;
  const suggestedCount = avgCov > 0 ? Math.ceil(crit.area / avgCov) : 0;
  if (totalCoverage + 1e-6 < crit.area) {
    warnings.push(
      `El área cubierta por los rociadores abiertos (${totalCoverage.toFixed(0)} ft²) es menor que el área de diseño (${crit.area.toFixed(0)} ft²). ` +
        `Con la cobertura promedio se necesitan unos ${suggestedCount} rociadores abiertos.`,
    );
  }
  const overListed = project.sprinklers.filter((s) => {
    const mc = getSprinklerModel(s.modelId, project)?.maxCoverage;
    return mc !== undefined && s.coverage > mc + 1e-6;
  });
  if (overListed.length)
    warnings.push(`${overListed.length} rociador(es) cubren más área de la que permite su hoja técnica: ${overListed.slice(0, 6).map((s) => s.id).join(', ')}${overListed.length > 6 ? '…' : ''}.`);
  if (crit.hazard !== 'custom') {
    const maxCov = HAZARDS[crit.hazard].maxCoverage;
    const over = project.sprinklers.filter((s) => s.coverage > maxCov + 1e-6 && getSprinklerModel(s.modelId, project)?.maxCoverage === undefined).map((s) => s.id);
    if (over.length)
      warnings.push(
        `${over.length} rociador(es) cubren más de ${maxCov} ft², el máximo usual para ${HAZARDS[crit.hazard].name.toLowerCase()} con rociadores estándar.`,
      );
  }
  if (requiredPressure > 175) warnings.push('La presión requerida supera 175 psi: verifique la clasificación de presión de los componentes.');

  return {
    ok: true,
    errors: [],
    warnings,
    requiredPressure,
    sprinklerFlow,
    fixedFlow,
    hoseAllowance: crit.hoseAllowance,
    totalFlow,
    criticalSprinklerId: critical,
    supply,
    nodes,
    pipes,
    sprinklers,
    designArea: { flowingCount: design.length, totalCoverage, requiredArea: crit.area, suggestedCount },
    solver: { evaluations, iterations, converged: res.converged, maxResidual: res.maxResidual },
  };
}
