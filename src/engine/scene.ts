// The 3D building layer: a MapLibre custom layer running three.js with MapLibre's camera and depth buffer.
// Per tile: faces (sun + sky light, sun shadows, soft wall-foot shading, distance fog), crease lines, and an outline
// hull for the selected building. Colours come from a small per-tile texture (one texel per building), so a layer
// switch rewrites a few KB and cross-fades; new tiles grow out of the ground.
import * as THREE from 'three';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { mercatorX, mercatorY, type Frame, type LoadedTile } from './tiles';
import type { Cutaway, Footprint } from './foundation';

export type Mode = 'light' | 'dark';

interface Lighting { sky: number[]; ground: number[]; sun: number[]; fog: string; edgeMode: number; edgeOpacity: number; selected: string; shadowTint: string; shadowStrength: number }
const LIGHTING: Record<Mode, Lighting> = {
  light: { sky: [0.64, 0.67, 0.72], ground: [0.45, 0.42, 0.38], sun: [0.5, 0.47, 0.42], fog: '#F3F1EC', edgeMode: 0, edgeOpacity: 0.62, selected: '#3E63DD', shadowTint: '#2A3140', shadowStrength: 0.3 },
  dark: { sky: [0.5, 0.54, 0.64], ground: [0.2, 0.2, 0.24], sun: [0.52, 0.47, 0.4], fog: '#12161C', edgeMode: 1, edgeOpacity: 0.28, selected: '#7C9BFF', shadowTint: '#000000', shadowStrength: 0.45 },
};
/** direction towards the sun in the local frame (x east, y south, z up): south-west, 38° high */
const SUN = new THREE.Vector3(-0.557, 0.557, 0.616).normalize();
const GROW_MS = 750;
const MIX_MS = 420;
const PULSE_MS = 1600;

const COMMON = /* glsl */ `
  attribute float featureIndex;
  uniform sampler2D uColors;
  uniform sampler2D uColorsPrev;
  uniform float uMix;
  uniform float uGrow;
  uniform float uSelected;
  uniform float uHovered;
  vec4 featureColor() {
    int i = int(featureIndex + 0.5);
    ivec2 size = textureSize(uColors, 0);
    ivec2 uv = ivec2(i % size.x, i / size.x);
    return mix(texelFetch(uColorsPrev, uv, 0), texelFetch(uColors, uv, 0), uMix);
  }
  float featureState() {
    return abs(featureIndex - uSelected) < 0.5 ? 2.0 : abs(featureIndex - uHovered) < 0.5 ? 1.0 : 0.0;
  }
`;
const HIDE = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;';

const FACE_VERTEX = /* glsl */ `${COMMON}
  uniform mat4 uShadowMatrix;
  uniform float uShadowOffset;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vDepth;
  varying float vState;
  varying vec4 vShadow;
  varying vec2 vLocal;
  void main() {
    vec4 c = featureColor();
    if (c.a < 0.5) { ${HIDE} }
    vec3 p = position;
    p.z *= uGrow;
    vLocal = p.xy;
    vColor = c.rgb;
    vNormal = normal;
    vHeight = p.z;
    vState = featureState();
    vShadow = uShadowMatrix * vec4(p + normal * uShadowOffset, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vDepth = gl_Position.w;
  }`;

const FACE_FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uSelectedColor;
  uniform float uFocus;
  uniform float uShadowOn;
  uniform float uShadowBias;
  uniform vec2 uShadowTexel;
  uniform sampler2DShadow uShadowMap;
  uniform float uCutOn;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vDepth;
  varying float vState;
  varying vec4 vShadow;
  varying vec2 vLocal;
  // ordered 4x4 dither: see-through without sorting
  float bayer(vec2 p) {
    int i = int(mod(p.x, 4.0)) + 4 * int(mod(p.y, 4.0));
    const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
    return (m[i] + 0.5) / 16.0;
  }
  float sunShadow() {
    if (uShadowOn < 0.5) return 1.0;
    vec3 s = vShadow.xyz / vShadow.w * 0.5 + 0.5;
    vec2 e = abs(s.xy * 2.0 - 1.0);
    float inside = 1.0 - smoothstep(0.8, 1.0, max(e.x, e.y));
    if (inside <= 0.0 || s.z >= 1.0) return 1.0;
    float sum = 0.0;
    for (int x = -1; x <= 1; x++)
      for (int y = -1; y <= 1; y++)
        sum += texture(uShadowMap, vec3(s.xy + vec2(float(x), float(y)) * uShadowTexel, s.z - uShadowBias));
    return mix(1.0, sum / 9.0, inside);
  }
  void main() {
    // foundation cutaway: the building itself turns half see-through (the pit is drawn over the city)
    if (uCutOn > 0.5 && vState > 1.5 && bayer(gl_FragCoord.xy) >= 0.4) discard;
    vec3 n = normalize(vNormal);
    float ndl = dot(n, uSunDir);
    float sun = ndl > 0.0 ? ndl * sunShadow() : 0.0;
    vec3 ambient = mix(uGroundColor, uSkyColor, 0.5 + 0.5 * n.z);
    // walls get a little darker towards the street; roofs keep their true colour
    float foot = mix(0.62, 1.0, smoothstep(0.0, 4.5, vHeight));
    float ao = mix(1.0, foot, 1.0 - abs(n.z));
    vec3 albedo = vColor;
    if (vState > 1.5) albedo = mix(albedo, uSelectedColor, 0.4) * 1.08 + 0.05;
    else {
      if (vState > 0.5) albedo = albedo * 1.12 + 0.035;
      // focus: while a building is selected the rest steps back a little
      float grey = dot(albedo, vec3(0.299, 0.587, 0.114));
      albedo = mix(albedo, mix(vec3(grey), uFogColor, 0.25), 0.3 * uFocus);
    }
    vec3 col = albedo * (ambient + uSunColor * sun) * ao;
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth) * 0.92);
    gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  }`;

const EDGE_VERTEX = /* glsl */ `${COMMON}
  varying vec3 vColor;
  varying float vDepth;
  varying float vState;
  void main() {
    vec4 c = featureColor();
    if (c.a < 0.5) { ${HIDE} }
    vec3 p = position;
    p.z *= uGrow;
    vColor = c.rgb;
    vState = featureState();
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vDepth = gl_Position.w;
  }`;

const EDGE_FRAGMENT = /* glsl */ `
  uniform float uEdgeMode;
  uniform float uEdgeOpacity;
  uniform float uEdgeFade;
  uniform float uLinesOn;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform vec3 uSelectedColor;
  varying vec3 vColor;
  varying float vDepth;
  varying float vState;
  void main() {
    vec3 col = uEdgeMode < 0.5 ? vColor * 0.36 : mix(vColor, vec3(1.0), 0.6);
    float a = uEdgeOpacity * uEdgeFade * uLinesOn * (1.0 - smoothstep(uFogNear * 0.5, uFogFar * 0.55, vDepth));
    if (vState > 1.5) { col = uSelectedColor; a = 1.0; }
    else if (vState > 0.5) { col = uEdgeMode < 0.5 ? vColor * 0.22 : vec3(1.0); a = max(a, 0.85); }
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }`;

const OUTLINE_VERTEX = /* glsl */ `${COMMON}
  uniform vec3 uSelCenter;
  uniform vec3 uSelSize;
  uniform float uOutlineWidth;
  void main() {
    if (abs(featureIndex - uSelected) > 0.5) { ${HIDE} }
    vec3 p = position;
    p.z *= uGrow;
    vec3 s = 1.0 + uOutlineWidth / max(uSelSize, vec3(0.5));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(uSelCenter + (p - uSelCenter) * s, 1.0);
  }`;

const OUTLINE_FRAGMENT = /* glsl */ `
  uniform vec3 uSelectedColor;
  uniform float uPulse;
  void main() {
    gl_FragColor = vec4(uSelectedColor * (0.9 + 0.25 * uPulse), 1.0);
  }`;

const XRAY_VERTEX = /* glsl */ `${COMMON}
  void main() {
    if (abs(featureIndex - uSelected) > 0.5) { ${HIDE} }
    vec3 p = position;
    p.z *= uGrow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const XRAY_FRAGMENT = /* glsl */ `
  uniform vec3 uSelectedColor;
  void main() {
    gl_FragColor = vec4(uSelectedColor, 0.24);
  }`;

// transparent ground plane that only darkens where buildings block the sun (MapLibre's ground cannot)
const GROUND_VERTEX = /* glsl */ `
  uniform mat4 uShadowMatrix;
  uniform float uShadowOffset;
  varying vec4 vShadow;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vShadow = uShadowMatrix * vec4(world.xyz + vec3(0.0, 0.0, uShadowOffset), 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vDepth = gl_Position.w;
  }`;

const GROUND_FRAGMENT = /* glsl */ `
  uniform float uShadowBias;
  uniform vec2 uShadowTexel;
  uniform sampler2DShadow uShadowMap;
  uniform vec3 uShadowTint;
  uniform float uShadowStrength;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uDebug;
  uniform float uCutOn;
  uniform vec4 uPitRect;
  varying vec4 vShadow;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    if (uCutOn > 0.5 && vWorld.x > uPitRect.x && vWorld.x < uPitRect.z && vWorld.y > uPitRect.y && vWorld.y < uPitRect.w) discard;
    vec3 s = vShadow.xyz / vShadow.w * 0.5 + 0.5;
    vec2 e = abs(s.xy * 2.0 - 1.0);
    float inside = 1.0 - smoothstep(0.75, 1.0, max(e.x, e.y));
    if (uDebug > 0.5) {
      float l = texture(uShadowMap, vec3(s.xy, s.z - uShadowBias));
      gl_FragColor = vec4(fract(s.z * 20.0), l, inside, 0.85);
      return;
    }
    if (inside <= 0.0) discard;
    float lit = 0.0;
    for (int x = -2; x <= 2; x++)
      for (int y = -2; y <= 2; y++)
        lit += texture(uShadowMap, vec3(s.xy + vec2(float(x), float(y)) * uShadowTexel, s.z - uShadowBias));
    float shade = (1.0 - lit / 25.0) * inside * (1.0 - smoothstep(uFogNear, uFogFar, vDepth));
    if (shade < 0.01) discard;
    gl_FragColor = vec4(uShadowTint, shade * uShadowStrength);
  }`;

const DEPTH_VERTEX = /* glsl */ `${COMMON}
  void main() {
    vec4 c = featureColor();
    if (c.a < 0.5) { ${HIDE} }
    vec3 p = position;
    p.z *= uGrow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

export interface TileView {
  tile: LoadedTile;
  meshes: THREE.Mesh[];
  lines: THREE.LineSegments[];
  outlines: THREE.Mesh[];
  xrays: THREE.Mesh[];
  colors: THREE.DataTexture;
  colorsPrev: THREE.DataTexture;
  uniforms: Record<string, THREE.IUniform>;
  depthMaterial: THREE.ShaderMaterial;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  born: number;
  mixStart: number;
}

const EMPTY_F32 = new Float32Array(0);
/** drop the CPU copy of an attribute once it is on the GPU */
function release(this: THREE.BufferAttribute) {
  (this as { array: ArrayLike<number> }).array = EMPTY_F32;
}
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const rgb = (c: number[]) => new THREE.Vector3(c[0], c[1], c[2]);
const colorVec = (hex: string) => { const c = new THREE.Color(hex); return new THREE.Vector3(c.r, c.g, c.b); };

export class BuildingLayer implements CustomLayerInterface {
  id = 'bag3d';
  type = 'custom' as const;
  renderingMode = '3d' as const;
  map!: MapLibreMap;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  /** the foundation cutaway: drawn over the city like an illustration (fresh depth buffer) */
  cutScene = new THREE.Scene();
  camera = new THREE.Camera();
  /** local metres -> Web Mercator */
  local: THREE.Matrix4;
  mvp = new THREE.Matrix4();
  inverse = new THREE.Matrix4();
  views = new Set<TileView>();
  shadows = true;
  /** building outlines on or off (the selected and hovered building keep theirs) */
  lines = true;
  private hoveredView: TileView | null = null;
  /** no GPU (SwiftShader, llvmpipe, remote desktops): shadows start off and use a small map */
  software = false;
  private selectedView: TileView | null = null;
  private selectedAt = 0;
  private focusFrom = 0;
  cutaway: Cutaway | null = null;
  private cutawayAt = 0;
  /** centre (local metres) and footprint radius of the selected building */
  selection: { x: number; y: number; radius: number } | null = null;
  private focusAt = 0;
  private shadowTarget!: THREE.WebGLRenderTarget;
  private shadowCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 10);
  shared: Record<string, THREE.IUniform>;
  ground: THREE.Mesh;

  constructor(private frame: Frame) {
    this.local = new THREE.Matrix4()
      .makeTranslation(frame.mx, frame.my, 0)
      .multiply(new THREE.Matrix4().makeScale(frame.scale, frame.scale, frame.scale));
    this.shared = {
      uSunDir: { value: SUN.clone() },
      uSunColor: { value: new THREE.Vector3() },
      uSkyColor: { value: new THREE.Vector3() },
      uGroundColor: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Vector3() },
      uFogNear: { value: 1e9 },
      uFogFar: { value: 2e9 },
      uEdgeMode: { value: 0 },
      uEdgeOpacity: { value: 0.5 },
      uEdgeFade: { value: 1 },
      uLinesOn: { value: 1 },
      uSelectedColor: { value: new THREE.Vector3() },
      uShadowOn: { value: 0 },
      uShadowBias: { value: 0.0001 },
      uShadowOffset: { value: 0.5 },
      uShadowTexel: { value: new THREE.Vector2() },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowMap: { value: null },
      uSelCenter: { value: new THREE.Vector3() },
      uSelSize: { value: new THREE.Vector3(1, 1, 1) },
      uOutlineWidth: { value: 0.6 },
      uPulse: { value: 0 },
      uFocus: { value: 0 },
      uShadowTint: { value: new THREE.Vector3() },
      uShadowStrength: { value: 0.3 },
      uDebug: { value: 0 },
      uCutOn: { value: 0 },
      uPitRect: { value: new THREE.Vector4() },
    };
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: GROUND_VERTEX, fragmentShader: GROUND_FRAGMENT, uniforms: this.shared,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
        // built straight in the mirrored local frame (y = south), so its winding is reversed on screen
        side: THREE.DoubleSide,
      }),
    );
    this.ground.renderOrder = -1;
    this.ground.frustumCulled = false;
    this.ground.visible = false;
    this.scene.add(this.ground);
    this.setMode('light');
  }

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
    this.renderer.autoClear = false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu);
    const size = this.software ? 1024 : this.renderer.capabilities.maxTextureSize >= 8192 && window.innerWidth > 700 ? 4096 : 2048;
    const depth = new THREE.DepthTexture(size, size);
    depth.compareFunction = THREE.LessEqualCompare;
    depth.type = THREE.UnsignedIntType;
    this.shadowTarget = new THREE.WebGLRenderTarget(size, size, { depthTexture: depth, depthBuffer: true });
    this.shared.uShadowMap.value = depth;
    this.shared.uShadowTexel.value.set(1 / size, 1 / size);
    // the depth texture must exist before the first frame samples it, shadows on or off
    this.renderer.setRenderTarget(this.shadowTarget);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  setMode(mode: Mode) {
    const l = LIGHTING[mode];
    this.shared.uSkyColor.value.copy(rgb(l.sky));
    this.shared.uGroundColor.value.copy(rgb(l.ground));
    this.shared.uSunColor.value.copy(rgb(l.sun));
    this.shared.uFogColor.value.copy(colorVec(l.fog));
    this.shared.uSelectedColor.value.copy(colorVec(l.selected));
    this.shared.uEdgeMode.value = l.edgeMode;
    this.shared.uShadowTint.value.copy(colorVec(l.shadowTint));
    this.shared.uShadowStrength.value = l.shadowStrength;
    this.shared.uEdgeOpacity.value = l.edgeOpacity;
    this.map?.triggerRepaint();
  }

  // ---- tiles ----
  addTile(tile: LoadedTile, colors: Uint8Array): TileView {
    const width = 256;
    const height = Math.max(1, Math.ceil(tile.features.length / width));
    const texture = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, width, height);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    const padded = new Uint8Array(width * height * 4);
    padded.set(colors.subarray(0, padded.length));
    const colorsTex = texture(padded);
    const prevTex = texture(padded.slice());
    const uniforms: Record<string, THREE.IUniform> = {
      ...this.shared,
      uColors: { value: colorsTex },
      uColorsPrev: { value: prevTex },
      uMix: { value: 1 },
      uGrow: { value: 0 },
      uSelected: { value: -1 },
      uHovered: { value: -1 },
    };
    const faceMaterial = new THREE.ShaderMaterial({
      vertexShader: FACE_VERTEX, fragmentShader: FACE_FRAGMENT, uniforms,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
    });
    const edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERTEX, fragmentShader: EDGE_FRAGMENT, uniforms, transparent: true, depthWrite: false,
    });
    const outlineMaterial = new THREE.ShaderMaterial({
      vertexShader: OUTLINE_VERTEX, fragmentShader: OUTLINE_FRAGMENT, uniforms, side: THREE.BackSide,
    });
    const xrayMaterial = new THREE.ShaderMaterial({
      vertexShader: XRAY_VERTEX, fragmentShader: XRAY_FRAGMENT, uniforms, transparent: true, depthWrite: false,
      // only where something stands in front of it: the visible faces are drawn already
      depthFunc: THREE.GreaterDepth,
    });
    const depthMaterial = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERTEX, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', uniforms,
      side: THREE.DoubleSide, colorWrite: false,
    });
    const view: TileView = {
      tile, meshes: [], lines: [], outlines: [], xrays: [], colors: colorsTex, colorsPrev: prevTex, uniforms, depthMaterial,
      materials: [faceMaterial, edgeMaterial, outlineMaterial, xrayMaterial, depthMaterial], geometries: [], born: performance.now(), mixStart: 0,
    };
    for (const part of tile.parts) {
      const b = part.bounds;
      const box = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const faces = new THREE.BufferGeometry();
      faces.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
      faces.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3, true));
      faces.setAttribute('featureIndex', new THREE.BufferAttribute(part.feature, 1));
      faces.setIndex(new THREE.BufferAttribute(part.index, 1));
      faces.boundingBox = box;
      faces.boundingSphere = sphere;
      const edges = new THREE.BufferGeometry();
      edges.setAttribute('position', new THREE.BufferAttribute(part.edgePosition, 3));
      edges.setAttribute('featureIndex', new THREE.BufferAttribute(part.edgeFeature, 1));
      edges.boundingBox = box.clone();
      edges.boundingSphere = sphere.clone();
      const mesh = new THREE.Mesh(faces, faceMaterial);
      const lines = new THREE.LineSegments(edges, edgeMaterial);
      const outline = new THREE.Mesh(faces, outlineMaterial);
      const xray = new THREE.Mesh(faces, xrayMaterial);
      lines.renderOrder = 1;
      outline.renderOrder = 2;
      xray.renderOrder = 3;
      outline.visible = xray.visible = false;
      for (const o of [mesh, lines, outline, xray]) { o.matrixAutoUpdate = false; o.userData.view = view; this.scene.add(o); }
      view.meshes.push(mesh);
      view.lines.push(lines);
      view.outlines.push(outline);
      view.xrays.push(xray);
      view.geometries.push(faces, edges);
      for (const g of [faces, edges]) for (const name of ['normal', 'featureIndex', 'position'] as const) {
        const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (a && !(g === faces && name === 'position')) a.onUpload(release);
      }
      part.normal = part.edgePosition = EMPTY_F32 as unknown as Int8Array & Float32Array;
      part.feature = part.edgeFeature = EMPTY_F32;
    }
    this.views.add(view);
    this.map.triggerRepaint();
    return view;
  }

  removeTile(view: TileView) {
    for (const o of [...view.meshes, ...view.lines, ...view.outlines, ...view.xrays]) this.scene.remove(o);
    view.geometries.forEach((g) => g.dispose());
    view.materials.forEach((m) => m.dispose());
    view.colors.dispose();
    view.colorsPrev.dispose();
    if (this.selectedView === view) { this.selectedView = null; this.selection = null; }
    if (this.hoveredView === view) this.hoveredView = null;
    this.views.delete(view);
    this.map.triggerRepaint();
  }

  /** new colours for one tile; animate = cross-fade from the old ones */
  setColors(view: TileView, colors: Uint8Array, animate: boolean) {
    const now = view.colors.image.data as Uint8Array;
    const prev = view.colorsPrev.image.data as Uint8Array;
    if (animate) prev.set(now); else prev.set(colors.subarray(0, prev.length));
    now.set(colors.subarray(0, now.length));
    view.colors.needsUpdate = true;
    view.colorsPrev.needsUpdate = true;
    view.uniforms.uMix.value = animate ? 0 : 1;
    view.mixStart = performance.now();
    this.map.triggerRepaint();
  }

  setSelected(view: TileView | null, feature: number) {
    if (this.selectedView) {
      this.selectedView.uniforms.uSelected.value = -1;
      this.selectedView.outlines.forEach((o) => (o.visible = false));
      this.selectedView.xrays.forEach((o) => (o.visible = false));
    }
    this.selectedView = view;
    if (!view) this.selection = null;
    this.focusFrom = this.shared.uFocus.value;
    this.focusAt = performance.now();
    if (view) {
      view.uniforms.uSelected.value = feature;
      view.outlines.forEach((o) => (o.visible = !this.cutaway));
      view.xrays.forEach((o) => (o.visible = !this.cutaway));
      const part = view.tile.parts.find((p) => feature < p.featureTriStart.length - 1 && p.featureTriStart[feature + 1] > p.featureTriStart[feature]) ?? view.tile.parts[0];
      const b = part.featureBoxes.subarray(feature * 6, feature * 6 + 6);
      this.shared.uSelCenter.value.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, 0);
      this.shared.uSelSize.value.set((b[3] - b[0]) / 2, (b[4] - b[1]) / 2, b[5]);
      this.selection = { x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, radius: Math.hypot(b[3] - b[0], b[4] - b[1]) / 2 };
      this.selectedAt = performance.now();
    }
    this.map.triggerRepaint();
  }

  setHovered(view: TileView | null, feature: number, previous: TileView | null) {
    if (previous) previous.uniforms.uHovered.value = -1;
    if (view) view.uniforms.uHovered.value = feature;
    this.hoveredView = view;
    this.map.triggerRepaint();
  }

  // ---- frame ----
  /** local metres of a longitude/latitude */
  toLocal(lon: number, lat: number): THREE.Vector3 {
    return new THREE.Vector3((mercatorX(lon) - this.frame.mx) / this.frame.scale, (mercatorY(lat) - this.frame.my) / this.frame.scale, 0);
  }

  toLngLat(x: number, y: number): [number, number] {
    const mx = this.frame.mx + x * this.frame.scale;
    const my = this.frame.my + y * this.frame.scale;
    return [mx * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp(((180 - my * 360) * Math.PI) / 180)) - 90];
  }

  /** wall-bottom segments of a building: triangle edges with both ends on the ground (wall feet) */
  footprint(view: TileView, feature: number): Footprint {
    const segments: number[] = [];
    const min: [number, number] = [Infinity, Infinity];
    const max: [number, number] = [-Infinity, -Infinity];
    for (const part of view.tile.parts) {
      if (feature >= part.featureTriStart.length - 1) continue;
      const pos = part.position, index = part.index;
      for (let k = part.featureTriStart[feature]; k < part.featureTriStart[feature + 1]; k++) {
        const t = part.featureTris[k] * 3;
        const low: number[] = [];
        for (let j = 0; j < 3; j++) {
          const v = index[t + j];
          const x = pos[v * 3], y = pos[v * 3 + 1];
          min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y);
          max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y);
          if (pos[v * 3 + 2] < 0.05) low.push(v);
        }
        if (low.length === 2) segments.push(pos[low[0] * 3], pos[low[0] * 3 + 1], pos[low[1] * 3], pos[low[1] * 3 + 1]);
      }
    }
    return { segments, min, max };
  }

  setCutaway(cutaway: Cutaway | null) {
    if (this.cutaway) { this.cutScene.remove(this.cutaway.group); this.cutaway.dispose(); }
    this.cutaway = cutaway;
    this.shared.uCutOn.value = cutaway ? 1 : 0;
    if (cutaway) {
      const { pit } = cutaway;
      this.cutScene.add(cutaway.group);
      this.shared.uPitRect.value.set(pit.minX, pit.minY, pit.maxX, pit.maxY);
      this.cutawayAt = performance.now();
    }
    for (const view of this.views) {
      view.xrays.forEach((o) => (o.visible = !cutaway && view === this.selectedView));
      view.outlines.forEach((o) => (o.visible = !cutaway && view === this.selectedView));
    }
    this.map.triggerRepaint();
  }

  /** screen position (CSS pixels) of a local point, null behind the camera */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector4(x, y, z, 1).applyMatrix4(this.mvp);
    if (v.w <= 0) return null;
    const canvas = this.map.getCanvas();
    return { x: ((v.x / v.w + 1) / 2) * canvas.clientWidth, y: ((1 - v.y / v.w) / 2) * canvas.clientHeight };
  }

  prerender() {
    this.shared.uShadowOn.value = this.shadows && this.views.size ? 1 : 0;
    this.ground.visible = false;
    if (!this.shared.uShadowOn.value) return;
    const zoom = this.map.getZoom();
    const radius = Math.min(2200, Math.max(140, 700 * 2 ** (16 - zoom)));
    const size = this.shadowTarget.width;
    const texel = (2 * radius) / size;
    const c = this.map.getCenter();
    const target = this.toLocal(c.lng, c.lat);
    target.x = Math.round(target.x / texel) * texel; // snap to the shadow grid: no shimmer while panning
    target.y = Math.round(target.y / texel) * texel;
    const cam = this.shadowCamera;
    const distance = radius * 3;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 1; cam.far = distance + radius * 2;
    cam.position.copy(target).addScaledVector(SUN, distance);
    cam.up.set(0, 0, 1);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    this.shared.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.shared.uShadowOffset.value = texel * 1.5;
    this.shared.uShadowBias.value = 0.12 / (cam.far - cam.near);

    const swapped: [THREE.Mesh, THREE.Material][] = [];
    for (const view of this.views) {
      for (const m of view.meshes) { swapped.push([m, m.material as THREE.Material]); m.material = view.depthMaterial; }
      view.lines.forEach((l) => (l.visible = false));
      view.outlines.forEach((o) => (o.visible = false));
      view.xrays.forEach((o) => (o.visible = false));
    }
    this.renderer.resetState();
    this.renderer.setRenderTarget(this.shadowTarget);
    this.renderer.clear(false, true, false);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    for (const [m, material] of swapped) m.material = material;
    this.ground.position.set(target.x, target.y, 0);
    this.ground.scale.set(radius, radius, 1);
    this.ground.updateMatrix();
    this.ground.matrixWorld.copy(this.ground.matrix);
    this.ground.visible = true;
    for (const view of this.views) {
      view.outlines.forEach((o) => (o.visible = !this.cutaway && view === this.selectedView));
      view.xrays.forEach((o) => (o.visible = !this.cutaway && view === this.selectedView));
    }
  }

  render(_gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const now = performance.now();
    let animating = false;
    for (const view of this.views) {
      const g = easeOut((now - view.born) / GROW_MS);
      view.uniforms.uGrow.value = g;
      if (g < 1) animating = true;
      if (view.uniforms.uMix.value < 1) {
        view.uniforms.uMix.value = easeOut((now - view.mixStart) / MIX_MS);
        animating = true;
      }
    }
    const pulseT = (now - this.selectedAt) / PULSE_MS;
    this.shared.uPulse.value = this.selectedView && pulseT < 1 ? Math.sin(pulseT * Math.PI * 3) * (1 - pulseT) : 0;
    if (this.selectedView && pulseT < 1) animating = true;
    if (this.cutaway) {
      // dig the pit and keep the water moving
      this.cutaway.uniforms.uReveal.value = easeOut((now - this.cutawayAt) / 1100);
      this.cutaway.uniforms.uTime.value = now / 1000;
      animating = true;
    }
    const focusT = easeOut((now - this.focusAt) / 350);
    this.shared.uFocus.value = this.focusFrom + ((this.selectedView ? 1 : 0) - this.focusFrom) * focusT;
    if (focusT < 1) animating = true;

    this.mvp.fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]).multiply(this.local);
    this.inverse.copy(this.mvp).invert();
    this.camera.projectionMatrix.copy(this.mvp);
    this.camera.projectionMatrixInverse.copy(this.inverse);

    // fog: relative to the distance of the view centre, whatever units the projection uses
    const c = this.map.getCenter();
    const l = this.toLocal(c.lng, c.lat);
    const centre = new THREE.Vector4(l.x, l.y, 0, 1).applyMatrix4(this.mvp);
    this.shared.uFogNear.value = centre.w * 1.5;
    this.shared.uFogFar.value = centre.w * 5.5;
    // lines fade out when zoomed out (a whole city of creases turns into hatching); skip drawing them when invisible
    const zoom = this.map.getZoom();
    const fade = Math.min(1, Math.max(0, (zoom - 14.2) / 1.4));
    this.shared.uEdgeFade.value = fade * fade * (3 - 2 * fade);
    this.shared.uLinesOn.value = this.lines ? 1 : 0;
    for (const view of this.views) {
      const draw = (this.lines && fade > 0) || view === this.selectedView || view === this.hoveredView;
      view.lines.forEach((l) => (l.visible = draw));
    }
    // outline about 2 screen pixels wide at the view centre
    const metresPerPixel = 1 / (this.frame.scale * 512 * 2 ** zoom);
    this.shared.uOutlineWidth.value = Math.min(6, Math.max(0.2, metresPerPixel * 2));

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    if (this.cutaway) {
      this.renderer.clearDepth();
      this.renderer.render(this.cutScene, this.camera);
    }
    if (animating) this.map.triggerRepaint();
  }

  // ---- picking: ray against each building's box first, then only that building's triangles ----
  pick(x: number, y: number, visible: (view: TileView, feature: number) => boolean): { view: TileView; feature: number } | null {
    const canvas = this.map.getCanvas();
    const nx = (x / canvas.clientWidth) * 2 - 1;
    const ny = -(y / canvas.clientHeight) * 2 + 1;
    const near = new THREE.Vector3(nx, ny, -1).applyMatrix4(this.inverse);
    const far = new THREE.Vector3(nx, ny, 1).applyMatrix4(this.inverse);
    const ray = new THREE.Ray(near, far.sub(near).normalize());
    const box = new THREE.Box3();
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), hit = new THREE.Vector3();
    let best: { view: TileView; feature: number } | null = null;
    let bestDistance = Infinity;
    for (const view of this.views) {
      for (const part of view.tile.parts) {
        const b = part.bounds;
        box.min.set(b[0], b[1], b[2]);
        box.max.set(b[3], b[4], b[5]);
        if (!ray.intersectsBox(box)) continue;
        const pos = part.position, index = part.index, boxes = part.featureBoxes;
        for (let f = 0; f < part.featureTriStart.length - 1; f++) {
          if (!visible(view, f)) continue;
          box.min.set(boxes[f * 6], boxes[f * 6 + 1], boxes[f * 6 + 2]);
          box.max.set(boxes[f * 6 + 3], boxes[f * 6 + 4], boxes[f * 6 + 5]);
          if (!ray.intersectsBox(box)) continue;
          for (let k = part.featureTriStart[f]; k < part.featureTriStart[f + 1]; k++) {
            const t = part.featureTris[k] * 3;
            va.fromArray(pos, index[t] * 3);
            vb.fromArray(pos, index[t + 1] * 3);
            vc.fromArray(pos, index[t + 2] * 3);
            if (!ray.intersectTriangle(va, vb, vc, false, hit)) continue;
            const d = hit.distanceToSquared(ray.origin);
            if (d < bestDistance) { bestDistance = d; best = { view, feature: f }; }
          }
        }
      }
    }
    return best;
  }
}
