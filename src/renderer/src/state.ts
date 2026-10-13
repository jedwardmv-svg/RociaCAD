/**
 * Estado de la aplicación: proyecto, selección, resultados, deshacer/rehacer.
 */
import { buildBom, calculate, itemCount, type AttachedData, type Bom, type CalcResult, type ItemSet, type Project } from '../../core';

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'pipe'; id: string }
  | { kind: 'sprinkler'; id: string }
  | { kind: 'element'; id: string }
  | { kind: 'hanger'; id: string }
  | { kind: 'multi'; items: ItemSet }
  | null;

type SingleKind = 'node' | 'pipe' | 'sprinkler' | 'element';
const LIST: Record<SingleKind, keyof ItemSet> = { node: 'nodes', pipe: 'pipes', sprinkler: 'sprinklers', element: 'elements' };

/** Los objetos de la selección como conjunto (vacío si no hay nada) */
export function selectionItems(sel: Selection): ItemSet {
  const out: ItemSet = { nodes: [], pipes: [], sprinklers: [], elements: [] };
  if (!sel) return out;
  if (sel.kind === 'hanger') return out;
  if (sel.kind === 'multi') return { nodes: [...sel.items.nodes], pipes: [...sel.items.pipes], sprinklers: [...sel.items.sprinklers], elements: [...sel.items.elements] };
  out[LIST[sel.kind]].push(sel.id);
  return out;
}

/** Selección a partir de un conjunto: nada, un objeto o varios */
export function selectionFrom(items: ItemSet): Selection {
  const n = itemCount(items);
  if (!n) return null;
  if (n === 1) {
    for (const k of Object.keys(LIST) as SingleKind[]) if (items[LIST[k]].length) return { kind: k, id: items[LIST[k]][0] } as Selection;
  }
  return { kind: 'multi', items };
}

/** Agrega o quita un objeto de la selección */
export function toggleInSelection(sel: Selection, kind: SingleKind | 'hanger', id: string): Selection {
  if (kind === 'hanger') return { kind: 'hanger', id };
  const items = selectionItems(sel);
  const list = items[LIST[kind]];
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  return selectionFrom(items);
}

export function isSelected(sel: Selection, kind: string, id: string): boolean {
  if (!sel) return false;
  if (sel.kind === 'multi') return (sel.items[LIST[kind as SingleKind]] ?? []).includes(id);
  if (sel.kind === 'hanger') return kind === 'hanger' && sel.id === id;
  return sel.kind === kind && sel.id === id;
}

export type Tool = 'select' | 'draw' | 'sprinkler' | 'fill' | 'element' | 'calibrate' | 'move-plan' | 'pick-vector' | 'area';

export type ColorMode = 'material' | 'size' | 'pressure' | 'velocity';

/** Etiquetas en el dibujo: ninguna, nombres (N1, T3, S5 y diámetros) o resultados del cálculo */
export type LabelMode = 'none' | 'names' | 'results' | 'pieces';

type Listener = (why: ChangeKind) => void;
export type ChangeKind = 'project' | 'selection' | 'result' | 'tool' | 'view' | 'file';

const MAX_UNDO = 150;

class Store {
  project!: Project;
  result!: CalcResult;
  bom!: Bom;
  selection: Selection = null;
  tool: Tool = 'select';
  colorMode: ColorMode = 'material';
  labelMode: LabelMode = 'none';
  filePath: string | null = null;
  fileName: string | null = null;
  dirty = false;
  /** archivos adjuntos (plano de fondo); fuera del proyecto para no copiarlos al deshacer */
  attached = new Map<string, AttachedData>();
  /** preferencias de dibujo */
  drawDefaults = {
    size: '1-1/4' as Project['pipes'][number]['size'],
    material: 'steel-sch40' as Project['pipes'][number]['material'],
    role: 'branch' as Project['pipes'][number]['role'],
    gridFt: 0.5 / 0.3048,
    k: 5.6,
    sprinklerModelId: 'gen-k56-pend',
    elementTypeId: 'wall-block-15',
    /** ft: base de los elementos nuevos */
    elementZ: 0,
    /** llenar recinto */
    fill: {
      direction: 'x' as 'x' | 'y',
      mainSide: 'start' as 'start' | 'end',
      piping: 'branches-main' as 'none' | 'branches' | 'branches-main',
      /** ft: altura de los ramales */
      pipeZ: 3.5 / 0.3048,
      /** ft: largo del bajante de los colgantes */
      dropFt: 0.3 / 0.3048,
      bySchedule: true,
    },
  };

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private calcTimer: number | undefined;

  load(project: Project, file?: { path: string | null; name: string | null }, attached?: Record<string, AttachedData>) {
    this.project = project;
    this.attached = new Map(Object.entries(attached ?? {}));
    this.selection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.filePath = file?.path ?? null;
    this.fileName = file?.name ?? null;
    this.setDirty(false);
    this.recalcNow();
    this.emit('file');
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(why: ChangeKind) {
    for (const l of this.listeners) l(why);
  }

  /**
   * Aplica un cambio al proyecto guardando una copia para poder deshacer.
   * `coalesce` agrupa cambios seguidos del mismo campo (p. ej. al escribir en un campo).
   */
  mutate(fn: (p: Project) => void, coalesce?: string) {
    const snap = JSON.stringify(this.project);
    if (!coalesce || coalesce !== this.lastCoalesce || Date.now() - this.lastCoalesceAt > 1500) {
      this.undoStack.push(snap);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.lastCoalesce = coalesce;
    this.lastCoalesceAt = Date.now();
    this.redoStack = [];
    fn(this.project);
    this.afterChange();
  }

  private lastCoalesce: string | undefined;
  private lastCoalesceAt = 0;

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(prev);
    this.lastCoalesce = undefined;
    this.fixSelection();
    this.afterChange();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(next);
    this.lastCoalesce = undefined;
    this.fixSelection();
    this.afterChange();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  private fixSelection() {
    const s = this.selection;
    if (!s) return;
    const p = this.project;
    if (s.kind === 'multi') {
      const has = (list: { id: string }[]) => new Set(list.map((x) => x.id));
      const nodes = has(p.nodes);
      const pipes = has(p.pipes);
      const spk = has(p.sprinklers);
      const els = has(p.elements ?? []);
      this.selection = selectionFrom({
        nodes: s.items.nodes.filter((id) => nodes.has(id)),
        pipes: s.items.pipes.filter((id) => pipes.has(id)),
        sprinklers: s.items.sprinklers.filter((id) => spk.has(id)),
        elements: s.items.elements.filter((id) => els.has(id)),
      });
      return;
    }
    const exists =
      (s.kind === 'node' && p.nodes.some((n) => n.id === s.id)) ||
      (s.kind === 'pipe' && p.pipes.some((n) => n.id === s.id)) ||
      (s.kind === 'sprinkler' && p.sprinklers.some((n) => n.id === s.id)) ||
      (s.kind === 'element' && (p.elements ?? []).some((n) => n.id === s.id)) ||
      (s.kind === 'hanger' && (p.hangers ?? []).some((n) => n.id === s.id));
    if (!exists) this.selection = null;
  }

  /** Después de un cambio hecho desde fuera (p. ej. borrar varios), quitar de la selección lo que ya no existe */
  cleanSelection() {
    this.fixSelection();
  }

  private afterChange() {
    this.setDirty(true);
    this.emit('project');
    window.clearTimeout(this.calcTimer);
    this.calcTimer = window.setTimeout(() => this.recalcNow(), 120);
  }

  recalcNow() {
    window.clearTimeout(this.calcTimer);
    try {
      this.result = calculate(this.project);
    } catch (err) {
      this.result = {
        ...calculate({ ...this.project, sprinklers: [] }),
        errors: [`Error interno del cálculo: ${(err as Error).message}`],
      };
    }
    this.bom = buildBom(this.project);
    this.emit('result');
  }

  select(sel: Selection) {
    this.selection = sel;
    this.emit('selection');
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.emit('tool');
  }

  setDirty(v: boolean) {
    this.dirty = v;
    window.rocia?.setDirty(v);
    const name = this.project?.info.name || 'Sin nombre';
    const title = `${v ? '• ' : ''}${name}${this.fileName ? ` — ${this.fileName}` : ''} — RociaCAD`;
    document.title = title;
    window.rocia?.setTitle(title);
  }
}

export const store = new Store();
