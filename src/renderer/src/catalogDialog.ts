/**
 * Ventana del catálogo: ver los ítems de fábrica y crear/editar los propios
 * (tuberías, rociadores y elementos del edificio).
 */
import {
  customId,
  ELEMENT_KIND_NAMES,
  ELEMENT_KIND_SHAPE,
  NOMINAL_SIZES,
  ORIENTATION_NAMES,
  parseCatalog,
  putInProjectCatalog,
  sizeLabel,
  type Catalog,
  type ElementKind,
  type ElementType,
  type Material,
  type SprinklerModel,
  type SprinklerOrientation,
} from '../../core';
import { catalogElements, catalogMaterials, catalogSprinklers, exportText, importInto, personal, savePersonal } from './catalogStore';
import { clear, h } from './dom';
import { flash, numInput, rerender, selectInput } from './fields';
import { store } from './state';

type Tab = 'materials' | 'sprinklers' | 'elements';
const TAB_NAMES: Record<Tab, string> = { materials: 'Tuberías', sprinklers: 'Rociadores', elements: 'Elementos' };

let dlg: HTMLDialogElement | null = null;
let tab: Tab = 'materials';
let selected: string | null = null;

export function openCatalog(start?: Tab, itemId?: string) {
  if (start) tab = start;
  if (itemId) selected = itemId;
  if (!dlg) {
    dlg = h('dialog', { class: 'catalog-dialog', 'aria-label': 'Catálogo' });
    dlg.addEventListener('close', () => store.emit('result'));
    document.body.append(dlg);
  }
  render();
  if (!dlg.open) dlg.showModal();
}

type AnyItem = Material | SprinklerModel | ElementType;

function itemsOf(t: Tab): AnyItem[] {
  return t === 'materials' ? catalogMaterials() : t === 'sprinklers' ? catalogSprinklers() : catalogElements();
}

function personalList(t: Tab): AnyItem[] {
  return personal[t] as AnyItem[];
}

/** Guarda un cambio en el catálogo personal y, si el proyecto usa ese ítem, también en el proyecto */
function commit(t: Tab, item: AnyItem) {
  const list = personalList(t);
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
  savePersonal();
  const inProject = (store.project.catalog?.[t] as AnyItem[] | undefined)?.some((x) => x.id === item.id);
  if (inProject) store.mutate((p) => putInProjectCatalog(p, t, item as never));
  render();
}

function render() {
  if (!dlg) return;
  const d = dlg;
  rerender(d, () => {
    const items = itemsOf(tab);
    if (!selected || !items.some((x) => x.id === selected)) selected = items[0]?.id ?? null;
    const current = items.find((x) => x.id === selected);
    clear(
      d,
      h(
        'header',
        { class: 'cat-head' },
        h('h1', null, 'Catálogo'),
        h(
          'div',
          { class: 'tabs', role: 'tablist' },
          (Object.keys(TAB_NAMES) as Tab[]).map((t) =>
            h('button', { role: 'tab', 'aria-selected': String(t === tab), onclick: () => ((tab = t), (selected = null), render()) }, TAB_NAMES[t]),
          ),
        ),
        h('button', { class: 'btn outline small', onclick: () => importCatalog() }, 'Importar'),
        h('button', { class: 'btn outline small', onclick: () => exportCatalog() }, 'Exportar'),
        h('button', { class: 'btn small primary', onclick: () => d.close() }, 'Cerrar'),
      ),
      h(
        'div',
        { class: 'cat-body' },
        h(
          'aside',
          { class: 'cat-list' },
          h('button', { class: 'btn outline small cat-new', onclick: () => createNew() }, newLabel()),
          h('ul', null, items.map((it) => h('li', null, h('button', { class: it.id === selected ? 'sel' : '', onclick: () => ((selected = it.id), render()) }, h('span', null, it.name), it.builtIn ? h('small', null, 'de fábrica') : null)))),
        ),
        h('section', { class: 'cat-form' }, current ? form(current) : h('p', { class: 'muted-text' }, 'No hay ítems.')),
      ),
    );
  });
}

function newLabel() {
  return tab === 'materials' ? 'Nueva tubería' : tab === 'sprinklers' ? 'Nuevo rociador' : 'Nuevo elemento';
}

function createNew(from?: AnyItem) {
  let item: AnyItem;
  if (tab === 'materials') {
    const base = (from as Material) ?? catalogMaterials()[0];
    item = { ...base, id: customId('mat'), name: from ? `${base.name} (copia)` : 'Tubería nueva', builtIn: undefined, id_in: { ...base.id_in } };
  } else if (tab === 'sprinklers') {
    const base = (from as SprinklerModel) ?? catalogSprinklers().find((s) => s.k === 5.6)!;
    item = { ...base, id: customId('spk'), name: from ? `${base.name} (copia)` : 'Rociador nuevo', builtIn: undefined };
  } else {
    const base = (from as ElementType) ?? catalogElements()[0];
    item = { ...base, id: customId('el'), name: from ? `${base.name} (copia)` : 'Elemento nuevo', builtIn: undefined };
  }
  delete (item as { builtIn?: boolean }).builtIn;
  selected = item.id;
  commit(tab, item);
}

function deleteItem(item: AnyItem) {
  const used =
    (tab === 'materials' && store.project.pipes.some((p) => p.material === item.id)) ||
    (tab === 'sprinklers' && store.project.sprinklers.some((s) => s.modelId === item.id)) ||
    (tab === 'elements' && (store.project.elements ?? []).some((e) => e.typeId === item.id));
  const list = personalList(tab);
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list.splice(i, 1);
  savePersonal();
  selected = null;
  render();
  flash(used ? 'Quitado de su catálogo. El proyecto abierto lo conserva porque lo está usando.' : 'Quitado del catálogo');
}

function row(label: string, control: HTMLElement) {
  return h('div', { class: 'field' }, h('span', null, label), control);
}

function textInput(label: string, value: string | undefined, key: string, onCommit: (v: string) => void, readOnly: boolean) {
  const el = h('input', { class: 'input-text', type: 'text', 'data-key': key, 'aria-label': label, readOnly });
  el.value = value ?? '';
  el.addEventListener('change', () => onCommit(el.value.trim()));
  return el;
}

function colorInput(value: string, key: string, onCommit: (v: string) => void, readOnly: boolean) {
  const el = h('input', { type: 'color', value, 'data-key': key, disabled: readOnly, class: 'color-input', 'aria-label': 'Color' });
  el.addEventListener('change', () => onCommit(el.value));
  return el;
}

function form(item: AnyItem): HTMLElement {
  const ro = !!item.builtIn;
  const up = (patch: Partial<AnyItem>) => commit(tab, { ...item, ...patch } as AnyItem);
  const head = h(
    'div',
    { class: 'cat-form-head' },
    h('h2', null, item.name),
    ro
      ? h('p', { class: 'muted-text' }, 'Este ítem viene con el programa y no se puede cambiar. Duplíquelo para crear una versión propia.')
      : null,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn outline small', onclick: () => createNew(item) }, ro ? 'Duplicar para editar' : 'Duplicar'),
      !ro ? h('button', { class: 'btn outline small danger', onclick: () => deleteItem(item) }, 'Quitar del catálogo') : null,
    ),
  );
  const common = row('Nombre', textInput('Nombre', item.name, `cat-name-${item.id}`, (v) => v && up({ name: v }), ro));

  if (tab === 'materials') {
    const m = item as Material;
    const metric = store.project.displayUnits === 'metric';
    const sizes = h(
      'table',
      { class: 'grid cat-sizes' },
      h('thead', null, h('tr', null, h('th', { class: 'l' }, 'Diámetro nominal'), h('th', null, 'Diámetro interno'))),
      h(
        'tbody',
        null,
        NOMINAL_SIZES.map((s) =>
          h(
            'tr',
            null,
            h('td', { class: 'l' }, metric ? `${sizeLabel(s, true)} (${s}")` : `${s}"`),
            h(
              'td',
              null,
              ro
                ? m.id_in[s] !== undefined
                  ? `${(metric ? m.id_in[s]! * 25.4 : m.id_in[s]!).toFixed(metric ? 1 : 3)} ${metric ? 'mm' : 'in'}`
                  : '—'
                : numInput({
                    label: `Diámetro interno ${s}`,
                    q: 'diameter',
                    value: m.id_in[s],
                    placeholder: 'no existe',
                    allowEmpty: true,
                    min: 0.1,
                    key: `cat-id-${m.id}-${s}`,
                    onCommit: (v) => up({ id_in: { ...m.id_in, [s]: v } } as Partial<Material>),
                    onClear: () => {
                      const copy = { ...m.id_in };
                      delete copy[s];
                      up({ id_in: copy } as Partial<Material>);
                    },
                  }),
            ),
          ),
        ),
      ),
    );
    return h(
      'div',
      null,
      head,
      common,
      row('C sistema húmedo', ro ? h('span', null, String(m.cWet)) : numInput({ label: 'C húmedo', value: m.cWet, digits: 0, min: 1, key: `cat-cw-${m.id}`, onCommit: (v) => up({ cWet: v } as Partial<Material>) })),
      row('C sistema seco', ro ? h('span', null, String(m.cDry)) : numInput({ label: 'C seco', value: m.cDry, digits: 0, min: 1, key: `cat-cd-${m.id}`, onCommit: (v) => up({ cDry: v } as Partial<Material>) })),
      row('Largo del tubo comercial', numInput({ disabled: ro, label: 'Largo del tubo', q: 'length', value: m.stickLengthFt, min: 0.1, key: `cat-stick-${m.id}`, onCommit: (v) => !ro && up({ stickLengthFt: v } as Partial<Material>) })),
      row('Color en 3D', colorInput(m.color ?? '#c8102e', `cat-color-${m.id}`, (v) => up({ color: v } as Partial<Material>), ro)),
      h('h3', null, 'Diámetros disponibles'),
      h('p', { class: 'muted-text' }, 'Deje vacío un tamaño que no se fabrique en este material.'),
      sizes,
    );
  }

  if (tab === 'sprinklers') {
    const s = item as SprinklerModel;
    return h(
      'div',
      null,
      head,
      common,
      row('Fabricante', textInput('Fabricante', s.manufacturer, `cat-man-${s.id}`, (v) => up({ manufacturer: v || undefined } as Partial<SprinklerModel>), ro)),
      row('Referencia o SIN', textInput('Referencia', s.model, `cat-ref-${s.id}`, (v) => up({ model: v || undefined } as Partial<SprinklerModel>), ro)),
      row('Factor K', numInput({ disabled: ro, label: 'Factor K', q: 'kfactor', value: s.k, min: 0.1, key: `cat-k-${s.id}`, onCommit: (v) => !ro && up({ k: v } as Partial<SprinklerModel>) })),
      row(
        'Orientación',
        ro
          ? h('span', null, ORIENTATION_NAMES[s.orientation])
          : selectInput<SprinklerOrientation>('Orientación', s.orientation, (Object.keys(ORIENTATION_NAMES) as SprinklerOrientation[]).map((k) => ({ value: k, label: ORIENTATION_NAMES[k] })), `cat-or-${s.id}`, (v) => up({ orientation: v } as Partial<SprinklerModel>)),
      ),
      row('Temperatura', numInput({ disabled: ro, label: 'Temperatura', unit: '°C', digits: 0, value: s.temperatureC, allowEmpty: true, key: `cat-t-${s.id}`, onCommit: (v) => !ro && up({ temperatureC: v } as Partial<SprinklerModel>), onClear: () => !ro && up({ temperatureC: undefined } as Partial<SprinklerModel>) })),
      row(
        'Respuesta',
        ro
          ? h('span', null, s.response === 'standard' ? 'Estándar' : 'Rápida')
          : selectInput<'quick' | 'standard'>('Respuesta', s.response ?? 'quick', [{ value: 'quick', label: 'Rápida' }, { value: 'standard', label: 'Estándar' }], `cat-resp-${s.id}`, (v) => up({ response: v } as Partial<SprinklerModel>)),
      ),
      row(
        'Tipo seco',
        ro
          ? h('span', null, s.dry ? 'Sí' : 'No')
          : selectInput<'no' | 'yes'>('Tipo seco', s.dry ? 'yes' : 'no', [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Sí (colgante o de pared seco)' }], `cat-dry-${s.id}`, (v) => up({ dry: v === 'yes' } as Partial<SprinklerModel>)),
      ),
      row('Cobertura máxima', numInput({ disabled: ro, label: 'Cobertura máxima', q: 'area', value: s.maxCoverage, allowEmpty: true, placeholder: 'según riesgo', key: `cat-cov-${s.id}`, onCommit: (v) => !ro && up({ maxCoverage: v } as Partial<SprinklerModel>), onClear: () => !ro && up({ maxCoverage: undefined } as Partial<SprinklerModel>) })),
      row('Presión mínima', numInput({ disabled: ro, label: 'Presión mínima', q: 'pressure', value: s.minPressure, allowEmpty: true, placeholder: 'según criterio', key: `cat-minp-${s.id}`, onCommit: (v) => !ro && up({ minPressure: v } as Partial<SprinklerModel>), onClear: () => !ro && up({ minPressure: undefined } as Partial<SprinklerModel>) })),
      h('p', { class: 'muted-text' }, 'La presión mínima y la cobertura máxima de la hoja técnica se usan en el cálculo y en los avisos.'),
    );
  }

  const e = item as ElementType;
  const shape = ELEMENT_KIND_SHAPE[e.kind];
  const widthLabel = e.kind === 'wall' ? 'Espesor' : e.kind === 'pipe-ref' ? 'Diámetro' : 'Ancho';
  const heightLabel = e.kind === 'beam' ? 'Peralte' : shape === 'area' ? 'Espesor' : 'Alto';
  return h(
    'div',
    null,
    head,
    common,
    row(
      'Clase',
      ro
        ? h('span', null, ELEMENT_KIND_NAMES[e.kind])
        : selectInput<ElementKind>('Clase', e.kind, (Object.keys(ELEMENT_KIND_NAMES) as ElementKind[]).map((k) => ({ value: k, label: ELEMENT_KIND_NAMES[k] })), `cat-kind-${e.id}`, (v) => up({ kind: v } as Partial<ElementType>)),
    ),
    shape !== 'area'
      ? row(widthLabel, numInput({ disabled: ro, label: widthLabel, q: 'length', value: e.width, min: 0.001, key: `cat-w-${e.id}`, onCommit: (v) => !ro && up({ width: v } as Partial<ElementType>) }))
      : null,
    row(heightLabel, numInput({ disabled: ro, label: heightLabel, q: 'length', value: e.height, min: 0.001, key: `cat-h-${e.id}`, onCommit: (v) => !ro && up({ height: v } as Partial<ElementType>) })),
    row('Color', colorInput(e.color, `cat-ecolor-${e.id}`, (v) => up({ color: v } as Partial<ElementType>), ro)),
  );
}

async function exportCatalog() {
  const n = personal.materials.length + personal.sprinklers.length + personal.elements.length;
  if (!n) return flash('Su catálogo todavía no tiene ítems propios para exportar');
  const content = exportText();
  if (window.rocia) {
    const r = await window.rocia.saveFile({ content, suggestedName: 'mi-catalogo', kind: 'catalog' });
    if (r) flash('Catálogo exportado');
  } else {
    const a = h('a', { href: URL.createObjectURL(new Blob([content], { type: 'application/json' })), download: 'mi-catalogo.rcatalogo' });
    a.click();
  }
}

async function importCatalog() {
  try {
    let text: string | null = null;
    if (window.rocia) {
      const f = await window.rocia.openFile('catalog');
      text = f?.content ?? null;
    } else {
      text = await new Promise<string | null>((resolve) => {
        const input = h('input', { type: 'file', accept: '.rcatalogo,application/json' });
        input.addEventListener('change', async () => resolve((await input.files?.[0]?.text()) ?? null));
        input.click();
      });
    }
    if (!text) return;
    const c: Catalog = parseCatalog(JSON.parse(text));
    const n = importInto(c);
    render();
    flash(n ? `Se importaron ${n} ítems` : 'El archivo no traía ítems válidos');
  } catch (err) {
    flash((err as Error).message);
  }
}
