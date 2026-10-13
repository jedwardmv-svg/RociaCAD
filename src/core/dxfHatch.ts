/**
 * Lector de HATCH para dxf-parser (que no los trae): contornos, relleno sólido y líneas del patrón.
 * Devuelve la misma forma que entrega LibreDWG para los DWG.
 */
import type DxfParser from 'dxf-parser';

interface Group {
  code: number;
  value: number | string | boolean;
}
interface Scanner {
  next(): Group;
  isEOF(): boolean;
}
type P = { x: number; y: number };

export class HatchHandler {
  ForEntityName = 'HATCH';

  parseEntity(scanner: Scanner, curr: Group): Record<string, unknown> {
    const g: Group[] = [];
    curr = scanner.next();
    while (!scanner.isEOF()) {
      if (curr.code === 0) break;
      g.push(curr);
      curr = scanner.next();
    }
    const e: Record<string, unknown> = { type: 'HATCH' };
    let i = 0;
    const num = (v: unknown) => Number(v) || 0;
    const peekCode = () => g[i]?.code;
    const take = () => g[i++];
    const point = (cx: number): P => {
      const x = num(take().value);
      const y = peekCode() === cx + 10 ? num(take().value) : 0;
      return { x, y };
    };
    const paths: Record<string, unknown>[] = [];
    const lines: {
      angle: number;
      base: P;
      offset: P;
      dashLengths: number[];
    }[] = [];
    while (i < g.length) {
      const c = g[i];
      switch (c.code) {
        case 8:
          e.layer = String(take().value);
          break;
        case 62:
          e.colorIndex = num(take().value);
          break;
        case 420:
          e.color = num(take().value);
          break;
        case 67:
          e.inPaperSpace = num(take().value) === 1;
          break;
        case 60:
          e.visible = num(take().value) === 0;
          break;
        case 2:
          e.patternName = String(take().value);
          break;
        case 70:
          e.solidFill = num(take().value);
          break;
        case 30:
          e.elevation = num(take().value);
          break;
        case 210: {
          const x = num(take().value);
          const y = peekCode() === 220 ? num(take().value) : 0;
          const z = peekCode() === 230 ? num(take().value) : 1;
          e.extrusion = { x, y, z };
          break;
        }
        case 91: {
          // contornos
          const n = num(take().value);
          for (let k = 0; k < n && i < g.length; k++) {
            while (i < g.length && peekCode() !== 92) i++;
            if (i >= g.length) break;
            const flag = num(take().value);
            if (flag & 2) {
              // polilínea
              let hasBulge = 0;
              let nv = 0;
              if (peekCode() === 72) hasBulge = num(take().value);
              if (peekCode() === 73) take();
              if (peekCode() === 93) nv = num(take().value);
              const vertices: (P & { bulge: number })[] = [];
              for (let v = 0; v < nv && i < g.length; v++) {
                if (peekCode() !== 10) break;
                const p = point(10);
                let bulge = 0;
                if (hasBulge && peekCode() === 42) bulge = num(take().value);
                vertices.push({ ...p, bulge });
              }
              paths.push({ vertices });
            } else {
              const ne = peekCode() === 93 ? num(take().value) : 0;
              const edges: Record<string, unknown>[] = [];
              for (let k2 = 0; k2 < ne && i < g.length; k2++) {
                if (peekCode() !== 72) break;
                const type = num(take().value);
                if (type === 1) {
                  const start = peekCode() === 10 ? point(10) : { x: 0, y: 0 };
                  const end = peekCode() === 11 ? point(11) : start;
                  edges.push({ type, start, end });
                } else if (type === 2) {
                  const center = peekCode() === 10 ? point(10) : { x: 0, y: 0 };
                  const radius = peekCode() === 40 ? num(take().value) : 0;
                  const startAngle = peekCode() === 50 ? (num(take().value) * Math.PI) / 180 : 0;
                  const endAngle = peekCode() === 51 ? (num(take().value) * Math.PI) / 180 : 0;
                  const ccw = peekCode() === 73 ? num(take().value) !== 0 : true;
                  edges.push({
                    type,
                    center,
                    radius,
                    startAngle,
                    endAngle,
                    isCCW: ccw,
                  });
                } else if (type === 3) {
                  const center = peekCode() === 10 ? point(10) : { x: 0, y: 0 };
                  const majorAxisEndPoint = peekCode() === 11 ? point(11) : { x: 1, y: 0 };
                  const axisRatio = peekCode() === 40 ? num(take().value) : 1;
                  const startAngle = peekCode() === 50 ? (num(take().value) * Math.PI) / 180 : 0;
                  const endAngle = peekCode() === 51 ? (num(take().value) * Math.PI) / 180 : 2 * Math.PI;
                  if (peekCode() === 73) take();
                  edges.push({
                    type,
                    center,
                    majorAxisEndPoint,
                    axisRatio,
                    startAngle,
                    endAngle,
                  });
                } else if (type === 4) {
                  // spline: se usan sus puntos de control
                  const controlPoints: P[] = [];
                  while (i < g.length && peekCode() !== 72 && peekCode() !== 97 && peekCode() !== 92) {
                    if (peekCode() === 10) controlPoints.push(point(10));
                    else take();
                  }
                  edges.push({ type, controlPoints });
                }
              }
              paths.push({ edges });
            }
            // objetos de origen
            if (peekCode() === 97) {
              const ns = num(take().value);
              for (let s = 0; s < ns && peekCode() === 330; s++) take();
            }
          }
          break;
        }
        case 78: {
          // líneas del patrón
          const n = num(take().value);
          for (let k = 0; k < n && i < g.length; k++) {
            while (i < g.length && peekCode() !== 53) i++;
            if (i >= g.length) break;
            const angle = (num(take().value) * Math.PI) / 180;
            const bx = peekCode() === 43 ? num(take().value) : 0;
            const by = peekCode() === 44 ? num(take().value) : 0;
            const ox = peekCode() === 45 ? num(take().value) : 0;
            const oy = peekCode() === 46 ? num(take().value) : 0;
            const nd = peekCode() === 79 ? num(take().value) : 0;
            const dashLengths: number[] = [];
            for (let d = 0; d < nd && peekCode() === 49; d++) dashLengths.push(num(take().value));
            lines.push({
              angle,
              base: { x: bx, y: by },
              offset: { x: ox, y: oy },
              dashLengths,
            });
          }
          break;
        }
        default:
          i++;
      }
    }
    e.boundaryPaths = paths;
    e.definitionLines = lines;
    return e;
  }
}

/**
 * Lector de VIEWPORT (ventanas de las presentaciones). Usa los mismos nombres de campos que
 * LibreDWG para que el DXF y el DWG se armen igual.
 */
export class ViewportHandler {
  ForEntityName = 'VIEWPORT';

  parseEntity(scanner: Scanner, curr: Group): Record<string, unknown> {
    const e: Record<string, unknown> = { type: 'VIEWPORT' };
    const num = (v: unknown) => Number(v) || 0;
    const c = { x: 0, y: 0, z: 0 };
    const vc = { x: 0, y: 0 };
    const t = { x: 0, y: 0, z: 0 };
    const d = { x: 0, y: 0, z: 1 };
    const frozen: string[] = [];
    curr = scanner.next();
    while (!scanner.isEOF() && curr.code !== 0) {
      const v = curr.value;
      switch (curr.code) {
        case 8:
          e.layer = String(v);
          break;
        case 67:
          e.inPaperSpace = num(v) === 1;
          break;
        case 10:
          c.x = num(v);
          break;
        case 20:
          c.y = num(v);
          break;
        case 30:
          c.z = num(v);
          break;
        case 40:
          e.width = num(v);
          break;
        case 41:
          e.height = num(v);
          break;
        case 69:
          e.viewportId = num(v);
          break;
        case 12:
          vc.x = num(v);
          break;
        case 22:
          vc.y = num(v);
          break;
        case 16:
          d.x = num(v);
          break;
        case 26:
          d.y = num(v);
          break;
        case 36:
          d.z = num(v);
          break;
        case 17:
          t.x = num(v);
          break;
        case 27:
          t.y = num(v);
          break;
        case 37:
          t.z = num(v);
          break;
        case 45:
          e.viewHeight = num(v);
          break;
        case 51:
          e.viewTwistAngle = (num(v) * Math.PI) / 180;
          break;
        case 331:
          frozen.push(String(v));
          break;
        case 90:
          e.status = num(v);
          break;
      }
      curr = scanner.next();
    }
    e.viewportCenter = c;
    e.displayCenter = vc;
    e.targetPoint = t;
    e.viewDirection = d;
    e.frozenLayerIds = frozen;
    // el bit 0x20000 (131072) de status apaga la ventana
    e.isVisible = !((Number(e.status) || 0) & 0x20000);
    return e;
  }
}

/** Agrega a un dxf-parser los lectores de HATCH y VIEWPORT */
export function addHatchHandler(parser: DxfParser) {
  parser.registerEntityHandler(HatchHandler as unknown as Parameters<DxfParser['registerEntityHandler']>[0]);
  parser.registerEntityHandler(ViewportHandler as unknown as Parameters<DxfParser['registerEntityHandler']>[0]);
}
