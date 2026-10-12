/**
 * "How Sufra runs your restaurant" — a procedural three.js machine.
 *
 * Ported from the owner's "Agentic Factory" (github.com/eugeneshilow/agentic-3d-templates, lib/machine-scene.ts):
 * the same plate, five station mechanisms, closed CatmullRom conveyor with instanced treads, copper pipes, packets that
 * change face at each station, merge-per-material compaction, cutaway clipping, exploded "stations" mode, "one order"
 * follow mode, adaptive pixel ratio, visibility pause and context-loss handling. Re-themed for Sufra:
 *   01 طلب الضيف (QR/app) → 02 المطبخ → 03 الكاشير → 04 التوصيل → 05 الدفع والإيصال الإلكتروني
 * with brass light strips instead of orange, and every in-scene screen painted in Arabic.
 * Differences from the original: sized from its container (not the window), DOM is passed in, options instead of
 * <html class="embed">, and the side the machine sits on follows the page direction (headline on the start side).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type MachineMode = "assembled" | "cutaway" | "stations" | "order";
export type StationId = "guest" | "kitchen" | "cashier" | "delivery" | "payment";

export interface StationInfo {
  id: StationId;
  name: string;
  desc: string;
  step: number;
}

export interface MachineOptions {
  embed: boolean;
  /** where the machine sits when embedded on a wide frame (the headline goes on the other side) */
  side: "left" | "right";
  stations: Record<StationId, { name: string; desc: string }>;
  labels: HTMLElement;
  tooltip: HTMLElement;
  onStation?: (id: StationId) => void;
  onReady?: () => void;
  onJourney?: (step: number, progress: number) => void;
  onPlaying?: (playing: boolean) => void;
  onError?: (msg: string) => void;
}

export interface MachineHandle {
  setMode: (m: MachineMode) => void;
  focusStation: (id: StationId) => void;
  overview: () => void;
  play: () => void;
  pause: () => void;
  dispose: () => void;
}

const AR = '"IBM Plex Sans Arabic", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const BRASS = 0xe2a93c;
const BRASS_DEEP = 0xa8700c;
const TEAL = 0x3db3a3;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function initMachine(root: HTMLElement, opts: MachineOptions): MachineHandle {
  const cleanups: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: (event: never) => void, o?: AddEventListenerOptions) => {
    const fn = handler as unknown as EventListener;
    target.addEventListener(type, fn, o);
    cleanups.push(() => target.removeEventListener(type, fn, o));
  };
  const dispose = () => {
    for (const fn of cleanups.reverse()) fn();
    cleanups.length = 0;
  };

  const TAU = Math.PI * 2;
  const embedded = opts.embed;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 150);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const w0 = Math.max(1, root.clientWidth);
  renderer.setPixelRatio(Math.min(devicePixelRatio, w0 < 900 ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "pan-y";
  root.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 55;
  controls.minPolarAngle = 0.09;
  controls.maxPolarAngle = Math.PI * 0.475;
  controls.rotateSpeed = 0.48;
  controls.zoomSpeed = 0.7;
  // Embedded in a landing page: the wheel and the finger scroll the page, not the scene.
  if (embedded) {
    controls.enableZoom = false;
    if (matchMedia("(pointer:coarse)").matches) controls.enableRotate = false;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.62;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xdbe8e4, 0x29211a, 2));
  const key = new THREE.DirectionalLight(0xfff1d8, 4.2);
  key.position.set(-4, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, near: 0.5, far: 35 });
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0002;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc4e0da, 3.1);
  rim.position.set(3, 7, -8);
  scene.add(rim);
  const warm = new THREE.PointLight(0xffc85a, 28, 20, 2);
  warm.position.set(-4, 5, 3);
  scene.add(warm);
  const front = new THREE.DirectionalLight(0xffffff, 1);
  front.position.set(5, 3, 10);
  scene.add(front);

  const mat = (color: number, metalness = 0.1, roughness = 0.4, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const M = {
    body: mat(0x2e3634, 0.75, 0.29),
    base: mat(0x27302d, 0.85, 0.32),
    edge: mat(0x6f7c78, 0.85, 0.24),
    chrome: mat(0xc3cad0, 0.92, 0.18),
    dark: mat(0x111816, 0.45, 0.38),
    rubber: mat(0x0b1012, 0.1, 0.6),
    amber: mat(BRASS_DEEP, 0.62, 0.28),
    teal: mat(0x0d5a53, 0.4, 0.35),
    ivory: mat(0xe0ded4, 0.48, 0.26),
    copper: mat(0xc58a45, 0.85, 0.3),
    light: mat(BRASS, 0.2, 0.25, { emissive: BRASS, emissiveIntensity: 1.5 }),
    tealLight: mat(TEAL, 0.2, 0.3, { emissive: TEAL, emissiveIntensity: 0.9 }),
    green: mat(0xc6d9a1, 0.1, 0.3, { emissive: 0x91b364, emissiveIntensity: 0.7 }),
  };
  type Vec3 = [number, number, number];
  type Material = THREE.Material;
  const geometries = new Map<string, THREE.BufferGeometry>();
  function boxGeo(w: number, h: number, d: number, r = 0.04) {
    const k = `b${w},${h},${d},${r}`;
    if (!geometries.has(k)) geometries.set(k, r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 3, h / 3, d / 3)) : new THREE.BoxGeometry(w, h, d));
    return geometries.get(k)!;
  }
  function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: Material = M.body, r = 0.04) {
    const o = new THREE.Mesh(boxGeo(w, h, d, r), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }
  function cyl(parent: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, m: Material = M.chrome, r2: number = r, segments = 24) {
    const k = `c${r},${r2},${h},${segments}`;
    if (!geometries.has(k)) geometries.set(k, new THREE.CylinderGeometry(r, r2, h, segments));
    const o = new THREE.Mesh(geometries.get(k)!, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }
  function ball(parent: THREE.Object3D, r: number, x: number, y: number, z: number, m: Material = M.chrome) {
    const k = `s${r}`;
    if (!geometries.has(k)) geometries.set(k, new THREE.SphereGeometry(r, 12, 8));
    const o = new THREE.Mesh(geometries.get(k)!, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }
  function tube(parent: THREE.Object3D, pts: Vec3[], r: number, m: Material = M.chrome) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const o = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, pts.length * 7), r, 8, false), m);
    o.castShadow = true;
    parent.add(o);
    return o;
  }
  function screw(parent: THREE.Object3D, x: number, y: number, z: number) {
    cyl(parent, 0.055, 0.026, x, y, z, M.chrome, undefined, 12);
    box(parent, 0.068, 0.005, 0.009, x, y + 0.014, z, M.dark, 0);
  }

  type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  function canvasTexture(w: number, h: number, draw: Draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return { texture: t, canvas: c, ctx };
  }
  /** Arabic text, right-aligned at `x` measured from the RIGHT edge of the canvas. */
  function ar(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size = 20, color = "#f4f1ea", weight = 500) {
    ctx.save();
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${AR}`;
    ctx.fillText(txt, ctx.canvas.width - x, y);
    ctx.restore();
  }
  /** Arabic text centred on `cx`. */
  function arC(ctx: CanvasRenderingContext2D, txt: string, cx: number, y: number, size = 20, color = "#f4f1ea", weight = 500) {
    ctx.save();
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${AR}`;
    ctx.fillText(txt, cx, y);
    ctx.restore();
  }
  /** Latin/mono text, left-aligned at `x` from the LEFT edge. */
  function mono(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size = 20, color = "#f4f1ea", weight = 500, align: CanvasTextAlign = "left") {
    ctx.save();
    ctx.direction = "ltr";
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${MONO}`;
    ctx.fillText(txt, x, y);
    ctx.restore();
  }
  function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  function qr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number, color = "#2b3430") {
    const n = 21;
    const cell = size / n;
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const finder = (i < 7 && j < 7) || (i < 7 && j >= n - 7) || (i >= n - 7 && j < 7);
        if (finder) {
          const fi = i < 7 ? i : i - (n - 7);
          const fj = j < 7 ? j : j - (n - 7);
          const ring = fi === 0 || fi === 6 || fj === 0 || fj === 6 || (fi >= 2 && fi <= 4 && fj >= 2 && fj <= 4);
          if (ring) ctx.fillRect(x + j * cell, y + i * cell, cell + 0.4, cell + 0.4);
        } else if (rnd() > 0.52) ctx.fillRect(x + j * cell, y + i * cell, cell + 0.4, cell + 0.4);
      }
  }
  function screenMaterial(texture: THREE.Texture) {
    return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  }
  type Painted = THREE.Texture | { texture: THREE.Texture };
  function screen(parent: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, tex: Painted) {
    const map = "texture" in tex ? tex.texture : tex;
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMaterial(map));
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  const machine = new THREE.Group();
  scene.add(machine);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.43;
  floor.receiveShadow = true;
  scene.add(floor);
  const shadow = canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(64, 64, 12, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,.7)");
    g.addColorStop(0.55, "rgba(0,0,0,.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), new THREE.MeshBasicMaterial({ map: shadow.texture, transparent: true, depthWrite: false, opacity: 0.6 }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.415;
  scene.add(contact);

  // Chamfered, layered platform with engraved nomenclature and captive screws.
  box(machine, 12.8, 0.38, 8.25, 0, -0.09, 0, M.base, 0.17);
  box(machine, 12.6, 0.055, 8.08, 0, 0.13, 0, M.edge, 0.11);
  box(machine, 12.49, 0.09, 7.96, 0, 0.19, 0, M.body, 0.1);
  box(machine, 12.55, 0.027, 8.02, 0, -0.19, 0, M.dark, 0.06);
  box(machine, 11.9, 0.026, 0.032, 0, -0.17, 4.115, M.light, 0.01);
  for (const x of [-5.6, 5.6])
    for (const z of [-3.35, 3.35]) {
      cyl(machine, 0.39, 0.25, x, -0.31, z, M.rubber);
      cyl(machine, 0.29, 0.09, x, -0.4, z, M.dark);
      screw(machine, x, 0.253, z);
    }
  for (const x of [-6.02, 6.02]) for (const z of [-3.73, 3.73]) screw(machine, x, 0.255, z);
  const engraving = canvasTexture(1536, 176, (c, w, h) => {
    c.fillStyle = "#232b28";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#4a5652";
    c.lineWidth = 2;
    c.strokeRect(2, 2, w - 4, h - 4);
    ar(c, "سُفرة", 45, 86, 52, "#e2d9c0", 700);
    ar(c, "·  الطلب  ·  المطبخ  ·  الكاشير  ·  التوصيل  ·  الإيصال", 240, 82, 34, "#b8c2be", 500);
    mono(c, "SUFRA OS   /   CAIRO   /   ONE SYSTEM FOR THE WHOLE RESTAURANT", 47, 140, 19, "#71807a", 500);
    mono(c, "No. 001", 1360, 140, 23, "#c58a45");
  });
  const plate = screen(machine, 7.35, 0.84, -0.4, 0.25, 3.51, engraving);
  plate.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 16; i++) box(machine, 0.015, 0.009, 0.11 + (i % 4) * 0.035, -5.6 + i * 0.09, 0.249, 3.5, M.edge, 0);

  // Faint drafting ellipses on the floor.
  const lineMat = new THREE.LineBasicMaterial({ color: 0x6f7c78, transparent: true, opacity: 0.14 });
  const draftingPoints: THREE.Vector3[] = [];
  for (const r of [7.5, 8.1])
    for (let i = 0; i < 120; i++)
      for (const j of [i, i + 1]) {
        const a = (j / 120) * TAU;
        draftingPoints.push(new THREE.Vector3(Math.cos(a) * r, -0.4, Math.sin(a) * r * 0.72));
      }
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * TAU;
    const r = 8.1;
    const o = i % 4 === 0 ? 0.16 : 0.07;
    draftingPoints.push(new THREE.Vector3(Math.cos(a) * r, -0.395, Math.sin(a) * r * 0.72), new THREE.Vector3(Math.cos(a) * (r + o), -0.395, Math.sin(a) * (r + o) * 0.72));
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(draftingPoints), lineMat));

  // Five stations along the belt; `step` is the place in the order flow.
  type StationDef = { id: StationId; plaque: string; step: number; pos: Vec3 };
  type Station = StationDef & { group: THREE.Group; base: THREE.Vector3; glowMat: THREE.MeshStandardMaterial; label: HTMLDivElement; index: number; anchor: THREE.Vector3 };
  const definitions: StationDef[] = [
    { id: "kitchen", plaque: "المطبخ", step: 2, pos: [-4.15, 0.29, -0.65] },
    { id: "cashier", plaque: "الكاشير", step: 3, pos: [-1.65, 0.29, -2.03] },
    { id: "delivery", plaque: "التوصيل", step: 4, pos: [1.5, 0.29, -2.08] },
    { id: "guest", plaque: "طلب الضيف", step: 1, pos: [4.03, 0.29, 0.12] },
    { id: "payment", plaque: "الدفع والإيصال", step: 5, pos: [0.93, 0.29, 1.85] },
  ];
  const stations: Station[] = [];
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10);
  function shell<T extends THREE.Material>(m: T): T {
    const s = m.clone() as T;
    s.clippingPlanes = [cutPlane];
    s.clipShadows = true;
    s.side = THREE.DoubleSide;
    return s;
  }
  const S = { body: shell(M.body), ivory: shell(M.ivory), amber: shell(M.amber), teal: shell(M.teal) };
  const gears: THREE.Group[] = [];
  function gear(parent: THREE.Object3D, x: number, y: number, z: number, r = 0.3) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    cyl(g, r, 0.09, 0, 0, 0, M.copper);
    cyl(g, r * 0.66, 0.105, 0, 0, 0, M.dark);
    cyl(g, r * 0.22, 0.14, 0, 0, 0, M.chrome);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const b = box(g, r * 0.26, 0.085, r * 0.2, Math.cos(a) * r, 0, Math.sin(a) * r, M.copper, 0.008);
      b.rotation.y = -a;
    }
    g.userData.moving = true;
    gears.push(g);
    return g;
  }
  definitions.forEach((d, i) => {
    const group = new THREE.Group();
    group.position.fromArray(d.pos);
    machine.add(group);
    const glowMat = M.light.clone();
    glowMat.emissiveIntensity = 0.5;
    box(group, 2.05, 0.12, 1.78, 0, 0.03, 0, M.dark, 0.1);
    box(group, 1.97, 0.03, 1.7, 0, 0.12, 0, glowMat, 0.09);
    box(group, 2.03, 0.17, 1.75, 0, 0.215, 0, M.body, 0.1);
    for (const x of [-0.85, 0.85]) for (const z of [-0.7, 0.7]) screw(group, x, 0.311, z);
    gear(group, -0.35, 0.45, 0, 0.27);
    gear(group, 0.22, 0.45, 0.12, 0.21);
    box(group, 0.6, 0.15, 0.36, 0.52, 0.47, -0.33, M.dark);
    for (let j = 0; j < 6; j++) box(group, 0.025, 0.16, 0.37, 0.3 + j * 0.08, 0.47, -0.33, M.edge, 0.004);
    tube(group, [[-0.7, 0.4, -0.4], [-0.55, 0.48, 0.4], [0.35, 0.45, 0.6], [0.7, 0.58, 0.23]], 0.023, M.light);
    const plaque = canvasTexture(512, 116, (c, w, h) => {
      c.fillStyle = "#141b19";
      c.fillRect(0, 0, w, h);
      mono(c, String(d.step).padStart(2, "0"), w - 26, 76, 42, "#e2a93c", 600, "right");
      ar(c, d.plaque, 112, 76, 40, "#dfe4e1", 600);
    });
    screen(group, 1.54, 0.345, 0, 0.27, 0.891, plaque);
    const info = opts.stations[d.id];
    const label = document.createElement("div");
    label.className = "mc-label";
    label.innerHTML = `<div class="mc-stem"></div><div class="mc-card"><div class="mc-title"><span>${String(d.step).padStart(2, "0")}</span>${info.name}</div><div class="mc-meta">${info.desc}</div></div>`;
    opts.labels.appendChild(label);
    cleanups.push(() => label.remove());
    stations.push({ ...d, group, base: new THREE.Vector3(...d.pos), glowMat, label, index: i, anchor: new THREE.Vector3(0, 2.5, 0) });
  });

  /* ── 02 Kitchen: ticket printer (moving printhead), film-like ticket reels, a vertical KDS screen ── */
  const kitchen = stations[0].group;
  box(kitchen, 1.74, 0.62, 1.33, 0, 0.65, -0.05, S.ivory, 0.13);
  box(kitchen, 1.5, 0.1, 1.16, 0, 0.99, -0.04, S.body, 0.025);
  for (const x of [-0.68, 0.68]) {
    cyl(kitchen, 0.065, 1.73, x, 1.35, -0.18, M.chrome);
    box(kitchen, 0.22, 1.8, 0.22, x, 1.37, -0.44, S.ivory, 0.035);
  }
  box(kitchen, 1.82, 0.27, 0.4, 0, 2.28, -0.35, S.amber, 0.045);
  box(kitchen, 1.55, 0.06, 0.06, 0, 2.13, -0.115, M.chrome, 0.01);
  const printhead = new THREE.Group();
  kitchen.add(printhead);
  printhead.position.set(0, 1.9, -0.08);
  printhead.userData.moving = true;
  box(printhead, 0.45, 0.36, 0.44, 0, 0, 0, M.body, 0.05);
  cyl(printhead, 0.11, 0.13, 0, -0.24, 0.03, M.chrome, 0.04);
  box(printhead, 0.24, 0.045, 0.022, 0, 0.09, 0.23, M.light, 0.01);
  tube(kitchen, [[-0.68, 2.1, -0.35], [-0.42, 2.52, -0.4], [0.25, 2.5, -0.4], [0.35, 2.01, -0.12]], 0.032, M.dark);
  const reels: THREE.Group[] = [];
  for (const [x, y] of [[-1.03, 1.82], [-0.94, 2.78]]) {
    const reel = new THREE.Group();
    reel.position.set(x, y, -0.48);
    kitchen.add(reel);
    reel.userData.moving = true;
    const core = cyl(reel, 0.4, 0.22, 0, 0, 0, M.ivory);
    core.rotation.x = Math.PI / 2;
    for (const z of [-0.14, 0.14]) {
      const disc = cyl(reel, 0.46, 0.045, 0, 0, z, M.chrome);
      disc.rotation.x = Math.PI / 2;
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * TAU;
        const hole = cyl(reel, 0.1, 0.006, Math.cos(a) * 0.29, Math.sin(a) * 0.29, z + (z > 0 ? 0.026 : -0.026), M.dark, undefined, 14);
        hole.rotation.x = Math.PI / 2;
      }
    }
    const axle = cyl(reel, 0.095, 0.37, 0, 0, 0, M.amber);
    axle.rotation.x = Math.PI / 2;
    reels.push(reel);
  }
  tube(kitchen, [[-1.36, 2.66, -0.48], [-1.5, 2.34, -0.48], [-1.34, 1.92, -0.48]], 0.045, M.dark);
  const kdsTexture = canvasTexture(384, 640, () => {});
  const kdsItems = [["2×", "كفتة مشوية"], ["1×", "فتة لحمة"], ["3×", "حمص بالطحينة"], ["2×", "ليمون نعناع"]];
  function drawKds(t: number) {
    const c = kdsTexture.ctx;
    const w = 384;
    const h = 640;
    c.fillStyle = "#13201d";
    c.fillRect(0, 0, w, h);
    rr(c, 0, 0, w, 96, 0, "#e2a93c");
    ar(c, "شاشة المطبخ", 24, 44, 26, "#241703", 700);
    mono(c, "#1042  ·  T7", 24, 78, 20, "#3b2a07", 600);
    const secs = Math.floor((t * 7) % 600);
    mono(c, `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`, w - 24, 60, 30, "#241703", 600, "right");
    kdsItems.forEach(([q, n], i) => {
      const y = 130 + i * 86;
      const done = (t * 0.45) % 4 > i + 0.6;
      rr(c, 20, y, w - 40, 70, 10, done ? "#1d3a33" : "#20302c");
      ar(c, n, 44, y + 45, 26, done ? "#7fa79c" : "#eef3ef", 600);
      mono(c, q, 44, y + 45, 26, "#e2a93c", 600);
      if (done) {
        c.strokeStyle = "#3db3a3";
        c.lineWidth = 4;
        c.beginPath();
        c.moveTo(w - 70, y + 36);
        c.lineTo(w - 58, y + 48);
        c.lineTo(w - 36, y + 24);
        c.stroke();
      }
    });
    ar(c, "ملاحظة: الكفتة من غير بصل", 24, 520, 20, "#f0a04e", 500);
    rr(c, 20, 560, w - 40, 54, 27, "#3db3a3");
    arC(c, "جاهز ✓", w / 2, 596, 24, "#04201c", 700);
    c.fillStyle = "#e2a93c";
    c.fillRect(20, 628, Math.max(10, ((t * 0.13) % 1) * (w - 40)), 5);
    kdsTexture.texture.needsUpdate = true;
  }
  drawKds(0);
  const outputScreen = new THREE.Group();
  outputScreen.userData.moving = true;
  kitchen.add(outputScreen);
  box(outputScreen, 0.62, 1.08, 0.055, 0, 1.36, 0.61, M.dark, 0.035);
  screen(outputScreen, 0.56, 0.98, 0, 1.36, 0.641, kdsTexture);
  box(kitchen, 1.14, 0.12, 0.2, 0, 0.83, 0.66, M.dark, 0.025);
  for (const x of [-0.42, 0.42]) {
    const r = cyl(kitchen, 0.115, 0.18, x, 0.92, 0.6, M.chrome);
    r.rotation.z = Math.PI / 2;
  }
  for (let i = 0; i < 5; i++) box(kitchen, 0.08, 0.03, 0.22, -0.38 + i * 0.19, 1.011, -0.02, M.edge, 0.005);

  /* ── 03 Cashier: a console with the POS queue and toggles ── */
  const cashier = stations[1].group;
  box(cashier, 1.9, 0.66, 1.36, 0, 0.67, -0.04, S.body, 0.11);
  const consoleTop = new THREE.Group();
  consoleTop.position.set(0, 1.01, -0.08);
  consoleTop.rotation.x = -0.32;
  cashier.add(consoleTop);
  box(consoleTop, 1.76, 0.12, 1.27, 0, 0, 0, S.ivory, 0.04);
  const queue = canvasTexture(640, 340, () => {});
  const queueRows = [["طاولة 7", "185.00"], ["تيك أواي #88", "96.90"], ["طاولة 12", "742.50"]];
  function drawQueue(t: number) {
    const c = queue.ctx;
    c.fillStyle = "#101b18";
    c.fillRect(0, 0, 640, 340);
    ar(c, "الكاشير · الفواتير المفتوحة", 25, 46, 24, "#b6c6c0", 600);
    mono(c, "03 / 11", 25, 46, 20, "#e2a93c", 500);
    for (let i = 0; i < 3; i++) {
      const y = 74 + i * 76;
      rr(c, 21, y, 598, 61, 6, "#1d2b27");
      c.fillStyle = i === 0 ? "#e2a93c" : "#55665f";
      c.fillRect(640 - 61, y + 10, 27, 41);
      ar(c, queueRows[i][0], 77, y + 30, 21, "#dbe3dc", 600);
      ar(c, i === 0 ? "جاري الدفع" : "مفتوحة", 77, y + 52, 14, i === 0 ? "#e2a93c" : "#81948f", 500);
      mono(c, queueRows[i][1], 40, y + 38, 20, "#eef3ef", 600);
      c.fillStyle = "#2f403b";
      c.fillRect(170, y + 46, 200, 6);
      c.fillStyle = i === 0 ? "#3db3a3" : "#5a6d67";
      const p = i === 0 ? ((t * 0.15) % 1) * 200 : 50 + i * 30;
      c.fillRect(370 - p, y + 46, p, 6);
    }
  }
  drawQueue(0);
  const qs = screen(consoleTop, 1.53, 0.79, 0, 0.067, -0.17, queue);
  qs.rotation.x = -Math.PI / 2;
  const toggles: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.57 + i * 0.38;
    cyl(consoleTop, 0.074, 0.035, x, 0.1, 0.45, M.dark);
    const t = cyl(consoleTop, 0.025, 0.15, x, 0.19, 0.45, M.chrome);
    t.rotation.x = -0.4;
    t.userData.moving = true;
    toggles.push(t);
    ball(consoleTop, 0.04, x, 0.275, 0.421, M.ivory);
  }
  cyl(cashier, 0.075, 0.06, 0.77, 1.05, -0.62, M.green);
  for (let i = 0; i < 7; i++) box(cashier, 0.55, 0.027, 0.02, 0, 0.46 + i * 0.05, 0.655, M.dark, 0.003);

  /* ── 04 Delivery: a big monitor with live tracking, a side KDS mirror, a flying delivery label ── */
  const delivery = stations[2].group;
  box(delivery, 1.35, 0.18, 0.88, 0, 0.44, 0, S.ivory, 0.045);
  cyl(delivery, 0.095, 1.04, 0, 0.93, -0.31, M.chrome);
  box(delivery, 0.56, 0.91, 0.14, 0, 0.99, -0.34, S.body, 0.04);
  box(delivery, 2.42, 1.72, 0.2, 0, 1.94, -0.17, S.ivory, 0.08);
  box(delivery, 2.28, 1.59, 0.1, 0, 1.94, -0.044, M.dark, 0.045);
  const mapTexture = canvasTexture(896, 592, (c, w, h) => {
    c.fillStyle = "#e9eee9";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#d3dbd5";
    c.fillRect(0, 0, w, 56);
    c.fillStyle = "#9aa8a2";
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.arc(w - 26 - i * 19, 27, 4, 0, TAU);
      c.fill();
    }
    ar(c, "تتبّع التوصيل", 33, 102, 30, "#16211e", 700);
    mono(c, "#1042", 33, 100, 20, "#5b6a64", 500);
    // map panel (left side in an RTL screen)
    rr(c, 32, 131, 420, 401, 12, "#dfe6df");
    c.fillStyle = "#9cc6d0";
    c.beginPath();
    c.moveTo(150, 131);
    c.bezierCurveTo(120, 260, 210, 330, 160, 532);
    c.lineTo(110, 532);
    c.bezierCurveTo(160, 330, 70, 260, 105, 131);
    c.fill();
    c.strokeStyle = "#c9d2cb";
    c.lineWidth = 10;
    for (const [a, b, d, e] of [[32, 230, 452, 210], [32, 400, 452, 430], [300, 131, 330, 532]]) {
      c.beginPath();
      c.moveTo(a, b);
      c.lineTo(d, e);
      c.stroke();
    }
    c.strokeStyle = "#0d5a53";
    c.lineWidth = 7;
    c.setLineDash([16, 10]);
    c.beginPath();
    c.moveTo(380, 470);
    c.bezierCurveTo(320, 420, 330, 300, 230, 260);
    c.bezierCurveTo(180, 240, 120, 220, 90, 190);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "#a8700c";
    c.beginPath();
    c.arc(380, 470, 16, 0, TAU);
    c.fill();
    c.fillStyle = "#0d5a53";
    c.beginPath();
    c.arc(90, 190, 16, 0, TAU);
    c.fill();
    // order panel (right side)
    ar(c, "الطيار في الطريق", 40, 190, 38, "#16211e", 700);
    ar(c, "حسام · موتوسيكل · الزمالك ← المعادي", 40, 232, 20, "#5b6a64", 500);
    rr(c, 484, 262, 380, 92, 14, "#ffffff");
    ar(c, "الوصول خلال", 60, 300, 20, "#5b6a64", 500);
    mono(c, "12 min", 510, 330, 40, "#0d5a53", 600);
    for (let i = 0; i < 3; i++) {
      c.fillStyle = "#cdd6cf";
      c.fillRect(864 - (330 - i * 50), 382 + i * 18, 330 - i * 50, 6);
    }
    rr(c, 484, 447, 380, 62, 31, "#0d5a53");
    ar(c, "تواصل مع الطيار", 150, 487, 22, "#ffffff", 600);
    ar(c, "مُدار بواسطة سُفرة", 33, 571, 14, "#7d8a84", 500);
  });
  screen(delivery, 2.16, 1.43, 0, 1.95, 0.011, mapTexture);
  ball(delivery, 0.024, 0, 2.747, -0.05, M.dark);
  box(delivery, 0.21, 0.019, 0.008, 0, 1.149, 0.013, M.light, 0.003);
  const flyLabel = new THREE.Group();
  flyLabel.userData.moving = true;
  delivery.add(flyLabel);
  box(flyLabel, 0.59, 0.77, 0.045, 0.94, 0.81, 0.55, M.ivory, 0.025);
  const labelTex = canvasTexture(220, 290, (c, w, h) => {
    c.fillStyle = "#f4f1ea";
    c.fillRect(0, 0, w, h);
    rr(c, 15, 16, 190, 150, 8, "#0d5a53");
    arC(c, "توصيل", 110, 80, 34, "#ffffff", 700);
    mono(c, "#1042", 110, 130, 24, "#e2a93c", 600, "center");
    ar(c, "المعادي · ش 9", 17, 210, 20, "#283030", 600);
    c.fillStyle = "#b0b5b0";
    c.fillRect(w - 17 - 153, 236, 153, 6);
    c.fillRect(w - 17 - 104, 252, 104, 5);
  });
  screen(flyLabel, 0.55, 0.72, 0.94, 0.81, 0.575, labelTex);

  /* ── 01 Guest order: cabinet with the incoming-orders screen and a card dropping in from the QR/app ── */
  const guest = stations[3].group;
  box(guest, 1.75, 1.77, 1.02, 0, 1.24, -0.13, S.body, 0.12);
  box(guest, 1.58, 0.13, 1.09, 0, 2.16, -0.13, S.teal, 0.04);
  box(guest, 1.47, 1.38, 0.055, 0, 1.31, 0.405, M.dark, 0.025);
  const orderTex = canvasTexture(480, 460, (c, w, h) => {
    c.fillStyle = "#13201d";
    c.fillRect(0, 0, w, h);
    ar(c, "طلبات الضيوف", 30, 52, 30, "#eef3ef", 700);
    ar(c, "النهارده · 3 جديد", 30, 84, 17, "#86998f", 500);
    const rows: [string, string, string][] = [
      ["طاولة 7", "QR من الترابيزة", "#e2a93c"],
      ["مريم أ.", "تطبيق سُفرة · توصيل", "#3db3a3"],
      ["طاولة 3", "QR · طلب إضافي", "#9fb59c"],
    ];
    rows.forEach(([n, s, col], i) => {
      const y = 110 + i * 100;
      rr(c, 22, y, 436, 83, 8, "#233632");
      c.fillStyle = col;
      c.beginPath();
      c.arc(w - 58, y + 40, 19, 0, TAU);
      c.fill();
      ar(c, n, 93, y + 36, 24, "#e6ece8", 600);
      ar(c, s, 93, y + 62, 16, "#94a59b", 500);
      mono(c, "↗", 40, y + 49, 25, "#c58a45");
    });
  });
  screen(guest, 1.31, 1.255, 0, 1.37, 0.44, orderTex);
  box(guest, 1.27, 0.075, 0.29, 0, 0.57, 0.55, M.chrome, 0.02);
  for (let i = 0; i < 3; i++) box(guest, 1.15, 0.021, 0.12, 0, 0.58 + i * 0.15, -0.35, M.copper, 0.006);
  tube(guest, [[0.69, 0.43, -0.2], [0.89, 0.65, -0.2], [0.89, 1.8, -0.2], [0.65, 1.99, -0.2]], 0.033, M.chrome);
  const incoming = new THREE.Group();
  incoming.userData.moving = true;
  guest.add(incoming);
  box(incoming, 0.86, 0.42, 0.043, 0, 0, 0, M.light, 0.035);
  const nameTex = canvasTexture(432, 204, (c, w, h) => {
    c.fillStyle = "#e2a93c";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#2a2412";
    c.beginPath();
    c.arc(w - 58, 98, 32, 0, TAU);
    c.fill();
    mono(c, "T7", w - 58, 108, 26, "#e2a93c", 600, "center");
    ar(c, "طاولة 7", 108, 92, 40, "#241703", 700);
    ar(c, "طلب جديد  +", 108, 140, 24, "#5b4708", 600);
  });
  screen(incoming, 0.82, 0.39, 0, 0, 0.026, nameTex);

  /* ── 05 Payment & e-receipt: cash desk with keypad, payment screen, printing ETA receipt and a falling coin ── */
  const payment = stations[4].group;
  box(payment, 1.91, 0.63, 1.32, 0, 0.65, -0.06, S.ivory, 0.12);
  box(payment, 1.96, 0.19, 1.38, 0, 0.42, -0.04, S.body, 0.04);
  box(payment, 1.37, 0.09, 0.038, 0, 0.44, 0.66, M.dark, 0.01);
  box(payment, 0.37, 0.042, 0.03, 0, 0.45, 0.687, M.chrome, 0.009);
  box(payment, 1.02, 0.25, 0.91, -0.33, 1.04, -0.03, S.body, 0.045);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) box(payment, 0.19, 0.085, 0.17, -0.62 + col * 0.27, 1.21, 0.27 - row * 0.24, col === 2 && row === 2 ? M.amber : M.ivory, 0.022);
  box(payment, 0.64, 0.6, 0.52, 0.58, 1.04, -0.15, S.body, 0.045);
  box(payment, 0.48, 0.07, 0.09, 0.59, 1.37, -0.1, M.dark, 0.01);
  cyl(payment, 0.06, 0.65, -0.35, 1.6, -0.56, M.chrome);
  box(payment, 1.13, 0.46, 0.19, -0.35, 1.98, -0.56, S.body, 0.045);
  const cashTex = canvasTexture(512, 176, (c) => {
    c.fillStyle = "#0f2420";
    c.fillRect(0, 0, 512, 176);
    ar(c, "تم الدفع · فيزا", 22, 46, 26, "#9cc8b9", 600);
    c.save();
    c.direction = "rtl";
    c.textAlign = "right";
    c.fillStyle = "#f1e6c4";
    c.font = `600 64px ${AR}`;
    c.fillText("‎+185 ج.م", 512 - 26, 134);
    c.restore();
  });
  screen(payment, 1.015, 0.349, -0.35, 1.98, -0.459, cashTex);
  const receipt = new THREE.Group();
  receipt.position.set(0.59, 1.37, -0.1);
  receipt.userData.moving = true;
  payment.add(receipt);
  const receiptTex = canvasTexture(280, 540, (c, w, h) => {
    c.fillStyle = "#f6f3ea";
    c.fillRect(0, 0, w, h);
    ar(c, "سُفرة · الزمالك", 22, 40, 22, "#24302b", 700);
    ar(c, "إيصال إلكتروني مبسّط", 22, 66, 15, "#5b6a64", 500);
    c.strokeStyle = "#8a9189";
    c.setLineDash([5, 6]);
    c.beginPath();
    c.moveTo(18, 80);
    c.lineTo(262, 80);
    c.stroke();
    const line = (label: string, v: string, y: number, bold = false) => {
      ar(c, label, 22, y, bold ? 18 : 15, "#24302b", bold ? 700 : 500);
      mono(c, v, 22, y, bold ? 18 : 15, "#24302b", bold ? 600 : 500);
    };
    line("2× كفتة", "104.00", 106);
    line("1× حمص", "24.08", 128);
    line("خدمة 12%", "15.37", 150);
    line("ضريبة 14%", "20.06", 172);
    c.beginPath();
    c.moveTo(18, 186);
    c.lineTo(262, 186);
    c.stroke();
    c.setLineDash([]);
    line("الإجمالي", "185.00", 214, true);
    qr(c, 70, 236, 140, 7);
    mono(c, "UUID 7f3c…e91a", 140, 404, 12, "#5b6a64", 500, "center");
    mono(c, "ETA · RC v1.2", 140, 424, 12, "#5b6a64", 500, "center");
    arC(c, "شكرًا لزيارتك!", 140, 470, 18, "#0d5a53", 700);
    mono(c, "No. 001042", 140, 510, 14, "#5b6a64", 500, "center");
  });
  const rp = screen(receipt, 0.41, 0.83, 0, 0.415, 0.01, receiptTex);
  (rp.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  receipt.rotation.x = -0.16;
  const coin = new THREE.Group();
  coin.userData.moving = true;
  payment.add(coin);
  const coinDisc = cyl(coin, 0.22, 0.065, 0, 0, 0, M.amber, undefined, 32);
  coinDisc.rotation.x = Math.PI / 2;
  const coinRing = new THREE.Mesh(new THREE.TorusGeometry(0.174, 0.014, 6, 32), M.light);
  coinRing.position.z = 0.037;
  coin.add(coinRing);
  const poundTex = canvasTexture(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.textAlign = "center";
    c.fillStyle = "#6b4708";
    c.font = `700 72px ${AR}`;
    c.fillText("ج", 64, 92);
  });
  const pound = screen(coin, 0.28, 0.28, 0, 0, 0.04, poundTex);
  (pound.material as THREE.MeshBasicMaterial).transparent = true;
  cyl(payment, 0.33, 0.09, 1.04, 0.39, 0.55, M.dark);
  cyl(payment, 0.26, 0.025, 1.04, 0.445, 0.55, M.copper);

  /* ── Conveyor ── */
  const path = new THREE.CatmullRomCurve3(
    [[-3.95, 0.84, 0.65], [-3.1, 0.84, -0.12], [-1.45, 0.84, -0.79], [1.32, 0.84, -0.8], [3.3, 0.84, 0.19], [3.43, 0.84, 1.21], [1.35, 0.84, 2.7], [-1.4, 0.84, 2.52], [-3.54, 0.84, 1.65]].map((p) => new THREE.Vector3(...(p as Vec3))),
    true,
    "catmullrom",
    0.25,
  );
  const belt = new THREE.Group();
  machine.add(belt);
  const frameMesh = new THREE.Mesh(new THREE.TubeGeometry(path, 150, 0.35, 8, true), M.dark);
  frameMesh.scale.y = 0.3;
  frameMesh.position.y = 0.51;
  belt.add(frameMesh);
  const beltCount = 148;
  const beltSlats = new THREE.InstancedMesh(boxGeo(0.135, 0.065, 0.63, 0.012), M.body, beltCount);
  beltSlats.receiveShadow = true;
  belt.add(beltSlats);
  beltSlats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  const pVec = new THREE.Vector3();
  const tVec = new THREE.Vector3();
  function updateBelt(t: number) {
    for (let i = 0; i < beltCount; i++) {
      const u = (i / beltCount + t * 0.012) % 1;
      path.getPointAt(u, pVec);
      path.getTangentAt(u, tVec);
      dummy.position.copy(pVec);
      dummy.rotation.set(0, -Math.atan2(tVec.z, tVec.x), 0);
      dummy.updateMatrix();
      beltSlats.setMatrixAt(i, dummy.matrix);
    }
    beltSlats.instanceMatrix.needsUpdate = true;
  }
  updateBelt(0);
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      path.getPointAt(i / 160, pVec);
      path.getTangentAt(i / 160, tVec);
      pts.push(pVec.clone().add(new THREE.Vector3(-tVec.z * 0.36 * side, 0.09, tVec.x * 0.36 * side)));
    }
    belt.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.028, 6, false), M.chrome));
  }
  for (let i = 0; i < 16; i++) {
    const p = path.getPointAt(i / 16);
    cyl(belt, 0.045, 0.43, p.x, 0.53, p.z, M.chrome);
  }
  const pipes = new THREE.Group();
  machine.add(pipes);
  for (let i = 0; i < 4; i++) {
    const a = stations[i].base;
    const b = stations[i + 1].base;
    const points = [a.clone().add(new THREE.Vector3(0.4, 0.12, 0)), a.clone().lerp(b, 0.35).add(new THREE.Vector3(0, 0.1, -0.6)), a.clone().lerp(b, 0.65).add(new THREE.Vector3(0, 0.1, -0.6)), b.clone().add(new THREE.Vector3(-0.4, 0.12, 0))];
    pipes.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 30, 0.054, 8, false), M.copper));
  }

  // Packet faces: order card → kitchen ticket → POS bill → delivery label → e-receipt
  const orderCardTex = canvasTexture(256, 352, (c, w) => {
    c.fillStyle = "#e2a93c";
    c.fillRect(0, 0, w, 352);
    ar(c, "طلب", 21, 54, 34, "#2b2410", 700);
    ar(c, "جديد", 21, 94, 34, "#2b2410", 700);
    c.strokeStyle = "#6e5413";
    c.lineWidth = 2;
    c.strokeRect(23, 118, 210, 133);
    mono(c, "T7", 128, 205, 54, "#2b2410", 600, "center");
    ar(c, "QR · طاولة 7", 23, 318, 20, "#5b4708", 600);
  });
  const ticketTex = canvasTexture(256, 352, (c, w) => {
    c.fillStyle = "#eef0ea";
    c.fillRect(0, 0, w, 352);
    ar(c, "تذكرة مطبخ", 24, 48, 26, "#24302b", 700);
    mono(c, "#1042", 24, 46, 16, "#8b8d80", 500);
    for (let i = 0; i < 7; i++) {
      c.fillStyle = i === 2 ? "#e2a93c" : "#b0b6a9";
      c.fillRect(w - 24 - (190 - (i % 3) * 30), 82 + i * 26, 190 - (i % 3) * 30, 8);
    }
    ar(c, "جاهز ✓", 24, 327, 22, "#0d5a53", 700);
  });
  const billTex = canvasTexture(256, 352, (c, w) => {
    c.fillStyle = "#1a2a26";
    c.fillRect(0, 0, w, 352);
    ar(c, "فاتورة", 24, 50, 30, "#eef3ef", 700);
    ar(c, "طاولة 7", 24, 84, 18, "#94a59b", 500);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = "#3a4d47";
      c.fillRect(24, 112 + i * 30, w - 48, 6);
    }
    mono(c, "185.00", 128, 290, 42, "#e2a93c", 600, "center");
    arC(c, "ج.م", 128, 330, 18, "#94a59b", 500);
  });
  const packetTextures = [orderCardTex, ticketTex, billTex, labelTex, receiptTex];
  const packets: { group: THREE.Group; faces: THREE.Mesh[]; halo: THREE.Mesh; stage: number; phase: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    g.userData.moving = true;
    machine.add(g);
    box(g, 0.47, 0.71, 0.04, 0, 0, 0, M.ivory, 0.022);
    const faces = packetTextures.map((tex) => {
      const s = screen(g, 0.43, 0.665, 0, 0, 0.024, tex);
      (s.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
      s.visible = false;
      return s;
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.414, 40), new THREE.MeshBasicMaterial({ color: BRASS, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.37;
    g.add(halo);
    halo.visible = false;
    packets.push({ group: g, faces, halo, stage: -1, phase: 0 });
  }
  function nearestPort(x: number, z: number) {
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < 300; i++) {
      const p = path.getPointAt(i / 300);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < dist) {
        dist = d;
        best = i / 300;
      }
    }
    return best;
  }
  const cashierU = nearestPort(-1.65, -0.7);
  const deliveryU = nearestPort(1.5, -0.7);
  const payU = nearestPort(0.93, 2.65);

  // Merge static geometry per parent/material; moving assemblies stay separate.
  function compact(group: THREE.Object3D) {
    for (const child of [...group.children]) if ((child as THREE.Group).isGroup) compact(child);
    const buckets = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
    for (const object of group.children) {
      const child = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material> & { isInstancedMesh?: boolean };
      if (!child.isMesh || child.isInstancedMesh || child.userData.moving || Array.isArray(child.material)) continue;
      const k = child.material.uuid;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(child);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      for (const geo of geos) geo.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list.some((x) => x.castShadow);
      mesh.receiveShadow = list.some((x) => x.receiveShadow);
      for (const m of list) group.remove(m);
      group.add(mesh);
    }
  }
  compact(machine);
  stations.forEach((s) => s.group.traverse((o) => (o.userData.station = s.id)));
  const pickables = stations.map((s) => s.group);

  let mode: MachineMode = "assembled";
  let cameraMode: "overview" | "station" = "overview";
  let playing = !reduceMotion;
  let simTime = reduceMotion ? 5.2 : 0;
  let spread = 0;
  let selected: StationId = "kitchen";
  let hovered: StationId | null = null;
  let width = 1;
  let height = 1;
  let mobile = false;
  let lastInteraction = performance.now();
  let dragging = false;
  let wasDragged = false;
  let downX = 0;
  let downY = 0;
  let cameraAnimating = true;
  let lastDraw = -1;
  let visible = true;
  let contextLost = false;
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3(0, 1, 0);
  const viewDirection = new THREE.Vector3(opts.side === "left" ? -10.5 : 10.5, 10.8, 17).normalize();
  let baseDistance = 25;
  let sized = false;
  let readySent = false;

  function layoutCamera() {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!w || !h) return;
    const first = !sized;
    sized = true;
    width = w;
    height = h;
    mobile = width <= 900;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const offset = mobile || !embedded ? 0 : (opts.side === "right" ? -1 : 1) * width * 0.21;
    camera.setViewOffset(width, height, offset, 0, width, height);
    const aspect = width / height;
    const availableWidth = mobile ? 0.94 : embedded ? 0.55 : 0.8;
    const horizontalFit = 17.3 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect * availableWidth);
    const verticalFit = 11.5 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (embedded ? 0.85 : 0.62));
    baseDistance = (Math.max(horizontalFit, verticalFit) * (mobile ? 0.97 : 1)) / (embedded ? (mobile ? 1.12 : 1.4) : 1);
    controls.maxDistance = Math.max(55, baseDistance * 1.6);
    camera.updateProjectionMatrix();
    setCameraGoal();
    cameraAnimating = true;
    if (first) {
      camera.position.copy(desiredPosition);
      controls.target.copy(desiredTarget);
      controls.update();
      cameraAnimating = false;
    }
  }
  function setCameraGoal() {
    const expand = mode === "stations" ? 1.2 : 1;
    if (cameraMode === "station") {
      const s = stations.find((x) => x.id === selected)!;
      desiredTarget.copy(s.group.position).add(new THREE.Vector3(0, 1.25, 0));
      desiredPosition.copy(desiredTarget).addScaledVector(viewDirection, mobile ? 9 : 12);
    } else {
      desiredTarget.set(0, 1, 0);
      desiredPosition.copy(viewDirection).multiplyScalar(baseDistance * expand).add(desiredTarget);
    }
  }
  function setMode(next: MachineMode) {
    mode = next;
    lastInteraction = performance.now();
    if (mode === "order") {
      simTime = 0;
      lastDraw = -1;
      play();
    }
    cameraMode = "overview";
    setCameraGoal();
    cameraAnimating = true;
  }
  function focusStation(id: StationId) {
    if (!stations.some((s) => s.id === id)) return;
    selected = id;
    if (mode === "order") mode = "assembled";
    cameraMode = "station";
    lastInteraction = performance.now();
    setCameraGoal();
    cameraAnimating = true;
  }
  function overview() {
    cameraMode = "overview";
    setCameraGoal();
    cameraAnimating = true;
  }
  function play() {
    playing = true;
    opts.onPlaying?.(true);
  }
  function pause() {
    playing = false;
    opts.onPlaying?.(false);
  }

  layoutCamera();
  const ro = new ResizeObserver(() => layoutCamera());
  ro.observe(root);
  cleanups.push(() => ro.disconnect());
  controls.addEventListener("start", () => {
    dragging = true;
    cameraAnimating = false;
    lastInteraction = performance.now();
  });
  controls.addEventListener("end", () => {
    dragging = false;
    lastInteraction = performance.now();
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = opts.tooltip;
  function local(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function hitStation(x: number, y: number) {
    pointer.set((x / width) * 2 - 1, (-y / height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    return hits.length ? stations.find((s) => s.id === hits[0].object.userData.station) ?? null : null;
  }
  listen(renderer.domElement, "pointermove", (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) wasDragged = true;
    if (dragging || e.pointerType === "touch") return;
    const { x, y } = local(e);
    const s = hitStation(x, y);
    hovered = s ? s.id : null;
    renderer.domElement.style.cursor = s ? "pointer" : controls.enableRotate ? "grab" : "default";
    tooltip.classList.toggle("visible", !!s);
    if (s) {
      const info = opts.stations[s.id];
      tooltip.querySelector("strong")!.innerHTML = `<span>${String(s.step).padStart(2, "0")}</span>${info.name}`;
      tooltip.querySelector("p")!.textContent = info.desc;
      tooltip.style.transform = `translate(${Math.min(width - 250, Math.max(10, x + 16))}px, ${Math.max(10, Math.min(height - 95, y - 65))}px)`;
    }
  });
  listen(renderer.domElement, "pointerleave", () => {
    hovered = null;
    tooltip.classList.remove("visible");
  });
  listen(renderer.domElement, "pointerdown", (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
    wasDragged = false;
    tooltip.classList.remove("visible");
  });
  listen(renderer.domElement, "pointerup", (e: PointerEvent) => {
    if (wasDragged) return;
    const { x, y } = local(e);
    const s = hitStation(x, y);
    if (!s) return;
    focusStation(s.id);
    opts.onStation?.(s.id);
  });
  listen(document, "visibilitychange", () => {
    visible = !document.hidden;
    lastFrame = performance.now();
  });
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting && !document.hidden;
      lastFrame = performance.now();
    },
    { threshold: 0.01 },
  );
  observer.observe(renderer.domElement);
  cleanups.push(() => observer.disconnect());
  listen(renderer.domElement, "webglcontextlost", (e: Event) => {
    e.preventDefault();
    contextLost = true;
    opts.onError?.("context-lost");
  });
  listen(renderer.domElement, "webglcontextrestored", () => {
    contextLost = false;
    lastFrame = performance.now();
  });

  const scratch = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  let prevJourney = -1;
  let lastFrame = performance.now();
  let frameCount = 0;
  let measureTime = 0;
  let pixelRatio = renderer.getPixelRatio();
  let rafId = 0;
  let forceFrame = 2; // render a still frame even when paused (reduced motion)
  function animate(now: number) {
    rafId = requestAnimationFrame(animate);
    const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.045));
    lastFrame = now;
    if (!visible || contextLost) return;
    if (playing) simTime += dt;
    const t = simTime;
    const beat = (t / 4) % 1;
    const tact = (t * TAU) / 4;
    const smooth = 1 - Math.exp(-dt * 5);
    spread = THREE.MathUtils.lerp(spread, mode === "stations" ? 1 : 0, reduceMotion ? 1 : smooth);
    cutPlane.constant = THREE.MathUtils.lerp(cutPlane.constant, mode === "cutaway" ? 0.99 : 10, reduceMotion ? 1 : smooth);
    stations.forEach((s, i) => {
      s.group.position.copy(s.base);
      s.group.position.x *= 1 + spread * 0.29;
      s.group.position.z *= 1 + spread * 0.37;
      s.group.position.y += spread * (i % 2 ? 0.32 : 0.55);
      const pulse = Math.pow(Math.max(0, Math.sin(tact - i * 0.9)), 7);
      s.glowMat.emissiveIntensity = THREE.MathUtils.lerp(s.glowMat.emissiveIntensity, hovered === s.id || (cameraMode === "station" && selected === s.id) ? 3.5 : 0.55 + pulse * 0.65, smooth || 1);
    });
    belt.scale.set(1 + spread * 0.12, 1, 1 + spread * 0.15);
    pipes.scale.set(1 + spread * 0.25, 1, 1 + spread * 0.3);
    gears.forEach((g, i) => (g.rotation.y = t * (i % 2 ? -1 : 1) * 1.1));
    reels.forEach((r, i) => (r.rotation.z = -t * (i ? 0.65 : 0.85)));
    printhead.position.x = Math.sin(tact) * 0.42;
    printhead.position.y = 1.91 + Math.sin(tact * 2) * 0.055;
    outputScreen.position.y = beat * 0.25;
    flyLabel.position.y = Math.sin(tact) * 0.04;
    const orderPhase = (t / 24) % 1;
    const cashBeat = mode === "order" ? THREE.MathUtils.clamp((orderPhase - 0.88) / 0.12, 0, 1) : beat;
    receipt.visible = coin.visible = mode !== "order" || orderPhase > 0.88;
    receipt.scale.y = 0.2 + Math.min(1, cashBeat * 1.5) * 0.8;
    coin.position.set(1.04, 2.7 - Math.min(1, cashBeat * 1.7) ** 2 * 2.17, 0.55);
    coin.rotation.y = t * 3.5;
    coin.scale.setScalar(cashBeat > 0.9 ? 1 - (cashBeat - 0.9) * 8 : 1);
    const incomingBeat = mode === "order" ? Math.min(1, orderPhase / 0.15) : beat;
    incoming.visible = mode !== "order" || orderPhase < 0.15;
    incoming.position.set(Math.sin(incomingBeat * Math.PI) * 0.24, 2.9 - incomingBeat * 1.9, 1.1 - incomingBeat * 0.55);
    incoming.rotation.z = Math.sin(incomingBeat * Math.PI) * -0.14;
    incoming.scale.setScalar(Math.min(1, incomingBeat * 8 + 0.15, (1 - incomingBeat) * 7 + 0.1));
    toggles.forEach((o, i) => (o.rotation.x = Math.sin(tact + i) > 0 ? -0.4 : 0.4));
    if (t - lastDraw > 1 / 18 || lastDraw < 0) {
      drawKds(t);
      drawQueue(t);
      queue.texture.needsUpdate = true;
      updateBelt(t);
      lastDraw = t;
    }
    packets.forEach((packet, i) => {
      const phase = (t / 24 + i / 6) % 1;
      packet.phase = phase;
      let stage: number;
      if (phase < 0.15) {
        stage = 0;
        const f = phase / 0.15;
        packet.group.position.copy(stations[3].group.position).add(new THREE.Vector3(0, 1.6, 0.6));
        scratch.copy(stations[0].group.position).add(new THREE.Vector3(0, 1.3, 0.65));
        packet.group.position.lerp(scratch, f);
        packet.group.position.y += Math.sin(f * Math.PI) * 2;
        packet.group.rotation.set(0, Math.sin(f * Math.PI) * 0.28, Math.sin(f * Math.PI) * -0.1);
      } else {
        const u = ((phase - 0.15) / 0.85) * payU;
        path.getPointAt(u, packet.group.position);
        packet.group.position.x *= 1 + spread * 0.12;
        packet.group.position.z *= 1 + spread * 0.15;
        packet.group.position.y += 0.43;
        packet.group.rotation.set(0, opts.side === "left" ? -0.18 : 0.18, 0);
        stage = u < cashierU * 0.7 ? 1 : u < deliveryU * 0.96 ? 2 : u < payU * 0.83 ? 3 : 4;
      }
      if (packet.stage !== stage) {
        packet.faces.forEach((f, j) => (f.visible = j === stage));
        packet.stage = stage;
      }
      packet.group.visible = mode !== "order" || i === 0;
      packet.halo.visible = mode === "order" && i === 0;
      packet.group.scale.setScalar(mode === "order" ? 1.35 : 1);
      if (phase > 0.94) packet.group.scale.multiplyScalar(Math.max(0.05, (1 - phase) / 0.06));
    });
    if (mode === "order") {
      const packet = packets[0];
      if (packet.stage !== prevJourney || frameCount % 6 === 0) {
        opts.onJourney?.(packet.stage, packet.phase);
        prevJourney = packet.stage;
      }
      if (!dragging && playing) {
        desiredTarget.copy(packet.group.position);
        desiredPosition.copy(desiredTarget).addScaledVector(viewDirection, mobile ? 10 : 15);
        cameraAnimating = true;
      }
    } else if (cameraMode === "station" && cameraAnimating) setCameraGoal();
    if (cameraAnimating && !dragging) {
      const speed = reduceMotion ? 1 : 1 - Math.exp(-dt * (mode === "order" ? 2.2 : 3));
      camera.position.lerp(desiredPosition, speed);
      controls.target.lerp(desiredTarget, speed);
      if (mode !== "order" && camera.position.distanceTo(desiredPosition) < 0.015 && controls.target.distanceTo(desiredTarget) < 0.015) cameraAnimating = false;
    }
    controls.autoRotate = playing && !reduceMotion && !dragging && !cameraAnimating && mode !== "order" && cameraMode === "overview" && now - lastInteraction > 6500;
    controls.autoRotateSpeed = 0.24;
    controls.update(dt);
    stations.forEach((s, i) => {
      const show = mode === "stations";
      s.label.classList.toggle("visible", show);
      if (!show) return;
      anchor.copy(s.group.position).add(s.anchor).project(camera);
      const offsets = mobile ? [[-30, 25], [-27, -50], [15, -65], [16, -1], [-5, 52]] : [[-48, -14], [-8, -64], [30, -12], [30, 20], [-12, 40]];
      let x = (anchor.x * 0.5 + 0.5) * width - 40 + offsets[i][0];
      let y = (-anchor.y * 0.5 + 0.5) * height - 52 + offsets[i][1];
      const minX = mobile || !embedded ? 9 : opts.side === "right" ? width * 0.425 : 9;
      const maxX = mobile || !embedded ? width - 140 : opts.side === "right" ? width - 165 : width * 0.575 - 165;
      x = THREE.MathUtils.clamp(x, minX, maxX);
      y = THREE.MathUtils.clamp(y, 60, height - 120);
      s.label.style.transform = `translate(${x}px,${y}px)`;
    });
    if (playing || cameraAnimating || dragging || forceFrame > 0 || controls.autoRotate || hovered || spread > 0.001) {
      renderer.render(scene, camera);
      if (forceFrame > 0) forceFrame--;
    }
    if (!readySent && sized) {
      readySent = true;
      opts.onReady?.();
    }
    if (playing) {
      frameCount++;
      measureTime += dt;
      if (measureTime > 4) {
        if (frameCount / measureTime < 43 && pixelRatio > 1) {
          pixelRatio = Math.max(1, pixelRatio - 0.25);
          renderer.setPixelRatio(pixelRatio);
          renderer.setSize(width, height, false);
        }
        frameCount = 0;
        measureTime = 0;
      }
    }
  }
  renderer.compile(scene, camera);
  rafId = requestAnimationFrame(animate);
  cleanups.push(() => {
    cancelAnimationFrame(rafId);
    controls.dispose();
    const textures = new Set<THREE.Texture>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const list = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const material of list) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
    });
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  });

  return {
    setMode,
    focusStation,
    overview,
    play: () => {
      play();
      forceFrame = 2;
    },
    pause: () => {
      pause();
      forceFrame = 2;
    },
    dispose,
  };
}
