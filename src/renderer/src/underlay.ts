/**
 * Plano de fondo: lectura de archivos (DXF, PDF, imagen) y preparación para la vista 3D.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { INSUNITS_FT, isVectorPlan, parseDxf, plausibleScale, planFromDwgDatabase, type AttachedData, type DwgDatabaseLike, type DxfResult, type Underlay } from '../../core';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface UnderlayAsset {
  kind: Underlay['kind'];
  dxf?: DxfResult;
  /** imagen ya dibujada (PDF o imagen) */
  canvas?: HTMLCanvasElement;
  /** tamaño en unidades del plano (puntos del PDF o píxeles de la imagen) */
  width: number;
  height: number;
  pageCount?: number;
}

export const ACCEPT = '.dxf,.pdf,.png,.jpg,.jpeg,.webp,.dwg';

/** PDF: pies por punto para una escala de dibujo 1:N (1 punto = 1/72 de pulgada en el papel) */
export const pdfScaleFt = (n: number) => n / 72 / 12;
export const pdfScaleN = (ftPerPt: number) => ftPerPt * 72 * 12;

// ---------- base64 ----------
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- lectura ----------
const cache = new Map<string, Promise<UnderlayAsset>>();

function assetKey(u: Underlay) {
  return `${u.dataId}|${u.kind === 'pdf' ? u.page ?? 1 : ''}|${!isVectorPlan(u.kind) && u.invert ? 'inv' : ''}`;
}

export function loadAsset(u: Underlay, data: AttachedData): Promise<UnderlayAsset> {
  const key = assetKey(u);
  let p = cache.get(key);
  if (!p) {
    p = readAsset(u, data);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function readAsset(u: Underlay, data: AttachedData): Promise<UnderlayAsset> {
  const bytes = fromBase64(data.base64);
  if (u.kind === 'dxf' || u.kind === 'dwg') {
    const dxf = u.kind === 'dxf' ? parseDxf(decodeDxf(bytes)) : await readDwg(bytes);
    const b = dxf.bounds;
    return { kind: 'dxf', dxf, width: b.maxX - b.minX, height: b.maxY - b.minY };
  }
  if (u.kind === 'pdf') return readPdf(bytes, u.page ?? 1, !!u.invert);
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: data.mime }));
  const canvas = toCanvas(bitmap.width, bitmap.height, (ctx) => ctx.drawImage(bitmap, 0, 0), !!u.invert);
  return { kind: 'image', canvas, width: bitmap.width, height: bitmap.height };
}

/** Los DXF viejos vienen en ANSI (Windows-1252); los nuevos en UTF-8 */
function decodeDxf(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---------- DWG (LibreDWG en WebAssembly; se carga solo cuando hace falta) ----------
type LibreDwgModule = typeof import('@mlightcad/libredwg-web');
let dwgLib: Promise<{ mod: LibreDwgModule; lib: Awaited<ReturnType<LibreDwgModule['LibreDwg']['create']>> }> | null = null;

function loadDwgLib() {
  if (!dwgLib) {
    dwgLib = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      // Vite empaqueta el .wasm junto al código y la librería lo encuentra sola
      const lib = await mod.LibreDwg.create();
      return { mod, lib };
    })();
    dwgLib.catch(() => (dwgLib = null));
  }
  return dwgLib;
}

async function readDwg(bytes: Uint8Array): Promise<DxfResult> {
  // En la app de escritorio el DWG se lee en una ventana aislada (LibreDWG necesita eval)
  if (window.rocia?.parseDwg) return (await window.rocia.parseDwg(bytes)) as DxfResult;
  const { mod, lib } = await loadDwgLib();
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const dwg = lib.dwg_read_data(buf, mod.Dwg_File_Type.DWG);
  if (!dwg) throw new Error('El archivo DWG está dañado o es de una versión que no se pudo leer.');
  try {
    const db = lib.convert(dwg) as unknown as DwgDatabaseLike;
    return planFromDwgDatabase(db);
  } finally {
    lib.dwg_free(dwg);
  }
}

/** Tamaño máximo de textura que aceptamos (la mayoría de tarjetas aceptan 8192 o más) */
let maxTexture = 8192;
export function setMaxTexture(n: number) {
  maxTexture = Math.min(16384, Math.max(2048, n));
}

async function readPdf(bytes: Uint8Array, pageNo: number, invert: boolean): Promise<UnderlayAsset> {
  const base = new URL('./pdfjs/', location.href).href;
  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: base + 'standard_fonts/',
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    wasmUrl: base + 'wasm/',
    iccUrl: base + 'iccs/',
  });
  const doc = await task.promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const vp1 = page.getViewport({ scale: 1 });
  // resolución: lo más alto que permita la tarjeta de video, sin pasar de 6 px por punto
  const scale = Math.min(6, maxTexture / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const raw = document.createElement('canvas');
  raw.width = Math.floor(vp.width);
  raw.height = Math.floor(vp.height);
  const ctx = raw.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, raw.width, raw.height);
  await page.render({ canvas: raw, canvasContext: ctx, viewport: vp }).promise;
  const canvas = invert ? toCanvas(raw.width, raw.height, (c) => c.drawImage(raw, 0, 0), true) : raw;
  const out: UnderlayAsset = { kind: 'pdf', canvas, width: vp1.width, height: vp1.height, pageCount: doc.numPages };
  await task.destroy();
  return out;
}

function toCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, invert: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (invert) {
    ctx.filter = 'invert(1)';
  }
  draw(ctx);
  return c;
}

// ---------- archivo nuevo ----------
export interface NewUnderlay {
  meta: Underlay;
  data: AttachedData;
  asset: UnderlayAsset;
}

export function pickPlanFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

/** Lee un archivo elegido por el usuario y propone escala y posición iniciales. */
export async function createUnderlay(file: File): Promise<NewUnderlay> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const kind: Underlay['kind'] = ext === 'dxf' ? 'dxf' : ext === 'dwg' ? 'dwg' : ext === 'pdf' ? 'pdf' : 'image';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = kind === 'dxf' ? 'image/vnd.dxf' : kind === 'dwg' ? 'image/vnd.dwg' : kind === 'pdf' ? 'application/pdf' : file.type || 'image/png';
  const data: AttachedData = { mime, base64: toBase64(bytes) };
  const meta: Underlay = {
    kind,
    name: file.name,
    dataId: `plano-${Date.now().toString(36)}`,
    page: kind === 'pdf' ? 1 : undefined,
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    z: 0,
    opacity: isVectorPlan(kind) ? 0.9 : 0.75,
    visible: true,
    invert: !isVectorPlan(kind) ? true : undefined,
    calibrated: false,
  };
  const asset = await loadAsset(meta, data);

  if (isVectorPlan(kind)) {
    const d = asset.dxf!;
    const span = Math.max(d.bounds.maxX - d.bounds.minX, d.bounds.maxY - d.bounds.minY);
    const pick = plausibleScale(span, d.ftPerUnit);
    meta.scale = pick.ft;
    if (d.ftPerUnit && !pick.corrected) meta.calibrated = true;
    if (pick.corrected && pick.code) {
      const said = INSUNITS_FT[d.insUnits]?.name ?? 'otra unidad';
      const toM = (ft: number) => (ft * 0.3048).toLocaleString('es-CO', { maximumFractionDigits: ft * 0.3048 < 1 ? 3 : 0 });
      meta.unitsNote =
        `El archivo dice que está en ${said}, pero así el dibujo mediría ${toM(span * d.ftPerUnit!)} m de ancho. ` +
        `Se tomó en ${INSUNITS_FT[pick.code].name} (${toM(span * pick.ft)} m). Si no es así, cambie las unidades del dibujo o calibre la escala.`;
    }
    meta.x = -d.bounds.minX * meta.scale;
    meta.y = -d.bounds.minY * meta.scale;
    // las capas que venían apagadas o congeladas en el archivo empiezan ocultas
    const off = d.layers.filter((l) => l.off).map((l) => l.name);
    if (off.length && off.length < d.layers.length) meta.hiddenLayers = off;
  } else if (kind === 'pdf') {
    meta.scale = pdfScaleFt(100);
  } else {
    meta.scale = 0.01 / 0.3048; // 1 píxel = 1 cm, hasta calibrar
  }
  return { meta, data, asset };
}
