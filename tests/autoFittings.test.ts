import { describe, expect, it } from 'vitest';
import { autoFittings, calculate, exampleWarehouse, type Project } from '../src/core';

const GEOM = ['elbow45', 'elbow90', 'elbow90long', 'tee'];

/** Ejemplo de bodega sin los codos y tees puestos a mano (las válvulas se quedan) */
function warehouseAuto(): Project {
  const p = exampleWarehouse();
  p.pipes = p.pipes.map((pp) => ({ ...pp, fittings: pp.fittings.filter((f) => !GEOM.includes(f.type)) }));
  p.autoFittings = true;
  return p;
}

const pipeId = (p: Project, from: string, to: string) => p.pipes.find((x) => x.from === from && x.to === to)!.id;

describe('Accesorios automáticos', () => {
  it('apagados no agregan nada', () => {
    expect(autoFittings(exampleWarehouse()).size).toBe(0);
  });

  it('pone tee en la derivación y codo al final del ramal', () => {
    const p = warehouseAuto();
    const auto = autoFittings(p);
    // bajante en medio del ramal: tee cargada al bajante (1")
    expect(auto.get(pipeId(p, 'B1-3', 'R1-3'))).toEqual([{ type: 'tee', count: 1 }]);
    // el tramo recto del ramal no lleva nada
    expect(auto.get(pipeId(p, 'B1-2', 'B1-3'))).toBeUndefined();
    // salida del ramal desde la matriz: tee en el ramal
    expect(auto.get(pipeId(p, 'M1', 'B1-1'))).toEqual([{ type: 'tee', count: 1 }]);
    // la matriz en línea recta no lleva nada
    expect(auto.get(pipeId(p, 'M1', 'M2'))).toBeUndefined();
    // último rociador del ramal: codo de 90° en el bajante
    expect(auto.get(pipeId(p, 'B1-6', 'R1-6'))).toEqual([{ type: 'elbow90', count: 1 }]);
    // final de la matriz: codo cargado al ramal (más pequeño que la matriz de 3")
    const last = auto.get(pipeId(p, 'M6', 'B6-1'));
    expect(last).toEqual([{ type: 'elbow90', count: 1 }]);
    // codos del montante y la acometida
    const atTop = [auto.get(pipeId(p, 'RB', 'RT')), auto.get(pipeId(p, 'RT', 'M0'))].flat().filter(Boolean);
    expect(atTop).toEqual([{ type: 'elbow90', count: 1 }]); // un solo codo arriba del montante
    expect(auto.get(pipeId(p, 'M0', 'M1'))).toBeUndefined(); // reducción en línea: sin accesorio
    expect(auto.get(pipeId(p, 'A1', 'A2'))?.[0].type ?? auto.get(pipeId(p, 'A2', 'RB'))?.[0].type).toBe('elbow90');
    // en el punto de suministro no se pone nada
    expect(auto.get(pipeId(p, 'S', 'A1'))).toBeUndefined();
  });

  it('no duplica donde ya hay accesorios puestos a mano', () => {
    const p = exampleWarehouse();
    p.autoFittings = true;
    const auto = autoFittings(p);
    expect(auto.get(pipeId(p, 'M1', 'B1-1'))).toBeUndefined();
    expect(auto.get(pipeId(p, 'M1', 'M2'))).toBeUndefined();
    expect(auto.get(pipeId(p, 'RB', 'RT'))).toBeUndefined();
  });

  it('el cálculo con accesorios automáticos da casi lo mismo que con los puestos a mano', () => {
    const manual = calculate(exampleWarehouse());
    const p = warehouseAuto();
    const auto = calculate(p);
    expect(auto.ok).toBe(true);
    expect(Math.abs(auto.requiredPressure - manual.requiredPressure) / manual.requiredPressure).toBeLessThan(0.05);
    // y claramente más que sin ningún accesorio
    const none = calculate({ ...p, autoFittings: false });
    expect(auto.requiredPressure).toBeGreaterThan(none.requiredPressure);
    expect(auto.pipes[pipeId(p, 'B1-3', 'R1-3')].fittingsText).toContain('auto');
  });

  it('codo de 45° cuando el giro es de 45°', () => {
    const p = warehouseAuto();
    p.nodes = [
      { id: 'S', x: 0, y: 0, z: 0 },
      { id: 'A', x: 10, y: 0, z: 0 },
      { id: 'B', x: 20, y: 10, z: 0 },
      { id: 'C', x: 30, y: 10, z: 0 },
    ];
    p.pipes = [
      { id: 'T1', from: 'S', to: 'A', size: '2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' },
      { id: 'T2', from: 'A', to: 'B', size: '2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' },
      { id: 'T3', from: 'B', to: 'C', size: '1-1/2', material: 'steel-sch40', c: 120, fittings: [], role: 'main' },
    ];
    p.sprinklers = [];
    p.supply = { ...p.supply, nodeId: 'S' };
    const auto = autoFittings(p);
    expect([...auto.values()].flat().map((f) => f.type).sort()).toEqual(['elbow45', 'elbow45']);
    expect(auto.get('T3')).toEqual([{ type: 'elbow45', count: 1 }]);
  });
});
