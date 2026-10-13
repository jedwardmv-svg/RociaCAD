/**
 * Textos de los planos dibujados con trazos (fuente Hershey Simplex, como romans.shx).
 * Se convierten en líneas para que se vean igual que el resto del plano, a cualquier zoom.
 */
import { SIMPLEX } from './hersheySimplex';

type P2 = [number, number];

const CAP = 21; // altura de mayúscula en unidades de la fuente
const BASE = 22; // línea base (y hacia abajo)
const SPACE = 16;

const glyphs = new Map<number, { adv: number; strokes: P2[][] }>();
function glyph(code: number) {
  let g = glyphs.get(code);
  if (g) return g;
  const raw = SIMPLEX[code - 33];
  if (!raw) return undefined;
  const strokes = raw[1]
    ? raw[1].split('|').map((s) => {
        const n = s.trim().split(/\s+/).map(Number);
        const pts: P2[] = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
        return pts;
      })
    : [];
  g = { adv: raw[0], strokes };
  glyphs.set(code, g);
  return g;
}

// marcas que se dibujan encima de una letra (tilde, virgulilla, diéresis, grave)
const MARKS: Record<string, P2[][]> = {
  '́': [[[-1, 2.5], [2, -0.5]]],
  '̀': [[[-2, -0.5], [1, 2.5]]],
  '̃': [[[-3, 2], [-1.5, 0.5], [0, 1.5], [1.5, 2.5], [3, 1]]],
  '̈': [[[-2.5, 1], [-2.5, 1.6]], [[2.5, 1], [2.5, 1.6]]],
};

/** Pasa caracteres que la fuente no tiene a algo que sí puede dibujar */
function normalizeText(s: string): string {
  return s
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%')
    .replace(/\\?U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ');
}

/** Quita los códigos de formato de un MTEXT (\P es salto de línea) */
export function mtextPlain(raw: string): string {
  let s = raw;
  // fracciones apiladas \Sa^b; → a/b
  s = s.replace(/\\S([^;]*?)[#^/]([^;]*?);/g, '$1/$2');
  s = s.replace(/\\[Pp]/g, '\n').replace(/\\~/g, ' ');
  // códigos con argumento terminado en ;
  s = s.replace(/\\[AaCcFfHhQqTtWwPp][^;\\]*;/g, '');
  // códigos sin argumento (subrayado, tachado…)
  s = s.replace(/\\[LlOoKkNn]/g, '');
  s = s.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  return s;
}

/** Ancho de una línea de texto en unidades de la fuente */
function lineWidthUnits(line: string): number {
  let w = 0;
  for (const ch of line.normalize('NFD')) {
    if (/[̀-ͯ]/.test(ch)) continue;
    if (ch === ' ') w += SPACE;
    else w += glyph(substitute(ch).charCodeAt(0))?.adv ?? SPACE;
  }
  return w;
}

/** letras que se dibujan con otra de la fuente (más una marca) */
function substitute(ch: string): string {
  if (ch === 'Ø' || ch === 'ø' || ch === '⌀') return 'O';
  if (ch === '°' || ch === 'º') return 'o';
  if (ch === 'ª') return 'a';
  if (ch === '±') return '+';
  if (ch === '¿') return '?';
  if (ch === '¡') return '!';
  if (ch === '²') return '2';
  if (ch === '³') return '3';
  if (ch === '×') return 'x';
  const c = ch.charCodeAt(0);
  return c >= 33 && c <= 126 ? ch : '?';
}

/**
 * Trazos de una línea de texto: polilíneas en coordenadas del texto
 * (x a la derecha desde el inicio, y hacia arriba desde la línea base), con altura h.
 */
export function textLineStrokes(line: string, h: number, widthFactor = 1): { strokes: P2[][]; width: number } {
  const k = h / CAP;
  const kx = k * (widthFactor > 0 ? widthFactor : 1);
  const out: P2[][] = [];
  let x = 0;
  const chars = [...normalizeText(line).normalize('NFD')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\t') {
      x += SPACE;
      continue;
    }
    if (/[̀-ͯ]/.test(ch)) continue;
    const sub = substitute(ch);
    const g = glyph(sub.charCodeAt(0));
    if (!g) {
      x += SPACE;
      continue;
    }
    // símbolos pequeños arriba (grados, superíndices)
    const small = ch === '°' || ch === 'º' || ch === 'ª' || ch === '²' || ch === '³';
    const sc = small ? 0.5 : 1;
    const dy = small ? -12 : 0;
    const flip = ch === '¿' || ch === '¡';
    let minX = Infinity;
    let maxX = -Infinity;
    for (const s of g.strokes) for (const [px] of s) (minX = Math.min(minX, px)), (maxX = Math.max(maxX, px));
    const cx = (minX + maxX) / 2;
    for (const s of g.strokes) {
      out.push(
        s.map(([px, py]) => {
          let gx = px;
          let gy = py;
          if (flip) (gx = 2 * cx - gx), (gy = 2 * 11.5 - gy);
          return [(x + (gx - minX * (1 - sc)) * sc) * kx, (BASE - (gy * sc + dy + BASE * (1 - sc))) * k] as P2;
        }),
      );
    }
    if (ch === 'Ø' || ch === 'ø' || ch === '⌀') out.push([[(x + minX - 1) * kx, (BASE - 23) * k], [(x + maxX + 1) * kx, (BASE - 0) * k]]);
    if (ch === '±') out.push([[(x + minX) * kx, 0], [(x + maxX) * kx, 0]]);
    // marca (acento) sobre la letra
    const next = chars[i + 1];
    if (next && MARKS[next]) {
      const upper = sub >= 'A' && sub <= 'Z';
      const top = upper ? -2 : 4; // y de la marca en unidades de la fuente
      for (const m of MARKS[next]) out.push(m.map(([mx, my]) => [(x + cx + mx) * kx, (BASE - (top + my)) * k] as P2));
    }
    x += small ? g.adv * 0.6 : g.adv;
  }
  return { strokes: out, width: x * kx };
}

/** Ancho de una línea de texto con altura h */
export function textLineWidth(line: string, h: number, widthFactor = 1): number {
  return lineWidthUnits(normalizeText(line)) * (h / CAP) * (widthFactor > 0 ? widthFactor : 1);
}

/** Parte un párrafo en líneas que no pasen de `maxWidth` (0 = sin límite) */
export function wrapText(paragraph: string, h: number, maxWidth: number, widthFactor = 1): string[] {
  if (!(maxWidth > 0)) return [paragraph];
  const words = paragraph.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && textLineWidth(test, h, widthFactor) > maxWidth * 1.02) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  lines.push(cur);
  return lines;
}
