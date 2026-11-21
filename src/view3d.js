// 3D view of the game map. Same town data, borders, colours and replay frames as the 2D canvas
// in game-view.js, on the real terrain: the map is draped over an elevation grid of Kongsberg
// (data/terrain.bin) and everything stands on it. Order homes are the real OpenStreetMap
// footprints at each customer address.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, HEADS, INK as TRUCK_INK, SHELL, EDGE, WOOD, LAMP, mix, light, face } from './looks.js';

const M = 1 / 1.113;              // world units per metre (one unit is 1e-5 degree of latitude)
const LIFT = 1.3;                 // buildings a little taller than life so the town reads from above
const RELIEF = 1.22;              // hills a little steeper than life, so the valley reads at a tilt
const PALETTE = {
  ground: '#f0e9d8', side: '#e2d6bb', base: '#cfc1a2', green: '#c9d8ac', water: '#86b8c5',
  lane: '#ded4bd', streetCase: '#d0c4aa', majorCase: '#bca989', street: '#ffffff', major: '#fff7e5',
  home: '#b5a489', homeWall: '#f1e7d0', town: '#ebe3d2', open: '#fff5da', openEdge: '#735536',
};
const TILT = 0.74;                // default camera tilt from straight down (radians, ~42°)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export async function createWorld3d(opts) {
  const { host, overlay: ctx, view, town, game, play, wx, wy, truckAt, labels } = opts;
  let picks = [];                           // this frame's clickable shops and order houses, in screen pixels
  const { OPEN, DELIVERED, PARKED, TRAIL, POP_TICKS, INK } = opts.constants;
  const [extra, relief, heights] = await Promise.all([
    fetch('data/buildings.json').then(res => res.json()),
    fetch('data/terrain.json').then(res => res.json()),
    fetch('data/terrain.bin').then(res => res.arrayBuffer()).then(buf => new Uint16Array(buf)),
  ]);
  // optional: OSM forest/wood and open land (fields, built-up areas) for planting forests
  const cover = await fetch('data/landcover.json').then(res => res.ok ? res.json() : null).catch(() => null) || { wood: [], open: [] };

  // ---- renderer, scene, camera ------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor('#f6f3ef');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 5, 20000);
  scene.fog = new THREE.Fog('#f6f3ef', 6000, 14000);

  const PI = Math.PI;
  const hemi = new THREE.HemisphereLight('#fffaf0', '#d9cdb4', 1.25 * PI * .5);
  const sun = new THREE.DirectionalLight('#fff9ef', 1.05 * PI * .5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
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
  const gridY = i => heights[i] / 10 * M * RELIEF;     // units above the lowest point on the map
  function heightAt(x, z) {
    const fx = clamp((x - X0) / W, 0, 1) * (cols - 1), fz = clamp((z - Z0) / D, 0, 1) * (rows - 1);
    const c = Math.min(cols - 2, Math.floor(fx)), r = Math.min(rows - 2, Math.floor(fz)), u = fx - c, v = fz - r, i = r * cols + c;
    return (gridY(i) * (1 - u) + gridY(i + 1) * u) * (1 - v) + (gridY(i + cols) * (1 - u) + gridY(i + cols + 1) * u) * v;
  }
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
  const groundGeo = new THREE.PlaneGeometry(W, D, cols - 1, rows - 1).rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, gridY(i));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: tex }));
  ground.position.set(CX, 0, CZ);
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

  function area(list) {
    const path = new Path2D();
    for (const p of list) { path.moveTo(wx(p[0]), wy(p[1])); for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1])); path.closePath(); }
    return path;
  }

  function groundTexture() {
    const longSide = Math.min(4096, renderer.capabilities.maxTextureSize);
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
    g.fillStyle = PALETTE.water;
    g.fill(area(town.water));
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // Roads: the same five strokes as 2D (casing under fill), as flat ribbons with round joins.
  const roadLayers = [
    ['lane', 2.2, PALETTE.lane], ['street', 7.5, PALETTE.streetCase], ['major', 11, PALETTE.majorCase],
    ['street', 5, PALETTE.street], ['major', 8.2, PALETTE.major],
  ];
  function buildRoads() {
    roadLayers.forEach(([kind, half, colour], i) => {
      const mesh = new THREE.Mesh(ribbons(town.roads[kind], half, .5 + i * .05), draped(colour));
      mesh.receiveShadow = true;
      mesh.renderOrder = 2 + i;
      scene.add(mesh);
    });
  }

  // Ribbons cut into short pieces so they follow the ground instead of bridging dips.
  function ribbons(lines, half, lift, pos = []) {
    const y = (x, z) => roadY(x, z) + lift;
    const disc = (x, z) => {
      const n = 10, cy = y(x, z);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
        const ax = x + Math.cos(a) * half, az = z + Math.sin(a) * half, bx = x + Math.cos(b) * half, bz = z + Math.sin(b) * half;
        pos.push(x, cy, z, bx, y(bx, bz), bz, ax, y(ax, az), az);
      }
    };
    for (const line of lines) {
      let px = wx(line[0]), pz = wy(line[1]);
      disc(px, pz);
      for (let i = 2; i < line.length; i += 2) {
        const x = wx(line[i]), z = wy(line[i + 1]);
        strip(pos, px, pz, x, z, half, y);
        disc(x, z);
        px = x; pz = z;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // One straight piece of ribbon from (ax, az) to (bx, bz), split every ~6 units; returns the piece count.
  function strip(pos, ax, az, bx, bz, half, y) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, n = Math.max(1, Math.ceil(len / 6));
    const nx = -dz / len * half, nz = dx / len * half;
    for (let s = 0; s < n; s++) {
      const x0 = ax + dx * s / n, z0 = az + dz * s / n, x1 = ax + dx * (s + 1) / n, z1 = az + dz * (s + 1) / n;
      const p = [x0 + nx, z0 + nz], q = [x1 + nx, z1 + nz], r = [x1 - nx, z1 - nz], t = [x0 - nx, z0 - nz];
      for (const [x, z] of [p, q, r, p, r, t]) pos.push(x, y(x, z), z);
    }
    return n;
  }

  // ---- buildings ------------------------------------------------------------------
  // Footprint ring in 1e5-degree ints -> extruded prism (walls + flat roof), as non-indexed triangles.
  // On a slope the walls start below the lowest corner and the roof sits above the highest one.
  function prism(ring, height, out) {
    const pts = [];
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(wx(ring[i]), wy(ring[i + 1])));
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const h = heightAt(p.x, p.y); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const foot = lo - 1.5, top = hi + height;
    const walls = [], roof = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      walls.push(a.x, foot, a.y, a.x, top, a.y, b.x, top, b.y, a.x, foot, a.y, b.x, top, b.y, b.x, foot, b.y);
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) {
      for (const n of [i, k, j]) roof.push(pts[n].x, top, pts[n].y);
    }
    out.walls.push(...walls);
    out.roof.push(...roof);
    return { pts, top };
  }

  function prismGeometry(parts, withGroups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...parts.walls, ...parts.roof], 3));
    geo.computeVertexNormals();
    if (withGroups) {
      geo.addGroup(0, parts.walls.length / 3, 0);
      geo.addGroup(parts.walls.length / 3, parts.roof.length / 3, 1);
    }
    return geo;
  }

  // Context town: every other mapped building in the bounds, pale so the order homes stand out.
  // Buildings under a shop (often the real store) make way for the shop model, as on the 2D map.
  const PLAZA = 100;
  const nearShop = (x, z, r = PLAZA) => game.players.some(p => Math.hypot(p.shop[0] - x, p.shop[1] - z) < r);
  {
    const parts = { walls: [], roof: [] };
    for (const b of extra.buildings) {
      let hit = false;
      for (let i = 1; i < b.length && !hit; i += 2) hit = nearShop(wx(b[i]), wy(b[i + 1]));
      if (hit) continue;
      const h = b[0] * M * LIFT;
      prism(b.slice(1), h, parts);
    }
    const mesh = new THREE.Mesh(prismGeometry(parts, false), litBoth(PALETTE.town));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = 20;
    scene.add(mesh);
  }

  // Order homes: the real footprint at each address the game delivers to.
  const homes = extra.homes.map((home, i) => {
    const parts = { walls: [], roof: [] };
    const height = Math.max(7, home.h) * M * LIFT;
    const { pts, top } = prism(home.ring, height, parts);
    const wall = litBoth(PALETTE.homeWall), roof = litBoth(PALETTE.home);
    const mesh = new THREE.Mesh(prismGeometry(parts, true), [wall, roof]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = 21;
    scene.add(mesh);
    let cx = 0, cz = 0, r = 0;
    for (const p of pts) { cx += p.x; cz += p.y; }
    cx /= pts.length; cz /= pts.length;
    for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cz));
    // ground glow draped over the slope around the house
    const ringGeo = new THREE.RingGeometry(.01, r + 9, 40, 4).rotateX(-Math.PI / 2).translate(cx, 0, cz);
    const rp = ringGeo.attributes.position;
    for (let v = 0; v < rp.count; v++) rp.setY(v, heightAt(rp.getX(v), rp.getZ(v)) + .9);
    const ring = new THREE.Mesh(ringGeo, flat('#ffffff', 0, { transparent: true, opacity: .55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    ring.renderOrder = 9;
    ring.visible = false;
    scene.add(ring);
    const pin = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, sizeAttenuation: false }));
    pin.center.set(.5, 0);
    pin.renderOrder = 50;
    pin.visible = false;
    scene.add(pin);
    return { i, key: `${home.p[0]},${home.p[1]}`, mesh, wall, roof, ring, pin, x: cx, z: cz, top, state: '' };
  });
  const homeAt = new Map(homes.map(h => [h.key, h]));

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
      home.wall.color.set(PALETTE.homeWall);
      home.roof.color.set(PALETTE.home);
      home.ring.visible = home.pin.visible = false;
      return;
    }
    const open = s.status === OPEN;
    const colour = open ? PALETTE.open : s.owner.colour;
    const fade = c => s.dim < 1 ? mix(c, PALETTE.homeWall, .7) : c;
    home.wall.color.set(fade(open ? PALETTE.open : mix(colour, '#ffffff', .25)));
    home.roof.color.set(fade(open ? PALETTE.openEdge : colour));
    home.ring.material.color.set(open ? PALETTE.openEdge : colour);
    home.ringBase = (open ? .28 : .45) * s.dim;
    home.ring.material.opacity = home.ringBase;
    home.ring.visible = true;
    home.pin.material.map = open ? pinTexture(PALETTE.open, PALETTE.openEdge) : pinTexture(colour, '#ffffff');
    home.pin.material.opacity = s.dim;
    home.pin.material.needsUpdate = true;
    home.pin.visible = true;
  }

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

  // ---- bridges: where a road crosses water it runs on a straight deck between the banks ----
  // Each road line is sampled every 3 units; a run of water samples becomes a bridge from just
  // before it to just after it. The deck stays clear of the water, ramps onto the banks, and gets a
  // slab, railings with posts and a pier or two. Roads, trucks and trails use roadY, so they cross on it.
  const bridges = [];
  {
    const HALF = { major: 11, street: 7.5, lane: 3 };
    for (const kind of ['major', 'street', 'lane']) for (const line of town.roads[kind]) {
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
  const RAMP = 26;
  function deckAt(x, z) {
    let best = -Infinity;
    for (const br of bridges) {
      const dx = br.bx - br.ax, dz = br.bz - br.az, t = ((x - br.ax) * dx + (z - br.az) * dz) / (br.length * br.length);
      const side = Math.abs((x - br.ax) * dz - (z - br.az) * dx) / br.length;
      if (side > br.half + 3) continue;
      const along = t * br.length;
      let h;
      if (t >= 0 && t <= 1) h = br.deckA + (br.deckB - br.deckA) * t;
      else if (along < 0 && along > -RAMP) { const u = 1 + along / RAMP; h = heightAt(x, z) + (br.deckA - heightAt(x, z)) * u * u * (3 - 2 * u); }
      else if (along > br.length && along < br.length + RAMP) { const u = 1 - (along - br.length) / RAMP; h = heightAt(x, z) + (br.deckB - heightAt(x, z)) * u * u * (3 - 2 * u); }
      else continue;
      if (h > best) best = h;
    }
    return best;
  }
  function roadY(x, z) { return Math.max(heightAt(x, z), deckAt(x, z)); }
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
  buildRoads();

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
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  streakMesh.renderOrder = 8;
  streakMesh.frustumCulled = false;
  if (STREAKS) scene.add(streakMesh);

  function flowWater(dt, scale) {
    let v = 0, q = 0;
    const put = (x, y, z, a) => { streakPos.set([x, y, z], v * 3); streakCol.set([.93, .97, .98, a], v * 4); v++; };
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

  // ---- trees in the parks and woods (decoration, seeded so every visit looks the same) ----
  {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const blocked = roadMask();
    const polys = town.green.map(p => {
      const pts = [];
      for (let i = 0; i < p.length; i += 2) pts.push([wx(p[i]), wy(p[i + 1])]);
      const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]);
      return { pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
    });
    const spots = [];
    for (let tries = 0; tries < 60000 && spots.length < 1800; tries++) {
      const x = X0 + rand() * W, z = Z0 + rand() * D;
      if (blocked(x, z)) continue;
      if (isWater(x, z) || isWater(x + 9, z) || isWater(x - 9, z) || isWater(x, z + 9) || isWater(x, z - 9)) continue;
      if (!polys.some(p => x >= p.box[0] && x <= p.box[2] && z >= p.box[1] && z <= p.box[3] && inside([x, z], p.pts))) continue;
      spots.push([x, z, .7 + rand() * .7, rand()]);
    }
    const trunk = new THREE.CylinderGeometry(.9, 1.2, 6, 5).translate(0, 3, 0);
    const crown = new THREE.IcosahedronGeometry(6, 0).translate(0, 10, 0);
    const trunks = new THREE.InstancedMesh(trunk, lit('#8a6d4f'), spots.length);
    const crowns = new THREE.InstancedMesh(crown, lit('#ffffff'), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), shades = ['#9dbb7c', '#8db06f', '#a9c48a', '#7fa565'].map(c => new THREE.Color(c));
    spots.forEach(([x, z, s, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
      m.compose(new THREE.Vector3(x, heightAt(x, z) - .5, z), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, shades[i % shades.length]);
    });
    for (const mesh of [trunks, crowns]) { mesh.castShadow = true; mesh.renderOrder = 22; scene.add(mesh); }
  }

  // ---- forests: where OSM maps forest or wood, and on empty land away from town -------------
  // Around Kongsberg most land the map leaves empty is spruce forest in real life. Fields, meadows,
  // built-up areas, parks (they have their own trees), roads, water and land near buildings stay clear.
  // Two instanced meshes for every tree, about 20 triangles each, so the forest stays cheap to draw.
  const forest = [];
  {
    let seed = 23;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const blocked = roadMask();
    const poly = list => list.map(p => {
      const pts = [];
      for (let i = 0; i < p.length; i += 2) pts.push([wx(p[i]), wy(p[i + 1])]);
      const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]);
      return { pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
    });
    const within = (list, x, z) => list.some(p => x >= p.box[0] && x <= p.box[2] && z >= p.box[1] && z <= p.box[3] && inside([x, z], p.pts));
    const wood = poly(cover.wood), open = poly(cover.open), parks = poly(town.green);
    // "town": within ~35 m of any building
    const cell = 8, cols = Math.ceil(W / cell), rows = Math.ceil(D / cell), near = new Uint8Array(cols * rows), R = 4;
    for (const b of extra.buildings) for (let i = 1; i < b.length; i += 2) {
      const c = Math.floor((wx(b[i]) - X0) / cell), r = Math.floor((wy(b[i + 1]) - Z0) / cell);
      for (let rr = Math.max(0, r - R); rr <= Math.min(rows - 1, r + R); rr++) for (let cc = Math.max(0, c - R); cc <= Math.min(cols - 1, c + R); cc++) near[rr * cols + cc] = 1;
    }
    const inTown = (x, z) => near[Math.floor((z - Z0) / cell) * cols + Math.floor((x - X0) / cell)] === 1;
    const STEP = 11;
    for (let z = Z0 + STEP / 2; z < Z1 && forest.length < 22000; z += STEP) for (let x = X0 + STEP / 2; x < X1; x += STEP) {
      const px = x + (rand() - .5) * STEP * .9, pz = z + (rand() - .5) * STEP * .9;
      if (px < X0 + 3 || px > X1 - 3 || pz < Z0 + 3 || pz > Z1 - 3) continue;
      if (blocked(px, pz) || isWater(px, pz) || isWater(px + 8, pz) || isWater(px - 8, pz) || isWater(px, pz + 8) || isWater(px, pz - 8)) continue;
      const mapped = within(wood, px, pz);
      if (!mapped && (inTown(px, pz) || within(open, px, pz) || within(parks, px, pz))) continue;
      if (rand() > (mapped ? .85 : .7)) continue;
      forest.push([px, pz, .8 + rand() * .7, rand(), rand() < .78]);
    }
    const spruce = forest.filter(t => t[4]), birch = forest.filter(t => !t[4]);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const plant = (list, crownGeo, trunkGeo, shades) => {
      const trunks = new THREE.InstancedMesh(trunkGeo, lit('#7d6450'), list.length), crowns = new THREE.InstancedMesh(crownGeo, lit('#ffffff'), list.length);
      const colours = shades.map(c => new THREE.Color(c));
      list.forEach(([x, z, sc, r], i) => {
        q.setFromAxisAngle(up, r * 6.28);
        m.compose(new THREE.Vector3(x, heightAt(x, z) - .5, z), q, new THREE.Vector3(sc, sc * (.9 + r * .35), sc));
        trunks.setMatrixAt(i, m);
        crowns.setMatrixAt(i, m);
        crowns.setColorAt(i, colours[i % colours.length]);
      });
      for (const mesh of [trunks, crowns]) { mesh.castShadow = true; mesh.receiveShadow = false; mesh.renderOrder = 22; scene.add(mesh); }
    };
    plant(spruce, new THREE.ConeGeometry(4.4, 13, 6).translate(0, 10, 0), new THREE.CylinderGeometry(.6, .8, 4, 4).translate(0, 2, 0), ['#6b8f5c', '#5f8553', '#779a69', '#668a58']);
    plant(birch, new THREE.IcosahedronGeometry(5, 0).translate(0, 9, 0), new THREE.CylinderGeometry(.6, .8, 6, 4).translate(0, 3, 0), ['#9dbb7c', '#a9c48a', '#93b574']);
  }

  function inside([x, y], ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function roadMask() {
    const cell = 4, cols = Math.ceil(W / cell), rows = Math.ceil(D / cell), grid = new Uint8Array(cols * rows);
    const mark = (x, z, r) => {
      const c0 = Math.floor((x - r - X0) / cell), c1 = Math.floor((x + r - X0) / cell);
      const r0 = Math.floor((z - r - Z0) / cell), r1 = Math.floor((z + r - Z0) / cell);
      for (let rr = Math.max(0, r0); rr <= Math.min(rows - 1, r1); rr++) for (let cc = Math.max(0, c0); cc <= Math.min(cols - 1, c1); cc++) grid[rr * cols + cc] = 1;
    };
    for (const kind of ['lane', 'street', 'major']) for (const line of town.roads[kind]) {
      for (let i = 2; i < line.length; i += 2) {
        const ax = wx(line[i - 2]), az = wy(line[i - 1]), bx = wx(line[i]), bz = wy(line[i + 1]);
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 3);
        for (let s = 0; s <= steps; s++) mark(ax + (bx - ax) * s / steps, az + (bz - az) * s / steps, 14);
      }
    }
    for (const b of extra.buildings) mark(wx(b[1]), wy(b[2]), 10);
    for (const p of game.players) mark(p.shop[0], p.shop[1], PLAZA + 10);
    return (x, z) => grid[Math.floor((z - Z0) / cell) * cols + Math.floor((x - X0) / cell)] === 1;
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
    const add = mesh => { mesh.castShadow = true; g.add(mesh); return mesh; };
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
    const holder = new THREE.Group();
    holder.rotation.order = 'YZX';            // heading about y, then nose up/down the slope
    holder.add(g);
    holder.traverse(o => { if (o.isMesh) o.renderOrder = 31; });
    return { group: holder, mats: [...mats.values(), faceMat] };
  }

  // ---- per-player actors ---------------------------------------------------------
  const TRUCK_SCALE = .9, SHOP_SCALE = 2.4;
  const players = game.players.map(player => {
    const shop = buildShop(player);
    shop.group.position.set(player.shop[0], 0, player.shop[1]);
    scene.add(shop.group);
    const model = buildTruck(player);
    const trucks = [];
    const count = game.frames[0].p[player.seat][4].length / 3;
    for (let t = 0; t < count; t++) {
      const truck = t === 0 ? model.group : model.group.clone();
      truck.visible = false;
      scene.add(truck);
      trucks.push({ obj: truck, heading: null });
    }
    return { player, shop, trucks, mats: [...shop.mats, ...model.mats], dim: 1 };
  });

  // trails: one dynamic ribbon mesh, RGBA vertex colours fade out behind each truck
  const trailGeo = new THREE.BufferGeometry();
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
    let [x0, y0, x1, y1] = town.focus;
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
    const r = region();
    const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
    return { target: new THREE.Vector3(x, heightAt(x, z), z), distance: fitDistance, polar: TILT, azimuth: 0 };
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
      flyTo({ ...start, polar: TILT, azimuth: entered ? start.azimuth : 0 }, 1200);
      entered = true;
    } else {
      toFlat();
    }
  }

  // ---- per-frame --------------------------------------------------------------
  const tmp = new THREE.Vector3();
  function project(x, y, z) {
    tmp.set(x, y, z).project(camera);
    if (tmp.z > 1 || tmp.z < -1) return null;
    return { x: (tmp.x + 1) / 2 * size.w, y: (1 - tmp.y) / 2 * size.h };
  }

  let before = performance.now();
  function render({ index, k, a, b, time, dark, tick }) {
    const now = performance.now(), dt = Math.min(.1, (now - before) / 1000);
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
    // Like the 2D sprites, actors grow more slowly than the map when you zoom in. Measured per
    // object, so a truck close to a low camera does not fill the screen.
    const growAt = (x, z) => clamp((camera.position.distanceTo(tmp.set(x, heightAt(x, z), z)) / fitDistance) ** .65, .16, 1.25);

    // sun follows the view so the shadow map stays sharp where you look
    const reach = clamp(distance * 1.1, 260, 2600);
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).addScaledVector(SUN_DIR, 3000);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 100, far: 6000 });
    sun.shadow.camera.updateProjectionMatrix();

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
    const trail = { pos: [], col: [] }, next = game.frames[Math.min(index + 1, game.frames.length - 1)];
    for (const actor of players) {
      const { player } = actor, dim = play.focus !== null && play.focus !== player.seat ? .3 : 1;
      if (dim !== actor.dim) {
        actor.dim = dim;
        for (const m of actor.mats) { m.transparent = dim < 1 || !!m.map; m.opacity = dim; m.needsUpdate = true; }
      }
      actor.grow = growAt(player.shop[0], player.shop[1]);
      actor.shop.group.scale.setScalar(SHOP_SCALE * actor.grow);
      {
        // stand on the highest corner; the footing covers the downhill side
        const sx = player.shop[0], sz = player.shop[1], hw = 31 * SHOP_SCALE * actor.grow, hd = 18 * SHOP_SCALE * actor.grow;
        actor.base = Math.max(heightAt(sx, sz), heightAt(sx - hw, sz - hd), heightAt(sx + hw, sz - hd), heightAt(sx - hw, sz + hd), heightAt(sx + hw, sz + hd));
        actor.shop.group.position.y = actor.base;
        const S = SHOP_SCALE * actor.grow, mid = project(sx, actor.base + 22 * S, sz), side = project(sx + 31 * S, actor.base + 22 * S, sz);
        if (mid) picks.push({ kind: 'shop', seat: player.seat, x: mid.x, y: mid.y, r: Math.max(22, side ? Math.hypot(side.x - mid.x, side.y - mid.y) * 1.25 : 30) });
      }
      let parked = 0;
      const colour = new THREE.Color(player.colour);
      actor.trucks.forEach((truck, t) => {
        const now = truckAt(player, t, a, b, k);
        if (now.parked) { parked++; truck.obj.visible = false; truck.heading = null; return; }
        const ta = a.p[player.seat][4], tb = next.p[player.seat][4], i = t * 3;
        const dx = wx(tb[i]) - wx(ta[i]), dz = wy(tb[i + 1]) - wy(ta[i + 1]);
        if (Math.hypot(dx, dz) > .4) {
          const want = Math.atan2(-dz, dx);
          if (truck.heading === null) truck.heading = want;
          else truck.heading += Math.atan2(Math.sin(want - truck.heading), Math.cos(want - truck.heading)) * Math.min(1, dt * 10);
        }
        const grow = growAt(now.x, now.y);
        truck.obj.visible = true;
        const heading = truck.heading ?? 0, reach = 144 * TRUCK_SCALE * grow * .45, hx = Math.cos(heading) * reach, hz = -Math.sin(heading) * reach;
        const front = roadY(now.x + hx, now.y + hz), back = roadY(now.x - hx, now.y - hz);
        truck.obj.position.set(now.x, (front + back) / 2 + Math.abs(Math.sin(time * 9 + t * 2 + player.seat)) * .6 * grow, now.y);
        truck.obj.rotation.set(0, heading, Math.atan2(front - back, reach * 2));
        truck.obj.scale.setScalar(TRUCK_SCALE * grow);
        // trail behind the truck, as in drawTrails()
        let px = now.x, pz = now.y;
        for (let back = 0; back < TRAIL && index - back >= 0; back++) {
          const list = game.frames[index - back].p[player.seat][4];
          if (list[i + 2] < PARKED) break;
          const x = wx(list[i]), z = wy(list[i + 1]), len = Math.hypot(x - px, z - pz);
          const alpha = (dim < 1 ? .12 : .55) * (1 - (back + k) / TRAIL);
          if (len > .01) {
            const pieces = strip(trail.pos, px, pz, x, z, 3.4 * grow, (vx, vz) => roadY(vx, vz) + 1);
            for (let v = 0; v < pieces * 6; v++) trail.col.push(colour.r, colour.g, colour.b, alpha);
          }
          px = x; pz = z;
        }
      });
      actor.parked = parked;
    }
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(trail.pos, 3));
    trailGeo.setAttribute('color', new THREE.Float32BufferAttribute(trail.col, 4));
    if (STREAKS) flowWater(dt, clamp((distance / fitDistance) ** .6, .55, 1.6));

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

  function drawLabels(zoom) {
    const placed = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [name, lon, lat, minZoom, kind] of labels) {
      if (zoom < minZoom) continue;
      const at = project(wx(lon), heightAt(wx(lon), wy(lat)) + 2, wy(lat));
      if (!at || at.x < 0 || at.y < 0 || at.x > size.w || at.y > size.h) continue;
      ctx.font = kind === 'river' ? 'italic 700 13px Georgia, serif' : '700 12px system-ui, sans-serif';
      const half = ctx.measureText(name).width / 2 + 6;
      if (placed.some(l => Math.abs(at.y - l.y) < 18 && Math.abs(at.x - l.x) < half + l.half)) continue;
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
    const at = project(player.shop[0], actor.base ?? 0, player.shop[1] + 26 * SHOP_SCALE * grow);
    if (!at) return;
    ctx.globalAlpha = actor.dim;
    ctx.font = '800 12px Mulish, Arial, sans-serif';
    const width = Math.min(132, ctx.measureText(player.name).width + 16), y = at.y + 4;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.beginPath();
    ctx.roundRect(at.x - width / 2, y, width, 20, 10);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name, at.x, y + 10.5, width - 12);
    ctx.fillStyle = player.colour;
    for (let i = 0; i < actor.parked; i++) { ctx.beginPath(); ctx.arc(at.x + (i - (actor.parked - 1) / 2) * 9, y + 26, 3, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  resize();
  pose(home().target, fitDistance, TILT, 0);
  const flowAt = (x, z) => { const i = cellOf(x, z); return i < 0 || !flowSpeed[i] ? null : [flowX[i], flowZ[i], flowSpeed[i]]; };
  return { render, setActive, flyHome: () => flyTo(home()), camera, controls, scene, renderer, flowAt, streaks: STREAKS, bridges, forest: forest.length, get picks() { return picks; } };
}
