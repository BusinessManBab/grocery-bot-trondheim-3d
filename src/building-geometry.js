// Cartoon building geometry, without three.js or the DOM, so the same code runs in the build
// workers (54k background buildings) and on the page (delivery homes and shop buildings).
// Each OSM footprint becomes a building in the style of what it really is (house, apartment
// block, shop or office, industrial shed, garage, church):
//  - pitched roofs (gabled or hipped, steep and with a thick overhanging eave) on house-like
//    footprints, flat roofs with a parapet and a rooftop box on big blocks
//  - windows, frames, cladding and floor bands come from one small repeating texture per style
//    (no geometry per window); the wall colour comes from vertex colours
//  - a front door on houses, a chimney on most pitched roofs, a tower and spire on churches
//  - muted pastel wall and roof colours picked per building type, in the spirit of Norwegian towns
// Output goes into growable typed-array buckets as indexed faces with flat normals: no JS
// number arrays, no copies, no welding pass.
import { Earcut } from './vendor/earcut.js';

export const STYLE_OF = {
  house: 'house', detached: 'house', semidetached_house: 'house', terrace: 'house', bungalow: 'house', cabin: 'house', farm: 'house',
  hut: 'house', residential: 'house', church: 'church', chapel: 'church', cathedral: 'church',
  apartments: 'apt', dormitory: 'apt', hotel: 'apt',
  retail: 'com', commercial: 'com', office: 'com', supermarket: 'com', kiosk: 'com', school: 'com', kindergarten: 'com', civic: 'com',
  public: 'com', hospital: 'com', university: 'com', college: 'com', government: 'com', train_station: 'com', sports_hall: 'com',
  industrial: 'ind', warehouse: 'ind', manufacture: 'ind', service: 'ind', hangar: 'ind', barn: 'ind', farm_auxiliary: 'ind',
  garage: 'shed', garages: 'shed', shed: 'shed', carport: 'shed', roof: 'shed', boathouse: 'shed', storage_tank: 'ind',
};
export const STYLES = ['house', 'church', 'apt', 'com', 'ind', 'shed'];
const PALETTE = {
  house: { walls: ['#f4ecdc', '#f0e2bf', '#e8d6c9', '#dfe8e2', '#f7f4ee', '#ecd8b6', '#dcae9c', '#e2e6ec'], roofs: ['#625b57', '#7c5248', '#925f4c', '#545257', '#6f6863', '#8a6a52'] },
  church: { walls: ['#f6f3ec'], roofs: ['#5a534f'] },
  apt: { walls: ['#ece6dc', '#e5dac9', '#dcd8d1', '#efe7da', '#e8ddd0'], roofs: ['#aaa39b'] },
  com: { walls: ['#e9e4dc', '#dfd9cf', '#ece3d3', '#e2e0db'], roofs: ['#b3aca3'] },
  ind: { walls: ['#d8d5cf', '#cdcac4', '#dcd2c2', '#c9cfd2'], roofs: ['#9e9992'] },
  shed: { walls: ['#e3dbcc', '#d9c9b4', '#dcb3a3', '#d6d6d0'], roofs: ['#6b6460', '#7d584c', '#8f8984'] },
};
const DOORS = ['#6b4a3a', '#8a3b32', '#3f5a6b', '#35503f', '#5b4f72'];
const NAMED = { white: '#f7f4ee', red: '#c9675a', yellow: '#efd98a', grey: '#bdb8b2', gray: '#bdb8b2', black: '#4a4746', brown: '#8a6650', blue: '#a9bccb', green: '#a9c2a4', beige: '#eadfc8' };
// facade tile = one window bay x one storey (metres)
const BAY = { house: 4.2, apt: 3.4, com: 6, ind: 6, shed: 3, church: 4.2 };

// ---- colour, exactly as THREE.Color does it (sRGB hex <-> linear working space) ----------
const toLinear = c => c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
const toSRGB = c => c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
const hexCache = new Map();
export function linear(hex) {
  let c = hexCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [toLinear((n >> 16 & 255) / 255), toLinear((n >> 8 & 255) / 255), toLinear((n & 255) / 255)];
    hexCache.set(hex, c);
  }
  return c;
}
const byte = v => Math.round(Math.min(255, Math.max(0, toSRGB(v) * 255)));
const hexOf = ([r, g, b]) => '#' + ((byte(r) << 16) | (byte(g) << 8) | byte(b)).toString(16).padStart(6, '0');
/** Linear value of the texture's plain-wall grey; wall materials multiply by 1 / BASE. */
export const BASE = linear('#dedede')[0];

const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

/** A growable buffer of indexed faces: position, flat normal, linear colour and (optionally) uv. */
export class Bucket {
  constructor(withUv = true, size = 1024) {
    this.withUv = withUv;
    this.vertices = 0;
    this.indices = 0;
    this.position = new Float32Array(size * 3);
    this.normal = new Float32Array(size * 3);
    this.color = new Float32Array(size * 3);
    this.uv = withUv ? new Float32Array(size * 2) : null;
    this.index = new Uint32Array(size * 2);
  }
  reserve(vertices, indices) {
    const grow = (array, need) => { if (need <= array.length) return array; const next = new array.constructor(Math.max(need, array.length * 2)); next.set(array); return next; };
    const v = this.vertices + vertices, i = this.indices + indices;
    this.position = grow(this.position, v * 3);
    this.normal = grow(this.normal, v * 3);
    this.color = grow(this.color, v * 3);
    if (this.uv) this.uv = grow(this.uv, v * 2);
    this.index = grow(this.index, i);
  }
  vertex(x, y, z, n, c, u, v) {
    const k = this.vertices++;
    this.position[k * 3] = x; this.position[k * 3 + 1] = y; this.position[k * 3 + 2] = z;
    this.normal[k * 3] = n[0]; this.normal[k * 3 + 1] = n[1]; this.normal[k * 3 + 2] = n[2];
    this.color[k * 3] = c[0]; this.color[k * 3 + 1] = c[1]; this.color[k * 3 + 2] = c[2];
    if (this.uv) { this.uv[k * 2] = u; this.uv[k * 2 + 1] = v; }
    return k;
  }
}

// face normal as THREE.BufferGeometry.computeVertexNormals() gets it: (c - b) x (a - b), summed
// over the face's triangles so a sliver triangle cannot spoil it
const normal = [0, 0, 0];
function faceNormal(points, triangles) {
  let nx = 0, ny = 0, nz = 0;
  for (const [a, b, c] of triangles) {
    const A = points[a], B = points[b], C = points[c];
    const cbx = C[0] - B[0], cby = C[1] - B[1], cbz = C[2] - B[2], abx = A[0] - B[0], aby = A[1] - B[1], abz = A[2] - B[2];
    nx += cby * abz - cbz * aby; ny += cbz * abx - cbx * abz; nz += cbx * aby - cby * abx;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  normal[0] = nx / len; normal[1] = ny / len; normal[2] = nz / len;
  return normal;
}
const TRI = [[0, 1, 2]], QUAD = [[0, 1, 2], [0, 2, 3]];
const PLAIN_UV = [.02, .02];

// texture coordinates repeat, so each face may drop whole tiles: keeps them small for int16 storage
function shiftUv(uvs) {
  let du = Infinity, dv = Infinity;
  for (const [u, v] of uvs) { du = Math.min(du, u); dv = Math.min(dv, v); }
  du = Math.floor(du); dv = Math.floor(dv);
  return uvs.map(([u, v]) => [u - du, v - dv]);
}
export function tri(b, pts, c, uvs) {
  const n = faceNormal(pts, TRI), t = uvs ? shiftUv(uvs) : null;
  b.reserve(3, 3);
  const k = b.vertices;
  for (let i = 0; i < 3; i++) { const p = pts[i], uv = t ? t[i] : PLAIN_UV; b.vertex(p[0], p[1], p[2], n, c, uv[0], uv[1]); }
  b.index[b.indices++] = k; b.index[b.indices++] = k + 1; b.index[b.indices++] = k + 2;
}
export function quad(b, pts, c, uvs) {
  const n = faceNormal(pts, QUAD), t = uvs ? shiftUv(uvs) : null;
  b.reserve(4, 6);
  const k = b.vertices;
  for (let i = 0; i < 4; i++) { const p = pts[i], uv = t ? t[i] : PLAIN_UV; b.vertex(p[0], p[1], p[2], n, c, uv[0], uv[1]); }
  b.index.set([k, k + 1, k + 2, k, k + 2, k + 3], b.indices);
  b.indices += 6;
}
// a flat polygon (roof cap): one vertex per corner, earcut triangles; triangles are [i, k, j]
// of earcut's [i, j, k], as the old per-triangle roof code wound them
function polygon(b, pts, y, triangles, c) {
  const points = pts.map(p => [p[0], y, p[1]]);
  const faces = triangles.map(([i, j, k]) => [i, k, j]);
  const n = faceNormal(points, faces);
  b.reserve(points.length, faces.length * 3);
  const k = b.vertices;
  for (const p of points) b.vertex(p[0], p[1], p[2], n, c, PLAIN_UV[0], PLAIN_UV[1]);
  for (const [i, j, l] of faces) { b.index[b.indices++] = k + i; b.index[b.indices++] = k + j; b.index[b.indices++] = k + l; }
}
// an oriented box (d along dx,dz): four sides and a lid
function box(b, cx, cz, dx, dz, w, d, y0, y1, c) {
  const nx = -dz, nz = dx, hw = w / 2, hd = d / 2;
  const P = (s, t) => [cx + dx * s + nx * t, cz + dz * s + nz * t];
  const k = [P(-hd, -hw), P(hd, -hw), P(hd, hw), P(-hd, hw)];
  for (let i = 0; i < 4; i++) { const a = k[i], e = k[(i + 1) % 4]; quad(b, [[a[0], y0, a[1]], [e[0], y0, e[1]], [e[0], y1, e[1]], [a[0], y1, a[1]]], c); }
  quad(b, k.map(p => [p[0], y1, p[1]]), c);
}

function area(pts) {
  let a = 0;
  for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) a += pts[p][0] * pts[q][1] - pts[q][0] * pts[p][1];
  return a / 2;
}
function triangulate(pts) {
  const flat = new Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { flat[i * 2] = pts[i][0]; flat[i * 2 + 1] = pts[i][1]; }
  const t = Earcut.triangulate(flat, []), out = [];
  for (let i = 0; i < t.length; i += 3) out.push([t[i], t[i + 1], t[i + 2]]);
  return out;
}
const pick = (list, n) => list[n % list.length];
const mixLinear = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const WHITE = [1, 1, 1];

/**
 * @param heightAt (x, z) => ground height in world units
 * @param M world units per metre; @param LIFT building height exaggeration
 */
export function createBuilder({ heightAt, M, LIFT }) {
  const STOREY = 3 * M * LIFT;

  function tone(hex, osm) {
    const named = osm && (NAMED[osm.toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(osm) ? osm.toLowerCase() : null));
    if (!named) return hex;
    return hexOf(mixLinear(linear(hex), linear(named), .5));   // OSM colour, toned to the map palette
  }

  /**
   * One building into `out` = { walls: {style: Bucket}, trim: Bucket, roof?: Bucket, plain?: bool }.
   * pts: [[x, z], ...] footprint corners in world units (any winding, no repeated closing corner);
   * metres: OSM height; info: [type, roof:shape, building:colour, roof:colour]; id: a stable number.
   * Walls carry their linear colour (the wall material multiplies by 1 / BASE so plain wall shows
   * the true colour); `plain` buildings get white walls and roofs, coloured by their materials.
   * hidden: optional flags per corner, 1 = the wall from this corner to the next is shared with a
   * neighbour that builds it (tools/bake_buildings.mjs), so it and any gable over it are left out:
   * two walls in one plane flicker.
   * Returns { pts, top, style } (top = highest point, for pins and labels).
   */
  function build(pts, metres, info, id, out, hidden = null) {
    if (area(pts) < 0) {
      // reversed, the wall from corner k to k + 1 becomes the wall from n - 2 - k to n - 1 - k
      const n = pts.length;
      if (hidden) hidden = Array.from({ length: n }, (_, k) => hidden[(2 * n - 2 - k) % n]);
      pts = pts.slice().reverse();
    }
    const skip = k => hidden !== null && hidden[k] === 1;
    if (pts.length < 3) return { pts, top: 0, style: 'house' };
    const [type = 'yes', roofTag = '', wallTag = '', roofColTag = ''] = info || [];
    const ar = Math.abs(area(pts)), areaM = ar / (M * M), h0 = metres;
    const style = STYLE_OF[type] || (areaM < 220 && h0 <= 9 ? 'house' : h0 > 10 ? 'apt' : areaM > 900 ? 'ind' : 'com');
    const r = hash(id + 7);
    const pal = PALETTE[style];
    const wallHex = tone(pick(pal.walls, r), wallTag), roofHex = tone(pick(pal.roofs, r >>> 5), roofColTag);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const y = heightAt(p[0], p[1]); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const foot = lo - 1.5, tiny = areaM < 30;

    // oriented rectangle along the longest edge, to decide on and lay out a pitched roof
    let best = 0, dx = 1, dz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez);
      if (len > best) { best = len; dx = ex / len; dz = ez / len; }
    }
    const nx = -dz, nz = dx;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of pts) { const s = p[0] * dx + p[1] * dz, t = p[0] * nx + p[1] * nz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const rectFill = ar / ((s1 - s0) * (t1 - t0) || 1), widthM = (t1 - t0) / M;
    const wantsPitch = roofTag ? roofTag !== 'flat' : (style === 'house' || style === 'church' || style === 'shed' || (style === 'com' && areaM < 160));
    const pitched = wantsPitch && rectFill > .8 && widthM < 22 && pts.length <= 12;
    // houses: walls to the eaves, then the roof; flat blocks: walls to full height
    const eave = (pitched ? Math.max(style === 'shed' ? 2.4 : 3.2, h0 * .62) : h0) * M * LIFT;
    // a few centimetres apart per building, so two equal neighbours' eaves and roofs, which overlap
    // over the shared wall, never lie in one plane (that flickers)
    const top = hi + eave + (r % 7) * .045 * M;

    // walls with the style's facade texture: u = metres along the wall / bay, v = height / storey
    const walls = out.walls[style] || (out.walls[style] = new Bucket(true)), bay = BAY[style] * M;
    const wc = out.plain ? WHITE : linear(wallHex);
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u0 = run / bay, u1 = (run + len) / bay, vf = (foot - lo) / STOREY, vt = (top - lo) / STOREY;
      if (!skip(i)) quad(walls, [[a[0], foot, a[1]], [b[0], foot, b[1]], [b[0], top, b[1]], [a[0], top, a[1]]], wc, [[u0, vf], [u1, vf], [u1, vt], [u0, vt]]);
      run += len;
    }

    const trim = out.trim, roofB = out.roof || trim, rc = out.roof ? WHITE : linear(roofHex), dark = linear(hexOf(scale(linear(roofHex), .72)));
    const at = (s, t, y) => [dx * s + nx * t, y, dz * s + nz * t];
    let peak = top;
    if (pitched) {
      const half = (t1 - t0) / 2, tm = (t0 + t1) / 2, o = .55 * M, steep = style === 'church' ? 1.05 : style === 'shed' ? .45 : .78;
      const rise = half * steep, ridge = top + rise;
      peak = ridge;
      const hipped = roofTag === 'hipped' || roofTag === 'pyramidal' || (!roofTag && style === 'house' && (r % 4 === 0) && (s1 - s0) / (t1 - t0) < 1.7);
      const ea = top - .12 * M;
      const E1 = at(s0 - o, t0 - o, ea), E2 = at(s1 + o, t0 - o, ea), E3 = at(s1 + o, t1 + o, ea), E4 = at(s0 - o, t1 + o, ea);
      let ra = s0 - o, rb = s1 + o;
      if (hipped) { ra = Math.min(s0 + half, (s0 + s1) / 2); rb = Math.max(s1 - half, (s0 + s1) / 2); }
      const R1 = at(ra, tm, ridge), R2 = at(rb, tm, ridge);
      quad(roofB, [E1, E2, R2, R1], rc);
      quad(roofB, [E3, E4, R1, R2], rc);
      if (hipped) { tri(roofB, [E4, E1, R1], rc); tri(roofB, [E2, E3, R2], rc); }
      else {                                                      // gable ends: wall triangles under the roof
        // a gable over a hidden (shared) wall is left out with it
        const along = p => p[0] * dx + p[1] * dz, onEnd = sEnd => pts.some((p, k) => skip(k)
          && Math.abs(along(p) - sEnd) < .4 * M && Math.abs(along(pts[(k + 1) % pts.length]) - sEnd) < .4 * M);
        for (const s of [s0, s1]) {
          if (onEnd(s)) continue;
          const A = at(s, t0, top), B = at(s, t1, top), C = at(s, tm, ridge - .1 * M);
          const vA = (top - lo) / STOREY, vC = (ridge - lo) / STOREY;
          tri(walls, [A, B, C], wc, [[0, vA], [(t1 - t0) / bay, vA], [(t1 - t0) / bay / 2, vC]]);
        }
      }
      // chunky fascia under the eaves (the cartoon "thick roof" edge)
      const f = .3 * M;
      if (!tiny) quad(trim, [E1, E2, [E2[0], ea - f, E2[2]], [E1[0], ea - f, E1[2]]], dark);
      if (!tiny) quad(trim, [E3, E4, [E4[0], ea - f, E4[2]], [E3[0], ea - f, E3[2]]], dark);
      // chimney on most houses
      if ((style === 'house') && r % 5 !== 1 && (s1 - s0) > 5 * M) {
        const cs = s0 + (s1 - s0) * (.25 + (r % 3) * .12), ct = tm + half * .45, yRoof = ridge - rise * .45;
        const [cx, , cz] = at(cs, ct, 0);
        box(trim, cx, cz, dx, dz, .9 * M, .9 * M, yRoof - .5 * M, ridge + .9 * M, linear(r % 2 ? '#9a5f4c' : '#77706a'));
      }
      // church: a tower with a spire at one end
      if (style === 'church') {
        const side = Math.min(t1 - t0, 8 * M) * .8, cs = s0 + side / 2, [cx, , cz] = at(cs, tm, 0), towerTop = ridge + 6 * M;
        box(trim, cx, cz, dx, dz, side, side, lo, towerTop, linear('#f6f3ec'));
        const hs = side / 2 + .2 * M, sp = towerTop + 11 * M, apex = [cx, sp, cz];
        const k = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]].map(([s, t]) => [cx + dx * s + nx * t, towerTop, cz + dz * s + nz * t]);
        for (let i = 0; i < 4; i++) tri(trim, [k[i], k[(i + 1) % 4], apex], linear('#4f4a47'));
        peak = sp;
      }
    } else {
      // flat roof: cap, a parapet rim and (on big blocks) a rooftop box
      polygon(roofB, pts, top, triangulate(pts), rc);
      const pc = linear(hexOf(scale(linear(wallHex), .86))), ph = top + .55 * M;
      if (!tiny) for (let i = 0; i < pts.length; i++) { if (skip(i)) continue; const a = pts[i], b = pts[(i + 1) % pts.length]; quad(trim, [[a[0], top, a[1]], [b[0], top, b[1]], [b[0], ph, b[1]], [a[0], ph, a[1]]], pc); }
      if (areaM > 380) {
        let cx = 0, cz = 0;
        for (const p of pts) { cx += p[0]; cz += p[1]; }
        cx /= pts.length; cz /= pts.length;
        const w = Math.min(t1 - t0, 9 * M) * .35, d = Math.min(s1 - s0, 12 * M) * .3;
        box(trim, cx, cz, dx, dz, w, d, top, top + 2.2 * M, linear('#bfb8ae'));
        peak = top + 2.2 * M;
      }
    }

    // a front door on houses, in the middle of the longest wall, facing out
    if (!tiny && (style === 'house' || style === 'church' || (style === 'apt' && r % 2 === 0)) && pts.some((_, k) => !skip(k))) {
      let k = 0, len = 0;
      for (let i = 0; i < pts.length; i++) { if (skip(i)) continue; const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > len) { len = l; k = i; } }
      const a = pts[k], b = pts[(k + 1) % pts.length], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const ex = (b[0] - a[0]) / (len || 1), ez = (b[1] - a[1]) / (len || 1);
      let cx = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cz += p[1]; }
      cx /= pts.length; cz /= pts.length;
      let ox = -ez, oz = ex;
      if (ox * (mx - cx) + oz * (mz - cz) < 0) { ox = -ox; oz = -oz; }
      // the door stands clear of the wall (a few cm in the same plane flickers at a distance)
      const g = heightAt(mx, mz), w = .55 * M, off = .25 * M, dh = 2.2 * M * LIFT * .85;
      const p = (s, y) => [mx + ex * s + ox * off, y, mz + ez * s + oz * off];
      quad(trim, [p(-w, g), p(w, g), p(w, g + dh), p(-w, g + dh)], linear(pick(DOORS, r >>> 3)));
      quad(trim, [p(-w - .25 * M, g + dh), p(w + .25 * M, g + dh), p(w + .25 * M, g + dh + .25 * M), p(-w - .25 * M, g + dh + .25 * M)], WHITE);
    }
    return { pts, top: peak, style };
  }

  return { build };
}

/** Footprint ring [lon, lat, lon, lat, ...] (1e-5 degree ints) -> [[x, z], ...] without repeated corners. */
export function ringPoints(ring, wx, wy) {
  const pts = [];
  for (let i = 0; i < ring.length; i += 2) {
    const x = wx(ring[i]), z = wy(ring[i + 1]), last = pts[pts.length - 1];
    if (!last || last[0] !== x || last[1] !== z) pts.push([x, z]);
  }
  while (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}
