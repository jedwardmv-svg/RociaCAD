/**
 * Puente seguro entre la interfaz (renderer) y el proceso principal.
 * La interfaz no tiene acceso directo a Node ni al disco: solo a estas funciones.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  openFile: (kind: 'project' | 'catalog' = 'project'): Promise<{ path: string; name: string; content: string } | null> =>
    ipcRenderer.invoke('file:open', kind),
  saveFile: (args: { path?: string; content: string; suggestedName?: string; kind?: 'project' | 'catalog' | 'dxf' | 'csv' }): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('file:save', args),
  /** Lee un DWG en la ventana aislada; devuelve el plano en líneas */
  parseDwg: (bytes: Uint8Array): Promise<unknown> => ipcRenderer.invoke('dwg:parse', bytes),
  exportPdf: (args: { suggestedName: string }): Promise<{ path: string } | null> => ipcRenderer.invoke('pdf:export', args),
  confirm: (args: { message: string; detail?: string; buttons: string[] }): Promise<number> => ipcRenderer.invoke('app:confirm', args),
  appInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke('app:info'),
  setDirty: (value: boolean) => ipcRenderer.send('state:dirty', value),
  setTitle: (title: string) => ipcRenderer.send('state:title', title),
  closeAfterSave: () => ipcRenderer.send('app:close-after-save'),
  onMenu: (cb: (action: string) => void) => {
    ipcRenderer.on('menu', (_e, action: string) => cb(action));
  },
  onUpdateStatus: (cb: (text: string) => void) => {
    ipcRenderer.on('update-status', (_e, text: string) => cb(text));
  },
};

export type RociaApi = typeof api;

contextBridge.exposeInMainWorld('rocia', api);
