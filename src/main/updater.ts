/**
 * Actualizaciones: busca versiones nuevas publicadas en GitHub y las instala solo con
 * autorización del usuario.
 *
 *  - Windows y Linux: descarga e instala con electron-updater.
 *  - Mac: el actualizador estándar exige un certificado de Apple; sin él, la app descarga el
 *    .zip de la versión nueva, verifica su huella y se reemplaza a sí misma (ver macUpdate.ts).
 *    Solo si no puede (por ejemplo, si se abrió desde el disco de instalación) abre la página.
 */
import { app, BrowserWindow, dialog, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { readFileSync, writeFileSync } from 'node:fs';
import { downloadMacUpdate, hasStagedMacUpdate, launchMacSwap, macSelfUpdateProblem, takeMacUpdateFailure } from './macUpdate';
import { join } from 'node:path';

const RELEASES_URL = 'https://github.com/jedwardmv-svg/RociaCAD/releases/latest';

interface Settings {
  checkOnStart: boolean;
  /** versión que el usuario pidió no volver a avisar */
  skipVersion?: string;
}

const settingsPath = () => join(app.getPath('userData'), 'actualizaciones.json');

export function loadSettings(): Settings {
  try {
    return { checkOnStart: true, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) };
  } catch {
    return { checkOnStart: true };
  }
}

export function saveSettings(s: Settings) {
  try {
    writeFileSync(settingsPath(), JSON.stringify(s));
  } catch {
    /* sin permiso de escritura: se ignora */
  }
}

let getWin: () => BrowserWindow | null = () => null;
let busy = false;
let manual = false;
let restartAfterClose = false;

/**
 * Llamar cuando se cerraron todas las ventanas. Si el usuario pidió reiniciar para instalar,
 * instala y vuelve a abrir la app; devuelve true en ese caso.
 */
export function installIfRequested(): boolean {
  if (!restartAfterClose) return false;
  restartAfterClose = false;
  if (isMac) {
    installOnQuitMac = false;
    if (launchMacSwap(true)) {
      app.quit();
      return true;
    }
    return false;
  }
  autoUpdater.quitAndInstall(false, true);
  return true;
}

const isMac = process.platform === 'darwin';
/** Mac: el usuario eligió "Instalar al cerrar" */
let installOnQuitMac = false;

function send(text: string) {
  getWin()?.webContents.send('update-status', text);
}

export function initUpdater(windowGetter: () => BrowserWindow | null) {
  getWin = windowGetter;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('update-available', (info) => void onAvailable(info));
  autoUpdater.on('update-not-available', () => {
    busy = false;
    if (manual) {
      const w = getWin();
      const opts = { type: 'info' as const, message: 'Está usando la versión más reciente.', detail: `RociaCAD ${app.getVersion()}`, buttons: ['Aceptar'] };
      if (w) void dialog.showMessageBox(w, opts);
      else void dialog.showMessageBox(opts);
    }
  });
  autoUpdater.on('download-progress', (p) => {
    getWin()?.setProgressBar(p.percent / 100);
    send(`Descargando actualización: ${Math.round(p.percent)} %`);
  });
  autoUpdater.on('update-downloaded', (info) => void onDownloaded(info));
  autoUpdater.on('error', (err) => {
    busy = false;
    getWin()?.setProgressBar(-1);
    if (manual) {
      void dialog.showMessageBox({
        type: 'warning',
        message: 'No se pudo buscar la actualización.',
        detail: `Revise la conexión a internet e intente de nuevo.\n\n${String(err?.message ?? err).slice(0, 300)}`,
        buttons: ['Aceptar'],
      });
    }
  });

  // avisar si la actualización anterior no se pudo instalar
  if (isMac) {
    const failed = takeMacUpdateFailure();
    if (failed) {
      setTimeout(async () => {
        const opts = {
          type: 'warning' as const,
          message: 'La actualización no se pudo instalar.',
          detail:
            `${failed}\n\nSi macOS lo bloqueó, abra Configuración del Sistema → Privacidad y seguridad → Gestión de apps, ` +
            'active RociaCAD e intente de nuevo desde Ayuda → Buscar actualizaciones. También puede instalarla desde la página de descarga.',
          buttons: ['Abrir la página de descarga', 'Cerrar'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        };
        const w = getWin();
        const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
        if (r.response === 0) void shell.openExternal(RELEASES_URL);
      }, 2500);
    }
  }

  app.on('will-quit', () => {
    if (isMac && installOnQuitMac && hasStagedMacUpdate()) launchMacSwap(false);
  });

  if (app.isPackaged && loadSettings().checkOnStart) {
    setTimeout(() => checkForUpdates(false), 6000);
  }
}

/** `userAsked`: true cuando el usuario lo pidió desde el menú (se le avisa también si no hay nada nuevo) */
export function checkForUpdates(userAsked: boolean) {
  if (!app.isPackaged) {
    if (userAsked) void dialog.showMessageBox({ type: 'info', message: 'Las actualizaciones solo funcionan en la app instalada.', buttons: ['Aceptar'] });
    return;
  }
  if (busy) return;
  busy = true;
  manual = userAsked;
  autoUpdater.checkForUpdates().catch(() => (busy = false));
}

function notesText(info: UpdateInfo): string {
  const raw = typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes ?? []).map((n) => n.note ?? '').join('\n');
  const plain = raw.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return plain ? `\n\nNovedades:\n${plain.slice(0, 600)}` : '';
}

async function onAvailable(info: UpdateInfo) {
  const settings = loadSettings();
  if (!manual && settings.skipVersion === info.version) {
    busy = false;
    return;
  }
  const w = getWin();
  // en Mac, si la app no se puede reemplazar sola, se ofrece la página de descarga y se dice por qué
  const macProblem = isMac ? macSelfUpdateProblem() : null;
  const detail = `Usted tiene la versión ${app.getVersion()}.${macProblem ? `\n\n${macProblem}` : ''}${notesText(info)}`;
  const buttons = macProblem ? ['Abrir la página de descarga', 'Ahora no', 'Omitir esta versión'] : ['Descargar e instalar', 'Ahora no', 'Omitir esta versión'];
  const opts = { type: 'info' as const, message: `Hay una versión nueva de RociaCAD: ${info.version}`, detail, buttons, defaultId: 0, cancelId: 1, noLink: true };
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
  if (r.response === 2) {
    saveSettings({ ...settings, skipVersion: info.version });
    busy = false;
    return;
  }
  if (r.response !== 0) {
    busy = false;
    return;
  }
  if (macProblem) {
    busy = false;
    void shell.openExternal(RELEASES_URL);
    return;
  }
  send('Descargando actualización…');
  if (isMac) {
    try {
      await downloadMacUpdate(info.version, info.files, (pct) => {
        getWin()?.setProgressBar(pct / 100);
        send(`Descargando actualización: ${Math.round(pct)} %`);
      });
      await onDownloaded(info);
    } catch (err) {
      busy = false;
      getWin()?.setProgressBar(-1);
      send('');
      const opts = {
        type: 'warning' as const,
        message: 'No se pudo instalar la actualización.',
        detail: `${(err as Error).message}\n\nPuede intentarlo de nuevo desde Ayuda → Buscar actualizaciones, o descargarla desde la página.`,
        buttons: ['Abrir la página de descarga', 'Cerrar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const r2 = getWin() ? await dialog.showMessageBox(getWin()!, opts) : await dialog.showMessageBox(opts);
      if (r2.response === 0) void shell.openExternal(RELEASES_URL);
    }
    return;
  }
  autoUpdater.downloadUpdate().catch(() => {
    busy = false;
  });
}

async function onDownloaded(info: UpdateInfo) {
  busy = false;
  const w = getWin();
  w?.setProgressBar(-1);
  send('');
  const opts = {
    type: 'question' as const,
    message: `La versión ${info.version} está lista para instalarse.`,
    detail: 'RociaCAD se cerrará, se instalará la versión nueva y se abrirá de nuevo. Si tiene cambios sin guardar, se le preguntará antes.',
    buttons: ['Reiniciar e instalar', 'Instalar al cerrar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
  // en ambos casos la instalación ya está autorizada
  if (isMac) installOnQuitMac = true;
  else autoUpdater.autoInstallOnAppQuit = true;
  if (r.response === 0) {
    // cerrar la ventana pasa por la pregunta de "cambios sin guardar"; si el usuario cancela,
    // la versión nueva se instalará cuando cierre la app
    restartAfterClose = true;
    if (w) w.close();
    else installIfRequested();
  }
}
