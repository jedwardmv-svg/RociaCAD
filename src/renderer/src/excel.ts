/**
 * Catálogo en Excel: descargar la plantilla (con los ítems propios actuales) e importarla llena.
 * ExcelJS se carga solo cuando se usa.
 */
import { catalogTemplate, parseCatalogSheets, TEMPLATE_INSTRUCTIONS, type Cell, type CatalogImport } from '../../core';
import { h } from './dom';
import { importInto, personal } from './catalogStore';
import { store } from './state';
import { toBase64 } from './underlay';

type ExcelJSModule = typeof import('exceljs');

let lib: Promise<ExcelJSModule> | null = null;
function excel(): Promise<ExcelJSModule> {
  // versión para navegador (sin dependencias de Node)
  lib ??= import('exceljs/dist/exceljs.min.js').then((m) => ((m as { default?: ExcelJSModule }).default ?? m) as ExcelJSModule);
  return lib;
}

const RED = 'FFC8102E';

/** Arma la plantilla y la guarda donde diga el usuario */
export async function downloadTemplate(): Promise<boolean> {
  const buf = await templateBuffer();
  const name = 'catalogo-rociacad';
  if (window.rocia) {
    const r = await window.rocia.saveFile({ content: toBase64(buf), suggestedName: name, kind: 'xlsx', base64: true });
    return !!r;
  }
  const a = h('a', { href: URL.createObjectURL(new Blob([buf as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), download: `${name}.xlsx` });
  a.click();
  return true;
}

/** Libro de Excel de la plantilla */
export async function templateBuffer(): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RociaCAD';
  const info = wb.addWorksheet('Instrucciones');
  info.getColumn(1).width = 120;
  const specs = catalogTemplate(store.project.displayUnits, personal);
  // instrucciones y, debajo, qué va en cada columna (sin comentarios en las celdas: ExcelJS
  // no puede volver a leer algunos archivos con comentarios guardados por otros programas)
  const lines: { text: string; bold?: boolean; size?: number }[] = TEMPLATE_INSTRUCTIONS.map((t, i) => ({ text: t, bold: i === 0, size: i === 0 ? 14 : undefined }));
  for (const spec of specs) {
    lines.push({ text: '' }, { text: `Hoja ${spec.name}`, bold: true });
    for (const col of spec.columns) lines.push({ text: `• ${col.header}${col.required ? ' (obligatoria)' : ''}${col.note ? ': ' + col.note : ''}` });
  }
  lines.forEach((l, i) => {
    const c = info.getCell(i + 1, 1);
    c.value = l.text;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (l.bold) c.font = { bold: true, size: l.size };
  });
  for (const spec of specs) {
    const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    spec.columns.forEach((col, j) => {
      ws.getColumn(j + 1).width = col.width;
      const c = ws.getCell(1, j + 1);
      c.value = col.required ? `${col.header} *` : col.header;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } };
      c.alignment = { wrapText: true, vertical: 'middle' };
      // como texto: si no, Excel convierte 3/4 en una fecha
      if (col.text) for (let r = 2; r <= 400; r++) ws.getCell(r, j + 1).numFmt = '@';
      // lista desplegable en la columna
      if (col.list)
        for (let r = 2; r <= 400; r++)
          ws.getCell(r, j + 1).dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: [`"${col.list.join(',')}"`],
            showErrorMessage: false,
          };
    });
    ws.getRow(1).height = 32;
    spec.rows.forEach((row, i) => row.forEach((v, j) => (ws.getCell(i + 2, j + 1).value = v === '' || v === undefined ? null : (v as string | number))));
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** Valor simple de una celda de ExcelJS (texto, número, fórmula, enlace o texto con formato) */
function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; error?: unknown };
  if (o.richText) return o.richText.map((x) => x.text).join('');
  if (o.result !== undefined) return plain(o.result);
  if (o.text !== undefined) return plain(o.text);
  return null;
}

/** Pide el archivo, lo lee y agrega los ítems al catálogo propio */
export async function importExcel(): Promise<CatalogImport | null> {
  const file = await new Promise<File | null>((resolve) => {
    const input = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
  if (!file) return null;
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Use un archivo de Excel .xlsx (en Excel: Archivo → Guardar como → Libro de Excel).');
  return importExcelBuffer(await file.arrayBuffer());
}

/**
 * Quita del libro los comentarios de las celdas (y sus dibujos): no hacen falta para importar y
 * ExcelJS no puede abrir algunos libros que los traen.
 */
async function withoutComments(data: ArrayBuffer): Promise<ArrayBuffer> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(data));
  const drop = (name: string) => /^xl\/(comments[^/]*\.xml$|comments\/|threadedComments\/|persons\/|drawings\/(vmlDrawing|commentsDrawing)[^/]*$)/i.test(name);
  let changed = false;
  for (const name of Object.keys(files)) {
    if (drop(name)) {
      delete files[name];
      changed = true;
    }
  }
  if (!changed) return data;
  for (const name of Object.keys(files)) {
    if (/^xl\/worksheets\/_rels\/.*\.rels$/i.test(name)) {
      const xml = strFromU8(files[name]).replace(/<Relationship\b[^>]*Type="[^"]*(comments|vmlDrawing|threadedComment)"[^>]*\/>/gi, '');
      files[name] = strToU8(xml);
    } else if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
      files[name] = strToU8(strFromU8(files[name]).replace(/<legacyDrawing\b[^>]*\/>/gi, ''));
    } else if (name === '[Content_Types].xml') {
      files[name] = strToU8(strFromU8(files[name]).replace(/<Override\b[^>]*PartName="\/xl\/(comments|threadedComments|persons|drawings\/(vmlDrawing|commentsDrawing))[^"]*"[^>]*\/>/gi, ''));
    }
  }
  const out = zipSync(files);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** Lee un libro de Excel y agrega sus ítems al catálogo propio */
export async function importExcelBuffer(data: ArrayBuffer): Promise<CatalogImport> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await withoutComments(data));
  const sheets: Record<string, Cell[][]> = {};
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = (row.values as unknown[]).slice(1).map(plain);
      rows[n - 1] = vals;
    });
    sheets[ws.name] = Array.from(rows, (r) => r ?? []);
  });
  const res = parseCatalogSheets(sheets, personal, store.project.displayUnits);
  importInto(res.catalog);
  return res;
}
