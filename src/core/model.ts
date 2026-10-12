/**
 * Modelo de datos del proyecto. Es lo que se guarda en el archivo .rcad (JSON).
 * Todas las magnitudes se guardan en unidades US (ver units.ts).
 */
import type { Catalog } from './catalog';
import type { FittingType } from './fittings';
import type { HazardId } from './hazards';
import type { MaterialId, NominalSize } from './pipes';
import type { UnitSystem } from './units';

export const FILE_FORMAT_VERSION = 1;

export interface Node {
  id: string;
  /** coordenadas en ft; z es la elevación */
  x: number;
  y: number;
  z: number;
  label?: string;
  /** Demanda fija en este nodo (gpm), p. ej. una conexión de manguera interior. */
  fixedDemand?: number;
}

export type PipeRole = 'feed' | 'riser' | 'main' | 'cross' | 'branch' | 'drop';

export const PIPE_ROLE_NAMES: Record<PipeRole, string> = {
  feed: 'Alimentación',
  riser: 'Montante (riser)',
  main: 'Principal',
  cross: 'Matriz transversal',
  branch: 'Ramal',
  drop: 'Bajante / brazo',
};

export interface FittingEntry {
  type: FittingType;
  count: number;
}

export interface Pipe {
  id: string;
  from: string;
  to: string;
  size: NominalSize;
  material: MaterialId;
  /** Coeficiente C de Hazen-Williams */
  c: number;
  /** Diámetro interno (in) si se quiere forzar uno distinto al del catálogo */
  idOverride?: number;
  /** Longitud real (ft) si se quiere forzar una distinta a la distancia entre nodos */
  lengthOverride?: number;
  fittings: FittingEntry[];
  role: PipeRole;
}

export type SprinklerOrientation = 'pendent' | 'upright' | 'sidewall' | 'concealed';

export const ORIENTATION_NAMES: Record<SprinklerOrientation, string> = {
  pendent: 'Colgante',
  upright: 'Montante',
  sidewall: 'De pared',
  concealed: 'Oculto',
};

export interface Sprinkler {
  id: string;
  nodeId: string;
  /** Factor K (gpm/psi^0.5) */
  k: number;
  /** Área de cobertura asignada (ft²) */
  coverage: number;
  /** Si fluye en el área de diseño (área más remota) */
  inDesignArea: boolean;
  orientation: SprinklerOrientation;
  /** Temperatura de activación °C (informativo) */
  temperatureC?: number;
  model?: string;
  /** modelo del catálogo del que salió (si se eligió uno) */
  modelId?: string;
}

/**
 * Elemento del edificio (muro, columna, viga, losa, cielo, ducto, tubería de otro sistema).
 * No entra en el cálculo hidráulico; sirve para ubicar la red y revisar choques.
 */
export interface BuildingElement {
  id: string;
  /** tipo en el catálogo */
  typeId: string;
  /** puntos en planta (ft): 1 para columna, 2 o más para muros/vigas/ductos, 3 o más para losas */
  points: { x: number; y: number }[];
  /** ft: base del muro/columna/losa, fondo de la viga, eje del ducto o tubería */
  z: number;
  /** sobrescribe la altura/espesor del tipo (ft) */
  height?: number;
  /** sobrescribe el ancho/espesor del tipo (ft) */
  width?: number;
}

export interface DesignCriteria {
  hazard: HazardId;
  /** gpm/ft² */
  density: number;
  /** ft² */
  area: number;
  /** gpm, se suma a la demanda de rociadores en el punto de suministro */
  hoseAllowance: number;
  /** psi */
  minSprinklerPressure: number;
  /** minutos */
  duration: number;
  /** ft/s; por encima se avisa */
  maxVelocity: number;
  /** psi; margen mínimo exigido entre suministro y demanda */
  minSafetyMargin: number;
}

export interface WaterSupply {
  /** Nodo donde está la prueba de hidrante / conexión al suministro */
  nodeId: string;
  /** psi */
  staticPressure: number;
  /** psi */
  residualPressure: number;
  /** gpm medido a la presión residual */
  residualFlow: number;
}

/**
 * Plano de fondo (DXF, PDF o imagen) sobre el que se dibuja.
 * Los bytes del archivo no van aquí: se guardan aparte (ver `ProjectFile.underlayData`) para que
 * deshacer/rehacer no copie megas de datos en cada cambio.
 */
export interface Underlay {
  kind: 'dxf' | 'pdf' | 'image';
  /** nombre del archivo original */
  name: string;
  /** clave de los datos del archivo en `underlayData` */
  dataId: string;
  /** página del PDF (desde 1) */
  page?: number;
  /** pies por unidad del plano (unidad del DXF, punto del PDF o píxel de la imagen) */
  scale: number;
  /** posición (ft) donde queda el origen del plano */
  x: number;
  y: number;
  /** giro en grados (antihorario) */
  rotation: number;
  /** elevación (ft) del plano */
  z: number;
  /** 0 a 1 */
  opacity: number;
  visible: boolean;
  /** PDF/imagen: invertir colores para verlo sobre fondo oscuro */
  invert?: boolean;
  /** DXF: capas ocultas */
  hiddenLayers?: string[];
  /** true cuando el usuario ya confirmó o calibró la escala */
  calibrated: boolean;
}

export interface ProjectInfo {
  name: string;
  client?: string;
  address?: string;
  designer?: string;
  notes?: string;
}

export interface Project {
  format: 'rociacad';
  version: number;
  info: ProjectInfo;
  displayUnits: UnitSystem;
  criteria: DesignCriteria;
  supply: WaterSupply;
  nodes: Node[];
  pipes: Pipe[];
  sprinklers: Sprinkler[];
  /** Precios unitarios de la lista de materiales, por clave de ítem */
  prices?: Record<string, number>;
  /** Moneda de los precios (COP, USD…) */
  currency?: string;
  /** Longitud de los tubos comerciales por material (ft), si difiere del catálogo */
  stickLengths?: Partial<Record<MaterialId, number>>;
  /** Tuberías, rociadores y elementos propios del usuario que usa este proyecto */
  catalog?: Partial<Catalog>;
  /** Muros, columnas, vigas, losas, ductos… */
  elements?: BuildingElement[];
  /** Plano de fondo */
  underlay?: Underlay;
}

/** Datos binarios de archivos adjuntos (plano de fondo), en base64. */
export interface AttachedData {
  mime: string;
  base64: string;
}

/** Lo que se escribe en el archivo .rcad: el proyecto más los archivos adjuntos. */
export interface ProjectFile extends Project {
  underlayData?: Record<string, AttachedData>;
}

/** Errores de estructura que impiden calcular. */
export function validateProject(p: Project): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  for (const n of p.nodes) {
    if (nodeIds.has(n.id)) errors.push(`Nodo repetido: ${n.id}`);
    nodeIds.add(n.id);
  }
  const pipeIds = new Set<string>();
  for (const pp of p.pipes) {
    if (pipeIds.has(pp.id)) errors.push(`Tubo repetido: ${pp.id}`);
    pipeIds.add(pp.id);
    if (!nodeIds.has(pp.from)) errors.push(`El tubo ${pp.id} empieza en un nodo que no existe (${pp.from})`);
    if (!nodeIds.has(pp.to)) errors.push(`El tubo ${pp.id} termina en un nodo que no existe (${pp.to})`);
    if (pp.from === pp.to) errors.push(`El tubo ${pp.id} empieza y termina en el mismo nodo`);
    if (!(pp.c > 0)) errors.push(`El tubo ${pp.id} tiene un coeficiente C inválido`);
  }
  for (const s of p.sprinklers) {
    if (!nodeIds.has(s.nodeId)) errors.push(`El rociador ${s.id} está en un nodo que no existe (${s.nodeId})`);
    if (!(s.k > 0)) errors.push(`El rociador ${s.id} tiene un factor K inválido`);
  }
  if (!nodeIds.has(p.supply.nodeId)) errors.push('El punto de suministro no corresponde a ningún nodo');
  if (p.supply.residualPressure >= p.supply.staticPressure)
    errors.push('La presión residual del suministro debe ser menor que la estática');
  if (!(p.supply.residualFlow > 0)) errors.push('El caudal de la prueba de suministro debe ser mayor que cero');
  return errors;
}

/** Siguiente identificador libre con un prefijo: N1, N2… */
export function nextId(prefix: string, existing: { id: string }[]): string {
  let max = 0;
  for (const e of existing) {
    if (e.id.startsWith(prefix)) {
      const n = Number(e.id.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return `${prefix}${max + 1}`;
}
