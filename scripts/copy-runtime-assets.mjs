// Copia a la carpeta pública de la interfaz los archivos que se cargan en tiempo de ejecución,
// para que funcionen sin internet:
//  - pdf.js: fuentes, mapas de caracteres y decodificadores (planos en PDF)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'src', 'renderer', 'public');

const pdfSrc = join(root, 'node_modules', 'pdfjs-dist');
const pdfDest = join(pub, 'pdfjs');
mkdirSync(pdfDest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  if (existsSync(join(pdfSrc, dir))) cpSync(join(pdfSrc, dir), join(pdfDest, dir), { recursive: true });
}

console.log('Archivos de pdf.js copiados a', pdfDest);
