// Copia los archivos de apoyo de pdf.js (fuentes, mapas de caracteres, decodificadores)
// a la carpeta pública de la interfaz para que funcionen sin internet.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pdfjs-dist');
const dest = join(root, 'src', 'renderer', 'public', 'pdfjs');
mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true });
}
console.log('Archivos de pdf.js copiados a', dest);
