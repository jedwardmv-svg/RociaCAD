import { describe, expect, it } from 'vitest';
import { buildPlan, fontWidthFactor, hatchPattern, layoutPlan, parseDxf, type DxfResult, type PlanLayout } from '../src/core';

/** Arma un DXF a partir de pares código/valor */
const dxf = (...pairs: (string | number)[]) => pairs.map(String).join('\n') + '\n';

describe('Sombreados con patrón', () => {
  it('raya un cuadrado con líneas a 45° recortadas al contorno', () => {
    const square = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    const out: number[] = [];
    // ANSI31: líneas a 45° separadas 1 unidad
    hatchPattern(square, [{ angle: Math.PI / 4, base: { x: 0, y: 0 }, offset: { x: -Math.SQRT1_2, y: Math.SQRT1_2 } }], out);
    const n = out.length / 4;
    // la diagonal mide 14.1: caben unas 14 líneas
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(20);
    for (let i = 0; i < out.length; i += 4) {
      for (const v of out.slice(i, i + 4)) {
        expect(v).toBeGreaterThanOrEqual(-1e-6);
        expect(v).toBeLessThanOrEqual(10 + 1e-6);
      }
      // todas a 45°
      expect(Math.abs(out[i + 2] - out[i] - (out[i + 3] - out[i + 1]))).toBeLessThan(1e-6);
    }
  });

  it('respeta los huecos (par-impar) y los trazos discontinuos', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hole = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ];
    const out: number[] = [];
    hatchPattern([outer, hole], [{ angle: 0, base: { x: 0, y: 0.5 }, offset: { x: 0, y: 1 } }], out);
    // ninguna raya pasa por dentro del hueco
    for (let i = 0; i < out.length; i += 4) {
      const y = out[i + 1];
      const mid = (out[i] + out[i + 2]) / 2;
      if (y > 4 && y < 6) expect(mid < 4 || mid > 6).toBe(true);
    }
    const dashed: number[] = [];
    hatchPattern([outer], [{ angle: 0, base: { x: 0, y: 0.5 }, offset: { x: 0, y: 1 }, dashLengths: [1, -1] }], dashed);
    expect(dashed.length).toBeGreaterThan(out.length);
    for (let i = 0; i < dashed.length; i += 4) expect(Math.abs(dashed[i + 2] - dashed[i])).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('lee un HATCH de un DXF (sólido y con patrón)', () => {
    const boundary = [92, 2, 72, 0, 73, 1, 93, 4, 10, 0, 20, 0, 10, 10, 20, 0, 10, 10, 20, 10, 10, 0, 20, 10, 97, 0];
    const text = dxf(
      0, 'SECTION', 2, 'ENTITIES',
      0, 'HATCH', 8, 'RELLENO', 62, 1, 100, 'AcDbHatch', 10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, 'SOLID', 70, 1, 71, 0, 91, 1, ...boundary, 75, 0, 76, 1, 98, 0,
      0, 'HATCH', 8, 'RAYADO', 62, 3, 100, 'AcDbHatch', 10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, 'ANSI31', 70, 0, 71, 0, 91, 1, ...boundary, 75, 0, 76, 1, 52, 0, 41, 1, 77, 0,
      78, 1, 53, 45, 43, 0, 44, 0, 45, -0.7071, 46, 0.7071, 79, 0, 98, 0,
      0, 'ENDSEC', 0, 'EOF',
    );
    const plan = parseDxf(text);
    const solid = plan.layers.find((l) => l.name === 'RELLENO')!;
    const lines = plan.layers.find((l) => l.name === 'RAYADO')!;
    expect(solid.fills.length / 9).toBe(2);
    expect(solid.fillColors[0]).toBe(0xff0000);
    expect(lines.segments.length / 6).toBeGreaterThan(10);
    expect(lines.colors[0]).toBe(0x00ff00);
  });
});

describe('Presentaciones (espacio papel)', () => {
  const model: DxfResult = {
    layers: [
      // cuadrado de 10 m con una diagonal, en el origen
      { name: 'MUROS', segments: [0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 10, 0, 10, 10, 0, 0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 10, 10, 0], colors: [1, 1, 1, 1, 2], fills: [], fillColors: [], color: 0xffffff, off: false },
      { name: 'OCULTA', segments: [0, 0, 0, 5, 5, 0], colors: [3], fills: [], fillColors: [], color: 0xffffff, off: false },
    ],
    insUnits: 6,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    snapPoints: [],
    stats: { entities: 0, segments: 6, texts: 0, fills: 0, skipped: {} },
    is3D: false,
    zRange: { min: 0, max: 0 },
  };
  const sheet = (vp: Partial<PlanLayout['viewports'][number]>): PlanLayout => ({
    name: 'Hoja',
    order: 1,
    layers: [{ name: 'ROTULO', segments: [0, 0, 0, 420, 0, 0], colors: [7], fills: [], fillColors: [], color: 0xffffff, off: false }],
    snapPoints: [],
    bounds: { minX: 0, minY: 0, maxX: 420, maxY: 297 },
    viewports: [
      {
        center: { x: 200, y: 150 },
        width: 200,
        height: 200,
        viewCenter: { x: 5, y: 5 },
        viewHeight: 10,
        target: { x: 0, y: 0, z: 0 },
        direction: { x: 0, y: 0, z: 1 },
        twist: 0,
        frozenLayers: ['OCULTA'],
        ...vp,
      },
    ],
  });

  it('proyecta el modelo dentro de la ventana a su escala', () => {
    const p = layoutPlan(model, sheet({}));
    const muros = p.layers.find((l) => l.name === 'MUROS')!;
    // 10 m en 200 mm: escala 20; el centro del modelo (5,5) cae en el centro de la ventana (200,150)
    expect(muros.segments.slice(0, 6)).toEqual([100, 50, 0, 300, 50, 0]);
    expect(p.layers.find((l) => l.name === 'ROTULO')).toBeTruthy();
    // las capas congeladas en la ventana no salen
    expect(p.layers.find((l) => l.name === 'OCULTA')).toBeUndefined();
    expect(p.bounds.maxX).toBe(420);
  });

  it('recorta lo que queda fuera de la ventana', () => {
    // la ventana muestra solo la mitad izquierda del modelo, más ampliada
    const p = layoutPlan(model, sheet({ viewCenter: { x: 2.5, y: 5 }, viewHeight: 10, width: 100 }));
    const muros = p.layers.find((l) => l.name === 'MUROS')!;
    for (let i = 0; i < muros.segments.length; i += 3) {
      expect(muros.segments[i]).toBeGreaterThanOrEqual(150 - 1e-9);
      expect(muros.segments[i]).toBeLessThanOrEqual(250 + 1e-9);
    }
  });

  it('lee las presentaciones de un DXF y separa el espacio papel del modelo', () => {
    const text = dxf(
      0, 'SECTION', 2, 'TABLES',
      0, 'TABLE', 2, 'LAYER', 5, '2', 70, 2,
      0, 'LAYER', 5, '10', 2, 'MUROS', 70, 0, 62, 7, 6, 'CONTINUOUS',
      0, 'LAYER', 5, '11', 2, 'ROTULO', 70, 0, 62, 2, 6, 'CONTINUOUS',
      0, 'ENDTAB',
      0, 'ENDSEC',
      0, 'SECTION', 2, 'BLOCKS',
      0, 'BLOCK', 5, '20', 330, '1F', 8, '0', 2, '*Paper_Space', 70, 0, 10, 0, 20, 0, 30, 0, 3, '*Paper_Space',
      0, 'ENDBLK', 5, '21', 8, '0',
      0, 'ENDSEC',
      0, 'SECTION', 2, 'ENTITIES',
      0, 'LINE', 5, '30', 8, 'MUROS', 10, 0, 20, 0, 30, 0, 11, 10, 21, 0, 31, 0,
      0, 'LINE', 5, '31', 330, '1F', 67, 1, 8, 'ROTULO', 10, 0, 20, 0, 30, 0, 11, 420, 21, 0, 31, 0,
      0, 'VIEWPORT', 5, '32', 330, '1F', 67, 1, 8, '0', 10, 210, 20, 148, 30, 0, 40, 500, 41, 350, 69, 1, 12, 210, 22, 148, 45, 350,
      0, 'VIEWPORT', 5, '33', 330, '1F', 67, 1, 8, '0', 10, 200, 20, 150, 30, 0, 40, 200, 41, 200, 69, 2, 12, 5, 22, 5, 16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0, 45, 10, 51, 0, 90, 0,
      0, 'ENDSEC',
      0, 'SECTION', 2, 'OBJECTS',
      0, 'LAYOUT', 5, '40', 330, '1A', 100, 'AcDbPlotSettings', 1, '', 100, 'AcDbLayout', 1, 'PLANTA A1', 70, 1, 71, 1, 330, '1F',
      0, 'ENDSEC',
      0, 'EOF',
    );
    const plan = parseDxf(text);
    // el modelo no trae el rótulo de la hoja
    expect(plan.layers.map((l) => l.name)).toEqual(['MUROS']);
    expect(plan.layouts?.length).toBe(1);
    const lay = plan.layouts![0];
    expect(lay.name).toBe('PLANTA A1');
    // la ventana 1 (la hoja) no cuenta como vista
    expect(lay.viewports.length).toBe(1);
    const p = layoutPlan(plan, lay);
    expect(p.layers.map((l) => l.name).sort()).toEqual(['MUROS', 'ROTULO']);
    expect(p.layers.find((l) => l.name === 'MUROS')!.segments.slice(0, 6)).toEqual([100, 50, 0, 300, 50, 0]);
  });
});

describe('Tubos y textos de AutoSPRINK', () => {
  it('dibuja como tubo un eje con el círculo de su diámetro en la punta', () => {
    const plan = buildPlan(
      [
        { type: 'LINE', layer: 'TUBO', vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }] },
        { type: 'LINE', layer: 'TUBO', vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }] },
        { type: 'CIRCLE', layer: 'TUBO', center: { x: 0, y: 0, z: 0 }, radius: 0.5, extrusion: { x: 0, y: 0, z: 1 } },
        // en planta: línea que termina en el centro de un círculo, pero no es un tubo
        { type: 'LINE', layer: 'PLANTA', vertices: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }] },
        { type: 'CIRCLE', layer: 'PLANTA', center: { x: 5, y: 0, z: 0 }, radius: 1 },
      ],
      {},
      6,
    );
    const tubo = plan.layers.find((l) => l.name === 'TUBO')!;
    // un solo tubo de 12 caras (24 triángulos) aunque el eje venga repetido
    expect(tubo.fills.length / 9).toBe(24);
    for (let i = 0; i < tubo.fills.length; i += 3) expect(Math.hypot(tubo.fills[i], tubo.fills[i + 1])).toBeCloseTo(0.5, 6);
    expect(plan.layers.find((l) => l.name === 'PLANTA')!.fills.length).toBe(0);
  });

  it('un texto centrado ocupa el ancho que dice el archivo', () => {
    // AutoCAD guarda el inicio real (0,0) y el centro (4,0): el texto mide 8 de ancho
    const plan = buildPlan([{ type: 'TEXT', layer: 'T', text: 'Diameter', startPoint: { x: 0, y: 0 }, endPoint: { x: 4, y: 0.5 }, textHeight: 1, halign: 1, valign: 2 }], {}, 6);
    const s = plan.layers[0].segments;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < s.length; i += 3) (min = Math.min(min, s[i])), (max = Math.max(max, s[i]));
    expect(min).toBeGreaterThanOrEqual(-0.05);
    expect(max).toBeLessThanOrEqual(8.05);
    expect(max - min).toBeGreaterThan(7);
  });

  it('las letras TrueType se dibujan más angostas que las de trazos', () => {
    expect(fontWidthFactor('romans.shx')).toBe(1);
    expect(fontWidthFactor('arial.ttf')).toBeLessThan(0.9);
    expect(fontWidthFactor('ARIALN.TTF')).toBeLessThan(fontWidthFactor('arial.ttf'));
  });
});
