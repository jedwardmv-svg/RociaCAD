/**
 * Proyectos de ejemplo y plantilla vacía.
 */
import { HAZARDS } from './hazards';
import { FILE_FORMAT_VERSION, type Node, type Pipe, type Project, type Sprinkler } from './model';
import type { NominalSize } from './pipes';
import { CONV } from './units';

const m = (meters: number) => meters / CONV.FT_TO_M;

export function emptyProject(): Project {
  const h = HAZARDS.oh1;
  return {
    format: 'rociacad',
    version: FILE_FORMAT_VERSION,
    info: { name: 'Proyecto nuevo' },
    displayUnits: 'metric',
    criteria: {
      hazard: h.id,
      density: h.density,
      area: h.area,
      hoseAllowance: h.hoseAllowance,
      minSprinklerPressure: 7,
      duration: h.duration,
      maxVelocity: 20,
      minSafetyMargin: 5,
    },
    supply: { nodeId: 'N1', staticPressure: 70, residualPressure: 55, residualFlow: 1000 },
    nodes: [{ id: 'N1', x: 0, y: 0, z: 0, label: 'Suministro' }],
    pipes: [],
    sprinklers: [],
  };
}

/**
 * Bodega de riesgo ordinario grupo 1, sistema en árbol alimentado por un extremo:
 *  - acometida subterránea de 6" desde la prueba de hidrante
 *  - montante (riser) de 4" con válvula de retención y válvula mariposa
 *  - matriz transversal de 3" y 6 ramales de 6 rociadores colgantes K5.6 a 3.4 m × 3.4 m
 *  - área de diseño: 13 rociadores en los tres ramales más remotos
 */
export function exampleWarehouse(): Project {
  const p = emptyProject();
  p.info = {
    name: 'Ejemplo: bodega riesgo ordinario 1',
    client: 'Proyecto de demostración',
    designer: '',
    notes: 'Sistema en árbol con 36 rociadores colgantes K5.6 a 3,4 m × 3,4 m. Datos de suministro ficticios.',
  };
  const nodes: Node[] = [];
  const pipes: Pipe[] = [];
  const sprinklers: Sprinkler[] = [];
  let pid = 0;
  const addNode = (id: string, x: number, y: number, z: number, label?: string) => {
    nodes.push({ id, x: m(x), y: m(y), z: m(z), label });
    return id;
  };
  const addPipe = (from: string, to: string, size: NominalSize, role: Pipe['role'], fittings: Pipe['fittings'] = [], material: Pipe['material'] = 'steel-sch40') => {
    pid++;
    pipes.push({ id: `T${pid}`, from, to, size, material, c: 120, fittings, role });
  };

  const ceiling = 4.0; // altura de la tubería de ramales (m)
  const dropLen = 0.3;
  const spacing = 3.4;

  addNode('S', -12, -8, -1, 'Prueba de hidrante');
  addNode('A1', -12, -1.5, -1);
  addNode('A2', 0, -1.5, -1);
  addNode('RB', 0, -1.5, 0, 'Base del montante');
  addNode('RT', 0, -1.5, ceiling, 'Parte alta del montante');
  addNode('M0', 0, 0, ceiling);
  addPipe('S', 'A1', '6', 'feed', [{ type: 'gate', count: 1 }], 'steel-sch40');
  addPipe('A1', 'A2', '6', 'feed', [{ type: 'elbow90', count: 1 }]);
  addPipe('A2', 'RB', '6', 'feed', [{ type: 'elbow90', count: 1 }, { type: 'check', count: 1 }]);
  addPipe('RB', 'RT', '4', 'riser', [{ type: 'butterfly', count: 1 }, { type: 'check', count: 1 }]);
  addPipe('RT', 'M0', '4', 'main', [{ type: 'elbow90', count: 1 }]);

  const branches = 6;
  const perBranch = 6;
  // tamaños de ramal desde la matriz hacia el extremo
  const branchSizes: NominalSize[] = ['1-1/2', '1-1/2', '1-1/4', '1-1/4', '1', '1'];
  let prevMain = 'M0';
  for (let b = 0; b < branches; b++) {
    const y = spacing / 2 + b * spacing;
    const mainNode = addNode(`M${b + 1}`, 0, y, ceiling);
    addPipe(prevMain, mainNode, '3', 'cross');
    prevMain = mainNode;
    let prev = mainNode;
    for (let s = 0; s < perBranch; s++) {
      const x = spacing / 2 + s * spacing;
      const bn = addNode(`B${b + 1}-${s + 1}`, x, y, ceiling);
      const fittings: Pipe['fittings'] = s === 0 ? [{ type: 'tee', count: 1 }] : [];
      addPipe(prev, bn, branchSizes[s], 'branch', fittings);
      const head = addNode(`R${b + 1}-${s + 1}`, x, y, ceiling - dropLen);
      addPipe(bn, head, '1', 'drop', [{ type: 'tee', count: 1 }]);
      // Área remota: los 5 rociadores más lejanos de los ramales 6 y 5, y los 3 más lejanos del ramal 4
      const inArea = (b === 5 && s >= 1) || (b === 4 && s >= 1) || (b === 3 && s >= 3);
      sprinklers.push({
        id: `S${b + 1}-${s + 1}`,
        nodeId: head,
        k: 5.6,
        coverage: (spacing * spacing) / (CONV.FT_TO_M * CONV.FT_TO_M),
        inDesignArea: inArea,
        orientation: 'pendent',
        temperatureC: 68,
        modelId: 'gen-k56-pend',
      });
      prev = bn;
    }
  }
  p.nodes = nodes;
  p.pipes = pipes;
  p.sprinklers = sprinklers;
  p.supply = { nodeId: 'S', staticPressure: 70, residualPressure: 55, residualFlow: 1000 };
  return p;
}

/**
 * Sistema mallado (grid): dos matrices paralelas unidas por los ramales.
 * Sirve para demostrar que el motor resuelve lazos.
 */
export function exampleGrid(): Project {
  const p = emptyProject();
  p.info = { name: 'Ejemplo: sistema mallado', notes: 'Malla de 8 ramales de 1-1/4" entre dos matrices de 3".' };
  const nodes: Node[] = [];
  const pipes: Pipe[] = [];
  const sprinklers: Sprinkler[] = [];
  let pid = 0;
  const addNode = (id: string, x: number, y: number, z: number, label?: string) => {
    nodes.push({ id, x: m(x), y: m(y), z: m(z), label });
  };
  const addPipe = (from: string, to: string, size: NominalSize, role: Pipe['role'], fittings: Pipe['fittings'] = []) => {
    pid++;
    pipes.push({ id: `T${pid}`, from, to, size, material: 'steel-sch40', c: 120, fittings, role });
  };
  const z = 5;
  const sp = 3.4;
  const nb = 8;
  const nh = 6;
  const width = (nh + 1) * sp;
  addNode('S', -6, -4, -1, 'Prueba de hidrante');
  addNode('RB', 0, -2, 0, 'Base del montante');
  addNode('RT', 0, -2, z);
  addPipe('S', 'RB', '6', 'feed', [{ type: 'elbow90', count: 2 }, { type: 'check', count: 1 }]);
  addPipe('RB', 'RT', '4', 'riser', [{ type: 'butterfly', count: 1 }, { type: 'check', count: 1 }]);
  let prevL = 'RT';
  let prevR = '';
  for (let b = 0; b < nb; b++) {
    const y = sp / 2 + b * sp;
    addNode(`L${b + 1}`, 0, y, z);
    addNode(`D${b + 1}`, width, y, z);
    addPipe(prevL, `L${b + 1}`, '3', 'cross', b === 0 ? [{ type: 'elbow90', count: 1 }] : []);
    if (prevR) addPipe(prevR, `D${b + 1}`, '3', 'cross');
    prevL = `L${b + 1}`;
    prevR = `D${b + 1}`;
    let prev = `L${b + 1}`;
    for (let s = 0; s < nh; s++) {
      const id = `G${b + 1}-${s + 1}`;
      addNode(id, (s + 1) * sp, y, z);
      addPipe(prev, id, '1-1/4', 'branch', s === 0 ? [{ type: 'tee', count: 1 }] : []);
      sprinklers.push({
        id: `S${b + 1}-${s + 1}`,
        nodeId: id,
        k: 5.6,
        coverage: (sp * sp) / (CONV.FT_TO_M * CONV.FT_TO_M),
        inDesignArea: (b >= nb - 3 && s >= 1 && s <= 4) || (b === nb - 1 && s === 5),
        orientation: 'upright',
        modelId: 'gen-k56-up',
      });
      prev = id;
    }
    addPipe(prev, `D${b + 1}`, '1-1/4', 'branch', [{ type: 'tee', count: 1 }]);
  }
  p.nodes = nodes;
  p.pipes = pipes;
  p.sprinklers = sprinklers;
  p.supply = { nodeId: 'S', staticPressure: 75, residualPressure: 60, residualFlow: 1200 };
  return p;
}
