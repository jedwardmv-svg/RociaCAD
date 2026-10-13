/**
 * Sección "Plano de fondo" del panel izquierdo.
 */
import { INSUNITS_FT, isVectorPlan, type Underlay } from '../../core';
import { h } from './dom';
import { numField } from './fields';
import { store } from './state';
import { pdfScaleFt, pdfScaleN, type UnderlayAsset } from './underlay';

/** Acciones que provee main.ts (abren diálogos o cambian de herramienta) */
export const planHooks = {
  load: async (_file?: File) => {},
  calibrate: () => {},
  move: () => {},
  remove: () => {},
  asset: (): UnderlayAsset | undefined => undefined,
};

let layersOpen = false;

const KIND_NAMES: Record<Underlay['kind'], string> = { dxf: 'Dibujo DXF', dwg: 'Dibujo DWG', pdf: 'PDF', image: 'Imagen' };

function setU(fn: (u: Underlay) => void, key?: string) {
  store.mutate((p) => {
    if (p.underlay) fn(p.underlay);
  }, key);
}

export function planSection(): HTMLElement {
  const u = store.project.underlay;
  if (!u) {
    return h(
      'section',
      { class: 'section' },
      h('h2', null, 'Plano de fondo'),
      h('p', { class: 'muted-text' }, 'Cargue el plano arquitectónico en DWG, DXF, PDF o imagen para dibujar la tubería encima.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn outline small', onclick: () => planHooks.load() }, 'Cargar plano')),
    );
  }
  const asset = planHooks.asset();
  const units = store.project.displayUnits;

  // --- Escala según el tipo
  let scaleField: HTMLElement;
  if (isVectorPlan(u.kind)) {
    const opts = [6, 5, 4, 2, 1].map((code) => ({ code, ...INSUNITS_FT[code] }));
    const match = opts.find((o) => Math.abs(o.ft - u.scale) / o.ft < 1e-6);
    const sel = h(
      'select',
      { 'data-key': 'plan-units', 'aria-label': 'Unidades del dibujo' },
      opts.map((o) => h('option', { value: String(o.code), selected: match?.code === o.code }, o.name)),
      match ? null : h('option', { value: 'custom', selected: true }, 'Calibrada'),
    );
    sel.addEventListener('change', () => {
      const o = opts.find((x) => String(x.code) === sel.value);
      if (!o) return;
      setU((x) => {
        // mantener fija la esquina del dibujo al cambiar de unidades
        const k = o.ft / x.scale;
        const ox = asset?.dxf?.bounds.minX ?? 0;
        const oy = asset?.dxf?.bounds.minY ?? 0;
        const r = (x.rotation * Math.PI) / 180;
        const cx = x.x + x.scale * (ox * Math.cos(r) - oy * Math.sin(r));
        const cy = x.y + x.scale * (ox * Math.sin(r) + oy * Math.cos(r));
        x.scale *= k;
        x.x = cx - x.scale * (ox * Math.cos(r) - oy * Math.sin(r));
        x.y = cy - x.scale * (ox * Math.sin(r) + oy * Math.cos(r));
        x.calibrated = true;
      });
    });
    scaleField = h('div', { class: 'field select' }, h('span', null, 'Unidades del dibujo'), sel);
  } else if (u.kind === 'pdf') {
    scaleField = numField({
      label: 'Escala 1:',
      unit: '',
      value: pdfScaleN(u.scale),
      digits: 1,
      min: 1,
      key: 'plan-pdfscale',
      hint: 'Escala a la que está impreso el plano, por ejemplo 100 para 1:100',
      onCommit: (n) =>
        setU((x) => {
          x.scale = pdfScaleFt(n);
          x.calibrated = true;
        }),
    });
  } else {
    scaleField = numField({
      label: 'Tamaño de un píxel',
      q: 'length',
      value: u.scale,
      digits: units === 'metric' ? 4 : 4,
      min: 1e-6,
      key: 'plan-px',
      onCommit: (v) =>
        setU((x) => {
          x.scale = v;
          x.calibrated = true;
        }),
    });
  }

  const opacity = h('input', { type: 'range', min: '10', max: '100', step: '5', value: String(Math.round(u.opacity * 100)), 'aria-label': 'Opacidad del plano', 'data-key': 'plan-opacity' });
  opacity.addEventListener('input', () => setU((x) => (x.opacity = Number(opacity.value) / 100), 'plan-opacity'));
  const visible = h('input', { type: 'checkbox', checked: u.visible, 'data-key': 'plan-visible' });
  visible.addEventListener('change', () => setU((x) => (x.visible = visible.checked)));
  const invert = h('input', { type: 'checkbox', checked: !!u.invert, 'data-key': 'plan-invert' });
  invert.addEventListener('change', () => setU((x) => (x.invert = invert.checked)));

  let pageField: HTMLElement | null = null;
  if (u.kind === 'pdf' && asset?.pageCount && asset.pageCount > 1) {
    const sel = h(
      'select',
      { 'data-key': 'plan-page', 'aria-label': 'Página' },
      Array.from({ length: asset.pageCount }, (_, i) => h('option', { value: String(i + 1), selected: (u.page ?? 1) === i + 1 }, `Página ${i + 1}`)),
    );
    sel.addEventListener('change', () => setU((x) => (x.page = Number(sel.value))));
    pageField = h('div', { class: 'field select' }, h('span', null, 'Página'), sel);
  }

  let layers: HTMLElement | null = null;
  if (isVectorPlan(u.kind) && asset?.dxf) {
    const hidden = new Set(u.hiddenLayers ?? []);
    const all = asset.dxf.layers;
    const shown = all.filter((l) => !hidden.has(l.name)).length;
    layers = h(
      'details',
      { class: 'layers' },
      h('summary', null, `Capas: ${shown} de ${all.length} visibles`),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn outline small', onclick: () => setU((x) => delete x.hiddenLayers) }, 'Mostrar todas'),
        h('button', { class: 'btn outline small', onclick: () => setU((x) => (x.hiddenLayers = all.map((l) => l.name))) }, 'Ocultar todas'),
      ),
      h(
        'ul',
        null,
        all.map((l) => {
          const cb = h('input', { type: 'checkbox', checked: !hidden.has(l.name), 'data-key': `layer-${l.name}` });
          cb.addEventListener('change', () =>
            setU((x) => {
              const set = new Set(x.hiddenLayers ?? []);
              if (cb.checked) set.delete(l.name);
              else set.add(l.name);
              x.hiddenLayers = set.size ? [...set] : undefined;
            }),
          );
          return h('li', null, h('label', { class: 'check' }, cb, h('span', null, l.name), h('small', null, String(l.segments.length / 4))));
        }),
      ),
    );
    const det = layers as HTMLDetailsElement;
    det.open = layersOpen;
    det.addEventListener('toggle', () => (layersOpen = det.open));
  }

  const dxfNote =
    isVectorPlan(u.kind) && asset?.dxf && asset.dxf.stats.texts > 0
      ? h('p', { class: 'muted-text' }, `${asset.dxf.stats.texts} textos del dibujo no se muestran.`)
      : null;

  return h(
    'section',
    { class: 'section' },
    h('h2', null, 'Plano de fondo'),
    h('dl', { class: 'readout' }, h('dt', null, KIND_NAMES[u.kind]), h('dd', { class: 'ellipsis', title: u.name }, u.name)),
    !asset ? h('p', { class: 'muted-text' }, 'Leyendo el plano…') : null,
    !u.calibrated
      ? h('p', { class: 'notice' }, 'La escala del plano no está confirmada. Use Calibrar y marque dos puntos con una medida conocida, como un eje o un muro.')
      : null,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: `btn small ${u.calibrated ? 'outline' : 'primary'}`, onclick: () => planHooks.calibrate() }, 'Calibrar escala'),
      h('button', { class: 'btn outline small', onclick: () => planHooks.move() }, 'Mover plano'),
    ),
    h('div', { style: 'height:6px' }),
    scaleField,
    pageField,
    numField({ label: 'Giro', unit: '°', value: u.rotation, digits: 2, key: 'plan-rot', onCommit: (v) => setU((x) => (x.rotation = v)) }),
    numField({ label: 'Elevación', q: 'elevation', value: u.z, key: 'plan-z', onCommit: (v) => setU((x) => (x.z = v)) }),
    h('div', { class: 'field' }, h('span', null, 'Opacidad'), opacity),
    h('label', { class: 'check' }, visible, 'Mostrar el plano'),
    !isVectorPlan(u.kind) ? h('label', { class: 'check' }, invert, 'Invertir colores (fondo oscuro)') : null,
    layers,
    dxfNote,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn outline small', onclick: () => planHooks.load() }, 'Cambiar plano'),
      h('button', { class: 'btn outline small danger', onclick: () => planHooks.remove() }, 'Quitar plano'),
    ),
  );
}
