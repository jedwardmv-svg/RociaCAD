/**
 * Lector de DWG que corre en la ventana oculta y aislada (dwg.html).
 * Recibe los bytes de un archivo y devuelve el plano ya convertido en líneas por capa.
 */
import { Dwg_File_Type, LibreDwg } from '@mlightcad/libredwg-web';
import { planFromDwgDatabase, type DwgDatabaseLike } from '../../core';

interface DwgBridge {
  onJob: (cb: (id: number, bytes: Uint8Array) => void) => void;
  done: (id: number, result: unknown, error?: string) => void;
}

const bridge = (window as unknown as { dwgBridge: DwgBridge }).dwgBridge;
let libPromise: Promise<LibreDwg> | null = null;

bridge.onJob(async (id, bytes) => {
  try {
    libPromise ??= LibreDwg.create();
    const lib = await libPromise;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const dwg = lib.dwg_read_data(buf, Dwg_File_Type.DWG);
    if (!dwg) throw new Error('El archivo DWG está dañado o es de una versión que no se pudo leer.');
    try {
      const plan = planFromDwgDatabase(lib.convert(dwg) as unknown as DwgDatabaseLike);
      bridge.done(id, plan);
    } finally {
      lib.dwg_free(dwg);
    }
  } catch (err) {
    bridge.done(id, null, (err as Error).message || String(err));
  }
});
