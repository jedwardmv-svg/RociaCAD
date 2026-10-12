/**
 * Puente mínimo de la ventana lectora de DWG: solo recibe trabajos y entrega resultados.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dwgBridge', {
  onJob: (cb: (id: number, bytes: Uint8Array) => void) => {
    ipcRenderer.on('dwg:job', (_e, id: number, bytes: Uint8Array) => cb(id, bytes));
  },
  done: (id: number, result: unknown, error?: string) => ipcRenderer.send('dwg:done', id, result, error),
});
