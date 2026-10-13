/**
 * Proceso principal de Electron: ventana, menú, diálogos de archivo y exportación a PDF.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import './dwg';
import { checkForUpdates, initUpdater, installIfRequested, loadSettings, saveSettings } from './updater';

type FileKind = 'project' | 'catalog' | 'dxf';
const KINDS: Record<FileKind, { name: string; ext: string; fallback: string }> = {
  project: { name: 'Proyecto RociaCAD', ext: 'rcad', fallback: 'proyecto' },
  catalog: { name: 'Catálogo RociaCAD', ext: 'rcatalogo', fallback: 'catalogo' },
  dxf: { name: 'Dibujo DXF', ext: 'dxf', fallback: 'dibujo' },
};
const filtersFor = (kind: FileKind) => [{ name: KINDS[kind].name, extensions: [KINDS[kind].ext] }];

let win: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;

function send(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args);
}

function createWindow() {
  forceClose = false;
  dirty = false;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'RociaCAD',
    backgroundColor: '#e9ecef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win?.show());

  win.on('close', (e) => {
    if (!dirty || forceClose || !win) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Guardar', 'No guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      title: 'Cambios sin guardar',
      message: 'El proyecto tiene cambios sin guardar.',
      detail: '¿Quiere guardarlos antes de salir?',
    });
    if (choice === 2) {
      e.preventDefault();
    } else if (choice === 0) {
      e.preventDefault();
      send('menu', 'save-and-close');
    }
  });

  // Los enlaces externos se abren en el navegador, nunca dentro de la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // ROCIA_DEBUG=1 deja disponibles los ganchos para pruebas automáticas
    win.loadFile(join(__dirname, '../renderer/index.html'), process.env.ROCIA_DEBUG ? { hash: 'debug' } : undefined);
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const item = (label: string, action: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send('menu', action),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Archivo',
      submenu: [
        item('Nuevo proyecto', 'new', 'CmdOrCtrl+N'),
        item('Abrir…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('Guardar', 'save', 'CmdOrCtrl+S'),
        item('Guardar como…', 'save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        item('Cargar plano de fondo (DXF, PDF o imagen)…', 'load-plan', 'CmdOrCtrl+L'),
        item('Exportar reporte PDF…', 'export-pdf', 'CmdOrCtrl+P'),
        item('Exportar dibujo DXF (para AutoCAD)…', 'export-dxf', 'CmdOrCtrl+E'),
        { type: 'separator' },
        {
          label: 'Ejemplos',
          submenu: [item('Bodega en árbol (riesgo ordinario 1)', 'example-tree'), item('Sistema mallado', 'example-grid')],
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'Salir' }]),
      ],
    },
    {
      label: 'Editar',
      submenu: [
        item('Deshacer', 'undo', 'CmdOrCtrl+Z'),
        item('Rehacer', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        item('Seleccionar todo', 'select-all', 'CmdOrCtrl+A'),
        { type: 'separator' },
        item('Catálogo de tuberías, rociadores y elementos…', 'catalog', 'CmdOrCtrl+K'),
      ],
    },
    {
      label: 'Ver',
      submenu: [
        item('Vista 3D', 'view-3d', 'F2'),
        item('Planta', 'view-top', 'F3'),
        item('Ajustar a la pantalla', 'view-fit', 'F4'),
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño de texto normal' },
        { role: 'zoomIn', label: 'Aumentar texto' },
        { role: 'zoomOut', label: 'Reducir texto' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const, label: 'Herramientas de desarrollo' }]),
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        item('Acerca de RociaCAD', 'about'),
        { label: 'Buscar actualizaciones…', click: () => checkForUpdates(true) },
        {
          label: 'Buscar actualizaciones al iniciar',
          type: 'checkbox',
          checked: loadSettings().checkOnStart,
          click: (mi) => saveSettings({ ...loadSettings(), checkOnStart: mi.checked }),
        },
        {
          label: 'Página del proyecto',
          click: () => shell.openExternal('https://github.com/jedwardmv-svg/RociaCAD'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

ipcMain.handle('file:open', async (_e, kind: FileKind = 'project') => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { filters: filtersFor(KINDS[kind] ? kind : 'project'), properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const path = r.filePaths[0];
  const content = await readFile(path, 'utf8');
  return { path, name: basename(path), content };
});

ipcMain.handle('file:save', async (_e, args: { path?: string; content: string; suggestedName?: string; kind?: FileKind }) => {
  if (!win) return null;
  const kind = args.kind && KINDS[args.kind] ? args.kind : 'project';
  let path = args.kind === 'project' || !args.kind ? args.path : undefined;
  if (!path) {
    const r = await dialog.showSaveDialog(win, {
      filters: filtersFor(kind),
      defaultPath: (args.suggestedName || KINDS[kind].fallback) + '.' + KINDS[kind].ext,
    });
    if (r.canceled || !r.filePath) return null;
    path = r.filePath;
  }
  await writeFile(path, args.content, 'utf8');
  return { path, name: basename(path) };
});

ipcMain.handle('pdf:export', async (_e, args: { suggestedName: string }) => {
  if (!win) return null;
  const r = await dialog.showSaveDialog(win, {
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    defaultPath: args.suggestedName + '.pdf',
  });
  if (r.canceled || !r.filePath) return null;
  const data = await win.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font-size:8px;width:100%;padding:0 0.5in;display:flex;justify-content:space-between;color:#555;font-family:sans-serif">' +
      '<span>RociaCAD ' + app.getVersion() + '</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
  });
  await writeFile(r.filePath, data);
  shell.openPath(r.filePath);
  return { path: r.filePath };
});

ipcMain.on('state:dirty', (_e, value: boolean) => {
  dirty = value;
});

ipcMain.on('state:title', (_e, title: string) => {
  win?.setTitle(title);
});

ipcMain.on('app:close-after-save', () => {
  forceClose = true;
  win?.close();
});

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

ipcMain.handle('app:confirm', async (_e, args: { message: string; detail?: string; buttons: string[] }) => {
  if (!win) return 0;
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: args.buttons,
    defaultId: 0,
    cancelId: args.buttons.length - 1,
    message: args.message,
    detail: args.detail,
  });
  return r.response;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  initUpdater(() => (win && !win.isDestroyed() ? win : null));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (installIfRequested()) return;
  if (process.platform !== 'darwin') app.quit();
});
