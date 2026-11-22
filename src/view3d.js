// 3D view of the game map. Same town data, borders, colours and replay frames as the 2D canvas
// in game-view.js, on the real terrain: the map is draped over an elevation grid of the town
// (data/terrain.bin) and everything stands on it. Order homes are the real OpenStreetMap
// footprints at each customer address.
//
// Loading is built for slow phones as much as for desktops:
//  - the ~54k background buildings and the roads are built in module workers (src/city-stream.js)
//    from the compact data/buildings.bin, nearest chunks first, and arrive as quantized,
//    indexed typed arrays that go straight to the GPU; the page keeps no second copy
//  - every building stays resident once built: no level of detail, no hiding, no swapping;
//    off-screen chunks are simply skipped by the GPU (frustum culling)
//  - trees are baked (data/trees.bin), the delivery homes are one mesh per material, and a
//    lighter quality tier (no shadows, lower resolution) is picked on phones and small machines
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, HEADS, INK as TRUCK_INK, SHELL, EDGE, WOOD, LAMP, mix, light, face } from './looks.js';
import { BASE, createBuildings } from './buildings3d.js?v=30';
import { forestPath } from './forest.js?v=30';
import { streamCity } from './city-stream.js?v=30';
import { buildLandmarks, landmarkClearance, landmarkTop } from './landmarks.js?v=30';
import { LIFT, M, RELIEF, UV_SCALE, createDecks, createFrame, readBuildings } from './world-build.js?v=30';

const PALETTE = {
  ground: '#f0e9d8', side: '#e2d6bb', base: '#cfc1a2', green: '#c9d8ac', water: '#86b8c5',
  lane: '#ded4bd', streetCase: '#d0c4aa', majorCase: '#bca989', street: '#ffffff', major: '#fff7e5',
  home: '#b5a489', homeWall: '#f1e7d0', town: '#ebe3d2', open: '#fff5da', openEdge: '#735536',
};
const ROAD_COLOURS = [PALETTE.lane, PALETTE.streetCase, PALETTE.majorCase, PALETTE.street, PALETTE.major];
const TILT = 0.74;                // default camera tilt from straight down (radians, ~42°)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
// Free the page's copy of static geometry once it is on the GPU (it is never read back).
function gpuOnly(attribute) { attribute.onUpload(function () { this.array = null; }); return attribute; }

/**
 * 'low' on phones, small tablets and machines with few cores or little memory: no shadows, a
 * 2048 px ground texture, no MSAA and at most 1.25x resolution. `?quality=low|high` overrides.
 */
export function pickQuality() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  const memory = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  return phone || memory <= 4 || cores <= 4 ? 'low' : 'high';
}

export async function createWorld3d(opts) {
  const { host, overlay: ctx, view, town, game, play, wx, wy, truckAt, labels } = opts;
  const grab = opts.grab || ((url, kind) => fetch(url).then(res => { if (!res.ok) throw new Error(`${url}: ${res.status}`); return res[kind](); }));
  let forest = opts.trees?.forest || opts.forest || [];
  let parkSpots = opts.trees?.parks || [];
  const low = (opts.quality || pickQuality()) === 'low';
  let picks = [];                           // this frame's clickable shops and order houses, in screen pixels
  const { OPEN, DELIVERED, PARKED, TRAIL, POP_TICKS, INK } = opts.constants;
  const [relief, heightBuffer, buildingBuffer, homeData, landmarkData] = await Promise.all([
    grab('data/terrain.json?v=30', 'json'),
    grab('data/terrain.bin?v=30', 'arrayBuffer'),
    grab('data/buildings.bin?v=30', 'arrayBuffer'),
    grab('data/homes.json?v=30', 'json'),
    grab('data/landmarks.json?v=30', 'json').catch(() => null),
  ]);
  const heights = new Uint16Array(heightBuffer);
  // Setup runs in short steps with a breath in between, so the page keeps answering (the 2D map
  // stays live underneath) instead of freezing for the whole build.
  const pass = () => new Promise(resolve => setTimeout(resolve, 0));

  // ---- renderer, scene, camera ------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(low ? 1.25 : 1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#f6f3ef');
  host.appendChild(renderer.domElement);
  // The building buffers live only on the GPU; if the browser drops the context, rebuild by reloading.
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); opts.onContextLost?.(); });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
  scene.fog = new THREE.Fog('#f6f3ef', 6000, 14000);

  const PI = Math.PI;
  const hemi = new THREE.HemisphereLight('#fffaf0', '#d9cdb4', 1.25 * PI * .5);
  const sun = new THREE.DirectionalLight('#fff9ef', 1.05 * PI * .5);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  const SUN_DIR = new THREE.Vector3(-0.45, 1, 0.6).normalize();

  // ---- world extents: exactly the game map's bounds -----------------------------
  const [b0, b1, b2, b3] = town.bounds;
  const X0 = wx(b0), X1 = wx(b2), Z0 = wy(b3), Z1 = wy(b1);
  const W = X1 - X0, D = Z1 - Z0, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;

  // ---- terrain: elevation grid over exactly these bounds (row 0 north, column 0 west) ----
  const { cols, rows } = relief;
  const terrain = { bounds: town.bounds, cols, rows, heights };
  const { heightAt, gridY } = createFrame(terrain);
  const PEAK = (relief.top - relief.base) * M * RELIEF;

  const flat = (colour, order, extraOpts = {}) => new THREE.MeshBasicMaterial({ color: colour, depthWrite: false, side: THREE.DoubleSide, ...extraOpts });
  // Draped layers sit on the terrain: no depth writes, pulled towards the camera so they win over it.
  const draped = (colour, extraOpts = {}) => new THREE.MeshLambertMaterial({ color: colour, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...extraOpts });
  const lit = colour => new THREE.MeshLambertMaterial({ color: colour });
  const litBoth = colour => new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide });

  // Ground: the 2D map's paper, green areas and water, painted into a texture and draped over the
  // elevation grid. Lit, so the hills shade themselves; flat ground keeps its 2D colour.
  const tex = groundTexture();
  // The terrain grid as one indexed mesh, written straight into typed arrays (same vertex order,
  // uv and winding as PlaneGeometry(W, D, cols - 1, rows - 1).rotateX(-PI / 2), in world position),
  // with normals from central differences of the height grid.
  const groundGeo = new THREE.BufferGeometry();
  {
    const n = cols * rows, dx = W / (cols - 1), dz = D / (rows - 1);
    const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      position[i * 3] = X0 + c * dx; position[i * 3 + 1] = gridY(i); position[i * 3 + 2] = Z0 + r * dz;
      uv[i * 2] = c / (cols - 1); uv[i * 2 + 1] = 1 - r / (rows - 1);
      const l = Math.max(0, c - 1), rr = Math.min(cols - 1, c + 1), u = Math.max(0, r - 1), d = Math.min(rows - 1, r + 1);
      const nx = (gridY(r * cols + l) - gridY(r * cols + rr)) / ((rr - l) * dx), nz = (gridY(u * cols + c) - gridY(d * cols + c)) / ((d - u) * dz);
      const len = Math.hypot(nx, 1, nz);
      normal[i * 3] = nx / len; normal[i * 3 + 1] = 1 / len; normal[i * 3 + 2] = nz / len;
    }
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = (r + 1) * cols + c, cc = (r + 1) * cols + c + 1, d = r * cols + c + 1;
      index[k++] = a; index[k++] = b; index[k++] = d; index[k++] = b; index[k++] = cc; index[k++] = d;
    }
    groundGeo.setAttribute('position', gpuOnly(new THREE.BufferAttribute(position, 3)));
    groundGeo.setAttribute('normal', gpuOnly(new THREE.BufferAttribute(normal, 3)));
    groundGeo.setAttribute('uv', gpuOnly(new THREE.BufferAttribute(uv, 2)));
    groundGeo.setIndex(gpuOnly(new THREE.BufferAttribute(index, 1)));
    groundGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(CX, PEAK / 2, CZ), Math.hypot(W / 2, D / 2, PEAK / 2) + 1);
  }
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: tex }));
  ground.receiveShadow = true;
  ground.renderOrder = 1;
  scene.add(ground);

  // The board's edge: a skirt from the terrain's edge down to a level base, so the hills read in section.
  const SLAB = 26;
  {
    const pos = [], edge = [];
    for (let c = 0; c < cols; c++) edge.push([c, 0]);
    for (let r = 1; r < rows; r++) edge.push([cols - 1, r]);
    for (let c = cols - 2; c >= 0; c--) edge.push([c, rows - 1]);
    for (let r = rows - 2; r >= 0; r--) edge.push([0, r]);
    const at = ([c, r]) => [X0 + c / (cols - 1) * W, gridY(r * cols + c), Z0 + r / (rows - 1) * D];
    for (let i = 0; i < edge.length; i++) {
      const [ax, ay, az] = at(edge[i]), [bx, by, bz] = at(edge[(i + 1) % edge.length]);
      pos.push(ax, ay, az, bx, by, bz, bx, -SLAB, bz, ax, ay, az, bx, -SLAB, bz, ax, -SLAB, az);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const skirt = new THREE.Mesh(geo, litBoth(PALETTE.side));
    skirt.receiveShadow = true;
    scene.add(skirt);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), lit(PALETTE.base));
    base.position.set(CX, -SLAB, CZ);
    scene.add(base);
  }

  // the 2D map has already traced these (same world units): reuse its paths
  function area(list) { return (list === town.water && opts.paths?.water) || (list === town.green && opts.paths?.green) || trace(list); }
  function trace(list) {
    const path = new Path2D();
    for (const p of list) { path.moveTo(wx(p[0]), wy(p[1])); for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1])); path.closePath(); }
    return path;
  }

  function groundTexture() {
    const longSide = Math.min(low ? 2048 : 4096, renderer.capabilities.maxTextureSize);
    const k = longSide / Math.max(W, D);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(D * k);
    const g = canvas.getContext('2d');
    g.fillStyle = PALETTE.ground;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(k, 0, 0, k, -X0 * k, -Z0 * k);
    g.fillStyle = PALETTE.green;
    g.fill(area(town.green));
    if (forest.length) g.fill(opts.paths?.forest || forestPath(forest));
    g.fillStyle = PALETTE.water;
    g.fill(area(town.water));
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // a 4096 px canvas is ~60 MB: let it go once the GPU has the texture
    t.onUpdate = () => { canvas.width = canvas.height = 1; t.onUpdate = null; };
    return t;
  }

  // Roads: the same five strokes as 2D (casing under fill), as flat ribbons with round joins, built
  // in the city workers (buildRoads in src/world-build.js) once the bridges are known. One mesh per
  // stroke per chunk; the strokes draw in order (renderOrder 2-6) so casings stay under fills.
  const roadMaterials = ROAD_COLOURS.map(colour => draped(colour));

  await pass();

  // ---- buildings ------------------------------------------------------------------
  // Buildings under a shop (often the real store) make way for the shop model, as on the 2D map;
  // tools/bake_buildings.mjs already left those footprints out of data/buildings.bin.
  const cartoon = createBuildings({ heightAt, wx, wy, M, LIFT });
  const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // wall materials multiply by 1 / BASE so the facade texture's plain grey shows the wall's true colour
  const wallTint = new THREE.Color().setScalar(1 / BASE);
  // The baked chunks store facade uv as int16 / UV_SCALE: same images, scaled texture transform.
  const chunkWallMats = {};
  for (const [style, texture] of Object.entries(cartoon.textures)) {
    const t = texture.clone();
    t.repeat.set(1 / UV_SCALE, 1 / UV_SCALE);
    chunkWallMats[style] = new THREE.MeshLambertMaterial({ map: t, color: wallTint, vertexColors: true, side: THREE.DoubleSide });
  }
  // own material for the chunks' trim: their uint8 x4 colours compile a different shader variant
  const chunkTrimMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const buildingStats = { count: 0, total: 0, vertices: 0, triangles: 0, contextDrawCalls: 0, gpuBytes: 0, chunks: 0, ms: 0, workers: 0 };

  // One quantized chunk mesh from the workers -> a resident mesh. Positions are int16 around the
  // mesh's centre with one uniform scale, so the mesh's transform puts them back in place.
  function chunkMesh(m, material, renderOrder) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', gpuOnly(new THREE.BufferAttribute(m.position, 4)));
    geo.setAttribute('normal', gpuOnly(new THREE.BufferAttribute(m.normal, 4, true)));
    if (m.color) geo.setAttribute('color', gpuOnly(new THREE.BufferAttribute(m.color, 4, true)));
    if (m.uv) geo.setAttribute('uv', gpuOnly(new THREE.BufferAttribute(m.uv, 2)));
    geo.setIndex(gpuOnly(new THREE.BufferAttribute(m.index, 1)));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), m.radius);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.fromArray(m.center);
    mesh.scale.setScalar(m.scale);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    return mesh;
  }
  const byteSize = m => m.position.byteLength + m.normal.byteLength + m.index.byteLength + (m.color?.byteLength || 0) + (m.uv?.byteLength || 0);

  // Delivery homes: the same cartoon builder, all in one mesh per material (instead of three draw
  // calls per home). An order recolours that home's walls and roof through its vertex colours.
  // A delivery address inside a landmark (the City Hall is one) keeps its pin and ring on the
  // landmark, but the landmark stands for its building.
  const homeOut = { walls: {}, roof: cartoon.bucket(), trim: cartoon.bucket(), plain: true };
  const insideLandmark = landmarkData ? landmarkTop(landmarkData, wx, wy) : () => null;
  const homes = homeData.homes.map((home, i) => {
    const wallsBefore = Object.fromEntries(Object.entries(homeOut.walls).map(([k, b]) => [k, b.vertices]));
    const roofBefore = homeOut.roof.vertices;
    const landmarkHeight = insideLandmark(wx(home.p[0]), wy(home.p[1]));
    let { pts, top, style } = landmarkHeight === null ? cartoon.build(home.ring, Math.max(7, home.h), home.info || ['house'], 100000 + i, homeOut, home.hidden || null)
      : { pts: home.ring.reduce((list, v, k) => (k % 2 ? list : [...list, [wx(v), wy(home.ring[k + 1])]]), []), top: 0, style: null };
    if (landmarkHeight !== null) top = heightAt(wx(home.p[0]), wy(home.p[1])) + landmarkHeight * M * LIFT;
    let cx = 0, cz = 0, r = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; }
    cx /= pts.length; cz /= pts.length;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cz));
    const ringGeo = new THREE.RingGeometry(.01, r + 9, 40, 4).rotateX(-Math.PI / 2).translate(cx, 0, cz);
    const rp = ringGeo.attributes.position;
    for (let v = 0; v < rp.count; v++) rp.setY(v, heightAt(rp.getX(v), rp.getZ(v)) + .9);
    // forceSinglePass: a flat overlay needs no back-then-front pass (three's default for transparent
    // double-sided materials, which also recompiles-checks the material twice per frame)
    const ring = new THREE.Mesh(ringGeo, flat('#ffffff', 0, { transparent: true, opacity: .55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, forceSinglePass: true }));
    ring.renderOrder = 9;
    ring.visible = false;
    scene.add(ring);
    const pin = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, sizeAttenuation: false }));
    pin.center.set(.5, 0);
    pin.renderOrder = 50;
    pin.visible = false;
    scene.add(pin);
    return { i, key: `${home.p[0]},${home.p[1]}`, style, walls: style ? [wallsBefore[style] || 0, homeOut.walls[style].vertices] : [0, 0],
      roofs: [roofBefore, homeOut.roof.vertices], ring, pin, x: cx, z: cz, top, state: '' };
  });
  const homeColours = {};                  // part -> dynamic colour attribute
  const homeMeshes = [];
  {
    const add = (bucket, material, part) => {
      const geo = cartoon.geometry(bucket);
      const colour = geo.attributes.color;
      colour.setUsage(THREE.DynamicDrawUsage);
      homeColours[part] = colour;
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.renderOrder = 21;
      scene.add(mesh);
      homeMeshes.push(mesh);
    };
    for (const [style, bucket] of Object.entries(homeOut.walls)) {
      add(bucket, new THREE.MeshLambertMaterial({ map: cartoon.textures[style], color: wallTint, vertexColors: true, side: THREE.DoubleSide }), style);
    }
    add(homeOut.roof, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'roof');
    const trim = new THREE.Mesh(cartoon.geometry(homeOut.trim), trimMat);
    trim.castShadow = trim.receiveShadow = true;
    trim.renderOrder = 21;
    scene.add(trim);
    homeMeshes.push(trim);
  }
  const homeAt = new Map(homes.map(h => [h.key, h]));
  const paintColour = new THREE.Color();
  function setHomeColour(home, wall, roof) {
    const fill = (attribute, [start, end], hex) => {
      paintColour.set(hex);
      for (let v = start; v < end; v++) attribute.setXYZ(v, paintColour.r, paintColour.g, paintColour.b);
      attribute.needsUpdate = true;
    };
    if (!home.style) return;                       // drawn by its landmark
    fill(homeColours[home.style], home.walls, wall);
    fill(homeColours.roof, home.roofs, roof);
  }
  for (const home of homes) setHomeColour(home, PALETTE.homeWall, PALETTE.home);

  // The town's famous buildings and places (src/landmarks.js, data/landmarks.json), e.g. the Opera House, MUNCH, the City Hall, the Royal
  // Palace and more, from their real OSM parts or modelled on their measured footprints. The plain
  // footprints they replace are already left out of data/buildings.bin by the bake.
  const landmarks = landmarkData ? buildLandmarks({ data: landmarkData, heightAt, wx, wy, M, LIFT, scene, wallTint, cartoon }) : { meshes: [], stats: { sites: 0 } };
  if (landmarkData) {
    // the trees were planted before these buildings were in the data: none inside a landmark
    const occupied = landmarkClearance(landmarkData, wx, wy);
    parkSpots = parkSpots.filter(([x, z]) => !occupied(x, z));
    forest = forest.filter(([x, z]) => !occupied(x, z));
  }

  // Pins: the 2D order square (white mark), standing on a little stem, one texture per colour.
  const pinTextures = new Map();
  function pinTexture(fill, edge) {
    const key = fill + edge;
    if (pinTextures.has(key)) return pinTextures.get(key);
    const c = document.createElement('canvas');
    c.width = 64; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = edge;
    g.beginPath(); g.moveTo(24, 58); g.lineTo(40, 58); g.lineTo(32, 92); g.closePath(); g.fill();
    g.fillStyle = edge;
    g.fillRect(6, 6, 52, 52);
    g.fillStyle = fill;
    g.fillRect(12, 12, 40, 40);
    g.fillStyle = edge;
    g.fillRect(28, 19, 8, 18);
    g.fillRect(28, 41, 8, 6);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    pinTextures.set(key, t);
    return t;
  }

  function paintHome(home, s) {
    const key = s ? `${s.status === OPEN ? 'open' : s.owner.seat}|${s.dim}` : '';
    if (key === home.state) return;
    home.state = key;
    if (!s) {
      setHomeColour(home, PALETTE.homeWall, PALETTE.home);
      home.ring.visible = home.pin.visible = false;
      return;
    }
    const open = s.status === OPEN;
    const colour = open ? PALETTE.open : s.owner.colour;
    const fade = c => s.dim < 1 ? mix(c, PALETTE.homeWall, .7) : c;
    setHomeColour(home, fade(open ? PALETTE.open : mix(colour, '#ffffff', .25)), fade(open ? PALETTE.openEdge : colour));
    home.ring.material.color.set(open ? PALETTE.openEdge : colour);
    home.ringBase = (open ? .28 : .45) * s.dim;
    home.ring.material.opacity = home.ringBase;
    home.ring.visible = true;
    home.pin.material.map = open ? pinTexture(PALETTE.open, PALETTE.openEdge) : pinTexture(colour, '#ffffff');
    home.pin.material.opacity = s.dim;
    home.pin.material.needsUpdate = true;
    home.pin.visible = true;
  }

  await pass();

  // ---- water: the 2D water areas as a grid, and which way each river runs --------------
  // Each connected stretch of water flows to its outlet: the lowest cell on the map's edge if it
  // reaches the edge, else its lowest cell. A breadth-first distance from the outlet, followed
  // downhill and smoothed, gives a direction everywhere on the water, tributaries included.
  const WC = 6, wcols = Math.ceil(W / WC), wrows = Math.ceil(D / WC);
  const water = new Uint8Array(wcols * wrows);
  {
    const c = document.createElement('canvas');
    c.width = wcols; c.height = wrows;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / WC, 0, 0, 1 / WC, -X0 / WC, -Z0 / WC);
    g.fillStyle = '#000';
    g.fill(area(town.water));
    const px = g.getImageData(0, 0, wcols, wrows).data;
    for (let i = 0; i < water.length; i++) water[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  }
  const cellOf = (x, z) => {
    const c = Math.floor((x - X0) / WC), r = Math.floor((z - Z0) / WC);
    return c < 0 || r < 0 || c >= wcols || r >= wrows ? -1 : r * wcols + c;
  };
  const isWater = (x, z) => { const i = cellOf(x, z); return i >= 0 && water[i] === 1; };
  const cellX = i => X0 + (i % wcols + .5) * WC, cellZ = i => Z0 + (Math.floor(i / wcols) + .5) * WC;
  const flowX = new Float32Array(water.length), flowZ = new Float32Array(water.length), flowSpeed = new Float32Array(water.length);
  const flowing = [];                       // cells of rivers big enough to show a current
  // Sea and fjords (coastal towns): water within 2 m of sea level is still, and is where rivers end.
  // Inland towns (Kongsberg's lowest point is 123 m) never have such cells.
  const SEA = (2 - relief.base) * M * RELIEF;
  const atSea = i => heightAt(cellX(i), cellZ(i)) < SEA;
  {
    const label = new Int32Array(water.length).fill(-1), dist = new Float32Array(water.length).fill(Infinity);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const around = (i, fn) => {
      const c = i % wcols, r = (i - c) / wcols;
      for (const [dc, dr] of N4) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < wcols && rr < wrows) fn(rr * wcols + cc); }
    };
    let comp = 0;
    for (let start = 0; start < water.length; start++) {
      if (!water[start] || label[start] >= 0) continue;
      const cells = [start];
      label[start] = comp;
      for (let h = 0; h < cells.length; h++) around(cells[h], j => { if (water[j] && label[j] < 0) { label[j] = comp; cells.push(j); } });
      comp++;
      if (cells.length < 120) continue;     // ponds stay still
      const sea = cells.filter(atSea);
      const edge = cells.filter(i => { const c = i % wcols, r = (i - c) / wcols; return c === 0 || r === 0 || c === wcols - 1 || r === wrows - 1; });
      const pool = edge.length ? edge : cells;
      let low = Infinity;
      for (const i of pool) low = Math.min(low, heightAt(cellX(i), cellZ(i)));
      const queue = sea.length ? sea : pool.filter(i => heightAt(cellX(i), cellZ(i)) < low + 1.5);
      for (const i of queue) dist[i] = 0;
      for (let h = 0; h < queue.length; h++) around(queue[h], j => { if (label[j] === label[queue[h]] && dist[j] === Infinity) { dist[j] = dist[queue[h]] + 1; queue.push(j); } });
      for (const i of cells) {
        if (dist[i] === Infinity || (sea.length && dist[i] === 0)) continue;   // the sea itself stays still
        const d = j => (j >= 0 && water[j] && dist[j] < Infinity ? dist[j] : dist[i]);
        const c = i % wcols;
        flowX[i] = d(c > 0 ? i - 1 : -1) - d(c < wcols - 1 ? i + 1 : -1);
        flowZ[i] = d(i - wcols) - d(i + wcols < water.length ? i + wcols : -1);
        flowing.push(i);
      }
    }
    // smooth the directions so the current bends with the banks instead of zig-zagging
    for (let pass = 0; pass < 4; pass++) {
      const sx = new Float32Array(flowX), sz = new Float32Array(flowZ);
      for (const i of flowing) {
        let ax = 0, az = 0;
        const c = i % wcols, r = (i - c) / wcols;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= wcols || rr >= wrows) continue;
          const j = rr * wcols + cc;
          if (water[j]) { ax += sx[j]; az += sz[j]; }
        }
        flowX[i] = ax; flowZ[i] = az;
      }
    }
    for (const i of flowing) {
      const len = Math.hypot(flowX[i], flowZ[i]) || 1;
      flowX[i] /= len; flowZ[i] /= len;
      // faster where the river drops (rapids and Nybrufossen), from the slope along the current
      const x = cellX(i), z = cellZ(i), drop = (heightAt(x - flowX[i] * 12, z - flowZ[i] * 12) - heightAt(x + flowX[i] * 12, z + flowZ[i] * 12)) / 24;
      flowSpeed[i] = clamp(1 + drop * 22, 1, 4);
    }
  }

  await pass();

  // ---- bridges: where a road crosses water it runs on a straight deck between the banks ----
  // Each road line is sampled every 3 units; a run of water samples becomes a bridge from just
  // before it to just after it. The deck stays clear of the water, ramps onto the banks, and gets a
  // slab, railings with posts and a pier or two. Roads, trucks and trails use roadY, so they cross on it.
  const bridges = [];
  {
    const HALF = { major: 11, street: 7.5, lane: 3 };
    // the same 3-unit samples, without building a list: most lines never touch water
    const touchesWater = line => {
      for (let i = 2; i < line.length; i += 2) {
        const ax = wx(line[i - 2]), az = wy(line[i - 1]), bx = wx(line[i]), bz = wy(line[i + 1]);
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
        for (let k = i === 2 ? 0 : 1; k <= n; k++) if (isWater(ax + (bx - ax) * k / n, az + (bz - az) * k / n)) return true;
      }
      return false;
    };
    for (const kind of ['major', 'street', 'lane']) for (const line of town.roads[kind]) {
      if (!touchesWater(line)) continue;
      const samples = [];
      for (let i = 2; i < line.length; i += 2) {
        const ax = wx(line[i - 2]), az = wy(line[i - 1]), bx = wx(line[i]), bz = wy(line[i + 1]);
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
        for (let k = i === 2 ? 0 : 1; k <= n; k++) {
          const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
          samples.push({ x, z, wet: isWater(x, z) });
        }
      }
      for (let i = 0; i < samples.length; i++) {
        if (!samples[i].wet) continue;
        let j = i;
        while (j + 1 < samples.length && (samples[j + 1].wet || (j + 2 < samples.length && samples[j + 2].wet))) j++;
        const a = samples[Math.max(0, i - 2)], b = samples[Math.min(samples.length - 1, j + 2)];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length >= 10 && length <= 320) {
          let low = Infinity;
          for (let k = i; k <= j; k++) low = Math.min(low, heightAt(samples[k].x, samples[k].z));
          const clear = low + 5.5 * M * RELIEF;
          const br = { ax: a.x, az: a.z, bx: b.x, bz: b.z, length, half: HALF[kind], kind, low,
            deckA: Math.max(heightAt(a.x, a.z), clear), deckB: Math.max(heightAt(b.x, b.z), clear) };
          // the two carriageways of one road are two lines: make them one wider deck
          const twin = bridges.find(o => {
            const mx = (o.ax + o.bx) / 2 - (br.ax + br.bx) / 2, mz = (o.az + o.bz) / 2 - (br.az + br.bz) / 2;
            const dot = ((o.bx - o.ax) * (br.bx - br.ax) + (o.bz - o.az) * (br.bz - br.az)) / (o.length * br.length);
            return Math.hypot(mx, mz) < 24 && Math.abs(dot) > .9;
          });
          if (twin) {
            const flip = (twin.bx - twin.ax) * (br.bx - br.ax) + (twin.bz - twin.az) * (br.bz - br.az) < 0;
            const [px, pz, qx, qz] = flip ? [br.bx, br.bz, br.ax, br.az] : [br.ax, br.az, br.bx, br.bz];
            const gap = Math.abs(((px + qx) / 2 - (twin.ax + twin.bx) / 2) * -(twin.bz - twin.az) + ((pz + qz) / 2 - (twin.az + twin.bz) / 2) * (twin.bx - twin.ax)) / twin.length;
            Object.assign(twin, { ax: (twin.ax + px) / 2, az: (twin.az + pz) / 2, bx: (twin.bx + qx) / 2, bz: (twin.bz + qz) / 2,
              half: Math.max(twin.half, br.half) + gap / 2, low: Math.min(twin.low, br.low), deckA: Math.max(twin.deckA, flip ? br.deckB : br.deckA), deckB: Math.max(twin.deckB, flip ? br.deckA : br.deckB) });
            twin.length = Math.hypot(twin.bx - twin.ax, twin.bz - twin.az);
          } else bridges.push(br);
        }
        i = j;
      }
    }
  }
  const { roadY } = createDecks(bridges, heightAt);
  {
    const deckMat = lit('#d9d1c3'), railMat = lit('#f4efe6'), postMat = lit('#9a8b78'), pierMat = lit('#c3b9aa');
    const parts = { deck: [], rail: [], post: [], pier: [] };
    // a straight beam between two points, with its own heights at each end (a sloped box)
    const beam = (out, ax, az, bx, bz, width, ya, yb, depth) => {
      const len = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / len * width / 2, nz = (bx - ax) / len * width / 2;
      const c = [[ax + nx, az + nz, ya], [bx + nx, bz + nz, yb], [bx - nx, bz - nz, yb], [ax - nx, az - nz, ya]];
      const top = c.map(([x, z, y]) => [x, y, z]), bot = c.map(([x, z, y]) => [x, y - depth, z]);
      const quad = (p, q, r, t) => out.push(...p, ...q, ...r, ...p, ...r, ...t);
      quad(top[0], top[1], top[2], top[3]); quad(bot[3], bot[2], bot[1], bot[0]);
      for (let k = 0; k < 4; k++) quad(top[k], bot[k], bot[(k + 1) % 4], top[(k + 1) % 4]);
    };
    for (const br of bridges) {
      const dx = (br.bx - br.ax) / br.length, dz = (br.bz - br.az) / br.length, nx = -dz, nz = dx;
      const w = br.half * 2 + 2.5, edge = br.half + .9, railH = br.kind === 'lane' ? 2.4 : 2.8;
      beam(parts.deck, br.ax, br.az, br.bx, br.bz, w, br.deckA + .2, br.deckB + .2, 2.4);
      for (const sgn of [-1, 1]) {
        const ox = nx * edge * sgn, oz = nz * edge * sgn;
        beam(parts.rail, br.ax + ox, br.az + oz, br.bx + ox, br.bz + oz, .6, br.deckA + railH, br.deckB + railH, .6);
        const posts = Math.max(2, Math.round(br.length / 9));
        for (let k = 0; k <= posts; k++) {
          const t = k / posts, x = br.ax + (br.bx - br.ax) * t + ox, z = br.az + (br.bz - br.az) * t + oz, y = br.deckA + (br.deckB - br.deckA) * t;
          beam(parts.post, x - dx * .35, z - dz * .35, x + dx * .35, z + dz * .35, .7, y + railH, y + railH, railH);
        }
      }
      // piers down to the water, one per ~45 units of span
      const piers = Math.floor(br.length / 45);
      for (let k = 1; k <= piers; k++) {
        const t = k / (piers + 1), x = br.ax + (br.bx - br.ax) * t, z = br.az + (br.bz - br.az) * t, y = br.deckA + (br.deckB - br.deckA) * t - 2.2;
        beam(parts.pier, x - dx * 1.6, z - dz * 1.6, x + dx * 1.6, z + dz * 1.6, w * .7, y, y, y - br.low + 3);
      }
    }
    for (const [key, mat] of [['deck', deckMat], ['rail', railMat], ['post', postMat], ['pier', pierMat]]) {
      if (!parts[key].length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(parts[key], 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.renderOrder = 1;          // before the roads (2-6), which then lie on the deck
      scene.add(mesh);
    }
  }

  // ---- the city: roads and every building, built in workers, nearest chunks first ------------
  const { header: buildingHeader } = readBuildings(buildingBuffer);
  buildingStats.total = buildingHeader.count;
  let cityChanged = false, cityDone = false;
  const roadStats = { meshes: 0, vertices: 0, triangles: 0, gpuBytes: 0 };
  function startFocus() {
    if (view.touched) {
      const wide = view.w > 760, p = { l: wide ? 44 : 30, t: 104, r: wide ? 334 : 30, b: wide ? 92 : Math.min(40 + 52 * game.players.length, view.h * .34) + 101 };
      const cx = p.l + (view.w - p.l - p.r) / 2, cy = p.t + (view.h - p.t - p.b) / 2;
      return [(cx - view.x) / view.scale, (cy - view.y) / view.scale];
    }
    const xs = game.players.map(p => p.shop[0]), zs = game.players.map(p => p.shop[1]);
    const r = region();
    return town.coverage?.kind === 'distributed-city-match' ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] : [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
  }
  const cityReady = (async () => {
    const grid = buildingHeader.grid, [fx, fz] = startFocus();
    const order = buildingHeader.chunks.map(([, count], chunk) => ({ chunk, count,
      d: Math.hypot(X0 + (chunk % grid + .5) * W / grid - fx, Z0 + (Math.floor(chunk / grid) + .5) * D / grid - fz) }))
      .filter(c => c.count).sort((p, q) => p.d - q.d);
    const result = await streamCity({
      terrain, buildings: buildingBuffer,
      jobs: [{ type: 'roads', roads: town.roads, bridges }, ...order.map(({ chunk }) => ({ type: 'chunk', chunk }))],
      onResult(message) {
        if (message.type === 'roads') {
          for (const m of message.meshes) {
            const mesh = chunkMesh(m, roadMaterials[m.layer], 2 + m.layer);
            mesh.receiveShadow = true;
            roadStats.meshes++; roadStats.vertices += m.vertices; roadStats.triangles += m.triangles; roadStats.gpuBytes += byteSize(m);
          }
        } else {
          for (const m of message.meshes) {
            const mesh = chunkMesh(m, m.part === 'walls' ? chunkWallMats[m.style] : chunkTrimMat, 20);
            mesh.castShadow = mesh.receiveShadow = true;
            mesh.userData.buildingDetail = 'all-resident';
            buildingStats.contextDrawCalls++;
            buildingStats.vertices += m.vertices;
            buildingStats.triangles += m.triangles;
            buildingStats.gpuBytes += byteSize(m);
          }
          buildingStats.count += message.count;
          buildingStats.chunks++;
        }
        cityChanged = true;
        opts.onProgress?.(buildingStats.count, buildingStats.total);
      },
    });
    buildingStats.ms = Math.round(result.ms);
    buildingStats.workers = result.workers;
    cityDone = true;
    return buildingStats;
  })();

  // Current: short streaks drifting downstream, bright at the head and fading to the tail.
  const STREAKS = Math.min(1400, Math.round(flowing.length / 6));
  const streaks = Array.from({ length: STREAKS }, () => ({ x: 0, z: 0, age: 0, life: 1 }));
  let seedW = 11;
  const randW = () => (seedW = (seedW * 16807) % 2147483647) / 2147483647;
  const respawn = (p, spread = false) => {
    const i = flowing[Math.floor(randW() * flowing.length)];
    p.x = cellX(i) + (randW() - .5) * WC; p.z = cellZ(i) + (randW() - .5) * WC;
    p.life = 1.6 + randW() * 2.4;
    p.age = spread ? randW() * p.life : 0;
  };
  for (const p of streaks) respawn(p, true);
  const streakGeo = new THREE.BufferGeometry();
  const streakPos = new Float32Array(STREAKS * 6 * 3), streakCol = new Float32Array(STREAKS * 6 * 4);
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 4));
  const streakMesh = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, forceSinglePass: true }));
  streakMesh.renderOrder = 8;
  streakMesh.frustumCulled = false;
  if (STREAKS) scene.add(streakMesh);

  function flowWater(dt, scale) {
    let v = 0, q = 0;
    const put = (x, y, z, a) => { streakPos[v * 3] = x; streakPos[v * 3 + 1] = y; streakPos[v * 3 + 2] = z; streakCol[v * 4] = .93; streakCol[v * 4 + 1] = .97; streakCol[v * 4 + 2] = .98; streakCol[v * 4 + 3] = a; v++; };
    for (const p of streaks) {
      p.age += dt;
      let i = cellOf(p.x, p.z);
      if (p.age > p.life || i < 0 || !water[i] || !flowSpeed[i]) { respawn(p); i = cellOf(p.x, p.z); }
      const speed = 13 * flowSpeed[i];
      p.x += flowX[i] * speed * dt;
      p.z += flowZ[i] * speed * dt;
      const len = (12 + speed * 1.1) * scale, half = (.75 + flowSpeed[i] * .2) * scale;
      const fx = flowX[i], fz = flowZ[i], nx = -fz * half, nz = fx * half;
      const tx = p.x - fx * len, tz = p.z - fz * len, a = Math.sin(Math.PI * clamp(p.age / p.life, 0, 1)) * Math.min(.9, .6 + flowSpeed[i] * .1);
      const hy = heightAt(p.x, p.z) + 1.1, ty = heightAt(tx, tz) + 1.1;
      // a tapered dash with a small arrowhead: tail transparent, head bright, tip pointing downstream
      put(p.x + nx, hy, p.z + nz, a); put(p.x - nx, hy, p.z - nz, a); put(tx, ty, tz, 0);
      put(p.x + nx * 2.4, hy, p.z + nz * 2.4, a); put(p.x - nx * 2.4, hy, p.z - nz * 2.4, a); put(p.x + fx * half * 4, hy, p.z + fz * half * 4, a);
      q++;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakGeo.attributes.color.needsUpdate = true;
  }

  await pass();

  // ---- reference-style park trees and spruce/birch woodland --------------------------
  // Both planted once by tools/bake_trees.cjs (data/trees.bin, see src/forest.js): park trees in
  // mapped parks, forest on OSM woodland and empty land away from town. One instanced mesh each.
  const parkTreeCount = parkSpots.length, forestTreeCount = forest.length;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), size = new THREE.Vector3();
    const plant = (list, crownGeo, trunkGeo, trunkColour, shades, stretch) => {
      if (!list.length) return;
      const trunks = new THREE.InstancedMesh(trunkGeo, lit(trunkColour), list.length);
      const crowns = new THREE.InstancedMesh(crownGeo, lit('#ffffff'), list.length);
      const colours = shades.map(c => new THREE.Color(c));
      list.forEach(([x, z, sc, r], i) => {
        q.setFromAxisAngle(up, r * 6.28);
        m.compose(at.set(x, heightAt(x, z) - .5, z), q, size.set(sc, stretch ? sc * (.9 + r * .35) : sc, sc));
        trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
        crowns.setColorAt(i, colours[i % colours.length]);
      });
      // they cover the whole city anyway: skip the per-instance bounding sphere and culling test
      for (const mesh of [trunks, crowns]) { mesh.castShadow = true; mesh.renderOrder = 22; mesh.frustumCulled = false; scene.add(mesh); }
    };
    plant(parkSpots, new THREE.IcosahedronGeometry(6, 0).translate(0, 10, 0), new THREE.CylinderGeometry(.9, 1.2, 6, 5).translate(0, 3, 0),
      '#8a6d4f', ['#9dbb7c', '#8db06f', '#a9c48a', '#7fa565'], false);
    plant(forest.filter(t => t[4]), new THREE.ConeGeometry(4.4, 13, 6).translate(0, 10, 0),
      new THREE.CylinderGeometry(.6, .8, 4, 4).translate(0, 2, 0), '#7d6450', ['#6b8f5c', '#5f8553', '#779a69', '#668a58'], true);
    plant(forest.filter(t => !t[4]), new THREE.IcosahedronGeometry(5, 0).translate(0, 9, 0),
      new THREE.CylinderGeometry(.6, .8, 6, 4).translate(0, 3, 0), '#7d6450', ['#9dbb7c', '#a9c48a', '#93b574'], true);
  }

  // ---- shops: the 2D shop drawing, built as a little supermarket ----------------------
  const signTexture = new THREE.TextureLoader().load('assets/grocery-bot-shop.svg');
  signTexture.colorSpace = THREE.SRGBColorSpace;
  signTexture.anisotropy = 8;

  function box(w, h, d, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildShop(player) {
    const store = game.meta.players[player.seat].store;
    if (store?.footprint) {
      const out = { walls: {}, roof: cartoon.bucket(), trim: cartoon.bucket(), plain: true };
      const { top, pts, style } = cartoon.build(store.footprint.ring, Math.max(6, store.footprint.h), store.footprint.info || ['retail', '', '', ''], 900000 + player.seat, out);
      const wall = new THREE.MeshLambertMaterial({ color: new THREE.Color(mix(player.colour, '#ffffff', .62)).multiply(wallTint), map: cartoon.textures[style], vertexColors: true, side: THREE.DoubleSide });
      const roof = new THREE.MeshLambertMaterial({ color: player.colour, vertexColors: true, side: THREE.DoubleSide });
      const geometry = cartoon.geometry(out.walls[style], out.roof, out.trim);
      geometry.translate(-player.shop[0], -heightAt(player.shop[0], player.shop[1]), -player.shop[1]);
      const mesh = new THREE.Mesh(geometry, [wall, roof, trimMat]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.renderOrder = 30;
      const group = new THREE.Group();
      group.add(mesh);
      const radius = Math.max(...pts.map(p => Math.hypot(p[0] - player.shop[0], p[1] - player.shop[1])));
      return { group, mats: [wall, roof], actual: true, top: top - heightAt(player.shop[0], player.shop[1]), radius };
    }
    // 2D: 62 x 34 px body, 6 px roof band, 8 striped awning tiles, window left, door right, sign above.
    const mats = { frame: lit('#583a2d'), wall: lit('#fff3da'), paint: lit(player.colour), glass: lit('#b6d4d7'), door: lit('#65493a'),
      sign: new THREE.MeshLambertMaterial({ map: signTexture }), post: lit('#583a2d') };
    const g = new THREE.Group();
    const w = 62, h = 34, d = 34, front = d / 2;
    g.add(box(w, 1.6, d + 2, mats.frame, 0, .8, 0));                        // plinth
    g.add(box(w - .4, 30, d + 1.6, mats.frame, 0, -15, 0));                 // footing down the slope
    g.add(box(w - 3, h, d - 3, mats.wall, 0, h / 2, 0));                    // cream walls
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(2.4, h, 2.4, mats.frame, sx * (w / 2 - 1.2), h / 2, sz * (d / 2 - 1.2)));
    g.add(box(w + 1, 6, d + 1, mats.paint, 0, h + 3, 0));                   // colour band (the 2D top stripe)
    g.add(box(w + 1, 1.2, d + 1, mats.frame, 0, h + 6.6, 0));               // roof edge
    g.add(box(w - 6, .8, d - 6, mats.frame, 0, h + 6.4, 0));
    // striped awning across the front, 8 tiles alternating player colour and cream
    for (let i = 0; i < 8; i++) {
      const tile = box(w / 8 + .05, .9, 7, i % 2 ? mats.wall : mats.paint, -w / 2 + w / 16 + i * w / 8, h - 1.4, front + 3);
      tile.rotation.x = .5;
      g.add(tile);
    }
    g.add(box(w * .34, h * .42, .8, mats.glass, -w * .2, h * .4, front - 1));  // shop window
    g.add(box(w * .2, h * .62, .8, mats.door, w * .22, h * .31 + 1.6, front - 1));   // door
    // GROCERY BOT sign on two posts, like the 2D sign floating above the roof
    const sign = new THREE.Mesh(new THREE.BoxGeometry(46, 15.3, 1.4), [mats.paint, mats.paint, mats.paint, mats.paint, mats.sign, mats.sign]);
    sign.position.set(0, h + 16, front - 6);
    sign.castShadow = true;
    g.add(sign);
    for (const sx of [-1, 1]) g.add(box(1.6, 9, 1.6, mats.post, sx * 14, h + 9, front - 6));
    g.traverse(o => { if (o.isMesh) o.renderOrder = 30; });
    return { group: g, mats: Object.values(mats) };
  }

  // ---- trucks: the 2D truck art (looks.js) as a model --------------------------------
  const svg = new SVGLoader();
  const extrudeCache = new Map();
  function extrudePath(d, depth) {
    const key = d + depth;
    if (!extrudeCache.has(key)) {
      const shapes = svg.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`).paths.flatMap(p => SVGLoader.createShapes(p));
      // SVG y points down: flip y, and z with it so the faces keep their winding.
      const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 8 }).scale(1, -1, -1).translate(0, 0, depth / 2);
      geo.computeVertexNormals();
      extrudeCache.set(key, geo);
    }
    return extrudeCache.get(key);
  }

  function svgRect(x, y, w, h, depth, material, z = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), material);
    mesh.position.set(x + w / 2, -(y + h / 2), z);
    return mesh;
  }

  function faceTexture(look, paint, tint) {
    const colour = !tint && light(paint) ? '#171412' : '#fff';
    const art = (tint ? `<rect x="-13.5" y="-9.5" width="30" height="19" rx="9.5" fill="${paint === TRUCK_INK ? '#4a423d' : TRUCK_INK}"/>` : '') +
      `<g transform="scale(1.7)">${face(look.eyes, colour)}</g>`;
    const src = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="168" viewBox="-14.5 -10.5 32 21">${art}</svg>`;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 168;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0); t.needsUpdate = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    return t;
  }

  function buildTruck(player) {
    const look = player.look, paint = COLORS[look.color], head = HEADS[look.head], [fx, fy] = head.face;
    const tint = look.visor === 'tint', WIDTH = 50, half = WIDTH / 2;
    const mats = new Map();
    const mat = colour => { if (!mats.has(colour)) mats.set(colour, lit(colour)); return mats.get(colour); };
    const g = new THREE.Group();
    const add = mesh => { mesh.castShadow = false; g.add(mesh); return mesh; };
    const sides = (make) => { for (const s of [-1, 1]) add(make(s)); };

    // decals on both sides of the carriage, like marks.* in looks.js
    const decal = (y, h, x = -72, w = 86) => {
      const c = mat(paint);
      if (look.decal === 'stripe') sides(s => svgRect(x, y + h * .68, w, h * .14, .8, c, s * (half + .4)));
      if (look.decal === 'band') sides(s => svgRect(x, y + h * .3, w, h * .32, .8, c, s * (half + .4)));
      if (look.decal === 'dots') for (const cx of [-52, -29, -6]) sides(s => {
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(7.5, h * .3), Math.min(7.5, h * .3), .8, 20).rotateX(Math.PI / 2), c);
        dot.position.set(cx, -(y + h * .46), s * (half + .4));
        return dot;
      });
    };

    add(svgRect(-74, 16, 144, 7, WIDTH - 6, mat(TRUCK_INK)));                                   // chassis
    const shell = 'M-72 20V-45Q-72 -52 -65 -52H7Q14 -52 14 -45V20Z';
    if (look.carriage === 'box' || look.carriage === 'cooler') {
      add(new THREE.Mesh(extrudePath(shell, WIDTH), mat(SHELL)));
      if (look.carriage === 'cooler') {
        add(svgRect(-34, -61, 28, 11, WIDTH * .55, mat('#d6cfc8')));
        for (const x of [-58, -44, -30, -16, -2]) sides(s => svgRect(x - .8, -46, 1.6, 60, .5, mat(EDGE), s * (half + .25)));
      }
      decal(-52, 72);
    } else if (look.carriage === 'canvas') {
      add(new THREE.Mesh(extrudePath('M-70 8V-34Q-70 -52 -29 -52T12 -34V8Z', WIDTH - 2), mat(mix(paint, '#ffffff', .78))));
      for (const x of [-43, -15]) sides(s => svgRect(x - .7, -50, 1.4, 58, .5, mat(mix(paint, '#ffffff', .5)), s * (half - .6)));
      decal(-34, 42, -70, 82);
      add(svgRect(-72, 6, 86, 14, WIDTH, mat(WOOD)));
    } else {
      add(svgRect(-72, 4, 86, 16, WIDTH, mat(WOOD)));
      const crate = (x, y, w, h, colour, z, d) => add(svgRect(x, y, w, h, d, mat(colour), z));
      crate(-64, -22, 22, 28, COLORS.oat, -9, 26);
      crate(-60, -40, 16, 18, COLORS.lemon, -9, 18);
      crate(-40, -16, 24, 22, COLORS.leaf, 8, 28);
      crate(-14, -8, 18, 14, COLORS.carrot, -4, 34);
      decal(4, 16);
    }

    // cab: the exact head silhouette from looks.js, with the bot's face on both doors
    add(new THREE.Mesh(extrudePath(head.d, WIDTH), mat(paint)));
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture(look, paint, tint), transparent: true });
    for (const s of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(32, 21), faceMat);
      plane.position.set(fx + 1.5, -fy, s * (half + .3));
      if (s < 0) plane.rotation.y = Math.PI;
      g.add(plane);
    }
    if (look.visor === 'shade') add(svgRect(fx - 12, fy - 13, head.brim + 5 - (fx - 12), 5, WIDTH + 3, mat(mix(paint, '#171412', .38))));
    if (look.visor === 'lights') {
      add(svgRect(head.roof - 13, head.top - 6, 26, 7, WIDTH * .7, mat(TRUCK_INK)));
      const lamp = new THREE.MeshLambertMaterial({ color: LAMP, emissive: LAMP, emissiveIntensity: .45 });
      for (const z of [-12, 0, 12]) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 8), lamp);
        bulb.position.set(head.roof, -(head.top - 7), z);
        g.add(bulb);
      }
      mats.set('lamp', lamp);
    }
    add(svgRect(58, 13, 16, 9, WIDTH, mat(TRUCK_INK)));                                       // bumper
    const headlamp = new THREE.MeshLambertMaterial({ color: LAMP, emissive: LAMP, emissiveIntensity: .35 });
    mats.set('headlamp', headlamp);
    for (const z of [-16, 16]) add(svgRect(64, 2, 7.5, 8, 9, headlamp, z));
    // wheels
    const tyre = new THREE.CylinderGeometry(9, 9, 7, 20).rotateX(Math.PI / 2), hub = new THREE.CylinderGeometry(3.6, 3.6, 7.6, 12).rotateX(Math.PI / 2);
    for (const x of [-54, -32, 46]) for (const s of [-1, 1]) {
      const wheel = add(new THREE.Mesh(tyre, mat(TRUCK_INK)));
      wheel.position.set(x, -29, s * (half - 3));
      const cap = new THREE.Mesh(hub, mat('#cfc7c1'));
      cap.position.set(x, -29, s * (half - 3));
      g.add(cap);
    }
    // stand the model on the ground, centred on the 2D sprite's anchor
    g.position.set(-2, 38, 0);
    // A fleet of 60 trucks otherwise submits thousands of tiny cab/wheel/decal
    // meshes. Batch each look by shared material before cloning its five trucks.
    const byMaterial = new Map();
    for (const child of g.children) {
      if (!child.isMesh || Array.isArray(child.material)) continue;
      child.updateMatrix();
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      const key = child.material.uuid;
      if (!byMaterial.has(key)) byMaterial.set(key, { material: child.material, geometries: [] });
      byMaterial.get(key).geometries.push(geometry);
    }
    g.clear();
    const parts = [];
    for (const { material, geometries } of byMaterial.values()) {
      const geometry = mergeGeometries(geometries, false);
      if (!geometry) throw new Error('Could not batch the truck geometry');
      parts.push({ geometry, material });
      for (const part of geometries) part.dispose();
    }
    g.updateMatrix();
    // parts: one merged geometry per material; offset: the model's own placement inside each truck
    return { parts, offset: g.matrix.clone(), mats: [...mats.values(), faceMat] };
  }

  await pass();

  // ---- per-player actors ---------------------------------------------------------
  // trucks a third smaller than before, so they keep to the streets instead of clipping the houses
  const TRUCK_SCALE = .62, SHOP_SCALE = 2.4;
  const players = game.players.map(player => {
    const shop = buildShop(player);
    shop.group.position.set(player.shop[0], 0, player.shop[1]);
    scene.add(shop.group);
    const model = buildTruck(player);
    const count = game.frames[0].p[player.seat][4].length / 3;
    // A player's fleet is one instanced mesh per material: ~8 draw calls for all five trucks, not ~40.
    const fleet = model.parts.map(({ geometry, material }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;             // trucks spread over the city; five instances are cheap
      mesh.renderOrder = 31;
      scene.add(mesh);
      return mesh;
    });
    // each truck keeps a transform (heading about y, then nose up/down the slope) for its instance
    const trucks = Array.from({ length: count }, () => { const obj = new THREE.Object3D(); obj.rotation.order = 'YZX'; return { obj, heading: null }; });
    return { player, shop, trucks, fleet, offset: model.offset, mats: [...shop.mats, ...model.mats], dim: 1 };
  });

  // trails: one dynamic ribbon mesh, RGBA vertex colours fade out behind each truck
  // one dynamic ribbon mesh, refilled each frame into buffers that only grow (no per-frame GPU buffers)
  const trailGeo = new THREE.BufferGeometry();
  let trailCapacity = 0;
  function trailBuffers(vertices) {
    if (vertices <= trailCapacity) return;
    const old = trailGeo.attributes.position ? [trailGeo.attributes.position.array, trailGeo.attributes.color.array] : null;
    trailCapacity = Math.max(4096, vertices * 2);
    trailGeo.dispose();
    const position = new Float32Array(trailCapacity * 3), color = new Float32Array(trailCapacity * 4);
    if (old) { position.set(old[0]); color.set(old[1]); }
    trailGeo.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(color, 4).setUsage(THREE.DynamicDrawUsage));
  }
  trailBuffers(4096);
  // One straight piece of trail from (ax, az) to (bx, bz), split at the terrain grid's spacing so it
  // follows the ground; written straight into the trail buffers. Returns the next free vertex.
  const edgeY = new Float32Array(2 * 64);
  function trailPiece(v, ax, az, bx, bz, half, colour, alpha) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, n = Math.min(63, Math.max(1, Math.ceil(len / 12)));
    const nx = -dz / len * half, nz = dx / len * half;
    trailBuffers(v + n * 6);
    const P = trailGeo.attributes.position.array, C = trailGeo.attributes.color.array;
    for (let s = 0; s <= n; s++) {
      const x = ax + dx * s / n, z = az + dz * s / n;
      edgeY[s * 2] = roadY(x + nx, z + nz) + 1; edgeY[s * 2 + 1] = roadY(x - nx, z - nz) + 1;
    }
    const put = (x, y, z) => {
      P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
      C[v * 4] = colour.r; C[v * 4 + 1] = colour.g; C[v * 4 + 2] = colour.b; C[v * 4 + 3] = alpha;
      v++;
    };
    for (let s = 0; s < n; s++) {
      const x0 = ax + dx * s / n, z0 = az + dz * s / n, x1 = ax + dx * (s + 1) / n, z1 = az + dz * (s + 1) / n;
      const pl = edgeY[s * 2], pr = edgeY[s * 2 + 1], ql = edgeY[s * 2 + 2], qr = edgeY[s * 2 + 3];
      put(x0 + nx, pl, z0 + nz); put(x1 + nx, ql, z1 + nz); put(x1 - nx, qr, z1 - nz);
      put(x0 + nx, pl, z0 + nz); put(x1 - nx, qr, z1 - nz); put(x0 - nx, pr, z0 - nz);
    }
    return v;
  }
  const trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  trailMesh.renderOrder = 10;
  trailMesh.frustumCulled = false;
  scene.add(trailMesh);

  // ---- camera framing (same box the 2D fit() frames) ------------------------------
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .12;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = 1.3;
  controls.minDistance = 60;
  let fitDistance = 3000, flight = null, size = { w: 0, h: 0 };

  function pads() {
    const wide = size.w > 760, boardHeight = 40 + 52 * game.players.length;
    return { l: wide ? 44 : 30, t: 104, r: wide ? 334 : 30, b: wide ? 92 : Math.min(boardHeight, size.h * .34) + 101 };
  }

  function region() {
    let [x0, y0, x1, y1] = town.bounds;
    const xs = game.players.map(p => p.shop[0]), zs = game.players.map(p => p.shop[1]);
    const mx = [wx(x0), wx(x1), ...xs], mz = [wy(y0), wy(y1), ...zs];
    return { x0: Math.min(...mx), x1: Math.max(...mx), z0: Math.min(...mz), z1: Math.max(...mz) };
  }

  function resize() {
    size = { w: host.clientWidth || innerWidth, h: host.clientHeight || innerHeight };
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    const p = pads();
    // shift the projection centre into the free area between the panels, as 2D does with padding
    camera.setViewOffset(size.w, size.h, (p.r - p.l) / 2, (p.b - p.t) / 2, size.w, size.h);
    camera.updateProjectionMatrix();
    const r = region(), p2 = pads(), tan = Math.tan(camera.fov * Math.PI / 360);
    const aw = Math.max(1, size.w - p2.l - p2.r), ah = Math.max(1, size.h - p2.t - p2.b);
    fitDistance = Math.max((r.z1 - r.z0) * Math.cos(TILT) / (2 * tan) * size.h / ah, (r.x1 - r.x0) / (2 * tan * camera.aspect) * size.w / aw) * 1.02;
    // A tilted perspective board is wider at the near edge. Fit its actual projected
    // corners rather than just its unprojected dimensions (especially on phones).
    const fitCamera = camera.clone(), tx = (r.x0 + r.x1) / 2, tz = (r.z0 + r.z1) / 2;
    const ty = heightAt(tx, tz);
    const corners = [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]
      .flatMap(([x, z]) => [new THREE.Vector3(x, heightAt(x, z), z), new THREE.Vector3(x, -SLAB, z)]);
    for (let attempt = 0; attempt < 24; attempt++) {
      fitCamera.position.set(tx, ty + fitDistance * Math.cos(TILT), tz + fitDistance * Math.sin(TILT));
      fitCamera.lookAt(tx, ty, tz);
      fitCamera.updateMatrixWorld();
      if (corners.every(corner => {
        const p = corner.clone().project(fitCamera), x = (p.x + 1) * size.w / 2, y = (1 - p.y) * size.h / 2;
        return x >= p2.l && x <= size.w - p2.r && y >= p2.t && y <= size.h - p2.b;
      })) break;
      fitDistance *= 1.06;
    }
    // Fixed Kongsberg fog distances wash out this larger board at phone overview zoom.
    scene.fog.near = fitDistance * 1.5;
    scene.fog.far = fitDistance * 3;
    camera.far = Math.max(20000, fitDistance * 5);
    camera.updateProjectionMatrix();
    controls.maxDistance = fitDistance * 2.4;
  }

  function pose(target, distance, polar, azimuth) {
    const sin = Math.sin(polar);
    camera.position.set(target.x + distance * sin * Math.sin(azimuth), target.y + distance * Math.cos(polar), target.z + distance * sin * Math.cos(azimuth));
    controls.target.copy(target);
    camera.lookAt(target);
  }

  function current() {
    const offset = camera.position.clone().sub(controls.target), distance = offset.length();
    return { target: controls.target.clone(), distance, polar: Math.acos(clamp(offset.y / distance, -1, 1)), azimuth: Math.atan2(offset.x, offset.z) };
  }

  function flyTo(to, ms = 1100) {
    const from = current();
    let da = to.azimuth - from.azimuth;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    flight = { from, to: { ...to, azimuth: from.azimuth + da }, start: performance.now(), ms };
  }

  function home() {
    // a town that fits on the screen starts framed whole, as in 2D; a big city starts inside it
    if (!town.coverage) {
      const r = region(), x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
      return { target: new THREE.Vector3(x, heightAt(x, z), z), distance: fitDistance, polar: TILT, azimuth: 0 };
    }
    const xs = game.players.map(p => p.shop[0]), zs = game.players.map(p => p.shop[1]);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2;
    const desktopDistance = 11000, phoneDistance = 18000;
    return { target: new THREE.Vector3(x, heightAt(x, z), z),
      distance: Math.min(fitDistance, size.w > 760 ? desktopDistance : phoneDistance), polar: .88, azimuth: -.12 };
  }
  function overview() {
    const r = region(), x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
    flyTo({ target: new THREE.Vector3(x, heightAt(x, z), z), distance: fitDistance, polar: TILT, azimuth: 0 });
  }
  // fly to a place from the explore menu: a district of a big city, or a landmark close up in a town
  function explore(lon, lat) {
    const x = wx(lon * 1e5), z = wy(lat * 1e5), from = current(), wide = size.w > 760;
    const distance = town.coverage ? (wide ? 2100 : 3300) : (wide ? 520 : 780);
    flyTo({ ...from, target: new THREE.Vector3(x, heightAt(x, z), z), distance, polar: town.coverage ? .9 : 1 });
  }
  // a fixed camera (checks and screenshots): target lon/lat, distance, polar and azimuth in radians
  function look(lon, lat, distance, polar = .9, azimuth = 0) {
    const x = wx(lon * 1e5), z = wy(lat * 1e5);
    flight = null;
    pose(new THREE.Vector3(x, heightAt(x, z), z), distance, polar, azimuth);
  }
  function zoomBy(factor) {
    const from = current();
    flyTo({ ...from, distance: clamp(from.distance * factor, controls.minDistance, controls.maxDistance) }, 350);
  }

  // 2D <-> 3D hand-over: keep the same spot and zoom when switching views.
  function fromFlat() {
    const p = pads(), cx = p.l + (view.w - p.l - p.r) / 2, cy = p.t + (view.h - p.t - p.b) / 2;
    const x = (cx - view.x) / view.scale, z = (cy - view.y) / view.scale, ratio = view.scale / view.fit;
    return { target: new THREE.Vector3(x, heightAt(x, z), z), distance: clamp(fitDistance / ratio, controls.minDistance, controls.maxDistance), azimuth: 0 };
  }

  function toFlat() {
    const s = current();
    if (!view.fit) return;
    const ratio = clamp(fitDistance / s.distance, .6, 14);
    const p = pads(), cx = p.l + (view.w - p.l - p.r) / 2, cy = p.t + (view.h - p.t - p.b) / 2;
    view.scale = view.fit * ratio;
    view.x = cx - s.target.x * view.scale;
    view.y = cy - s.target.z * view.scale;
    view.touched = Math.abs(ratio - 1) > .02 || Math.hypot(s.target.x - home().target.x, s.target.z - home().target.z) > 20;
  }

  renderer.domElement.addEventListener('dblclick', () => flyTo(home()));
  {
    let down = null;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', event => { down = event.isPrimary ? { x: event.offsetX, y: event.offsetY, t: performance.now() } : null; });
    el.addEventListener('pointerup', event => {
      if (down && event.isPrimary && Math.hypot(event.offsetX - down.x, event.offsetY - down.y) < 6 && performance.now() - down.t < 500) opts.onTap?.(event.offsetX, event.offsetY);
      down = null;
    });
    el.addEventListener('pointermove', event => { if (!event.buttons) el.style.cursor = opts.hover?.(event.offsetX, event.offsetY) ? 'pointer' : ''; });
  }
  addEventListener('resize', () => { if (active) resize(); });

  let active = false, entered = false;
  function setActive(on) {
    if (on === active) return;
    active = on;
    if (on) {
      resize();
      // start straight down where the 2D map was, then tilt into 3D
      const start = view.touched || entered ? fromFlat() : { ...home(), polar: 0 };
      pose(start.target, start.distance, .001, 0);
      flyTo({ ...start, polar: view.touched || entered ? TILT : home().polar,
        azimuth: entered ? start.azimuth : home().azimuth }, 1200);
      entered = true;
    } else {
      toFlat();
    }
  }

  // ---- per-frame --------------------------------------------------------------
  const tmp = new THREE.Vector3(), truckMatrix = new THREE.Matrix4();
  function project(x, y, z) {
    tmp.set(x, y, z).project(camera);
    if (tmp.z > 1 || tmp.z < -1) return null;
    return { x: (tmp.x + 1) / 2 * size.w, y: (1 - tmp.y) / 2 * size.h };
  }

  let before = performance.now();
  let shadowAt = -Infinity, shadowX = Infinity, shadowZ = Infinity, shadowDistance = 0;
  let lastX = 0, lastZ = 0, lastDistance = 0, restingSince = 0;
  // If a machine picked for the full look still cannot keep up once the city is in, step down
  // once to the light tier (no shadows, lower resolution) rather than stutter.
  const frameTimes = [];
  let quality = low ? 'low' : 'high';
  function governor(ms) {
    if (quality === 'low' || !cityDone || document.hidden || !active) return;
    frameTimes.push(ms);
    if (frameTimes.length < 120) return;
    const median = frameTimes.sort((p, q) => p - q)[60];
    frameTimes.length = 0;
    if (median < 40 || new URLSearchParams(location.search).get('quality') === 'high') return;
    quality = 'low';
    sun.castShadow = false;
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
    resize();
    console.info(`3D view: ${median.toFixed(0)} ms per frame, switched to the light quality tier`);
  }

  function render({ index, k, a, b, time, dark, tick }) {
    const now = performance.now(), dt = Math.min(.1, (now - before) / 1000);
    governor(now - before);
    before = now;
    if (flight) {
      const t = clamp((now - flight.start) / flight.ms, 0, 1), e = ease(t), f = flight.from, to = flight.to;
      pose(new THREE.Vector3().lerpVectors(f.target, to.target, e), f.distance + (to.distance - f.distance) * e, f.polar + (to.polar - f.polar) * e, f.azimuth + (to.azimuth - f.azimuth) * e);
      if (t >= 1) flight = null;
    } else {
      controls.update();
    }
    controls.target.x = clamp(controls.target.x, X0, X1);
    controls.target.z = clamp(controls.target.z, Z0, Z1);
    if (!flight) {
      // the point you orbit rides on the ground, so panning over a hill does not dive into it
      const dy = (heightAt(controls.target.x, controls.target.z) - controls.target.y) * Math.min(1, dt * 5);
      controls.target.y += dy;
      camera.position.y += dy;
    }
    camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 12);
    const distance = camera.position.distanceTo(controls.target);
    // Atmospheric depth follows the current zoom, never a fixed small-map range.
    scene.fog.near = distance * 1.45;
    scene.fog.far = distance * 3;
    // Depth precision: with the near plane fixed at 5 units, a camera 3 km out could only tell
    // surfaces ~10 cm apart, so doors, trim and touching buildings flickered. The near plane
    // follows the camera's height over the ground instead (nothing visible is closer than that).
    const above = camera.position.y - heightAt(camera.position.x, camera.position.z);
    const near = clamp(Math.min(above * .3, distance * .08), 2, 400);
    if (Math.abs(near - camera.near) > camera.near * .1) { camera.near = near; camera.updateProjectionMatrix(); }
    // Like the 2D sprites, actors grow more slowly than the map when you zoom in. Measured per
    // object, so a truck close to a low camera does not fill the screen.
    const growAt = (x, z) => clamp((camera.position.distanceTo(tmp.set(x, heightAt(x, z), z)) / 6200) ** .65, .16, 1.25);

    // sun follows the view so the shadow map stays sharp where you look. Redrawing the shadow map
    // re-renders the city around you, so while the camera moves it happens at most twice a second
    // (and only when it has moved well across the shadowed area); once it rests, at once.
    const moved = Math.hypot(lastX - controls.target.x, lastZ - controls.target.z) > .5 || Math.abs(lastDistance - distance) > 1;
    lastX = controls.target.x; lastZ = controls.target.z; lastDistance = distance;
    if (moved) restingSince = now;
    const resting = now - restingSince > 250, reachNow = clamp(distance * 1.1, 260, 2600);
    const shift = Math.hypot(shadowX - controls.target.x, shadowZ - controls.target.z), zoomShift = Math.abs(shadowDistance - distance);
    if (renderer.shadowMap.enabled && ((resting && (shift > 35 || zoomShift > 80 || cityChanged) && now - shadowAt > 200) ||
        (!resting && now - shadowAt > 500 && (shift > reachNow * .3 || zoomShift > shadowDistance * .3)) ||
        (cityChanged && now - shadowAt > 1000))) {
      cityChanged = false;
      const reach = clamp(distance * 1.1, 260, 2600);
      sun.target.position.copy(controls.target);
      sun.position.copy(controls.target).addScaledVector(SUN_DIR, 3000);
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 100, far: 6000 });
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
      shadowAt = now; shadowX = controls.target.x; shadowZ = controls.target.z; shadowDistance = distance;
    }

    // orders -> houses
    const states = new Map(), pops = [];
    for (const [id, order] of game.activeOrders) {
      const age = tick - order.t;
      if (order.status === DELIVERED && Math.floor(age) >= POP_TICKS) { game.activeOrders.delete(id); continue; }
      const house = homeAt.get(`${order.lon},${order.lat}`), owner = game.players[order.owner];
      if (!house) continue;
      const dim = play.focus !== null && order.owner !== play.focus && order.status !== OPEN ? .25 : 1;
      if (order.status === DELIVERED) {
        const at = owner && project(house.x, house.top + 4, house.z);
        if (at) pops.push({ x: at.x, y: at.y, age: age / POP_TICKS, text: `+${order.points}`, colour: owner.colour, dim });
        continue;
      }
      const was = states.get(house);
      if (!was || was.status === OPEN) states.set(house, { status: order.status, owner, dim, id });
    }
    const pinH = 24 / size.h * 2 * Math.tan(camera.fov * Math.PI / 360);  // a 24 px pin at any screen size
    const chosen = opts.selected?.() ?? null;
    picks = [];
    for (const house of homes) {
      const s = states.get(house);
      paintHome(house, s);
      if (s) {
        const big = s.id === chosen ? 1.5 : 1;
        house.pin.position.set(house.x, house.top + 6 + Math.sin(time * 2.4 + house.i) * 1.5, house.z);
        house.pin.scale.set(pinH * 2 / 3 * big, pinH * big, 1);
        house.ring.material.opacity = s.id === chosen ? .45 + Math.sin(time * 5) * .2 : house.ringBase;
        const pin = project(house.x, house.top + 6, house.z), roof = project(house.x, house.top, house.z);
        if (pin) picks.push({ kind: 'order', id: s.id, x: pin.x, y: pin.y - 14 * big, r: 16 * big });
        if (roof) picks.push({ kind: 'order', id: s.id, x: roof.x, y: roof.y, r: 14 });
      }
    }

    // trucks, shops and trails
    let trailVertices = 0;
    const next = game.frames[Math.min(index + 1, game.frames.length - 1)];
    for (const actor of players) {
      const { player } = actor, dim = play.focus !== null && play.focus !== player.seat ? .3 : 1;
      if (dim !== actor.dim) {
        actor.dim = dim;
        for (const m of actor.mats) { m.transparent = dim < 1 || !!m.map; m.opacity = dim; m.needsUpdate = true; }
      }
      actor.grow = growAt(player.shop[0], player.shop[1]);
      actor.shop.group.scale.setScalar(actor.shop.actual ? 1 : SHOP_SCALE * actor.grow);
      {
        // stand on the highest corner; the footing covers the downhill side
        const sx = player.shop[0], sz = player.shop[1], hw = 31 * SHOP_SCALE * actor.grow, hd = 18 * SHOP_SCALE * actor.grow;
        actor.base = actor.shop.actual ? heightAt(sx, sz) : Math.max(heightAt(sx, sz), heightAt(sx - hw, sz - hd), heightAt(sx + hw, sz - hd), heightAt(sx - hw, sz + hd), heightAt(sx + hw, sz + hd));
        actor.shop.group.position.y = actor.base;
        const S = SHOP_SCALE * actor.grow, mid = project(sx, actor.base + 22 * S, sz), side = project(sx + 31 * S, actor.base + 22 * S, sz);
        const actual = actor.shop.actual && project(sx, actor.base + actor.shop.top, sz);
        if (actual) picks.push({ kind: 'shop', seat: player.seat, x: actual.x, y: actual.y, r: 24 });
        else if (mid) picks.push({ kind: 'shop', seat: player.seat, x: mid.x, y: mid.y, r: Math.max(22, side ? Math.hypot(side.x - mid.x, side.y - mid.y) * 1.25 : 30) });
      }
      let parked = 0, shown = 0;
      const colour = actor.colour ||= new THREE.Color(player.colour);
      actor.trucks.forEach((truck, t) => {
        const now = truckAt(player, t, a, b, k);
        if (now.parked) { parked++; truck.heading = null; return; }
        const ta = a.p[player.seat][4], tb = next.p[player.seat][4], i = t * 3;
        const dx = wx(tb[i]) - wx(ta[i]), dz = wy(tb[i + 1]) - wy(ta[i + 1]);
        if (Math.hypot(dx, dz) > .4) {
          const want = Math.atan2(-dz, dx);
          if (truck.heading === null) truck.heading = want;
          else truck.heading += Math.atan2(Math.sin(want - truck.heading), Math.cos(want - truck.heading)) * Math.min(1, dt * 10);
        }
        const grow = growAt(now.x, now.y);
        const heading = truck.heading ?? 0, reach = 144 * TRUCK_SCALE * grow * .45, hx = Math.cos(heading) * reach, hz = -Math.sin(heading) * reach;
        const front = roadY(now.x + hx, now.y + hz), back = roadY(now.x - hx, now.y - hz);
        truck.obj.position.set(now.x, (front + back) / 2 + Math.abs(Math.sin(time * 9 + t * 2 + player.seat)) * .6 * grow, now.y);
        truck.obj.rotation.set(0, heading, Math.atan2(front - back, reach * 2));
        truck.obj.scale.setScalar(TRUCK_SCALE * grow);
        truck.obj.updateMatrix();
        truckMatrix.multiplyMatrices(truck.obj.matrix, actor.offset);
        for (const mesh of actor.fleet) mesh.setMatrixAt(shown, truckMatrix);
        shown++;
        // trail behind the truck, as in drawTrails()
        let px = now.x, pz = now.y;
        for (let back = 0; back < TRAIL && index - back >= 0; back++) {
          const list = game.frames[index - back].p[player.seat][4];
          if (list[i + 2] < PARKED) break;
          const x = wx(list[i]), z = wy(list[i + 1]), len = Math.hypot(x - px, z - pz);
          const alpha = (dim < 1 ? .12 : .55) * (1 - (back + k) / TRAIL);
          if (len > .01) trailVertices = trailPiece(trailVertices, px, pz, x, z, 3.4 * grow, colour, alpha);
          px = x; pz = z;
        }
      });
      actor.parked = parked;
      for (const mesh of actor.fleet) { mesh.count = shown; mesh.visible = shown > 0; mesh.instanceMatrix.needsUpdate = true; }
    }
    trailGeo.attributes.position.clearUpdateRanges();
    trailGeo.attributes.position.addUpdateRange(0, trailVertices * 3);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.clearUpdateRanges();
    trailGeo.attributes.color.addUpdateRange(0, trailVertices * 4);
    trailGeo.attributes.color.needsUpdate = true;
    trailGeo.setDrawRange(0, trailVertices);
    if (STREAKS) flowWater(dt, clamp((distance / fitDistance) ** .6, .55, 1.6));
    landmarks.update?.(now / 1000);                // rapids and waterfalls (src/landmarks.js)

    renderer.render(scene, camera);

    // overlay: dusk, place labels, shop name pills (drawn with the 2D styles)
    if (dark > 0) {
      ctx.fillStyle = `rgba(22,30,52,${dark})`;
      ctx.fillRect(0, 0, size.w, size.h);
    }
    drawLabels(fitDistance / distance);
    for (const actor of players) drawPill(actor, actor.grow);
    return pops;
  }

  // text widths never change for a given font: measure each label once, not every frame
  const widths = new Map();
  document.fonts?.addEventListener?.('loadingdone', () => widths.clear());   // Mulish arrives after first use
  const textWidth = (font, text) => { const key = font + '|' + text; let w = widths.get(key); if (w === undefined) { ctx.font = font; w = ctx.measureText(text).width; widths.set(key, w); } return w; };

  function drawLabels(zoom) {
    const placed = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [name, lon, lat, minZoom, kind] of labels) {
      if (zoom < minZoom) continue;
      const at = project(wx(lon), heightAt(wx(lon), wy(lat)) + 2, wy(lat));
      if (!at || at.x < 0 || at.y < 0 || at.x > size.w || at.y > size.h) continue;
      const font = kind === 'river' ? 'italic 700 13px Georgia, serif' : '700 12px system-ui, sans-serif';
      const half = textWidth(font, name) / 2 + 6;
      if (placed.some(l => Math.abs(at.y - l.y) < 18 && Math.abs(at.x - l.x) < half + l.half)) continue;
      ctx.font = font;
      placed.push({ x: at.x, y: at.y, half });
      ctx.lineWidth = 3;
      ctx.strokeStyle = kind === 'river' ? '#b8d9de' : '#fff7e5';
      ctx.strokeText(name, at.x, at.y);
      ctx.fillStyle = kind === 'river' ? '#1d5163' : '#514129';
      ctx.fillText(name, at.x, at.y);
    }
  }

  function drawPill(actor, grow) {
    const { player } = actor;
    const at = actor.shop.actual ? project(player.shop[0], (actor.base ?? 0) + actor.shop.top + 5, player.shop[1]) :
      project(player.shop[0], actor.base ?? 0, player.shop[1] + 26 * SHOP_SCALE * grow);
    if (!at) return;
    ctx.globalAlpha = actor.dim;
    ctx.font = '800 12px Mulish, Arial, sans-serif';
    const store = game.meta.players[player.seat].store?.name;
    const storeWidth = store ? Math.min(180, store.length * 5.8 + 16) : 0;
    const width = Math.max(storeWidth, Math.min(132, textWidth('800 12px Mulish, Arial, sans-serif', player.name) + 16)), y = at.y + 4;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.beginPath();
    ctx.roundRect(at.x - width / 2, y, width, store ? 34 : 20, 10);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name, at.x, y + 10.5, width - 12);
    if (store) {
      ctx.font = '700 10px Mulish, Arial, sans-serif';
      ctx.fillStyle = '#67594b';
      ctx.fillText(store, at.x, y + 25, width - 12);
    }
    ctx.fillStyle = player.colour;
    for (let i = 0; i < actor.parked; i++) { ctx.beginPath(); ctx.arc(at.x + (i - (actor.parked - 1) / 2) * 9, y + (store ? 40 : 26), 3, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  resize();
  pose(home().target, fitDistance, TILT, 0);
  await pass();

  // Compile every shader before the first frame, in parallel where the browser can
  // (KHR_parallel_shader_compile), including the chunk and road materials whose meshes are still
  // being built: otherwise the first frame, and the first chunk to arrive, stall on compiling.
  renderer.initTexture(tex);
  await pass();
  {
    const warm = [];
    const stand = (material, colour, uv, cast) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Int16Array(12), 4));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(12), 4, true));
      if (colour) geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(12), 4, true));
      if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Int16Array(6), 2));
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      scene.add(mesh);
      warm.push(mesh);
    };
    for (const material of Object.values(chunkWallMats)) stand(material, true, true, true);
    stand(chunkTrimMat, true, false, true);
    for (const material of roadMaterials) stand(material, false, false, false);
    await renderer.compileAsync(scene, camera);
    for (const mesh of warm) { scene.remove(mesh); mesh.geometry.dispose(); }
  }
  const flowAt = (x, z) => { const i = cellOf(x, z); return i < 0 || !flowSpeed[i] ? null : [flowX[i], flowZ[i], flowSpeed[i]]; };
  return { render, setActive, flyHome: () => flyTo(home()), overview, explore, look, zoomBy,
    buildingMode: 'all', get quality() { return quality; }, ready: cityReady, get cityDone() { return cityDone; },
    buildingStats, roadStats, homeStats: { homes: homes.length, drawCalls: homeMeshes.length },
    landmarkStats: { ...landmarks.stats, drawCalls: landmarks.meshes.length },
    treeCounts: { parks: parkTreeCount, forest: forestTreeCount },
    camera, controls, scene, renderer, flowAt, streaks: STREAKS, bridges, get picks() { return picks; } };
}
