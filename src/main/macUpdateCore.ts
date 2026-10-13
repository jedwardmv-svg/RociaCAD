/**
 * Partes "puras" de la actualización en Mac (sin Electron), para poder probarlas.
 * Ver macUpdate.ts para el flujo completo.
 */

export interface UpdateFile {
  url: string;
  sha512: string;
  size?: number;
}

/** El .zip de la versión nueva para la arquitectura de este Mac (arm64 = chip Apple, x64 = Intel) */
export function pickMacZip(files: UpdateFile[], arch: string): UpdateFile | undefined {
  const a = arch === 'arm64' ? 'arm64' : 'x64';
  return (
    files.find((f) => f.url.endsWith('.zip') && f.url.includes(`-Mac-${a}`)) ??
    // por si algún día se publica un solo zip universal
    files.find((f) => f.url.endsWith('.zip') && /universal/i.test(f.url))
  );
}

/** Ruta del paquete .app a partir del ejecutable: /Applications/RociaCAD.app/Contents/MacOS/RociaCAD */
export function bundlePathFromExe(exePath: string): string | null {
  const m = exePath.match(/^(.*?\.app)\/Contents\/MacOS\/[^/]+$/);
  return m ? m[1] : null;
}

/** Motivo por el que la app no se puede reemplazar sola, o null si se puede */
export function cannotReplaceReason(bundle: string | null): string | null {
  if (!bundle) return 'No se encontró la ubicación de la aplicación.';
  if (bundle.includes('/AppTranslocation/'))
    return 'macOS está ejecutando RociaCAD desde una ubicación temporal. Arrastre RociaCAD a la carpeta Aplicaciones, ábrala desde ahí e intente de nuevo.';
  if (bundle.startsWith('/Volumes/'))
    return 'RociaCAD se está ejecutando desde el disco de instalación. Arrástrelo a la carpeta Aplicaciones, ábralo desde ahí e intente de nuevo.';
  return null;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Guion que espera a que la app se cierre, reemplaza el paquete .app por el nuevo y,
 * si se pide, la vuelve a abrir. Si algo falla, deja la versión anterior intacta.
 */
export function buildSwapScript(opts: {
  pid: number;
  current: string;
  staged: string;
  relaunch: boolean;
  log: string;
  /** archivo que se crea si la instalación falla (la app lo revisa al abrir) */
  failMarker: string;
  /** rutas de los programas de macOS (se cambian solo en las pruebas) */
  tools?: { ditto: string; xattr: string; open: string };
}): string {
  const { pid, current, staged, relaunch, log } = opts;
  const t = opts.tools ?? { ditto: '/usr/bin/ditto', xattr: '/usr/bin/xattr', open: '/usr/bin/open' };
  const next = `${current}.nueva`;
  const old = `${current}.anterior`;
  // si algo falla: se deja la versión anterior, se anota el fallo y se vuelve a abrir la app
  const fail = (msg: string, extra = '') =>
    `then echo ${q(msg)}; ${extra}echo ${q(msg)} > ${q(opts.failMarker)}; ${relaunch ? `${q(t.open)} ${q(current)}; ` : ''}exit 1; fi`;
  return [
    '#!/bin/bash',
    `exec >>${q(log)} 2>&1`,
    'echo "--- $(date) actualización de RociaCAD"',
    // esperar hasta 60 s a que se cierre la app
    `for i in $(seq 1 300); do kill -0 ${pid} 2>/dev/null || break; sleep 0.2; done`,
    `rm -rf ${q(next)} ${q(old)}`,
    // copiar primero al lado de la app (mismo disco) y luego intercambiar
    `if ! ${q(t.ditto)} ${q(staged)} ${q(next)}; ${fail('No se pudo copiar la versión nueva.', `rm -rf ${q(next)}; `)}`,
    `${q(t.xattr)} -dr com.apple.quarantine ${q(next)} 2>/dev/null || true`,
    `if ! mv ${q(current)} ${q(old)}; ${fail('macOS no permitió reemplazar la aplicación.', `rm -rf ${q(next)}; `)}`,
    `if ! mv ${q(next)} ${q(current)}; ${fail('No se pudo poner la versión nueva.', `mv ${q(old)} ${q(current)}; `)}`,
    `rm -rf ${q(old)}`,
    `rm -rf ${q(staged.replace(/\/[^/]+\.app$/, ''))}`,
    relaunch ? `${q(t.open)} ${q(current)}` : '',
    'echo "listo"',
  ]
    .filter(Boolean)
    .join('\n');
}
