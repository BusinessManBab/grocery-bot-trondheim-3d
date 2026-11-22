// Builds the heavy, static parts of the 3D city off the main thread: the ~54k background
// buildings (one chunk of the 6 x 6 grid at a time) and the road ribbons. Used by
// src/world-worker.js, and directly on the page when module workers are unavailable.
//
// Everything comes back as compact typed arrays, ready to hand to the GPU without copying:
//  - positions: int16 x4 per vertex, relative to the mesh's centre, with one uniform scale per mesh
//  - normals: int8 x4 (normalized); colours: uint8 x4 (normalized, linear); facade uv: int16 / 128
//  - indices: uint16 when the mesh has fewer than 65536 vertices, else uint32
// That is 20 bytes per building vertex instead of 44, and indexed faces need 4 vertices per
// wall instead of 6.
import { Bucket, STYLES, createBuilder } from './building-geometry.js?v=30';

export const M = 1 / 1.113;              // world units per metre (one unit is 1e-5 degree of latitude)
export const LIFT = 1.3;                 // buildings a little taller than life so the town reads from above
export const RELIEF = 1.25;              // hills a little steeper than life, so the valley reads at a tilt
export const UV_SCALE = 128;             // facade uv is stored as int16 * 1/128 (textures repeat 1/128)
export const ROAD_LAYERS = [
  ['lane', 2.2], ['street', 7.5], ['major', 11], ['street', 5], ['major', 8.2],
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** World frame shared with game-view.js: x east, z south, 1 unit = 1e-5 degree of latitude. */
export function createFrame({ bounds, cols, rows, heights }) {
  const [b0, b1, b2, b3] = bounds;
  const origin = [(b0 + b2) / 2, (b1 + b3) / 2], squash = Math.cos(origin[1] / 1e5 * Math.PI / 180);
  const wx = lon => (lon - origin[0]) * squash, wy = lat => -(lat - origin[1]);
  const X0 = wx(b0), X1 = wx(b2), Z0 = wy(b3), Z1 = wy(b1), W = X1 - X0, D = Z1 - Z0;
  const gridY = i => heights[i] / 10 * M * RELIEF;
  function heightAt(x, z) {
    const fx = clamp((x - X0) / W, 0, 1) * (cols - 1), fz = clamp((z - Z0) / D, 0, 1) * (rows - 1);
    const c = Math.min(cols - 2, Math.floor(fx)), r = Math.min(rows - 2, Math.floor(fz)), u = fx - c, v = fz - r, i = r * cols + c;
    return (gridY(i) * (1 - u) + gridY(i + 1) * u) * (1 - v) + (gridY(i + cols) * (1 - u) + gridY(i + cols + 1) * u) * v;
  }
  return { wx, wy, X0, X1, Z0, Z1, W, D, heightAt, gridY };
}

/** data/buildings.bin (tools/bake_buildings.mjs) -> header and typed-array views, no parsing. */
export function readBuildings(buffer) {
  const size = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
  const base = 4 + size, arrays = {};
  for (const { name, type, length, offset } of header.layout) arrays[name] = new globalThis[type + 'Array'](buffer, base + offset, length);
  // where each building's deltas start
  const start = new Uint32Array(header.count), corner = new Uint32Array(header.count);
  for (let i = 0, d = 0, c = 0; i < header.count; i++) { start[i] = d; d += (arrays.points[i] - 1) * 2; corner[i] = c; c += arrays.points[i]; }
  return { header, arrays, start, corner };
}

/** Bucket -> transferable, quantized mesh data (see the header comment). */
function pack(bucket) {
  const n = bucket.vertices, P = bucket.position;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < n * 3; k += 3) {
    const x = P[k], y = P[k + 1], z = P[k + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const half = Math.max(x1 - x0, y1 - y0, z1 - z0) / 2 || 1, scale = half / 32767;
  const position = new Int16Array(n * 4);
  let r2 = 0;
  for (let k = 0; k < n; k++) {
    const x = (P[k * 3] - cx) / scale, y = (P[k * 3 + 1] - cy) / scale, z = (P[k * 3 + 2] - cz) / scale;
    position[k * 4] = Math.round(x); position[k * 4 + 1] = Math.round(y); position[k * 4 + 2] = Math.round(z);
    r2 = Math.max(r2, x * x + y * y + z * z);
  }
  const normal = new Int8Array(n * 4), N = bucket.normal;
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) normal[k * 4 + a] = Math.round(N[k * 3 + a] * 127);
  let color = null;
  if (bucket.color) {
    color = new Uint8Array(n * 4);
    const C = bucket.color;
    for (let k = 0; k < n; k++) {
      for (let a = 0; a < 3; a++) color[k * 4 + a] = Math.round(clamp(C[k * 3 + a], 0, 1) * 255);
      color[k * 4 + 3] = 255;
    }
  }
  let uv = null;
  if (bucket.uv) {
    uv = new Int16Array(n * 2);
    for (let k = 0; k < n * 2; k++) uv[k] = clamp(Math.round(bucket.uv[k] * UV_SCALE), -32768, 32767);
  }
  const index = n <= 65536 ? new Uint16Array(bucket.indices) : new Uint32Array(bucket.indices);
  index.set(bucket.index.subarray(0, bucket.indices));
  const transfer = [position.buffer, normal.buffer, index.buffer];
  if (color) transfer.push(color.buffer);
  if (uv) transfer.push(uv.buffer);
  return { mesh: { center: [cx, cy, cz], scale, radius: Math.sqrt(r2) + 2, vertices: n, triangles: bucket.indices / 3, position, normal, color, uv, index }, transfer };
}

/** All buildings of one chunk -> one mesh per facade style plus one for roofs and trim. */
export function buildChunk(frame, data, chunk) {
  const { header, arrays, start, corner } = data;
  const builder = createBuilder({ heightAt: frame.heightAt, M, LIFT });
  const out = { walls: {}, trim: new Bucket(false, 1 << 14) };
  const [first, count] = header.chunks[chunk];
  for (let i = first; i < first + count; i++) {
    const n = arrays.points[i], d = start[i];
    let lon = arrays.first[i * 2], lat = arrays.first[i * 2 + 1];
    const pts = [[frame.wx(lon), frame.wy(lat)]];
    for (let k = 0; k < n - 1; k++) {
      lon += arrays.delta[d + k * 2]; lat += arrays.delta[d + k * 2 + 1];
      pts.push([frame.wx(lon), frame.wy(lat)]);
    }
    const info = [header.types[arrays.type[i]], header.roofs[arrays.roof[i]], header.colours[arrays.wall[i]], header.colours[arrays.roofColour[i]]];
    // walls shared with a neighbour that keeps them (tools/bake_buildings.mjs), per corner
    const hidden = arrays.hidden ? arrays.hidden.subarray(corner[i], corner[i] + n) : null;
    builder.build(pts, arrays.height[i], info, arrays.id[i], out, hidden);
  }
  const meshes = [], transfer = [];
  for (const style of STYLES) {
    const bucket = out.walls[style];
    if (!bucket || !bucket.vertices) continue;
    const packed = pack(bucket);
    meshes.push({ part: 'walls', style, ...packed.mesh });
    transfer.push(...packed.transfer);
  }
  if (out.trim.vertices) {
    const packed = pack(out.trim);
    meshes.push({ part: 'trim', ...packed.mesh });
    transfer.push(...packed.transfer);
  }
  return { result: { chunk, count, meshes }, transfer };
}

// ---- roads ------------------------------------------------------------------------------
// Bridge decks (found on the page from the water mask) lift roads over the water; trucks use the
// same rule on the page.
export function createDecks(bridges, heightAt) {
  const RAMP = 26, CELL = 160, buckets = new Map();
  const key = (x, z) => (z + 32768) * 65536 + (x + 32768);
  for (const br of bridges) {
    const margin = RAMP + br.half + 4;
    const x0 = Math.floor((Math.min(br.ax, br.bx) - margin) / CELL), x1 = Math.floor((Math.max(br.ax, br.bx) + margin) / CELL);
    const z0 = Math.floor((Math.min(br.az, br.bz) - margin) / CELL), z1 = Math.floor((Math.max(br.az, br.bz) + margin) / CELL);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const k = key(x, z);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(br);
    }
  }
  function deckAt(x, z) {
    const list = buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return -Infinity;
    let best = -Infinity;
    for (const br of list) {
      const dx = br.bx - br.ax, dz = br.bz - br.az, t = ((x - br.ax) * dx + (z - br.az) * dz) / (br.length * br.length);
      const side = Math.abs((x - br.ax) * dz - (z - br.az) * dx) / br.length;
      if (side > br.half + 3) continue;
      const along = t * br.length;
      let h;
      if (t >= 0 && t <= 1) h = br.deckA + (br.deckB - br.deckA) * t;
      else if (along < 0 && along > -RAMP) { const u = 1 + along / RAMP, g = heightAt(x, z); h = g + (br.deckA - g) * u * u * (3 - 2 * u); }
      else if (along > br.length && along < br.length + RAMP) { const u = 1 - (along - br.length) / RAMP, g = heightAt(x, z); h = g + (br.deckB - g) * u * u * (3 - 2 * u); }
      else continue;
      if (h > best) best = h;
    }
    return best;
  }
  return { deckAt, roadY: (x, z) => Math.max(heightAt(x, z), deckAt(x, z)) };
}

class Ribbon {                                // positions + normals, indexed, growable
  constructor() { this.vertices = 0; this.indices = 0; this.position = new Float32Array(1 << 15); this.normal = new Float32Array(1 << 15); this.index = new Uint32Array(1 << 15); this.color = null; this.uv = null; }
  reserve(v, i) {
    const grow = (a, need) => { if (need <= a.length) return a; const b = new a.constructor(Math.max(need, a.length * 2)); b.set(a); return b; };
    this.position = grow(this.position, (this.vertices + v) * 3);
    this.normal = grow(this.normal, (this.vertices + v) * 3);
    this.index = grow(this.index, this.indices + i);
  }
  vertex(x, y, z, n) {
    const k = this.vertices++;
    this.position[k * 3] = x; this.position[k * 3 + 1] = y; this.position[k * 3 + 2] = z;
    this.normal[k * 3] = n[0]; this.normal[k * 3 + 1] = n[1]; this.normal[k * 3 + 2] = n[2];
    return k;
  }
  // a triangle, wound to face up (towards +y) whatever order it comes in
  face(a, b, c) {
    const P = this.position;
    const cross = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
    if (cross >= 0) { this.index[this.indices++] = a; this.index[this.indices++] = b; this.index[this.indices++] = c; }
    else { this.index[this.indices++] = a; this.index[this.indices++] = c; this.index[this.indices++] = b; }
  }
}

/**
 * Road ribbons: the 2D map's five strokes (casing under fill) as flat ribbons on the ground.
 * Joins are mitred where a road bends gently and get a round cap where it turns sharply or ends,
 * like the 2D lineJoin/lineCap 'round'. A straight piece is split only where the ground (or a
 * bridge ramp) would otherwise rise through it, so flat streets cost two vertices per corner.
 */
export function buildRoads(frame, roads, bridges, grid = 6) {
  const { wx, wy, X0, Z0, W, D } = frame;
  const { roadY } = createDecks(bridges, frame.heightAt);
  const n = [0, 0, 0];
  const normalAt = (x, z) => {
    const e = 3, gx = (roadY(x - e, z) - roadY(x + e, z)) / (2 * e), gz = (roadY(x, z - e) - roadY(x, z + e)) / (2 * e);
    const len = Math.hypot(gx, 1, gz);
    n[0] = gx / len; n[1] = 1 / len; n[2] = gz / len;
    return n;
  };
  const TOLERANCE = .15, STEP = 6, DISC = 10, MITRE = Math.cos(20 * Math.PI / 180);
  const results = [], transfer = [];
  ROAD_LAYERS.forEach(([kind, half], layer) => {
    const lift = .5 + layer * .05;
    const chunks = new Map();
    for (const line of roads[kind] || []) {
      const middle = Math.floor(line.length / 4) * 2;
      const col = clamp(Math.floor((wx(line[middle]) - X0) / W * grid), 0, grid - 1), row = clamp(Math.floor((wy(line[middle + 1]) - Z0) / D * grid), 0, grid - 1);
      const key = row * grid + col;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(line);
    }
    for (const [chunk, lines] of chunks) {
      const out = new Ribbon();
      const disc = (x, z) => {
        out.reserve(DISC + 1, DISC * 3);
        const nn = normalAt(x, z), c = out.vertex(x, roadY(x, z) + lift, z, nn);
        for (let i = 0; i < DISC; i++) {
          const a = i / DISC * Math.PI * 2, px = x + Math.cos(a) * half, pz = z + Math.sin(a) * half;
          out.vertex(px, roadY(px, pz) + lift, pz, nn);
        }
        for (let i = 0; i < DISC; i++) out.face(c, c + 1 + i, c + 1 + (i + 1) % DISC);
      };
      let prev = -1;                          // the strip's last left/right vertex pair (left index)
      const pair = (x, z, ox, oz, connect) => {
        out.reserve(2, 6);
        const nn = normalAt(x, z);
        const l = out.vertex(x + ox, roadY(x + ox, z + oz) + lift, z + oz, nn);
        out.vertex(x - ox, roadY(x - ox, z - oz) + lift, z - oz, nn);
        if (connect && prev >= 0) { out.face(prev, l, l + 1); out.face(prev, l + 1, prev + 1); }
        prev = l;
      };
      // straight piece a -> b with the strip's offset (ox, oz): only the samples the ground needs
      const piece = (ax, az, bx, bz, ox, oz) => {
        const len = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(len / STEP));
        if (k === 1) return;
        const h = new Float32Array((k + 1) * 3);
        for (let s = 0; s <= k; s++) {
          const x = ax + (bx - ax) * s / k, z = az + (bz - az) * s / k;
          h[s * 3] = roadY(x, z); h[s * 3 + 1] = roadY(x + ox, z + oz); h[s * 3 + 2] = roadY(x - ox, z - oz);
        }
        const keep = new Uint8Array(k + 1);
        keep[0] = keep[k] = 1;
        const split = (i, j) => {             // Douglas-Peucker on the height profile (centre and both edges)
          if (j - i < 2) return;
          let worst = 0, at = -1;
          for (let s = i + 1; s < j; s++) {
            const t = (s - i) / (j - i);
            for (let e = 0; e < 3; e++) {
              const dev = Math.abs(h[s * 3 + e] - (h[i * 3 + e] + (h[j * 3 + e] - h[i * 3 + e]) * t));
              if (dev > worst) { worst = dev; at = s; }
            }
          }
          if (worst > TOLERANCE) { keep[at] = 1; split(i, at); split(at, j); }
        };
        split(0, k);
        for (let s = 1; s < k; s++) if (keep[s]) pair(ax + (bx - ax) * s / k, az + (bz - az) * s / k, ox, oz, true);
      };
      for (const line of lines) {
        const pts = [];
        for (let i = 0; i < line.length; i += 2) {
          const x = wx(line[i]), z = wy(line[i + 1]), last = pts[pts.length - 1];
          if (!last || Math.hypot(x - last[0], z - last[1]) > 1e-3) pts.push([x, z]);
        }
        disc(pts[0][0], pts[0][1]);
        if (pts.length > 1) disc(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        prev = -1;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
          const ox = -(bz - az) / len * half, oz = (bx - ax) / len * half;
          if (i === 0) pair(ax, az, ox, oz, false);
          piece(ax, az, bx, bz, ox, oz);
          if (i === pts.length - 2) { pair(bx, bz, ox, oz, true); break; }
          // the corner at b: mitre a gentle bend, round cap and restart the strip on a sharp one
          const [cx, cz] = pts[i + 2], len2 = Math.hypot(cx - bx, cz - bz);
          const ux = (bx - ax) / len, uz = (bz - az) / len, vx = (cx - bx) / len2, vz = (cz - bz) / len2, cos = ux * vx + uz * vz;
          if (cos >= MITRE) {
            const mx = -(uz + vz), mz = ux + vx, ml = Math.hypot(mx, mz) || 1, k = half / Math.sqrt((1 + cos) / 2);
            pair(bx, bz, mx / ml * k, mz / ml * k, true);
          } else {
            pair(bx, bz, ox, oz, true);
            disc(bx, bz);
            pair(bx, bz, -vz * half, vx * half, false);
          }
        }
      }
      const packed = pack(out);
      results.push({ layer, kind, chunk, ...packed.mesh });
      transfer.push(...packed.transfer);
    }
  });
  return { result: { meshes: results }, transfer };
}
