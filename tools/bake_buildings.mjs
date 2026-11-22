// Bakes data/buildings.json into data/buildings.bin, the compact file the 3D view streams.
//
//   node tools/bake_buildings.mjs
//
// What it does once, offline, instead of in every visitor's browser:
//  - drops the footprints that the twelve shop models replace (the real store buildings)
//  - removes background wall jogs (the same tolerance rule the 3D view used at load time)
//  - sorts the buildings into a 6 x 6 grid of chunks, so the view can build them in parallel,
//    nearest first, and the GPU can skip chunks that are off screen
//  - keeps each wall two neighbours share on one side only (two walls in one plane flicker)
//  - stores rings as an int32 first point plus int16 deltas (1e-5 degree units), ~7x smaller
//    than the JSON and readable without parsing
//  - leaves out the footprints that data/landmarks.json's famous buildings replace
//    (tools/bake_landmarks.py) and anything standing mostly on the water the map draws
//    (houseboats, kiosks on piers, boathouses: their decks and hulls are not drawn)
// The delivery homes go to data/homes.json unchanged (they are never simplified).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
const GRID = 6;

const extra = read('buildings.json');
const town = read('game-map.json');
const game = read('game.json');
const [b0, b1, b2, b3] = town.bounds;
const origin = [(b0 + b2) / 2, (b1 + b3) / 2];
const squash = Math.cos(origin[1] / 1e5 * Math.PI / 180);
const wx = lon => (lon - origin[0]) * squash;
const wy = lat => -(lat - origin[1]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Same rule as the former contextOutline() in src/view3d.js: drop a corner when it lies within
// 1.5 m (2.5 m beyond 2.6 km of the centre) of the line between its neighbours. Corners on a wall
// shared with a neighbour (`locked`) stay, so the shared wall survives as one edge on both sides.
// Returns [[lon, lat, rawIndex], ...].
function outline(flat, locked) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1], i / 2]);
  const sq = Math.cos((b1 + b3) / 2 / 1e5 * Math.PI / 180);
  const tolerance = Math.hypot(wx(flat[0]), wy(flat[1])) > 2600 ? 2.5 : 1.5;
  let changed = true;
  while (changed && pts.length > 4) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
      if (locked[p[2]]) continue;
      const dx = (b[0] - a[0]) * sq, dy = b[1] - a[1], px = (p[0] - a[0]) * sq, py = p[1] - a[1];
      const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy || 1), 0, 1);
      if (Math.hypot(px - t * dx, py - t * dy) * 1.113 <= tolerance) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  // a closing point equal to the first one, or repeated corners, add nothing but empty walls
  const out = [];
  for (const p of pts) if (!out.length || p[0] !== out[out.length - 1][0] || p[1] !== out[out.length - 1][1]) out.push(p);
  while (out.length > 3 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

// Shared walls. Neighbours in a terrace or a town-centre block share the wall between them
// (OpenStreetMap gives both footprints the same two corner nodes). Built twice, the two walls lie
// in exactly the same plane with different colours and windows, and the GPU cannot decide which is
// in front: they flicker as the camera moves. Each shared wall is kept on one side only: on the
// taller building, else on a delivery home, else on the lower id. The other side's wall (and its
// gable, see src/building-geometry.js) is marked hidden: per corner in buildings.bin, and as
// `hidden` on the homes in homes.json.
const edgeKey = (ax, ay, bx, by) => (ax < bx || (ax === bx && ay < by)) ? `${ax},${ay},${bx},${by}` : `${bx},${by},${ax},${ay}`;
function rawEdges(flat) {
  const n = flat.length / 2, list = [];
  let m = n;
  if (n > 1 && flat[0] === flat[(n - 1) * 2] && flat[1] === flat[(n - 1) * 2 + 1]) m = n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, ax = flat[i * 2], ay = flat[i * 2 + 1], bx = flat[j * 2], by = flat[j * 2 + 1];
    if (ax !== bx || ay !== by) list.push([i, j, edgeKey(ax, ay, bx, by)]);
  }
  return list;
}

// Water as the 3D ground paints it: one canvas path of all water rings filled with the nonzero
// rule, so islands and filled-in harbours (rings wound the other way) are land. A point is on
// water when the rings' winding number around it is not zero.
const waterEdges = new Map(), BAND = 40;               // horizontal bands of edges, 40 units tall
for (const w of town.water) {
  for (let i = 0; i < w.length; i += 2) {
    const j = (i + 2) % w.length, ax = w[i], ay = w[i + 1], bx = w[j], by = w[j + 1];
    if (ay === by) continue;
    for (let band = Math.floor(Math.min(ay, by) / BAND); band <= Math.floor(Math.max(ay, by) / BAND); band++) {
      if (!waterEdges.has(band)) waterEdges.set(band, []);
      waterEdges.get(band).push([ax, ay, bx, by]);
    }
  }
}
function onWater(x, y) {
  let winding = 0;
  for (const [ax, ay, bx, by] of waterEdges.get(Math.floor(y / BAND)) || []) {
    if ((ay <= y) === (by <= y)) continue;
    const cross = ax + (y - ay) / (by - ay) * (bx - ax);
    if (cross > x) winding += by > ay ? 1 : -1;
  }
  return winding !== 0;
}
// share of a footprint on water: its centre and points between the centre and each corner
function wetShare(ring) {
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  const samples = [[cx, cy], ...ring.map(([x, y]) => [cx + (x - cx) * .7, cy + (y - cy) * .7]), ...ring.map(([x, y]) => [cx + (x - cx) * .3, cy + (y - cy) * .3])];
  return samples.filter(([x, y]) => onWater(x + .5, y + .5)).length / samples.length;
}
const landmarks = fs.existsSync(path.join(ROOT, 'data', 'landmarks.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'landmarks.json'), 'utf8')) : { sites: [] };
const replaced = new Set(landmarks.sites.flatMap(site => site.replaces || []));

const stores = new Set(game.meta.players.filter(p => p.store?.footprint).map(p => p.store.footprint.ring.join(',')));
// a shop without a mapped store gets the 3D view's model shop on a plaza: the buildings within
// 100 units of it make way (as in the 2D map)
const PLAZA = 100, plazas = game.meta.players.filter(p => !p.store?.footprint).map(p => [wx(p.shop[0]), wy(p.shop[1])]);
const onPlaza = flat => { for (let i = 0; i < flat.length; i += 2) if (plazas.some(([x, z]) => Math.hypot(wx(flat[i]) - x, wy(flat[i + 1]) - z) < PLAZA)) return true; return false; };
const table = list => { const index = new Map(list.map((v, i) => [v, i])); return v => { if (!index.has(v)) { index.set(v, list.length); list.push(v); } return index.get(v); }; };
const types = [], roofs = [''], colours = [''];
const typeOf = table(types), roofOf = table(roofs), colourOf = table(colours);

// Duplicates: the same footprint mapped twice (a building and its building:part, or a delivery
// home that is also a background building) would stand in exactly the same place, every wall
// and roof flickering. Only the delivery home, else the tallest copy, is kept.
const shapeKey = flat => rawEdges(flat).map(e => e[2]).sort().join(';');
const homeShapes = new Set(extra.homes.map(h => shapeKey(h.ring)));
const tallestOf = new Map();
extra.buildings.forEach((b, id) => {
  const key = shapeKey(b.slice(1)), best = tallestOf.get(key);
  if (best === undefined || b[0] > extra.buildings[best][0]) tallestOf.set(key, id);
});
const duplicate = new Set();
extra.buildings.forEach((b, id) => { const key = shapeKey(b.slice(1)); if (homeShapes.has(key) || tallestOf.get(key) !== id) duplicate.add(id); });

// every wall of every kept footprint and delivery home, by its two corners; homes are built at
// 7 m at least (src/view3d.js)
const owners = new Map();
const own = (key, owner) => { const list = owners.get(key); if (list) list.push(owner); else owners.set(key, [owner]); };
const homeOwner = (home, i) => ({ id: 100000 + i, h: Math.max(7, home.h), home: true });
extra.homes.forEach((home, i) => { for (const [, , key] of rawEdges(home.ring)) own(key, homeOwner(home, i)); });
extra.buildings.forEach((b, id) => {
  if (stores.has(b.slice(1).join(',')) || replaced.has(id) || onPlaza(b.slice(1)) || duplicate.has(id)) return;
  for (const [, , key] of rawEdges(b.slice(1))) own(key, { id, h: b[0], home: false });
});
const wins = (o, me) => o.h > me.h || (o.h === me.h && ((o.home && !me.home) || (o.home === me.home && o.id < me.id)));

const items = [];
let dropped = 0, wet = 0, landmarked = 0, hiddenWalls = 0, duplicates = 0;
extra.buildings.forEach((b, id) => {
  if (stores.has(b.slice(1).join(',')) || onPlaza(b.slice(1))) { dropped++; return; }
  if (duplicate.has(id)) { duplicates++; return; }
  if (replaced.has(id)) { landmarked++; return; }
  const raw = [];
  for (let i = 1; i < b.length; i += 2) raw.push([b[i], b[i + 1]]);
  if (wetShare(raw) >= .5) { wet++; return; }
  const flat = b.slice(1), locked = new Uint8Array(flat.length / 2), shared = new Map(), me = { id, h: b[0], home: false };
  for (const [i, j, key] of rawEdges(flat)) {
    const others = owners.get(key).filter(o => o.id !== id);
    if (!others.length) continue;
    locked[i] = locked[j] = 1;
    shared.set(i, { j, hide: others.some(o => wins(o, me)) });
  }
  const ring = outline(flat, locked);
  if (ring.length < 3) { dropped++; return; }
  const hidden = ring.map((p, k) => {
    const e = shared.get(p[2]), next = ring[(k + 1) % ring.length];
    return e && e.hide && e.j === next[2] ? 1 : 0;
  });
  hiddenWalls += hidden.reduce((n, v) => n + v, 0);
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  const col = clamp(Math.floor((cx - b0) / (b2 - b0) * GRID), 0, GRID - 1);
  const row = clamp(Math.floor((b3 - cy) / (b3 - b1) * GRID), 0, GRID - 1);
  const [type = 'yes', roof = '', wall = '', roofColour = ''] = extra.info?.[id] || [];
  items.push({ id, chunk: row * GRID + col, ring, hidden, h: clamp(Math.round(b[0]), 1, 255),
    type: typeOf(type), roof: roofOf(roof), wall: colourOf(wall), roofColour: colourOf(roofColour) });
});
if (extra.buildings.length > 65535) throw new Error('ids no longer fit in uint16');
if (types.length > 255 || roofs.length > 255 || colours.length > 255) throw new Error('tag tables no longer fit in uint8');
items.sort((p, q) => p.chunk - q.chunk || p.id - q.id);

const count = items.length, points = items.reduce((n, it) => n + it.ring.length, 0);
const chunks = Array.from({ length: GRID * GRID }, () => [0, 0]);
items.forEach((it, i) => { const c = chunks[it.chunk]; if (!c[1]) c[0] = i; c[1]++; });

// layout: [u32 header bytes][header JSON, padded to 4][arrays at the offsets listed in the header]
const layout = [];
let offset = 0;
const add = (name, type, length) => {
  const size = { Int32: 4, Uint16: 2, Int16: 2, Uint8: 1 }[type];
  offset = Math.ceil(offset / 4) * 4;
  layout.push({ name, type, length, offset });
  offset += size * length;
};
add('first', 'Int32', count * 2);
add('delta', 'Int16', (points - count) * 2);
add('id', 'Uint16', count);
add('points', 'Uint16', count);
add('height', 'Uint8', count);
add('type', 'Uint8', count);
add('roof', 'Uint8', count);
add('wall', 'Uint8', count);
add('roofColour', 'Uint8', count);
add('hidden', 'Uint8', points);
const body = new ArrayBuffer(Math.ceil(offset / 4) * 4);
const view = Object.fromEntries(layout.map(l => [l.name, new globalThis[l.type + 'Array'](body, l.offset, l.length)]));
let d = 0, q = 0;
items.forEach((it, i) => {
  for (const flag of it.hidden) view.hidden[q++] = flag;
  view.first[i * 2] = it.ring[0][0];
  view.first[i * 2 + 1] = it.ring[0][1];
  for (let k = 1; k < it.ring.length; k++) {
    const dx = it.ring[k][0] - it.ring[k - 1][0], dy = it.ring[k][1] - it.ring[k - 1][1];
    if (Math.abs(dx) > 32767 || Math.abs(dy) > 32767) throw new Error(`building ${it.id}: edge too long for int16`);
    view.delta[d++] = dx; view.delta[d++] = dy;
  }
  view.id[i] = it.id;
  view.points[i] = it.ring.length;
  view.height[i] = it.h;
  view.type[i] = it.type;
  view.roof[i] = it.roof;
  view.wall[i] = it.wall;
  view.roofColour[i] = it.roofColour;
});

// fingerprint of the inputs, so tools/check_preview.py can tell when the bake is stale
const source = crypto.createHash('sha256');
for (const file of ['buildings.json', 'game-map.json', 'game.json', 'landmarks.json']) if (fs.existsSync(path.join(ROOT, 'data', file))) source.update(fs.readFileSync(path.join(ROOT, 'data', file)));
const header = { format: 'grocery-bot-buildings/2', source: source.digest('hex').slice(0, 16), attribution: extra.attribution, bounds: town.bounds, grid: GRID,
  count, points, chunks, types, roofs, colours, layout };
let json = Buffer.from(JSON.stringify(header));
json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const lead = Buffer.alloc(4);
lead.writeUInt32LE(json.length);
fs.writeFileSync(path.join(ROOT, 'data', 'buildings.bin'), Buffer.concat([lead, json, Buffer.from(body)]));
// homes: hidden flags per corner as ringPoints() in src/building-geometry.js sees the ring
// (repeated and closing corners dropped)
let hiddenHomeWalls = 0;
const homes = extra.homes.map((home, i) => {
  const me = homeOwner(home, i), pts = [];
  for (let k = 0; k < home.ring.length; k += 2) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== home.ring[k] || last[1] !== home.ring[k + 1]) pts.push([home.ring[k], home.ring[k + 1]]);
  }
  while (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  const hidden = pts.map((p, k) => {
    const q = pts[(k + 1) % pts.length], list = owners.get(edgeKey(p[0], p[1], q[0], q[1])) || [];
    return list.some(o => o.id !== me.id && wins(o, me)) ? 1 : 0;
  });
  const n = hidden.reduce((a, v) => a + v, 0);
  hiddenHomeWalls += n;
  return n ? { ...home, hidden } : home;
});
fs.writeFileSync(path.join(ROOT, 'data', 'homes.json'), JSON.stringify({ attribution: extra.attribution, homes }));

const rawPoints = extra.buildings.reduce((n, b) => n + (b.length - 1) / 2, 0);
console.log(`buildings.bin: ${count} buildings (${dropped} store/degenerate, ${hiddenWalls} shared walls kept on one side, ${duplicates} duplicates, ${landmarked} replaced by landmarks, ${wet} on water left out), ` +
  `${points} corners (${rawPoints} before simplifying), ${(4 + json.length + body.byteLength) / 1e6} MB; ` +
  `chunk sizes ${Math.min(...chunks.map(c => c[1]))}-${Math.max(...chunks.map(c => c[1]))}; homes.json: ${extra.homes.length} homes (${hiddenHomeWalls} shared walls left to a neighbour)`);
