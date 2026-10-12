/**
 * Vista 3D del sistema con Three.js. Eje Z hacia arriba; unidades de escena = pies.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  ELEMENT_KIND_SHAPE,
  fmt,
  getElementType,
  getMaterial,
  NOMINAL_SIZES,
  sizeLabel,
  type CalcResult,
  type NominalSize,
  type Project,
} from '../../core';
import type { ColorMode, Selection } from './state';
import type { Underlay } from '../../core';
import type { UnderlayAsset } from './underlay';

export type ViewName = '3d' | 'top' | 'front' | 'side';

export interface Hit {
  kind: 'node' | 'pipe' | 'sprinkler' | 'element';
  id: string;
  point: THREE.Vector3;
}

export interface LegendEntry {
  color: string;
  label: string;
}

export const COLORS = {
  background: 0x24303a,
  gridMajor: 0x3d4b58,
  gridMinor: 0x2e3a45,
  steel: 0xc8102e,
  cpvc: 0xe58a3a,
  brass: 0xc9a227,
  water: 0x5ab4e5,
  node: 0x9aa7b3,
  supply: 0x2e9cca,
  selected: 0x3ee0ff,
  inactive: 0x6b7680,
  preview: 0xfff2a8,
};

/** Diámetro exterior aproximado (in) para dibujar los tubos */
const OD_IN: Record<NominalSize, number> = {
  '3/4': 1.05, '1': 1.315, '1-1/4': 1.66, '1-1/2': 1.9, '2': 2.375, '2-1/2': 2.875, '3': 3.5,
  '3-1/2': 4.0, '4': 4.5, '5': 5.563, '6': 6.625, '8': 8.625, '10': 10.75, '12': 12.75,
};

/** Rampa secuencial para presión/velocidad (de bajo a alto) */
const RAMP = ['#5aa9e6', '#4fc3c9', '#7fd18b', '#e8c547', '#ef8f3c', '#e5484d'];

/** Colores por tamaño nominal (pequeños fríos → grandes cálidos) */
const SIZE_COLORS: Partial<Record<NominalSize, string>> = {
  '3/4': '#8fd3ff', '1': '#4fb3e8', '1-1/4': '#3f8fd1', '1-1/2': '#5cc5a7', '2': '#9ccc65',
  '2-1/2': '#e8c547', '3': '#f0a23b', '3-1/2': '#e8833a', '4': '#e2603a', '5': '#d0453a',
  '6': '#c8102e', '8': '#a3175a', '10': '#7d2a8a', '12': '#5a3a9a',
};

function rampColor(t: number): THREE.Color {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const c = new THREE.Color(RAMP[i]);
  return c.lerp(new THREE.Color(RAMP[i + 1]), x - i);
}

export class Viewer {
  readonly el: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  controls: OrbitControls;
  private perspControls: OrbitControls;
  private orthoControls: OrbitControls;

  private model = new THREE.Group();
  private overlay = new THREE.Group();
  private grid: THREE.Group = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private meshById = new Map<string, THREE.Mesh[]>();
  private baseMaterial = new Map<THREE.Mesh, THREE.Material>();
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private selectedMat = new THREE.MeshStandardMaterial({ color: COLORS.selected, emissive: 0x0a5566, roughness: 0.4 });
  private unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false);
  private sphere = new THREE.SphereGeometry(1, 16, 12);
  private bounds = new THREE.Box3();
  private modelBounds = new THREE.Box3();
  private underlayGroup = new THREE.Group();
  private underlayKey = '';
  private underlayMeta: Underlay | undefined;
  private underlayAsset: UnderlayAsset | undefined;
  private underlayMaterials: (THREE.LineBasicMaterial | THREE.MeshBasicMaterial)[] = [];
  private assetIds = new WeakMap<UnderlayAsset, number>();
  private nextAssetId = 1;
  view: ViewName = '3d';
  floorZ = 0;
  legend: LegendEntry[] = [];
  legendTitle = '';

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLORS.background);
    el.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-layer';
    el.appendChild(this.labels.domElement);

    this.persp = new THREE.PerspectiveCamera(40, 1, 0.1, 20000);
    this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, -20000, 20000);
    this.ortho.up.set(0, 1, 0);
    this.camera = this.persp;

    this.perspControls = new OrbitControls(this.persp, this.renderer.domElement);
    this.perspControls.enableDamping = true;
    this.perspControls.dampingFactor = 0.12;
    this.perspControls.screenSpacePanning = true;
    this.orthoControls = new OrbitControls(this.ortho, this.renderer.domElement);
    this.orthoControls.enableRotate = false;
    this.orthoControls.screenSpacePanning = true;
    this.orthoControls.enabled = false;
    this.orthoControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls = this.perspControls;

    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3a3a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, -60, 120);
    this.scene.add(sun);
    this.scene.add(this.underlayGroup, this.grid, this.model, this.overlay);

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const halfH = (this.ortho.top - this.ortho.bottom) / 2;
    const cx = (this.ortho.left + this.ortho.right) / 2;
    this.ortho.left = cx - halfH * (w / h);
    this.ortho.right = cx + halfH * (w / h);
    this.ortho.updateProjectionMatrix();
  }

  private mat(color: number | string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${JSON.stringify(opts)}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...opts });
      this.matCache.set(key, m);
    }
    return m;
  }

  private register(mesh: THREE.Mesh, kind: Hit['kind'], id: string, pickable = true) {
    mesh.userData = { kind, id };
    const key = `${kind}:${id}`;
    const list = this.meshById.get(key) ?? [];
    list.push(mesh);
    this.meshById.set(key, list);
    this.baseMaterial.set(mesh, mesh.material as THREE.Material);
    if (pickable) this.pickables.push(mesh);
  }

  /** Reconstruye toda la escena a partir del proyecto y el resultado. */
  rebuild(project: Project, result: CalcResult | undefined, mode: ColorMode, selection: Selection, showLabels: boolean) {
    for (const obj of [...this.model.children]) {
      this.model.remove(obj);
      obj.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
        // liberar la geometría propia de cada objeto (las compartidas se reutilizan)
        if (o instanceof THREE.Mesh && o.geometry !== this.unitCylinder && o.geometry !== this.sphere) o.geometry.dispose();
      });
    }
    this.pickables = [];
    this.meshById.clear();
    this.baseMaterial.clear();

    const metric = project.displayUnits === 'metric';
    const nodes = new Map(project.nodes.map((n) => [n.id, n]));
    const box = new THREE.Box3();
    for (const n of project.nodes) box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    for (const e of project.elements ?? []) for (const q of e.points) box.expandByPoint(new THREE.Vector3(q.x, q.y, e.z));
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 10));
    this.modelBounds = box;
    this.bounds = this.combinedBounds();

    // --- Escala de colores
    let pMin = Infinity;
    let pMax = -Infinity;
    if (result?.ok) {
      for (const r of Object.values(result.nodes)) {
        pMin = Math.min(pMin, r.pressure);
        pMax = Math.max(pMax, r.pressure);
      }
    }
    const vMax = project.criteria.maxVelocity;
    this.legend = [];
    this.legendTitle = '';
    const sizesUsed = new Set<NominalSize>();

    const pipeColor = (pipeId: string, size: NominalSize, material: string): THREE.Color => {
      const pr = result?.ok ? result.pipes[pipeId] : undefined;
      if (mode === 'size') return new THREE.Color(SIZE_COLORS[size] ?? '#ffffff');
      if (mode === 'pressure') {
        if (!pr || pMax <= pMin) return new THREE.Color(COLORS.inactive);
        const avg = (pr.pUpstream + pr.pDownstream) / 2;
        return rampColor((avg - pMin) / (pMax - pMin));
      }
      if (mode === 'velocity') {
        if (!pr || Math.abs(pr.flow) < 1e-6) return new THREE.Color(COLORS.inactive);
        if (pr.velocity > vMax) return new THREE.Color('#ff3df0');
        return rampColor(pr.velocity / vMax);
      }
      return new THREE.Color(getMaterial(material, project).color ?? COLORS.steel);
    };

    // --- Tubos
    const up = new THREE.Vector3(0, 1, 0);
    let minR = Infinity;
    for (const p of project.pipes) {
      const a = nodes.get(p.from);
      const b = nodes.get(p.to);
      if (!a || !b) continue;
      const va = new THREE.Vector3(a.x, a.y, a.z);
      const vb = new THREE.Vector3(b.x, b.y, b.z);
      const dir = vb.clone().sub(va);
      const len = dir.length();
      if (len < 1e-6) continue;
      const r = Math.max(((OD_IN[p.size] ?? 2) / 24) * 2.2, 0.1);
      minR = Math.min(minR, r);
      sizesUsed.add(p.size);
      const color = pipeColor(p.id, p.size, p.material);
      const mesh = new THREE.Mesh(this.unitCylinder, this.mat(color.getHex()));
      mesh.scale.set(r, len, r);
      mesh.position.copy(va).add(vb).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(up, dir.normalize());
      this.register(mesh, 'pipe', p.id);
      this.model.add(mesh);
    }
    if (!Number.isFinite(minR)) minR = 0.06;

    // --- Nodos (pequeñas esferas en las uniones) y suministro
    const nodeR = minR * 1.25;
    for (const n of project.nodes) {
      const isSupply = n.id === project.supply.nodeId;
      const mesh = new THREE.Mesh(this.sphere, this.mat(isSupply ? COLORS.supply : COLORS.node, { roughness: 0.7 }));
      const rr = isSupply ? Math.max(0.6, nodeR * 4) : nodeR;
      mesh.scale.setScalar(rr);
      mesh.position.set(n.x, n.y, n.z);
      this.register(mesh, 'node', n.id);
      this.model.add(mesh);
      if (isSupply) this.addLabel(new THREE.Vector3(n.x, n.y, n.z + rr), 'Suministro', 'label supply');
      const sel = selection && selection.kind === 'node' && selection.id === n.id;
      if (showLabels && !isSupply && (n.label || sel)) {
        const pr = result?.ok ? result.nodes[n.id] : undefined;
        const name = n.label || n.id;
        const txt = pr ? `${name}: ${fmt('pressure', pr.pressure, project.displayUnits, true)}` : name;
        this.addLabel(new THREE.Vector3(n.x, n.y, n.z + nodeR), txt, 'label');
      }
    }

    // --- Rociadores
    for (const s of project.sprinklers) {
      const n = nodes.get(s.nodeId);
      if (!n) continue;
      const g = new THREE.Group();
      g.position.set(n.x, n.y, n.z);
      const downward = s.orientation !== 'upright';
      const sign = downward ? -1 : 1;
      const brass = this.mat(COLORS.brass, { metalness: 0.6, roughness: 0.35 });
      const frame = new THREE.Mesh(this.unitCylinder, brass);
      frame.scale.set(0.1, 0.34, 0.1);
      frame.rotation.x = Math.PI / 2;
      frame.position.z = sign * 0.13;
      const deflector = new THREE.Mesh(this.unitCylinder, brass);
      deflector.scale.set(0.3, 0.04, 0.3);
      deflector.rotation.x = Math.PI / 2;
      deflector.position.z = sign * 0.3;
      const hit = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.scale.setScalar(0.5);
      hit.position.z = sign * 0.15;
      g.add(frame, deflector, hit);
      this.register(frame, 'sprinkler', s.id, false);
      this.register(deflector, 'sprinkler', s.id, false);
      this.register(hit, 'sprinkler', s.id);
      this.baseMaterial.delete(hit);
      if (s.inDesignArea) {
        const sr = result?.ok ? result.sprinklers[s.id] : undefined;
        const spray = new THREE.Mesh(
          new THREE.ConeGeometry(Math.sqrt(s.coverage) * 0.42, 3.2, 28, 1, true),
          new THREE.MeshBasicMaterial({ color: COLORS.water, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
        );
        spray.rotation.x = Math.PI / 2; // eje del cono hacia +z; el vértice queda arriba
        spray.position.z = sign * 0.3 - 1.6;
        g.add(spray);
        if (showLabels && sr) {
          this.addLabel(new THREE.Vector3(n.x, n.y, n.z + sign * 0.3), `${s.id}: ${fmt('flow', sr.flow, project.displayUnits, true)}`, 'label flow');
        }
      }
      this.model.add(g);
    }

    // --- Leyenda
    if (mode === 'material') {
      this.legendTitle = 'Material';
      for (const id of new Set(project.pipes.map((p) => p.material))) {
        const m = getMaterial(id, project);
        this.legend.push({ color: m.color ?? '#c8102e', label: m.name });
      }
    } else if (mode === 'size') {
      this.legendTitle = 'Diámetro';
      for (const s of NOMINAL_SIZES) if (sizesUsed.has(s)) this.legend.push({ color: SIZE_COLORS[s]!, label: sizeLabel(s, metric) });
    } else if (mode === 'pressure' && result?.ok && pMax > pMin) {
      this.legendTitle = `Presión (${metric ? 'bar' : 'psi'})`;
      for (let i = 0; i < RAMP.length; i++) {
        const v = pMin + ((pMax - pMin) * i) / (RAMP.length - 1);
        this.legend.push({ color: RAMP[i], label: fmt('pressure', v, project.displayUnits) });
      }
    } else if (mode === 'velocity' && result?.ok) {
      this.legendTitle = `Velocidad (${metric ? 'm/s' : 'ft/s'})`;
      for (let i = 0; i < RAMP.length; i++) {
        this.legend.push({ color: RAMP[i], label: fmt('velocity', (vMax * i) / (RAMP.length - 1), project.displayUnits) });
      }
      this.legend.push({ color: '#ff3df0', label: 'sobre el límite' });
    }

    this.buildElements(project);
    this.rebuildGrid(metric);
    this.applySelection(selection);
  }

  private addLabel(pos: THREE.Vector3, text: string, cls: string) {
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    obj.center.set(0.5, 1.15);
    this.model.add(obj);
  }

  private rebuildGrid(metric: boolean) {
    this.grid.clear();
    const b = this.modelBounds;
    const step = metric ? 1 / 0.3048 : 1; // 1 m ó 1 ft
    const major = metric ? 5 : 10; // líneas fuertes cada 5 m ó 10 ft
    const pad = step * major;
    const x0 = Math.floor((b.min.x - pad) / (step * major)) * step * major;
    const x1 = Math.ceil((b.max.x + pad) / (step * major)) * step * major;
    const y0 = Math.floor((b.min.y - pad) / (step * major)) * step * major;
    const y1 = Math.ceil((b.max.y + pad) / (step * major)) * step * major;
    this.floorZ = b.min.z;
    const minor: number[] = [];
    const majorPts: number[] = [];
    const z = this.floorZ - 0.01;
    let i = 0;
    for (let x = x0; x <= x1 + 1e-6; x += step, i++) (i % major === 0 ? majorPts : minor).push(x, y0, z, x, y1, z);
    i = 0;
    for (let y = y0; y <= y1 + 1e-6; y += step, i++) (i % major === 0 ? majorPts : minor).push(x0, y, z, x1, y, z);
    const mk = (pts: number[], color: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
    };
    this.grid.add(mk(minor, COLORS.gridMinor), mk(majorPts, COLORS.gridMajor));
  }

  // ---------- Plano de fondo ----------

  /** Muestra (o quita) el plano de fondo. Solo reconstruye la geometría si cambió el archivo o las capas. */
  setUnderlay(meta: Underlay | undefined, asset: UnderlayAsset | undefined) {
    this.underlayMeta = meta;
    this.underlayAsset = asset;
    if (!meta || !asset) {
      this.disposeUnderlay();
      this.underlayKey = '';
      this.grid.visible = true;
      this.bounds = this.combinedBounds();
      return;
    }
    let id = this.assetIds.get(asset);
    if (!id) this.assetIds.set(asset, (id = this.nextAssetId++));
    const key = `${id}|${(meta.hiddenLayers ?? []).join('\u0001')}`;
    if (key !== this.underlayKey) {
      this.disposeUnderlay();
      this.underlayKey = key;
      if (asset.kind === 'dxf' && asset.dxf) {
        const hidden = new Set(meta.hiddenLayers ?? []);
        const ox = asset.dxf.bounds.minX;
        const oy = asset.dxf.bounds.minY;
        let n = 0;
        for (const l of asset.dxf.layers) if (!hidden.has(l.name)) n += l.segments.length / 2;
        const pos = new Float32Array(n * 3);
        let k = 0;
        for (const l of asset.dxf.layers) {
          if (hidden.has(l.name)) continue;
          const sg = l.segments;
          for (let i = 0; i < sg.length; i += 2) {
            pos[k++] = sg[i] - ox;
            pos[k++] = sg[i + 1] - oy;
            pos[k++] = 0;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.LineBasicMaterial({ color: 0xb4c2cf, transparent: true, depthWrite: false });
        const lines = new THREE.LineSegments(geo, mat);
        lines.position.set(ox, oy, 0);
        lines.renderOrder = -1;
        this.underlayMaterials.push(mat);
        this.underlayGroup.add(lines);
      } else if (asset.canvas) {
        const tex = new THREE.CanvasTexture(asset.canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        const geo = new THREE.PlaneGeometry(asset.width, asset.height);
        geo.translate(asset.width / 2, asset.height / 2, 0);
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = -1;
        this.underlayMaterials.push(mat);
        this.underlayGroup.add(mesh);
      }
    }
    const g = this.underlayGroup;
    g.position.set(meta.x, meta.y, meta.z - 0.02);
    g.rotation.set(0, 0, THREE.MathUtils.degToRad(meta.rotation));
    g.scale.set(meta.scale, meta.scale, 1);
    g.visible = meta.visible;
    for (const m of this.underlayMaterials) m.opacity = meta.opacity;
    this.grid.visible = !meta.visible;
    this.bounds = this.combinedBounds();
  }

  private disposeUnderlay() {
    this.underlayGroup.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        const m = o.material as THREE.Material & { map?: THREE.Texture };
        m.map?.dispose();
        m.dispose();
      }
    });
    this.underlayGroup.clear();
    this.underlayMaterials = [];
  }

  /** Caja del plano de fondo en coordenadas del proyecto (ft) */
  private underlayBox(): THREE.Box3 | null {
    const u = this.underlayMeta;
    const a = this.underlayAsset;
    if (!u || !a || !u.visible) return null;
    const x0 = a.kind === 'dxf' ? a.dxf!.bounds.minX : 0;
    const y0 = a.kind === 'dxf' ? a.dxf!.bounds.minY : 0;
    const box = new THREE.Box3();
    for (const [px, py] of [[x0, y0], [x0 + a.width, y0], [x0, y0 + a.height], [x0 + a.width, y0 + a.height]]) {
      box.expandByPoint(this.planToWorld(px, py));
    }
    return box;
  }

  private combinedBounds(): THREE.Box3 {
    const b = this.modelBounds.clone();
    const u = this.underlayBox();
    if (u) {
      // proyecto vacío: el plano manda
      if (this.modelBounds.getSize(new THREE.Vector3()).length() < 1e-6 || b.isEmpty()) return u.expandByPoint(b.min);
      b.union(u);
    }
    return b;
  }

  /** Punto del plano (unidades del dibujo) a coordenadas del proyecto */
  planToWorld(px: number, py: number): THREE.Vector3 {
    const u = this.underlayMeta!;
    const r = THREE.MathUtils.degToRad(u.rotation);
    const sx = px * u.scale;
    const sy = py * u.scale;
    return new THREE.Vector3(u.x + sx * Math.cos(r) - sy * Math.sin(r), u.y + sx * Math.sin(r) + sy * Math.cos(r), u.z);
  }

  /** Coordenadas del proyecto a unidades del plano */
  worldToPlan(x: number, y: number): { x: number; y: number } {
    const u = this.underlayMeta!;
    const r = THREE.MathUtils.degToRad(u.rotation);
    const dx = x - u.x;
    const dy = y - u.y;
    return { x: (dx * Math.cos(r) + dy * Math.sin(r)) / u.scale, y: (-dx * Math.sin(r) + dy * Math.cos(r)) / u.scale };
  }

  get hasUnderlay() {
    return !!this.underlayMeta?.visible && !!this.underlayAsset;
  }

  /** Punto del puntero sobre el plano de fondo */
  underlayPoint(ev: PointerEvent | MouseEvent): THREE.Vector3 | null {
    if (!this.underlayMeta) return null;
    return this.planePoint(ev, this.underlayMeta.z);
  }

  /** Extremo o vértice del DXF más cercano al puntero (a menos de `px` píxeles), en coordenadas del proyecto */
  underlaySnap(ev: PointerEvent | MouseEvent, px = 12): THREE.Vector3 | null {
    const u = this.underlayMeta;
    const a = this.underlayAsset;
    if (!u || !a || !u.visible || a.kind !== 'dxf' || !a.dxf) return null;
    const p = this.planePoint(ev, u.z);
    const q = this.planePoint({ clientX: ev.clientX + px, clientY: ev.clientY } as MouseEvent, u.z);
    if (!p || !q) return null;
    const tol = p.distanceTo(q) / u.scale;
    const c = this.worldToPlan(p.x, p.y);
    const pts = a.dxf.snapPoints;
    let best = -1;
    let bd = tol * tol;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - c.x;
      const dy = pts[i + 1] - c.y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best >= 0 ? this.planToWorld(pts[best], pts[best + 1]) : null;
  }

  /** Muestra una medida temporal (calibración o traslado) entre dos puntos */
  setMeasure(a: THREE.Vector3 | null, b: THREE.Vector3 | null) {
    this.setPreview(a, b, false);
  }

  /** Muros, columnas, vigas, losas, cielos, ductos y tuberías de otros sistemas */
  private buildElements(project: Project) {
    const up = new THREE.Vector3(0, 1, 0);
    for (const e of project.elements ?? []) {
      const t = getElementType(e.typeId, project);
      const w = e.width ?? t.width;
      const hh = e.height ?? t.height;
      const shape = ELEMENT_KIND_SHAPE[t.kind];
      const area = shape === 'area';
      const mat = this.mat(t.color, { transparent: true, opacity: area ? 0.3 : t.kind === 'wall' ? 0.55 : 0.75, depthWrite: !area && t.kind !== 'wall', roughness: 0.9, metalness: 0 });
      const add = (mesh: THREE.Mesh) => {
        mesh.renderOrder = area ? -0.5 : 0;
        this.register(mesh, 'element', e.id);
        this.model.add(mesh);
      };
      if (shape === 'point') {
        const q = e.points[0];
        if (!q) continue;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, w, hh), mat);
        mesh.position.set(q.x, q.y, e.z + hh / 2);
        add(mesh);
      } else if (shape === 'line') {
        for (let i = 0; i + 1 < e.points.length; i++) {
          const a = new THREE.Vector3(e.points[i].x, e.points[i].y, 0);
          const b = new THREE.Vector3(e.points[i + 1].x, e.points[i + 1].y, 0);
          const len = a.distanceTo(b);
          if (len < 1e-6) continue;
          const centerZ = t.kind === 'duct' || t.kind === 'pipe-ref' ? e.z : e.z + hh / 2;
          let mesh: THREE.Mesh;
          if (t.kind === 'pipe-ref') {
            mesh = new THREE.Mesh(this.unitCylinder, mat);
            mesh.scale.set(w / 2, len, w / 2);
            mesh.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
          } else {
            // los muros se alargan medio espesor en cada punta para que las esquinas cierren
            const ext = t.kind === 'wall' ? w : 0;
            mesh = new THREE.Mesh(new THREE.BoxGeometry(len + ext, w, hh), mat);
            mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
          }
          mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, centerZ);
          add(mesh);
        }
      } else if (e.points.length >= 3) {
        const shp = new THREE.Shape(e.points.map((q) => new THREE.Vector2(q.x, q.y)));
        const geo = new THREE.ExtrudeGeometry(shp, { depth: hh, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.z = e.z;
        add(mesh);
      }
    }
  }

  applySelection(sel: Selection) {
    for (const [mesh, m] of this.baseMaterial) mesh.material = m;
    if (!sel) return;
    for (const mesh of this.meshById.get(`${sel.kind}:${sel.id}`) ?? []) {
      if (this.baseMaterial.has(mesh)) mesh.material = this.selectedMat;
    }
  }

  /** Objeto bajo el puntero (los rociadores y nodos tienen prioridad sobre los tubos). */
  pick(ev: PointerEvent | MouseEvent): Hit | null {
    const ray = this.rayFrom(ev);
    const hits = ray.intersectObjects(this.pickables, false);
    if (!hits.length) return null;
    // los elementos del edificio solo se eligen si no hay tubería ni rociadores bajo el puntero
    const network = hits.filter((x) => x.object.userData.kind !== 'element');
    if (!network.length) {
      const e = hits[0];
      return { kind: 'element', id: e.object.userData.id, point: e.point.clone() };
    }
    const first = network[0];
    const nearDist = first.distance;
    // preferir nodo/rociador si está casi a la misma distancia que el tubo
    const pref = network.find(
      (h) => (h.object.userData.kind === 'sprinkler' || h.object.userData.kind === 'node') && h.distance - nearDist < 1.0,
    );
    const h = pref ?? first;
    return { kind: h.object.userData.kind, id: h.object.userData.id, point: h.point.clone() };
  }

  private rayFrom(ev: PointerEvent | MouseEvent): THREE.Raycaster {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  /** Punto del puntero sobre el plano horizontal z = cte. */
  planePoint(ev: PointerEvent | MouseEvent, z: number): THREE.Vector3 | null {
    const ray = this.rayFrom(ev);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  /** Posición en pantalla (px, relativa al lienzo) de un punto 3D. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  /** Línea de vista previa del dibujo, marca del cursor y (opcional) el trazo ya marcado. */
  setPreview(from: THREE.Vector3 | null, to: THREE.Vector3 | null, snappedToNode = false, path: THREE.Vector3[] = []) {
    this.overlay.clear();
    if (to) {
      const marker = new THREE.Mesh(
        this.sphere,
        new THREE.MeshBasicMaterial({ color: snappedToNode ? COLORS.selected : COLORS.preview, depthTest: false }),
      );
      marker.renderOrder = 10;
      marker.scale.setScalar(snappedToNode ? 0.35 : 0.22);
      marker.position.copy(to);
      this.overlay.add(marker);
    }
    const line = (pts: THREE.Vector3[]) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS.preview, depthTest: false }));
      l.renderOrder = 10;
      this.overlay.add(l);
    };
    if (path.length >= 2) line(path);
    if (from && to) line([from, to]);
  }

  /**
   * Marco de coordenadas para exportar a DXF: si hay un plano DXF de fondo se exporta en sus
   * coordenadas y unidades, para que la red quede encima del plano del arquitecto.
   */
  dxfExportFrame(): { toPlan: (x: number, y: number) => { x: number; y: number }; ftPerUnit: number } | undefined {
    const u = this.underlayMeta;
    if (!u || u.kind !== 'dxf' || !this.underlayAsset) return undefined;
    return { toPlan: (x, y) => this.worldToPlan(x, y), ftPerUnit: u.scale };
  }

  setView(view: ViewName) {
    this.view = view;
    const usesOrtho = view !== '3d';
    this.perspControls.enabled = !usesOrtho;
    this.orthoControls.enabled = usesOrtho;
    this.camera = usesOrtho ? this.ortho : this.persp;
    this.controls = usesOrtho ? this.orthoControls : this.perspControls;
    this.fit();
  }

  fit() {
    const b = this.bounds;
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 5);
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    if (this.view === '3d') {
      const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2))) * 0.72;
      const dir = new THREE.Vector3(-0.75, -1.1, 0.85).normalize();
      this.persp.position.copy(center).addScaledVector(dir, dist);
      this.perspControls.target.copy(center);
      this.persp.lookAt(center);
    } else {
      let span: number;
      let pos: THREE.Vector3;
      let upv: THREE.Vector3;
      if (this.view === 'top') {
        span = Math.max(size.x / (w / h), size.y);
        pos = new THREE.Vector3(center.x, center.y, b.max.z + 100);
        upv = new THREE.Vector3(0, 1, 0);
      } else if (this.view === 'front') {
        span = Math.max(size.x / (w / h), size.z);
        pos = new THREE.Vector3(center.x, b.min.y - 100, center.z);
        upv = new THREE.Vector3(0, 0, 1);
      } else {
        span = Math.max(size.y / (w / h), size.z);
        pos = new THREE.Vector3(b.max.x + 100, center.y, center.z);
        upv = new THREE.Vector3(0, 0, 1);
      }
      const half = Math.max(span, 10) * 0.66;
      this.ortho.top = half;
      this.ortho.bottom = -half;
      this.ortho.left = -half * (w / h);
      this.ortho.right = half * (w / h);
      this.ortho.zoom = 1;
      this.ortho.up.copy(upv);
      this.ortho.position.copy(pos);
      this.orthoControls.target.copy(center);
      this.ortho.lookAt(center);
      this.ortho.updateProjectionMatrix();
    }
    this.controls.update();
  }

  /** Imagen PNG de la vista actual (para el reporte) */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
