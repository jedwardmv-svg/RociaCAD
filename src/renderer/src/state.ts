/**
 * Estado de la aplicación: proyecto, selección, resultados, deshacer/rehacer.
 */
import { buildBom, calculate, type Bom, type CalcResult, type Project } from '../../core';

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'pipe'; id: string }
  | { kind: 'sprinkler'; id: string }
  | null;

export type Tool = 'select' | 'draw' | 'sprinkler';

export type ColorMode = 'material' | 'size' | 'pressure' | 'velocity';

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
  showLabels = false;
  filePath: string | null = null;
  fileName: string | null = null;
  dirty = false;
  /** preferencias de dibujo */
  drawDefaults = {
    size: '1-1/4' as Project['pipes'][number]['size'],
    material: 'steel-sch40' as Project['pipes'][number]['material'],
    role: 'branch' as Project['pipes'][number]['role'],
    gridFt: 0.5 / 0.3048,
    k: 5.6,
  };

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private calcTimer: number | undefined;

  load(project: Project, file?: { path: string | null; name: string | null }) {
    this.project = project;
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
    const exists =
      (s.kind === 'node' && p.nodes.some((n) => n.id === s.id)) ||
      (s.kind === 'pipe' && p.pipes.some((n) => n.id === s.id)) ||
      (s.kind === 'sprinkler' && p.sprinklers.some((n) => n.id === s.id));
    if (!exists) this.selection = null;
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
