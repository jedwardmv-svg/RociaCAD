/**
 * Catálogo en hojas de cálculo (Excel): la plantilla que se llena y la lectura de sus filas.
 * Aquí no se toca el archivo .xlsx (eso lo hace la interfaz): se trabaja con tablas de celdas,
 * para poder probarlo sin Excel.
 *
 * Hojas: "Tuberías" (una fila por tamaño), "Rociadores" y "Elementos". Las unidades se leen del
 * encabezado de cada columna, así una plantilla en pulgadas o en milímetros se lee igual.
 */
import { customId, ELEMENT_KIND_NAMES, type Catalog, type ElementKind, type ElementType, type SprinklerModel } from './catalog';
import { ORIENTATION_NAMES, type SprinklerOrientation } from './model';
import type { UnitSystem } from './units';
import { DN_MM, NOMINAL_SIZES, type Material, type NominalSize } from './pipes';

export type Cell = string | number | boolean | null | undefined;

export interface SheetColumn {
  header: string;
  width: number;
  /** opciones de la lista desplegable */
  list?: string[];
  /** obligatoria */
  required?: boolean;
  /** la columna se guarda como texto (los tamaños 3/4, 1-1/4…) */
  text?: boolean;
  note?: string;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Cell[][];
}

/** Factor K métrico (L/min/bar½) a US (gpm/psi½) */
export const K_METRIC = 14.413;

const FT = 0.3048;
const PSI_BAR = 0.0689476;

export const SHEET_NAMES = { pipes: 'Tuberías', sprinklers: 'Rociadores', elements: 'Elementos' } as const;

const RESPONSE_NAMES = { quick: 'Rápida', standard: 'Estándar' } as const;
const KIND_SHEET_NAMES: Record<ElementKind, string> = ELEMENT_KIND_NAMES;

/** Quita tildes, mayúsculas y espacios de más para comparar textos */
export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Tamaño nominal escrito de cualquier forma: 1-1/4, 1 1/4, 1¼, 1.25, 1,25, DN32 o 32 mm */
export function parseNominalSize(v: Cell): NominalSize | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  let s = String(v).trim().replace(/["”″]|pulg(adas)?|in\b/gi, '').trim();
  const frac: Record<string, string> = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4' };
  s = s.replace(/[¼½¾]/g, (m) => frac[m]).trim();
  const dn = /^dn\s*(\d+)$/i.exec(s) ?? /^(\d+)\s*mm$/i.exec(s);
  if (dn) return NOMINAL_SIZES.find((x) => DN_MM[x] === Number(dn[1]));
  // número decimal
  const dec = Number(s.replace(',', '.'));
  let value: number;
  if (Number.isFinite(dec)) value = dec;
  else {
    const m = /^(\d+)?[\s-]*(\d+)\/(\d+)$/.exec(s);
    if (!m) return undefined;
    value = (m[1] ? Number(m[1]) : 0) + Number(m[2]) / Number(m[3]);
  }
  const toNum = (x: NominalSize) => {
    const [w, f] = x.includes('-') ? x.split('-') : x.includes('/') ? ['0', x] : [x, ''];
    const [a, b] = f ? f.split('/').map(Number) : [0, 1];
    return Number(w) + a / b;
  };
  return NOMINAL_SIZES.find((x) => Math.abs(toNum(x) - value) < 1e-6);
}

const num = (v: Cell): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

const yes = (v: Cell) => /^(si|s|yes|y|x|1|true|verdadero)$/.test(norm(v));

// ---------- Plantilla ----------

/** Hojas de la plantilla, con los ítems propios actuales (o una fila de ejemplo si no hay) */
export function catalogTemplate(units: UnitSystem, current: Catalog): SheetSpec[] {
  const metric = units === 'metric';
  const L = metric ? 'm' : 'ft';
  const dUnit = metric ? 'mm' : 'in';
  const aUnit = metric ? 'm²' : 'ft²';
  const pUnit = metric ? 'bar' : 'psi';
  const len = (ft: number) => round(metric ? ft * FT : ft, 3);
  const dia = (inch: number) => round(metric ? inch * 25.4 : inch, metric ? 2 : 3);
  const area = (ft2: number) => round(metric ? ft2 * FT * FT : ft2, 2);
  const pres = (psi: number) => round(metric ? psi * PSI_BAR : psi, 3);

  const pipeRows: Cell[][] = [];
  for (const m of current.materials)
    for (const size of NOMINAL_SIZES) {
      const d = m.id_in[size];
      if (d !== undefined) pipeRows.push([m.name, size, dia(d), m.cWet, m.cDry, len(m.stickLengthFt), m.color ?? '']);
    }
  if (!pipeRows.length)
    pipeRows.push(
      ['Ejemplo - Acero SCH 10', '1', dia(1.097), 120, 100, len(6 / FT), '#c8102e'],
      ['Ejemplo - Acero SCH 10', '1-1/4', dia(1.442), 120, 100, len(6 / FT), '#c8102e'],
    );
  const sprRows: Cell[][] = current.sprinklers.map((s) => [
    s.name,
    s.manufacturer ?? '',
    s.model ?? '',
    s.k,
    'gpm/psi½',
    ORIENTATION_NAMES[s.orientation],
    s.temperatureC ?? '',
    s.response ? RESPONSE_NAMES[s.response] : '',
    s.maxCoverage ? area(s.maxCoverage) : '',
    s.minPressure ? pres(s.minPressure) : '',
    s.dry ? 'Sí' : 'No',
  ]);
  if (!sprRows.length) sprRows.push(['Ejemplo - K5.6 colgante respuesta rápida', 'Fabricante', 'SIN 0000', 5.6, 'gpm/psi½', 'Colgante', 68, 'Rápida', area(130), pres(7), 'No']);
  const elRows: Cell[][] = current.elements.map((e) => [e.name, KIND_SHEET_NAMES[e.kind], len(e.width), len(e.height), e.color]);
  if (!elRows.length) elRows.push(['Ejemplo - Muro de ladrillo 12 cm', 'Muro', len(0.12 / FT), len(2.8 / FT), '#c9a68a']);

  return [
    {
      name: SHEET_NAMES.pipes,
      columns: [
        { header: 'Nombre de la tubería', width: 34, required: true, note: 'Las filas con el mismo nombre son los tamaños de una misma tubería.' },
        { header: 'Tamaño nominal (pulgadas)', width: 14, required: true, text: true, list: NOMINAL_SIZES as string[], note: 'Ej.: 1, 1-1/4, 2-1/2 (también sirve 1¼, 1.25 o DN32).' },
        { header: `Diámetro interno (${dUnit})`, width: 16, required: true, note: 'De la hoja técnica del fabricante.' },
        { header: 'C sistema húmedo', width: 12, required: true, note: 'Coeficiente de Hazen-Williams (acero 120, CPVC y cobre 150).' },
        { header: 'C sistema seco', width: 12, note: 'Si se deja vacío se usa el de húmedo (el acero en seco se calcula con 100).' },
        { header: `Largo del tubo comercial (${L})`, width: 14, note: metric ? 'Por omisión 6 m.' : 'Por omisión 21 ft.' },
        { header: 'Color en 3D', width: 10, note: 'Opcional, en formato #rrggbb.' },
      ],
      rows: pipeRows,
    },
    {
      name: SHEET_NAMES.sprinklers,
      columns: [
        { header: 'Nombre', width: 36, required: true },
        { header: 'Fabricante', width: 16 },
        { header: 'Modelo / SIN', width: 14 },
        { header: 'Factor K', width: 10, required: true },
        { header: 'Unidad de K', width: 12, list: ['gpm/psi½', 'L/min/bar½'], note: 'Las hojas técnicas dan las dos: K 5.6 = K 80.' },
        { header: 'Tipo', width: 12, required: true, list: Object.values(ORIENTATION_NAMES) },
        { header: 'Temperatura (°C)', width: 12 },
        { header: 'Respuesta', width: 11, list: Object.values(RESPONSE_NAMES) },
        { header: `Cobertura máxima (${aUnit})`, width: 14, note: 'La de su listado, si es menor que la de la norma.' },
        { header: `Presión mínima (${pUnit})`, width: 13 },
        { header: 'Tipo seco', width: 9, list: ['Sí', 'No'] },
      ],
      rows: sprRows,
    },
    {
      name: SHEET_NAMES.elements,
      columns: [
        { header: 'Nombre', width: 34, required: true },
        { header: 'Clase', width: 22, required: true, list: Object.values(KIND_SHEET_NAMES) },
        { header: `Ancho o espesor (${L})`, width: 16, required: true, note: 'Espesor del muro, ancho de viga, columna o ducto, diámetro de tubería. En losas y cielos, 0.' },
        { header: `Altura o espesor (${L})`, width: 16, required: true, note: 'Altura del muro o columna, peralte de la viga, espesor de la losa, alto del ducto.' },
        { header: 'Color', width: 10, note: 'Opcional, en formato #rrggbb.' },
      ],
      rows: elRows,
    },
  ];
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Texto de la hoja de instrucciones */
export const TEMPLATE_INSTRUCTIONS = [
  'Catálogo de RociaCAD',
  '',
  '1. Llene las hojas Tuberías, Rociadores y Elementos con los datos de las hojas técnicas de los fabricantes.',
  '2. Las columnas con * son obligatorias. Las demás se pueden dejar vacías.',
  '3. En Tuberías va una fila por cada tamaño: las filas con el mismo nombre forman una sola tubería.',
  '4. Las unidades son las que dice cada encabezado. Puede cambiar (mm) por (in), (m) por (ft) o (bar) por (psi) en el encabezado si sus datos vienen así.',
  '5. Las filas cuyo nombre empieza con "Ejemplo" no se importan: bórrelas o cámbieles el nombre.',
  '6. Guarde el archivo y en RociaCAD vaya a Catálogo → Importar desde Excel.',
  '7. Si importa un ítem con el mismo nombre de uno que ya creó, se actualiza en vez de duplicarse.',
];

// ---------- Lectura ----------

export interface CatalogImport {
  catalog: Catalog;
  added: number;
  updated: number;
  errors: string[];
}

interface Col {
  index: number;
  header: string;
}

/** Ubica las columnas por palabras clave del encabezado */
function columns(header: Cell[], keys: Record<string, RegExp>): Record<string, Col | undefined> {
  const out: Record<string, Col | undefined> = {};
  const h = header.map((x) => norm(x).replace(/\s*\*$/, ''));
  for (const [k, re] of Object.entries(keys)) {
    const i = h.findIndex((x) => re.test(x));
    out[k] = i >= 0 ? { index: i, header: h[i] } : undefined;
  }
  return out;
}

/** Fila del encabezado: la primera que tiene un "nombre" */
function headerRow(rows: Cell[][]): number {
  return rows.findIndex((r) => r.some((c) => /^nombre/.test(norm(c))));
}

const unitOf = (header: string | undefined, opts: string[]): string | undefined => {
  if (!header) return undefined;
  const m = /\(([^)]*)\)/.exec(header);
  const u = (m ? m[1] : header).replace(/\s/g, '');
  return opts.find((o) => u.includes(o));
};

/** Convierte a pies una longitud según la unidad del encabezado */
const toFt = (v: number, header: string | undefined, metricDefault: boolean) => {
  const u = unitOf(header, ['mm', 'cm', 'ft', 'pies', 'in', 'm']) ?? (metricDefault ? 'm' : 'ft');
  return u === 'mm' ? v / 304.8 : u === 'cm' ? v / 30.48 : u === 'in' ? v / 12 : u === 'ft' || u === 'pies' ? v : v / FT;
};
const toIn = (v: number, header: string | undefined, metricDefault: boolean) => {
  const u = unitOf(header, ['mm', 'cm', 'in', 'pulg']) ?? (metricDefault ? 'mm' : 'in');
  return u === 'mm' ? v / 25.4 : u === 'cm' ? v / 2.54 : v;
};
const toFt2 = (v: number, header: string | undefined, metricDefault: boolean) => {
  const u = unitOf(header, ['m²', 'm2', 'ft²', 'ft2']) ?? (metricDefault ? 'm²' : 'ft²');
  return u.startsWith('m') ? v / (FT * FT) : v;
};
const toPsi = (v: number, header: string | undefined, metricDefault: boolean) => {
  const u = unitOf(header, ['bar', 'kpa', 'psi']) ?? (metricDefault ? 'bar' : 'psi');
  return u === 'bar' ? v / PSI_BAR : u === 'kpa' ? v / (PSI_BAR * 100) : v;
};

const COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Lee las hojas (nombre → filas de celdas) y arma los ítems del catálogo.
 * `existing` es el catálogo propio actual: los ítems con el mismo nombre se actualizan.
 */
export function parseCatalogSheets(sheets: Record<string, Cell[][]>, existing: Catalog, units: UnitSystem): CatalogImport {
  const metric = units === 'metric';
  const errors: string[] = [];
  const out: Catalog = { materials: [], sprinklers: [], elements: [] };
  let added = 0;
  let updated = 0;
  const find = (prefix: RegExp) => Object.keys(sheets).find((n) => prefix.test(norm(n)));
  const skip = (name: string) => !name || /^ejemplo\b/.test(norm(name));
  const idFor = <T extends { id: string; name: string }>(list: T[], name: string, prefix: string) => {
    const old = list.find((x) => norm(x.name) === norm(name));
    if (old) updated++;
    else added++;
    return old?.id ?? customId(prefix);
  };

  // --- Tuberías
  const pipeSheet = find(/^tuber|^pipe|^materiales?$/);
  if (pipeSheet) {
    const rows = sheets[pipeSheet];
    const hr = headerRow(rows);
    if (hr < 0) errors.push(`${pipeSheet}: no se encontró la fila de encabezados (la que tiene "Nombre…").`);
    else {
      const c = columns(rows[hr], { name: /^nombre/, size: /tamano|nominal|diametro nominal/, id: /interno|interior/, cw: /humedo|^c$|^c \(|^coeficiente c$/, cd: /seco/, len: /largo|longitud/, color: /color/ });
      const byName = new Map<string, Material>();
      rows.slice(hr + 1).forEach((r, k) => {
        const row = hr + k + 2;
        const name = String(r[c.name?.index ?? -1] ?? '').trim();
        if (skip(name)) return;
        const size = parseNominalSize(r[c.size?.index ?? -1]);
        const d = num(r[c.id?.index ?? -1]);
        if (!size) return void errors.push(`${pipeSheet}, fila ${row}: el tamaño nominal "${r[c.size?.index ?? -1] ?? ''}" no se reconoce.`);
        if (!(d && d > 0)) return void errors.push(`${pipeSheet}, fila ${row}: falta el diámetro interno de ${name} ${size}".`);
        let m = byName.get(norm(name));
        if (!m) {
          const cw = num(r[c.cw?.index ?? -1]);
          if (!(cw && cw > 0)) return void errors.push(`${pipeSheet}, fila ${row}: falta el C de ${name}.`);
          const cd = num(r[c.cd?.index ?? -1]);
          const len = num(r[c.len?.index ?? -1]);
          const color = String(r[c.color?.index ?? -1] ?? '').trim();
          m = {
            id: idFor(existing.materials, name, 'tub'),
            name,
            cWet: cw,
            cDry: cd && cd > 0 ? cd : cw,
            id_in: {},
            stickLengthFt: len && len > 0 ? toFt(len, c.len?.header, metric) : metric ? 6 / FT : 21,
            color: COLOR.test(color) ? color : undefined,
          };
          byName.set(norm(name), m);
        }
        const inches = toIn(d, c.id?.header, metric);
        if (inches > 30) return void errors.push(`${pipeSheet}, fila ${row}: un diámetro interno de ${d} parece estar en otra unidad (revise el encabezado).`);
        m.id_in[size] = round(inches, 4);
      });
      out.materials = [...byName.values()].filter((m) => Object.keys(m.id_in).length);
    }
  }

  // --- Rociadores
  const sprSheet = find(/^rociador|^sprinkler/);
  if (sprSheet) {
    const rows = sheets[sprSheet];
    const hr = headerRow(rows);
    if (hr < 0) errors.push(`${sprSheet}: no se encontró la fila de encabezados.`);
    else {
      const c = columns(rows[hr], {
        name: /^nombre/,
        maker: /fabricante|marca/,
        model: /modelo|sin\b/,
        k: /factor k|^k\b/,
        ku: /unidad de k/,
        type: /^tipo$|orientacion|^tipo de rociador/,
        temp: /temperatura/,
        resp: /respuesta/,
        cov: /cobertura/,
        pmin: /presion/,
        dry: /tipo seco|^seco/,
      });
      const orient = (v: Cell): SprinklerOrientation | undefined => {
        const t = norm(v);
        if (/colgante|pendent/.test(t)) return 'pendent';
        if (/montante|upright/.test(t)) return 'upright';
        if (/pared|sidewall|lateral/.test(t)) return 'sidewall';
        if (/oculto|concealed|empotrado/.test(t)) return 'concealed';
        return undefined;
      };
      rows.slice(hr + 1).forEach((r, k) => {
        const row = hr + k + 2;
        const name = String(r[c.name?.index ?? -1] ?? '').trim();
        if (skip(name)) return;
        let K = num(r[c.k?.index ?? -1]);
        if (!(K && K > 0)) return void errors.push(`${sprSheet}, fila ${row}: falta el factor K de ${name}.`);
        const ku = norm(r[c.ku?.index ?? -1]);
        // K métrico (L/min/bar½): por la unidad o porque el número es muy grande para K en gpm
        if (/l\/min|bar/.test(ku) || (!ku && K > 50)) K = round(K / K_METRIC, 2);
        const o = orient(r[c.type?.index ?? -1]);
        if (!o) return void errors.push(`${sprSheet}, fila ${row}: el tipo "${r[c.type?.index ?? -1] ?? ''}" no se reconoce (Colgante, Montante, De pared u Oculto).`);
        const temp = num(r[c.temp?.index ?? -1]);
        const respT = norm(r[c.resp?.index ?? -1]);
        const cov = num(r[c.cov?.index ?? -1]);
        const pmin = num(r[c.pmin?.index ?? -1]);
        const s: SprinklerModel = {
          id: idFor(existing.sprinklers, name, 'roc'),
          name,
          manufacturer: String(r[c.maker?.index ?? -1] ?? '').trim() || undefined,
          model: String(r[c.model?.index ?? -1] ?? '').trim() || undefined,
          k: K,
          orientation: o,
          temperatureC: temp && temp > 0 ? temp : undefined,
          response: /rapid|quick|qr/.test(respT) ? 'quick' : /estandar|standard|sr/.test(respT) ? 'standard' : undefined,
          maxCoverage: cov && cov > 0 ? round(toFt2(cov, c.cov?.header, metric), 2) : undefined,
          minPressure: pmin && pmin > 0 ? round(toPsi(pmin, c.pmin?.header, metric), 2) : undefined,
          dry: c.dry ? yes(r[c.dry.index]) : undefined,
        };
        out.sprinklers.push(s);
      });
    }
  }

  // --- Elementos
  const elSheet = find(/^elemento/);
  if (elSheet) {
    const rows = sheets[elSheet];
    const hr = headerRow(rows);
    if (hr < 0) errors.push(`${elSheet}: no se encontró la fila de encabezados.`);
    else {
      const c = columns(rows[hr], { name: /^nombre/, kind: /clase|tipo/, w: /ancho/, h: /altura|alto/, color: /color/ });
      const kinds = Object.entries(KIND_SHEET_NAMES) as [ElementKind, string][];
      rows.slice(hr + 1).forEach((r, k) => {
        const row = hr + k + 2;
        const name = String(r[c.name?.index ?? -1] ?? '').trim();
        if (skip(name)) return;
        const kt = norm(r[c.kind?.index ?? -1]);
        const kind = kinds.find(([, label]) => norm(label) === kt || norm(label).startsWith(kt))?.[0] ?? (kt.startsWith('tuberia') ? 'pipe-ref' : undefined);
        if (!kt || !kind) return void errors.push(`${elSheet}, fila ${row}: la clase "${r[c.kind?.index ?? -1] ?? ''}" no se reconoce.`);
        const w = num(r[c.w?.index ?? -1]) ?? 0;
        const hgt = num(r[c.h?.index ?? -1]);
        if (!(hgt && hgt > 0)) return void errors.push(`${elSheet}, fila ${row}: falta la altura o espesor de ${name}.`);
        const color = String(r[c.color?.index ?? -1] ?? '').trim();
        const e: ElementType = {
          id: idFor(existing.elements, name, 'ele'),
          name,
          kind,
          width: toFt(w, c.w?.header, metric),
          height: toFt(hgt, c.h?.header, metric),
          color: COLOR.test(color) ? color : '#b9c2ca',
        };
        out.elements.push(e);
      });
    }
  }

  if (!pipeSheet && !sprSheet && !elSheet) errors.push('El archivo no tiene hojas llamadas Tuberías, Rociadores o Elementos. Use la plantilla de RociaCAD.');
  return { catalog: out, added, updated, errors };
}
