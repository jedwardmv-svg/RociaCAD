/**
 * Lectura de DWG en una ventana oculta y aislada.
 *
 * LibreDWG (WebAssembly) necesita evaluar código ('unsafe-eval'). Para no relajar la seguridad
 * de la ventana principal, se abre una ventana invisible, con sandbox y sin acceso al sistema,
 * que solo convierte los bytes del DWG en líneas y las devuelve.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

let reader: BrowserWindow | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function ensureReader(): Promise<void> {
  if (reader && !reader.isDestroyed() && ready) return ready;
  reader = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/dwg.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  reader.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  reader.webContents.on('will-navigate', (e) => e.preventDefault());
  reader.on('closed', () => {
    reader = null;
    ready = null;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('El lector de DWG se cerró inesperadamente.'));
    }
    pending.clear();
  });
  const url = process.env.ELECTRON_RENDERER_URL;
  ready = (url ? reader.loadURL(`${url}/dwg.html`) : reader.loadFile(join(__dirname, '../renderer/dwg.html'))).then(() => undefined);
  return ready;
}

ipcMain.on('dwg:done', (_e, id: number, result: unknown, error?: string) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (error) p.reject(new Error(error));
  else p.resolve(result);
});

ipcMain.handle('dwg:parse', async (_e, bytes: Uint8Array) => {
  await ensureReader();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('El DWG tardó demasiado en leerse.'));
    }, 180_000);
    pending.set(id, { resolve, reject, timer });
    reader!.webContents.send('dwg:job', id, bytes);
  });
});

app.on('before-quit', () => {
  if (reader && !reader.isDestroyed()) reader.destroy();
});
