/**
 * Actualización dentro de la app en Mac, sin certificado de Apple.
 *
 * El actualizador estándar de macOS (Squirrel) exige una firma de Apple pagada. En su lugar:
 *  1. se descarga de GitHub el .zip de la versión nueva para este Mac (chip Apple o Intel),
 *  2. se comprueba su huella SHA-512 contra la publicada en la versión (latest-mac.yml),
 *  3. se descomprime en una carpeta temporal,
 *  4. al reiniciar, un pequeño guion reemplaza RociaCAD.app por la nueva y la abre.
 * Como la descarga la hace la propia app (no el navegador), macOS no la marca como
 * "descargada de internet" y no vuelve a pedir permisos.
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { bundlePathFromExe, buildSwapScript, cannotReplaceReason, pickMacZip, type UpdateFile } from './macUpdateCore';

const run = promisify(execFile);
const REPO_DOWNLOAD = 'https://github.com/jedwardmv-svg/RociaCAD/releases/download';

let staged: { version: string; appPath: string } | null = null;

/** null si esta copia de la app se puede reemplazar sola; si no, el motivo para el usuario */
export function macSelfUpdateProblem(): string | null {
  const bundle = bundlePathFromExe(process.execPath);
  const reason = cannotReplaceReason(bundle);
  if (reason) return reason;
  try {
    accessSync(dirname(bundle!), constants.W_OK);
    accessSync(bundle!, constants.W_OK);
  } catch {
    return 'Su usuario no tiene permiso para cambiar RociaCAD en la carpeta Aplicaciones. Instale la versión nueva desde la página de descarga.';
  }
  return null;
}

/** Descarga, verifica y descomprime la versión nueva. `onProgress` recibe 0 a 100. */
export async function downloadMacUpdate(version: string, files: UpdateFile[], onProgress: (pct: number) => void): Promise<void> {
  const file = pickMacZip(files, process.arch);
  if (!file) throw new Error('La versión nueva no trae el archivo para este Mac.');
  const dir = join(app.getPath('temp'), `rociacad-actualizacion-${version}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, 'RociaCAD.zip');

  const res = await fetch(`${REPO_DOWNLOAD}/v${version}/${encodeURIComponent(file.url)}`, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar la actualización (error ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || file.size || 0;
  const hash = createHash('sha512');
  const out = createWriteStream(zipPath);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
    got += value.length;
    if (total) onProgress(Math.min(100, (got / total) * 100));
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));

  if (hash.digest('base64') !== file.sha512) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('El archivo descargado no coincide con el publicado. Por seguridad no se instaló; intente de nuevo.');
  }

  const unpack = join(dir, 'app');
  mkdirSync(unpack);
  await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpack]);
  const appName = readdirSync(unpack).find((n) => n.endsWith('.app'));
  if (!appName) throw new Error('La actualización descargada no contiene la aplicación.');
  const appPath = join(unpack, appName);
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath]).catch(() => undefined);
  rmSync(zipPath, { force: true });
  staged = { version, appPath };
}

const failMarkerPath = () => join(app.getPath('userData'), 'actualizacion-fallida.txt');

/** Si la última instalación falló, devuelve el motivo (y lo borra para no repetir el aviso) */
export function takeMacUpdateFailure(): string | null {
  const p = failMarkerPath();
  if (!existsSync(p)) return null;
  try {
    const msg = readFileSync(p, 'utf8').trim();
    rmSync(p, { force: true });
    return msg || 'La instalación no se completó.';
  } catch {
    return null;
  }
}

export function hasStagedMacUpdate(): boolean {
  return !!staged && existsSync(staged.appPath);
}

/**
 * Lanza el guion que reemplaza la app cuando esta se cierre. Llamar justo antes de salir.
 * `relaunch`: volver a abrir RociaCAD al terminar.
 */
export function launchMacSwap(relaunch: boolean): boolean {
  if (!hasStagedMacUpdate()) return false;
  const current = bundlePathFromExe(process.execPath);
  if (!current) return false;
  const dir = dirname(dirname(staged!.appPath));
  const script = join(dir, 'instalar.sh');
  const log = join(app.getPath('userData'), 'actualizacion.log');
  writeFileSync(script, buildSwapScript({ pid: process.pid, current, staged: staged!.appPath, relaunch, log, failMarker: failMarkerPath() }), { mode: 0o755 });
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  child.unref();
  staged = null;
  return true;
}
