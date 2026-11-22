// Oslo's famous buildings for the 3D view, from data/landmarks.json (tools/bake_landmarks.py).
// Most are their real OpenStreetMap building parts, each extruded from its own floor to its own
// roof height in its mapped colour (the City Hall's towers, the Royal Palace, the cathedral, the
// 100 m+ towers by Oslo S, Barcode), with a facade that suits it and a few details OSM cannot hold
// (clock faces, the palace portico, castle roofs, the cathedral spire, the museum's light hall).
// Shapes OSM cannot describe are modelled by hand on each building's measured footprint frame:
// the Opera House's marble roof sloping into the fjord, MUNCH's bent top, the Astrup Fearnley
// Museum's sail roofs, the Fram Museum's A-frames and the Vigeland Monolith.
// Everything is merged into one mesh per material: about ten draw calls for all of it.
//
// Other towns use the same file (tools/bake_landmarks.mjs writes their data/landmarks.json from
// tools/landmarks.spec.json). Their sites pick a model by `site.model`: the generic ones below
// (church, outline, rapids) are parametrised by the spec (colours, heights, which way a tower
// faces), and a town's own signature shapes are added to MODELS under their own names.
// Moving water (rapids, waterfalls) is the only animation: one texture offset per frame.
import * as THREE from 'three';
import { Bucket, linear, quad, tri } from './building-geometry.js?v=30';
import { Earcut } from './vendor/earcut.js';

// facade tile: [bay width m, storey height m]
const TILE = { glass: [3, 3.6], tower: [1.8, 3.6], brick: [3.6, 4.2], classic: [4.6, 5.2], castle: [7, 6], slate: [9, 8],
  alabaster: [3, 3], munch: [1.4, 4], aluminium: [2.4, 3], timber: [.6, 4], dark: [3, 3.6], stripes: [2, 3.6], church: [5.5, 11] };
const NAMED = { white: '#f4f2ec', grey: '#9a9894', gray: '#9a9894', lightgrey: '#c9c7c2', black: '#3a3a3c', yellow: '#e8cf72' };

function facadeTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#dedede';
  g.fillRect(0, 0, 128, 128);
  const pane = (x, y, w, h, glass = '#6f8a9c', frame = '#ffffff', f = 5) => {
    g.fillStyle = frame; g.fillRect(x, y, w, h);
    g.fillStyle = glass; g.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.beginPath(); g.moveTo(x + f + 2, y + h - f - 4); g.lineTo(x + f + 10, y + f + 2); g.lineTo(x + f + 15, y + f + 2); g.lineTo(x + f + 7, y + h - f - 4); g.fill();
  };
  if (kind === 'glass' || kind === 'dark') {
    g.fillStyle = kind === 'dark' ? '#3b4650' : '#7f9aab'; g.fillRect(0, 0, 128, 128);      // curtain wall
    g.fillStyle = kind === 'dark' ? '#5b6670' : '#a9bcc8'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 0, 5, 128);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(14, 120); g.lineTo(60, 10); g.lineTo(84, 10); g.lineTo(38, 120); g.fill();
  } else if (kind === 'tower' || kind === 'stripes') {
    g.fillStyle = kind === 'stripes' ? '#2f3337' : '#c9cbcc';
    g.fillRect(64, 0, 64, 128);                                                           // vertical bands
    g.fillStyle = '#7d93a1'; g.fillRect(70, 8, 52, 100);
  } else if (kind === 'brick') {
    g.fillStyle = '#cfcfcf'; for (let y = 4; y < 128; y += 8) g.fillRect(0, y, 128, 1.5);   // brick courses
    pane(34, 22, 60, 76, '#5d6f7a', '#e9e9e9', 6);
  } else if (kind === 'classic') {
    g.fillStyle = '#c9c9c9'; g.fillRect(0, 114, 128, 14); g.fillRect(0, 0, 128, 7);         // cornice and plinth band
    pane(36, 24, 56, 78, '#5f7380', '#f2f2f2', 7);
    g.fillStyle = '#efefef'; g.fillRect(30, 18, 68, 6);                                    // window head
  } else if (kind === 'castle') {
    g.fillStyle = '#cdcdcd'; for (let y = 10; y < 128; y += 22) for (let x = (y / 22 % 2) * 20; x < 128; x += 40) g.fillRect(x, y, 34, 2);
    g.fillStyle = '#4b555b'; g.beginPath(); g.roundRect(52, 40, 24, 40, [12, 12, 0, 0]); g.fill();   // small arched window
  } else if (kind === 'church') {
    g.fillStyle = '#cfcfcf'; for (let y = 4; y < 128; y += 8) g.fillRect(0, y, 128, 1.5);   // brick courses
    g.fillStyle = '#ececec'; g.beginPath(); g.roundRect(46, 18, 36, 96, [18, 18, 0, 0]); g.fill();
    g.fillStyle = '#4c5a63'; g.beginPath(); g.roundRect(51, 23, 26, 86, [13, 13, 0, 0]); g.fill();   // tall arched window
    g.fillStyle = '#ececec'; g.fillRect(63, 23, 2, 86);
  } else if (kind === 'slate') {
    g.fillStyle = '#d2d2d2'; for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 2);
    for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 2, 128);
  } else if (kind === 'alabaster') {
    g.fillStyle = '#e8e8e8'; for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 3, 128);
  } else if (kind === 'munch') {
    for (let x = 0; x < 128; x += 16) { g.fillStyle = '#e6e6e6'; g.fillRect(x, 0, 9, 128); g.fillStyle = '#cfcfcf'; g.fillRect(x + 9, 0, 7, 128); }
    g.fillStyle = 'rgba(80,90,100,.25)'; for (let y = 6; y < 128; y += 12) for (let x = 2; x < 128; x += 8) g.fillRect(x, y, 3, 3);   // perforation
  } else if (kind === 'aluminium') {
    g.fillStyle = '#cdcdcd'; for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 2, 128); for (let y = 0; y < 128; y += 42) g.fillRect(0, y, 128, 2);
    g.fillStyle = '#7f909a'; g.fillRect(8, 60, 112, 14);                                   // window band
  } else if (kind === 'timber') {
    for (let x = 0; x < 128; x += 16) { g.fillStyle = '#d6d6d6'; g.fillRect(x, 0, 12, 128); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const colourOf = (value, fallback) => (value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : NAMED[value] || fallback);
const shade = (hex, k) => { const c = linear(hex); return [c[0] * k, c[1] * k, c[2] * k]; };
const shadeHex = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function buildLandmarks({ data, heightAt, wx, wy, M, LIFT, scene, wallTint, cartoon }) {
  const K = M * LIFT;                                     // world units per metre of height
  const buckets = new Map();                              // facade kind -> walls; 'plain' -> roofs and details
  const bucket = kind => { if (!buckets.has(kind)) buckets.set(kind, new Bucket(true)); return buckets.get(kind); };
  const plain = bucket('plain');
  const stats = { sites: 0, parts: 0, names: [] };
  const extraMeshes = [];                                 // meshes outside the per-material buckets (moving water)

  // ---- small geometry toolkit (world units; pts are [x, z]) -------------------------------------
  // walls of a ring from y0 to y1, facade uv in metres / tile
  function walls(kind, pts, y0, y1, rgb) {
    const [bay, storey] = TILE[kind] || [3, 3.5], b = bucket(kind);
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u0 = run / (bay * M), u1 = (run + len) / (bay * M), v0 = 0, v1 = (y1 - y0) / (storey * K);
      quad(b, [[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]], rgb, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      run += len;
    }
  }
  // a flat cap over a ring with holes, facing up (or down)
  function cap(rings, y, rgb, down = false) {
    const flat = [], holes = [], all = [];
    for (const r of rings) { if (all.length) holes.push(all.length); for (const p of r) { flat.push(p[0], p[1]); all.push(p); } }
    const t = Earcut.triangulate(flat, holes);
    for (let i = 0; i < t.length; i += 3) {
      const A = all[t[i]], B = all[t[i + 1]], C = all[t[i + 2]];
      const order = down ? [A, B, C] : [A, C, B];
      tri(plain, order.map(p => [p[0], y, p[1]]), rgb);
    }
  }
  const area = pts => { let a = 0; for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) a += pts[p][0] * pts[q][1] - pts[q][0] * pts[p][1]; return a / 2; };
  const ccw = pts => (area(pts) < 0 ? pts.slice().reverse() : pts);
  const ringPts = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([wx(flat[i]), wy(flat[i + 1])]); return out; };
  // prism: walls + roof (+ floor when it floats), from metres above `base`
  function prism(kind, rings, base, h0, h1, wallHex, roofHex) {
    const y0 = h0 > 0 ? base + h0 * K : base - 1.5, y1 = base + h1 * K;
    rings = rings.map((r, i) => (i === 0 ? ccw(r) : ccw(r).reverse()));
    for (const r of rings) walls(kind, r, y0, y1, linear(wallHex));
    cap(rings, y1, roofHex ? linear(roofHex) : shade(wallHex, .82));
    if (h0 > 0) cap(rings, y0, shade(wallHex, .6), true);
  }
  // oriented box in a local frame: f(u, v) -> [x, z]
  function box(kind, f, u0, u1, v0, v1, base, h0, h1, wallHex, roofHex) {
    prism(kind, [[f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)]], base, h0, h1, wallHex, roofHex);
  }
  // longest-edge frame of a footprint: centre, axis, extents (world units)
  function axes(pts) {
    let best = 0, dx = 1, dz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez);
      if (l > best) { best = l; dx = ex / l; dz = ez / l; }
    }
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of pts) { const s = x * dx + z * dz, t = -x * dz + z * dx; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const at = (s, t) => [dx * s - dz * t, dz * s + dx * t];
    return { dx, dz, s0, s1, t0, t1, at };
  }
  // pitched roofs on a footprint's rectangle: 'gabled' (ridge along the long side), 'hipped', 'pyramid'
  function roof(shape, pts, y, rise, hex) {
    const { s0, s1, t0, t1, at } = axes(pts), tm = (t0 + t1) / 2, sm = (s0 + s1) / 2, half = (t1 - t0) / 2, c = linear(hex);
    const P = (s, t, h) => { const [x, z] = at(s, t); return [x, h, z]; };
    const E = [P(s0, t0, y), P(s1, t0, y), P(s1, t1, y), P(s0, t1, y)], top = y + rise;
    if (shape === 'pyramid') {
      const apex = P(sm, tm, top);
      for (let i = 0; i < 4; i++) tri(plain, [E[i], E[(i + 1) % 4], apex], c);
      return;
    }
    const inset = shape === 'hipped' ? Math.min(half, (s1 - s0) / 2) : 0;
    const R1 = P(s0 + inset, tm, top), R2 = P(s1 - inset, tm, top);
    quad(plain, [E[0], E[1], R2, R1], c);
    quad(plain, [E[2], E[3], R1, R2], c);
    tri(plain, [E[3], E[0], R1], c);
    tri(plain, [E[1], E[2], R2], c);
  }
  // a vertical disc on a wall (clock face): centre, outward normal, radius
  function disc(x, y, z, nx, nz, r, hex, n = 16) {
    const c = linear(hex), tx = -nz, tz = nx, ring = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; ring.push([x + nx * .25 + tx * Math.cos(a) * r, y + Math.sin(a) * r, z + nz * .25 + tz * Math.cos(a) * r]); }
    const mid = [x + nx * .25, y, z + nz * .25];
    for (let i = 0; i < n; i++) tri(plain, [mid, ring[i], ring[(i + 1) % n]], c);
  }
  // cone / spire / column around (x, z): radius r0 at y0 to r1 at y1
  function cone(x, z, y0, y1, r0, r1, hex, n = 8) {
    const c = linear(hex);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
      const p = (ang, r, y) => [x + Math.cos(ang) * r, y, z + Math.sin(ang) * r];
      if (r1 > 0) quad(plain, [p(a, r0, y0), p(b, r0, y0), p(b, r1, y1), p(a, r1, y1)], c);
      else tri(plain, [p(a, r0, y0), p(b, r0, y0), [x, y1, z]], c);
    }
    if (r1 > 0) { const top = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; top.push([x + Math.cos(a) * r1, z + Math.sin(a) * r1]); } cap([top], y1, c.map(v => v * .9)); }
  }
  // a site's measured frame: (u along the long axis, v to its left), metres -> world [x, z]
  function frameOf(site) {
    const f = site.frame, a = f.angle * Math.PI / 180, cx = wx(f.center[0]), cz = wy(f.center[1]);
    return (u, v) => [cx + (u * Math.cos(a) - v * Math.sin(a)) * M, cz + (-u * Math.sin(a) - v * Math.cos(a)) * M];
  }
  function baseOf(points) { let lo = Infinity; for (const [x, z] of points) lo = Math.min(lo, heightAt(x, z)); return lo; }

  // ---- hand models -----------------------------------------------------------------------------
  const animated = [];
  const castleTile = () => [TILE.castle[0] * M, TILE.castle[1] * K];                                    // textures whose offset moves with time
  const siteRings = site => (site.outline || []).map(ringPts);
  // outer rings of an outline (a relation may list several outers and inners)
  const outerRings = (site, all = siteRings(site)) => all.filter((r, i) => i === 0 || Math.abs(area(r)) > Math.abs(area(all[0])) * .02 && !all.slice(0, i).some(o => insideRing(r[0], o)));
  function insideRing([x, z], pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
    }
    return c;
  }
  // gabled roof over the rectangle [s0, s1] x [t0, t1] of an axes() frame, with gables in the wall's facade
  function gableRoof(frame, s0, s1, t0, t1, y, rise, roofHex, wallKind, wallHex, overhang = .6 * M) {
    const { at } = frame, tm = (t0 + t1) / 2, c = linear(roofHex), w = linear(wallHex);
    const P = (s, t, h) => { const [x, z] = at(s, t); return [x, h, z]; };
    const o = overhang, e = y - .2 * K;
    quad(plain, [P(s0 - o, t0 - o, e), P(s1 + o, t0 - o, e), P(s1 + o, tm, y + rise), P(s0 - o, tm, y + rise)], c);
    quad(plain, [P(s1 + o, t1 + o, e), P(s0 - o, t1 + o, e), P(s0 - o, tm, y + rise), P(s1 + o, tm, y + rise)], c);
    const [bay, storey] = TILE[wallKind] || [3, 3.5], b = bucket(wallKind);
    for (const s of [s0, s1]) tri(b, [P(s, t0, y), P(s, t1, y), P(s, tm, y + rise)], w,
      [[0, 0], [(t1 - t0) / (bay * M), 0], [(t1 - t0) / (bay * M) / 2, rise / (storey * K)]]);
  }

  const MODELS = {
    // A big brick church on its real outline (a cross or a plain hall): walls with tall arched
    // windows, a steep gabled roof over each arm of the cross, and a tower with a tiered cap and a
    // spire on one arm's end. Spec: wall, roof, height (m), tower: "north" | "east" | "south" |
    // "west" (the arm it stands on), towerTop (m, top of the masonry), spire (m, tip), cap.
    church(site) {
      const rings = outerRings(site), pts = ccw(rings[0]), base = baseOf(pts);
      const wallHex = site.wall || '#9b4c3c', roofHex = site.roof || '#474a4d', H = site.height || 15;
      walls('church', pts, base - 1.5, base + H * K, linear(wallHex));
      const fr = axes(pts), { s0, s1, t0, t1, at } = fr;
      // the arms: the cross section along the long axis is the width of its ends, and the other way round
      const sOf = ([x, z]) => x * fr.dx + z * fr.dz, tOf = ([x, z]) => -x * fr.dz + z * fr.dx, eps = 1.5 * M;
      const endT = pts.filter(p => Math.abs(sOf(p) - s0) < eps || Math.abs(sOf(p) - s1) < eps).map(tOf);
      const endS = pts.filter(p => Math.abs(tOf(p) - t0) < eps || Math.abs(tOf(p) - t1) < eps).map(sOf);
      const ta0 = endT.length ? Math.min(...endT) : t0, ta1 = endT.length ? Math.max(...endT) : t1;
      const sb0 = endS.length ? Math.min(...endS) : s0, sb1 = endS.length ? Math.max(...endS) : s1;
      const top = base + H * K, steep = 1.05;
      gableRoof(fr, s0, s1, ta0, ta1, top, (ta1 - ta0) / 2 * steep, roofHex, 'church', wallHex);
      const cross = (sb1 - sb0) < (s1 - s0) * .9 || (ta1 - ta0) < (t1 - t0) * .9;
      if (cross) {
        // the transverse arm: its own frame, with s and t swapped
        const swapped = { at: (s, t) => at(t, s) };
        gableRoof(swapped, t0, t1, sb0, sb1, top, (sb1 - sb0) / 2 * steep, roofHex, 'church', wallHex);
      }
      // the tower: on the end of the arm facing site.tower, half inside the outline
      const dirs = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] }, [ex, ez] = dirs[site.tower] || dirs.east;
      const ends = [[(sb0 + sb1) / 2, t0], [(sb0 + sb1) / 2, t1], [s0, (ta0 + ta1) / 2], [s1, (ta0 + ta1) / 2]].map(([s, t]) => ({ s, t, p: at(s, t) }));
      let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
      const end = ends.reduce((m, e) => ((e.p[0] - cx) * ex + (e.p[1] - cz) * ez > (m.p[0] - cx) * ex + (m.p[1] - cz) * ez ? e : m), ends[0]);
      const side = Math.min(9 * M, (cross ? Math.min(ta1 - ta0, sb1 - sb0) : t1 - t0) * .45), inward = side * .45;
      const len = Math.hypot(end.p[0] - cx, end.p[1] - cz) || 1, ux = (cx - end.p[0]) / len, uz = (cz - end.p[1]) / len;
      const tx = end.p[0] + ux * inward, tz = end.p[1] + uz * inward, vx = -uz, vz = ux, h = side / 2;
      const sq = r => [[tx + (ux + vx) * r, tz + (uz + vz) * r], [tx + (-ux + vx) * r, tz + (-uz + vz) * r], [tx + (-ux - vx) * r, tz + (-uz - vz) * r], [tx + (ux - vx) * r, tz + (uz - vz) * r]];
      const towerTop = base + (site.towerTop || H * 2) * K, spire = base + (site.spire || (site.towerTop || H * 2) + 16) * K, capHex = site.cap || roofHex;
      prism('church', [ccw(sq(h))], base, 0, (towerTop - base) / K, wallHex, wallHex);
      prism('brick', [ccw(sq(h * 1.08))], base, (towerTop - base) / K - 1.2, (towerTop - base) / K, '#e9e2d6', '#e9e2d6');   // cornice
      // baroque cap: a flared bell, a small open lantern and the spire with a ball
      const capH = (spire - towerTop) * .32;
      cone(tx, tz, towerTop, towerTop + capH * .55, h * 1.12, h * .62, capHex, 8);
      cone(tx, tz, towerTop + capH * .55, towerTop + capH, h * .62, h * .3, capHex, 8);
      cone(tx, tz, towerTop + capH, towerTop + capH * 1.45, h * .32, h * .32, '#e9e2d6', 8);
      cone(tx, tz, towerTop + capH * 1.45, spire, h * .36, 0, capHex, 8);
      cone(tx, tz, spire - .2 * K, spire + .9 * K, .7 * M, .7 * M, '#d9b45a', 6);
      // clock faces under the cornice, on the tower's four sides
      for (const [nx, nz] of [[ux, uz], [-ux, -uz], [vx, vz], [-vx, -vz]]) {
        disc(tx + nx * h, towerTop - 3 * K, tz + nz * h, nx, nz, 1.6 * K, '#f3ead2', 12);
      }
    },
    // A building the plain data lacks, on its real outline (courtyards included): walls in the
    // spec's facade and colour, a flat roof with a parapet. Spec: facade, wall, roof, height (m).
    outline(site) {
      const all = siteRings(site), outers = outerRings(site, all), base = baseOf(outers.flat());
      const H = site.height || 10, wallHex = site.wall || '#d8d4cc';
      const holes = all.filter(r => !outers.includes(r));
      for (const outer of outers) {
        const mine = holes.filter(r => Math.abs(area(r)) > 1 && insideRing(r[0], outer));
        prism(site.facade || 'classic', [outer, ...mine], base, 0, H, wallHex, site.roof || shadeHex(wallHex, .7));
        for (const r of [outer, ...mine]) walls(site.facade || 'classic', r.map(([x, z]) => [x, z]), base + H * K, base + (H + .8) * K, shade(wallHex, .9));
      }
    },
    // Rapids and waterfalls on a river: white water streaming down the river (faster where it is
    // steeper), a foaming step across the river at each fall, and boulders breaking the surface.
    // From the bake: line = [[lon, lat, left m, right m], ...] downstream; falls = [[lon, lat], ...].
    rapids(site) {
      const line = site.line.map(([lon, lat, l, r]) => ({ x: wx(lon), z: wy(lat), l: l * M * .94, r: r * M * .94 }));
      const n = line.length;
      for (let i = 0; i < n; i++) {
        const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)], len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        line[i].dx = (b.x - a.x) / len; line[i].dz = (b.z - a.z) / len;
      }
      const falls = (site.falls || []).map(([lon, lat]) => [wx(lon * 1e5), wy(lat * 1e5)]);
      const nearFall = (x, z) => falls.reduce((m, [fx, fz]) => Math.min(m, Math.hypot(x - fx, z - fz)), Infinity);
      const ACROSS = 6, position = [], colour = [], uv = [], index = [];
      let v = 0;
      line.forEach((p, i) => {
        if (i) {
          const q = line[i - 1], ds = Math.hypot(p.x - q.x, p.z - q.z), slope = Math.max(0, heightAt(q.x, q.z) - heightAt(p.x, p.z)) / (ds || 1);
          v += ds / (18 * M) / (1 + slope * 8);                // steeper: the streaks race
        }
        const fall = clamp(1 - nearFall(p.x, p.z) / (30 * M), 0, 1), ends = Math.min(i, n - 1 - i) / 3;
        for (let k = 0; k <= ACROSS; k++) {
          const f = k / ACROSS, off = -p.l + (p.l + p.r) * f;          // left bank to right bank
          const x = p.x - p.dz * off, z = p.z + p.dx * off;
          position.push(x, heightAt(x, z) + .7, z);
          const edge = Math.min(f, 1 - f) * ACROSS / 2;
          colour.push(1, 1, 1, clamp(.62 + fall * .38, 0, 1) * clamp(edge, .35, 1) * clamp(ends, 0, 1));
          uv.push(off / (14 * M), v);
        }
        if (i) for (let k = 0; k < ACROSS; k++) {
          const a = (i - 1) * (ACROSS + 1) + k, b = a + 1, c = a + ACROSS + 1, d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      });
      const foam = foamTexture(), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colour, 4));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(index);
      const material = new THREE.MeshBasicMaterial({ map: foam, vertexColors: true, transparent: true, depthWrite: false, forceSinglePass: true, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
      const mesh = new THREE.Mesh(geo, material);
      mesh.renderOrder = 8;
      scene.add(mesh); extraMeshes.push(mesh);
      animated.push({ texture: foam, speed: .55 });
      // each fall: a white step across the river, over its full width, racing faster
      const fallFoam = foamTexture(true), fallMat = material.clone();
      fallMat.map = fallFoam;
      animated.push({ texture: fallFoam, speed: 1.6 });
      const fp = [], fc = [], fu = [], fi = [];
      for (const [fx, fz] of falls) {
        const p = line.reduce((m, q) => (Math.hypot(q.x - fx, q.z - fz) < Math.hypot(m.x - fx, m.z - fz) ? q : m), line[0]);
        // soft-edged: the churn is brightest on the lip and fades upstream, downstream and at the banks
        const ROWS = 4, half = 6 * M, base0 = fp.length / 3, lip = [.15, 1, .8, .45, 0];
        for (let j = 0; j <= ROWS; j++) {
          const along = -half + j * 2 * half / ROWS, cx = fx + p.dx * along, cz = fz + p.dz * along;
          for (let k = 0; k <= ACROSS; k++) {
            const f = k / ACROSS, off = -p.l + (p.l + p.r) * f, x = cx - p.dz * off, z = cz + p.dx * off;
            fp.push(x, heightAt(x, z) + 1 - j * .06, z);
            fc.push(1, 1, 1, lip[j] * clamp(Math.min(f, 1 - f) * ACROSS, .3, 1));
            fu.push(off / (10 * M), j * .18);
          }
        }
        for (let j = 0; j < ROWS; j++) for (let k = 0; k < ACROSS; k++) {
          const a = base0 + j * (ACROSS + 1) + k, b = a + 1, c = a + ACROSS + 1, d = c + 1;
          fi.push(a, c, b, b, c, d);
        }
        // boulders breaking the surface around the fall (seeded, the same every visit)
        let seed = Math.round(fx * 13 + fz * 7) >>> 0 || 1;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let r = 0; r < 9; r++) {
          const along = (rand() - .5) * 24 * M, off = -p.l + (p.l + p.r) * rand(), x = fx + p.dx * along - p.dz * off, z = fz + p.dz * along + p.dx * off;
          const size = (1.4 + rand() * 1.8) * M, y = heightAt(x, z);
          cone(x, z, y - .5, y + 1.2 + size * 1.1, size, size * .35, rand() < .5 ? '#8d8b86' : '#76746f', 5);
        }
      }
      if (fp.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(fc, 4));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
        g.setIndex(fi);
        const m = new THREE.Mesh(g, fallMat);
        m.renderOrder = 9;
        scene.add(m); extraMeshes.push(m);
      }
    },
    // ---- Trondheim ---------------------------------------------------------------------------------
    // Nidarosdomen: its ~150 OpenStreetMap building parts (nave, transepts, choir, octagon, chapels,
    // west towers, buttresses), each walled from its own floor to its eaves in grey-green soapstone,
    // with its mapped roof (gabled along or across, pyramidal, flat) in green copper or stone. The
    // central tower's copper spire reaches 87 m (SNL) with a gilt ball, and the 8 m rose window sits
    // in the west front between the two west towers. A wall shared by two parts is drawn only where
    // it shows above the lower one, and no part gets a floor, so no two faces are coplanar.
    nidaros(site) {
      const stone = site.stone || '#b2b4aa', copper = site.copper || '#6f9c86', S = linear(stone);
      const base = baseOf(siteRings(site)[0]);
      const spirePart = site.parts.reduce((m, p) => (p.max > (m?.max ?? 0) ? p : m), null);
      const info = site.parts.map((p, i) => {
        const pitched = p.roofH > .3 && ['gabled', 'pyramidal', 'skillion', 'onion', 'hipped', 'dome'].includes(p.roof);
        const top = p === spirePart ? (site.spire || p.max) : p.max;
        const wallTop = (pitched && p.roof !== 'skillion' ? p.max - p.roofH : p.max - (p.roof === 'skillion' ? p.roofH / 2 : 0)) + (pitched ? 0 : (i % 3) * .25);
        return { p, pitched, top, wallTop };
      });
      // edges by their OSM node coordinates: which part stands on the other side of each wall
      const key = (a, b, c, d) => (a < c || (a === c && b < d) ? `${a},${b},${c},${d}` : `${c},${d},${a},${b}`);
      const edgeOwners = new Map();
      info.forEach((q, i) => { const r = q.p.rings[0]; for (let k = 0; k + 3 < r.length; k += 2) { const kk = key(r[k], r[k + 1], r[k + 2], r[k + 3]); if (!edgeOwners.has(kk)) edgeOwners.set(kk, []); edgeOwners.get(kk).push(i); } });
      const roofHex = p => (p.copper ? copper : shadeHex(stone, .82));
      info.forEach((q, i) => {
        const { p, pitched, top, wallTop } = q, r = p.rings[0];
        if (r.length < 8) return;
        const lo = p.min, kind = wallTop - lo > 9 ? 'church' : 'castle', [bay, storey] = TILE[kind], b = bucket(kind);
        let run = 0;
        for (let k = 0; k + 3 < r.length; k += 2) {
          const a = [wx(r[k]), wy(r[k + 1])], c = [wx(r[k + 2]), wy(r[k + 3])], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          // the visible spans of this wall: minus what a neighbour sharing the edge covers
          let spans = [[lo, wallTop]];
          for (const j of edgeOwners.get(key(r[k], r[k + 1], r[k + 2], r[k + 3]))) {
            if (j === i) continue;
            const o = info[j], h0 = o.p.min, h1 = o.wallTop;
            spans = spans.flatMap(([s0, s1]) => [[s0, Math.min(s1, h0)], [Math.max(s0, h1), s1]]).filter(([s0, s1]) => s1 - s0 > .05);
          }
          // walls run clockwise or counter-clockwise: both faces are drawn (DoubleSide), so either works
          for (const [s0, s1] of spans) {
            const y0 = s0 > 0 ? base + s0 * K : base - 1.5, y1 = base + s1 * K;
            const u0 = run / (bay * M), u1 = (run + len) / (bay * M), v0 = s0 / storey, v1 = s1 / storey;
            quad(b, [[a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]]], S, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
          }
          run += len;
        }
        const pts = ccw(ringPts(r).slice(0, -1)), y = base + wallTop * K, rise = (top - wallTop) * K, hex = roofHex(p);
        if (!pitched || p.roof === 'skillion') { cap([pts], y, linear(p.roof === 'skillion' ? hex : shadeHex(stone, .86))); return; }
        if (p.roof === 'gabled') {
          const f = axes(pts);
          if (p.across) gableRoof({ at: (s, t) => f.at(t, s) }, f.t0, f.t1, f.s0, f.s1, y, rise, hex, kind, stone, .25 * M);
          else gableRoof(f, f.s0, f.s1, f.t0, f.t1, y, rise, hex, kind, stone, .25 * M);
          return;
        }
        if (p.roof === 'hipped') { roof('hipped', pts, y, rise, hex); return; }
        // pyramidal / onion: a true pyramid over the part's ring (the octagonal spire too)
        let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
        const c = linear(hex), apex = [cx, y + rise, cz];
        for (let k = 0; k < pts.length; k++) { const A = pts[k], B = pts[(k + 1) % pts.length]; tri(plain, [[A[0], y, A[1]], [B[0], y, B[1]], apex], c); }
        if (p === spirePart) {                                  // the gilt ball on the spire's tip
          cone(cx, cz, y + rise - .4 * K, y + rise + .6 * K, .45 * M, .9 * M, '#d6b04a', 6);
          cone(cx, cz, y + rise + .6 * K, y + rise + 1.6 * K, .9 * M, 0, '#d6b04a', 6);
        }
      });
      // the rose window: on the west front, centred between the west towers, 8 m across
      const towers = site.parts.filter(p => /vesttårn/.test(p.name || ''));
      const nave = site.parts.find(p => p.name === 'Skibet');
      if (towers.length === 2 && nave) {
        const mid = pts => { const q = ringPts(pts); let x = 0, z = 0; for (const p of q) { x += p[0]; z += p[1]; } return [x / q.length, z / q.length]; };
        const [ax, az] = mid(towers[0].rings[0]), [bx, bz] = mid(towers[1].rings[0]), [nx0, nz0] = mid(nave.rings[0]);
        const cx = (ax + bx) / 2, cz = (az + bz) / 2, dl = Math.hypot(cx - nx0, cz - nz0) || 1, nx = (cx - nx0) / dl, nz = (cz - nz0) / dl;
        // the face of the west front: the furthest wall point out along the normal, near the centre line
        let far = -Infinity;
        for (const p of site.parts) if (p.max >= 20 && p !== towers[0] && p !== towers[1]) for (const [x, z] of ringPts(p.rings[0])) {
          const along = (x - cx) * nx + (z - cz) * nz, side = Math.abs(-(x - cx) * nz + (z - cz) * nx);
          if (side < 6 * M) far = Math.max(far, along);
        }
        if (far > -Infinity) {
          const fx = cx + nx * far, fz = cz + nz * far, y = base + 17 * K, k = K;
          disc(fx, y, fz, nx, nz, 4.3 * k, shadeHex(stone, .92), 24);
          disc(fx + nx * .25, y, fz + nz * .25, nx, nz, 3.7 * k, '#3f4a63', 24);
          const tx = -nz, tz = nx, sc = linear(shadeHex(stone, 1.05));
          for (let s = 0; s < 8; s++) {                           // eightfold tracery
            const ang = s / 8 * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang), w = .18 * k, R = 3.7 * k, o = .55;
            const P = (r, d) => [fx + nx * o + tx * (ca * r - sa * d), y + sa * r + ca * d, fz + nz * o + tz * (ca * r - sa * d)];
            quad(plain, [P(-R, -w), P(R, -w), P(R, w), P(-R, w)], sc);
          }
          disc(fx + nx * .6, y, fz + nz * .6, nx, nz, .9 * k, shadeHex(stone, 1.05), 12);
        }
      }
    },
    // Gamle Bybro (1861): the timber bridge on three stone piers over the Nidelva, with its neo-Gothic
    // red portals at both ends ("Lykkens portal"). Spec: span [[lon, lat] west, [lon, lat] east], width m.
    bybro(site) {
      const [A, B] = site.span.map(([lon, lat]) => [wx(lon * 1e5), wy(lat * 1e5)]);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]), dx = (B[0] - A[0]) / L, dz = (B[1] - A[1]) / L;
      const f = (u, v) => [A[0] + dx * u * M - dz * v * M, A[1] + dz * u * M + dx * v * M];   // u metres along, v across
      const Lm = L / M, half = (site.width || 7) / 2, red = site.portal || '#b3302a';
      const yA = heightAt(...A) + .3 * K, yB = heightAt(...B) + .3 * K;
      let water = Infinity; for (let t = .15; t <= .85; t += .05) water = Math.min(water, heightAt(...f(Lm * t, 0)));
      const lift = Math.max(0, water + 4.5 * K - (yA + yB) / 2);
      const deckY = t => yA + (yB - yA) * t + lift * Math.sin(Math.PI * t) ** .6;
      const N = 12, wood = linear('#6e5444'), under = linear('#4f3d33'), rail = linear(shadeHex(red, .9));
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N, u0 = Lm * t0, u1 = Lm * t1, y0 = deckY(t0), y1 = deckY(t1), d = .9 * K;
        const P = (u, v, y) => { const [x, z] = f(u, v); return [x, y, z]; };
        quad(plain, [P(u0, -half, y0), P(u1, -half, y1), P(u1, half, y1), P(u0, half, y0)], wood);
        quad(plain, [P(u0, -half, y0 - d), P(u1, -half, y1 - d), P(u1, half, y1 - d), P(u0, half, y0 - d)], under);
        for (const v of [-half, half]) {
          quad(plain, [P(u0, v, y0 - d), P(u1, v, y1 - d), P(u1, v, y1), P(u0, v, y0)], under);
          const vr = v * .94;                                   // the red railing: top rail, mid rail, posts
          quad(plain, [P(u0, vr, y0 + 1.05 * K), P(u1, vr, y1 + 1.05 * K), P(u1, vr, y1 + 1.25 * K), P(u0, vr, y0 + 1.25 * K)], rail);
          quad(plain, [P(u0, vr, y0 + .5 * K), P(u1, vr, y1 + .5 * K), P(u1, vr, y1 + .62 * K), P(u0, vr, y0 + .62 * K)], rail);
          const [px, pz] = f(u0, vr);
          if (i) cone(px, pz, y0, y0 + 1.25 * K, .12 * M, .12 * M, shadeHex(red, .9), 4);
        }
      }
      for (const t of [.27, .5, .73]) {                         // the three stone piers
        const u = Lm * t, y = deckY(t) - .9 * K;
        const ring = [f(u - 1.6, -half - .4), f(u + 1.6, -half - .4), f(u + 1.6, half + .4), f(u - 1.6, half + .4)];
        walls('castle', ccw(ring), water - 3, y - .05 * K, linear('#9b958a'));
        cap([ccw(ring)], y - .05 * K, linear('#8c867c'));
      }
      // the portals: two posts, a lintel and a pointed neo-Gothic gable with pinnacles
      for (const [u, y] of [[0, yA - .3 * K], [Lm, yB - .3 * K]]) {
        const vp = half + .9, P = (uu, v, h) => { const [x, z] = f(uu, v); return [x, y + h * K, z]; }, c = linear(red), light = linear('#efe6d6');
        for (const s of [-1, 1]) {
          box('timber', f, u - .55, u + .55, s * vp - .55, s * vp + .55, y, 0, 6.2, red, shadeHex(red, .8));
          const [px, pz] = f(u, s * vp);
          cone(px, pz, y + 6.2 * K, y + 7.9 * K, .55 * M, 0, red, 4);
        }
        box('timber', f, u - .4, u + .4, -vp + .3, vp - .3, y, 4.6, 5.6, red, shadeHex(red, .8));
        // the gable over the lintel: front and back triangles, two sloped faces, a white trim
        const g0 = 5.6, g1 = 8.4, e = vp - .55;
        for (const uu of [u - .4, u + .4]) tri(plain, [P(uu, -e, g0), P(uu, e, g0), P(uu, 0, g1)], c);
        quad(plain, [P(u - .4, -e, g0), P(u + .4, -e, g0), P(u + .4, 0, g1), P(u - .4, 0, g1)], c);
        quad(plain, [P(u + .4, e, g0), P(u - .4, e, g0), P(u - .4, 0, g1), P(u + .4, 0, g1)], c);
        for (const uu of [u - .65, u + .65]) tri(plain, [P(uu, -e * .55, g0 + .3), P(uu, e * .55, g0 + .3), P(uu, 0, g1 - .9)], light);
      }
    },
    // The wharves (bryggene) along the Nidelva at Kjøpmannsgata and Bakklandet: tall timber warehouses
    // in ochre, red, white and brown, gables to the river, standing on posts at the water's edge.
    // Each on its real footprint (inset 0.2 m so neighbours never share a wall plane).
    wharves(site) {
      const cols = site.colours;
      site.outline.forEach((flat, i) => {
        let pts = ccw(ringPts(flat));
        if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts = pts.slice(0, -1);
        let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= pts.length; cz /= pts.length;
        const inner = pts.map(([x, z]) => { const l = Math.hypot(x - cx, z - cz) || 1, d = Math.min(.2 * M, l * .3); return [x - (x - cx) / l * d, z - (z - cz) / l * d]; });
        const H = clamp(site.heights[i] || 10, 8, 16), base = baseOf(pts), top = base + H * K;
        const fr = axes(inner), { s0, s1, t0, t1, at } = fr, sm = (s0 + s1) / 2, tm = (t0 + t1) / 2, o = 5 * M;
        const sides = [{ p: at(s0 - o, tm), end: 1, a: [s0, t0], b: [s0, t1] }, { p: at(s1 + o, tm), end: 1, a: [s1, t0], b: [s1, t1] },
          { p: at(sm, t0 - o), end: 0, a: [s0, t0], b: [s1, t0] }, { p: at(sm, t1 + o), end: 0, a: [s0, t1], b: [s1, t1] }];
        const low = sides.reduce((m, q) => (heightAt(...q.p) < heightAt(...m.p) ? q : m));
        let seed = (i * 7919 + 13) % 97; const hex = cols[(seed + i * 3) % cols.length];
        walls('timber', inner, base - 1.5, top, linear(hex));
        const w = low.end ? (t1 - t0) : (s1 - s0), rise = w / 2 * .95, roofHex = i % 3 ? '#4a4544' : '#7a3b2e';
        if (low.end) gableRoof(fr, s0, s1, t0, t1, top, rise, roofHex, 'timber', hex, .4 * M);
        else gableRoof({ at: (s, t) => at(t, s) }, t0, t1, s0, s1, top, rise, roofHex, 'timber', hex, .4 * M);
        // posts at the water's edge on the river side, out to where the bank drops
        const [ax, az] = at(...low.a), [bx, bz] = at(...low.b), len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / (2.6 * M)));
        const ox = (low.p[0] - (ax + bx) / 2), oz = (low.p[1] - (az + bz) / 2), ol = Math.hypot(ox, oz) || 1;
        for (let k = 0; k <= n; k++) {
          const x = ax + (bx - ax) * k / n + ox / ol * .5 * M, z = az + (bz - az) * k / n + oz / ol * .5 * M;
          const g = Math.min(heightAt(x, z), base) - 1;
          cone(x, z, g, base + 1.2 * K, .22 * M, .22 * M, '#3d3530', 4);
        }
      });
    },
    // Kristiansten festning (1684): the ramparts along the fort's outline, grey stone faced with a
    // grass top sloping inwards. Spec: height (m).
    ramparts(site) {
      let pts = ccw(siteRings(site)[0]);
      if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts = pts.slice(0, -1);
      const H = (site.height || 4) * K, n = pts.length, inward = 5 * M;
      const inner = pts.map((p, i) => {
        const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
        const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
        // ccw ring in [x, z]: the left normal points inside
        const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2], m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(...m) || 1;
        const k = Math.min(2, 1 / Math.max(.3, (m[0] * n1[0] + m[1] * n1[1]) / ml));
        return [p[0] + m[0] / ml * inward * k, p[1] + m[1] / ml * inward * k];
      });
      // which side is inside: test the centroid
      let cx = 0, cz = 0; for (const [x, z] of pts) { cx += x; cz += z; } cx /= n; cz /= n;
      const d0 = Math.hypot(inner[0][0] - cx, inner[0][1] - cz) < Math.hypot(pts[0][0] - cx, pts[0][1] - cz);
      const inn = d0 ? inner : pts.map((p, i) => [2 * p[0] - inner[i][0], 2 * p[1] - inner[i][1]]);
      const stone = linear('#a39d90'), grass = linear('#7d9a58'), cs = castleTile();
      let run = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], ya = heightAt(...a), yb = heightAt(...b), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        quad(bucket('castle'), [[a[0], ya - 1.5, a[1]], [b[0], yb - 1.5, b[1]], [b[0], yb + H, b[1]], [a[0], ya + H, a[1]]], stone,
          [[run / cs[0], 0], [(run + len) / cs[0], 0], [(run + len) / cs[0], (H + 1.5) / cs[1]], [run / cs[0], (H + 1.5) / cs[1]]]);
        const ia = inn[i], ib = inn[(i + 1) % n], yia = heightAt(...ia) + H * .35, yib = heightAt(...ib) + H * .35;
        quad(plain, [[a[0], ya + H, a[1]], [b[0], yb + H, b[1]], [ib[0], Math.max(yib, yb + H * .35), ib[1]], [ia[0], Math.max(yia, ya + H * .35), ia[1]]], grass);
        run += len;
      }
    },
    // The Donjon of Kristiansten: the whitewashed four-storey keep under a hipped grey roof.
    donjon(site) {
      let pts = ccw(siteRings(site)[0]);
      if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts = pts.slice(0, -1);
      const base = baseOf(pts), top = base + (site.height || 15) * K;
      // whitewashed walls (untextured, so they stay white) with gun slits on four storeys
      walls('plain', pts, base - 1.5, top, linear('#f4f2ec'));
      const H = site.height || 15, slit = linear('#3b4044');
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(len / (4.5 * M));
        const ox = (b[1] - a[1]) / len * .25, oz = -(b[0] - a[0]) / len * .25;       // outward for a ccw ring
        for (let f = 0; f < 4; f++) for (let k = 0; k < n; k++) {
          const t = (k + .5) / n, w = .35 * M / len, y0 = base + (1.6 + f * H / 4) * K, y1 = y0 + 1.3 * K;
          const P = (tt, y) => [a[0] + (b[0] - a[0]) * tt + ox, y, a[1] + (b[1] - a[1]) * tt + oz];
          quad(plain, [P(t - w, y0), P(t + w, y0), P(t + w, y1), P(t - w, y1)], slit);
        }
      }
      roof('hipped', pts, top, ((site.roofTop || 20) - (site.height || 15)) * K, '#5d6064');
    },
    // Tyholttårnet (1983): the 124 m concrete radio tower on Tyholt, its dark glass revolving restaurant
    // at 70-76.6 m (OSM) under a white roof, and the antenna mast on top.
    tvtower(site) {
      const ring = siteRings(site)[0];
      let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
      let r = 0; for (const [x, z] of ring) r = Math.max(r, Math.hypot(x - cx, z - cz));
      const y = baseOf(ring), [d0, d1] = site.drum || [70, 76.6], H = h => y + h * K, R = r * .9;
      cone(cx, cz, y - 1.5, H(d0), R, R * .62, '#cfccc4', 16);
      cone(cx, cz, H(d0), H(d0 + .8), R * .62, R * 1.25, '#bdb9b0', 16);
      cone(cx, cz, H(d0 + .8), H(d1), R * 1.25, R * 1.25, '#2f3a44', 16);
      cone(cx, cz, H(d1), H(d1 + 2), R * 1.3, R * .55, '#f1f0ec', 16);
      cone(cx, cz, H(d1 + 2), H(96), R * .42, R * .34, '#cfccc4', 12);
      cone(cx, cz, H(96), H(site.top || 124), R * .14, R * .04, '#dcdcdc', 6);
    },
    // Oslo Opera House (Snøhetta, 2008): white marble roof rising from the fjord to a plateau, the
    // glazed main hall above it, the stage towers (35 m and 25 m) and the aluminium-clad workshops.
    // Dimensions from its OSM outline and parts (u east along the building, v north).
    opera(site) {
      const f = frameOf(site), corners = [f(-114, -65), f(112, -65), f(112, 57), f(-114, 57)], base = baseOf(corners);
      const marble = '#f5f3ee', H = 16;
      const height = (u, v) => Math.max(.4, Math.min(H, H * (u + 112) / 67, H * (v + 66) / 26));
      // the marble landscape as a height field (4 m cells) with vertical edges where it meets the land
      const U0 = -112, U1 = 40, V0 = -66, V1 = 24, S = 4, nu = Math.round((U1 - U0) / S), nv = Math.round((V1 - V0) / S);
      const P = (i, j) => { const u = U0 + (U1 - U0) * i / nu, v = V0 + (V1 - V0) * j / nv, [x, z] = f(u, v); return [x, base + height(u, v) * K, z]; };
      const m = linear(marble);
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        tri(plain, [a, c, b], m); tri(plain, [a, d, c], m);
      }
      const edge = [];
      for (let i = 0; i <= nu; i++) edge.push(P(i, 0));
      for (let j = 1; j <= nv; j++) edge.push(P(nu, j));
      for (let i = nu - 1; i >= 0; i--) edge.push(P(i, nv));
      for (let j = nv - 1; j > 0; j--) edge.push(P(0, j));
      for (let i = 0; i < edge.length; i++) {
        const a = edge[i], b = edge[(i + 1) % edge.length];
        quad(plain, [[a[0], base - 1.5, a[2]], [b[0], base - 1.5, b[2]], b, a], shade(marble, .9));
      }
      box('glass', f, -45, 0, -38, 22, base, 0, 23, '#5a81a0', marble);           // main hall, glazed
      box('aluminium', f, 0, 86, -40, 56, base, 0, 20, '#d4d6d3', '#bfc2c0');    // workshops
      box('aluminium', f, 55, 109, 3, 57, base, 0, 15, '#d4d6d3', '#bfc2c0');
      box('aluminium', f, -72, -3, 24, 57, base, 0, 11, '#dcdcd8', '#c6c6c2');
      box('aluminium', f, 0, 27, -30, 3, base, 0, 35, '#e7e4dd', '#cfccc5');     // main stage tower, white aluminium
      box('aluminium', f, 27, 50, 14, 39, base, 0, 25, '#e7e4dd', '#cfccc5');    // second stage tower
    },
    // MUNCH (Estudio Herreros, 2021): a 60 m tower in perforated aluminium on a wider base, its top
    // bending over towards the city (the sideways step the OSM parts record, made a smooth bend).
    munch(site) {
      const f = frameOf(site);
      const base = baseOf(site.parts.flatMap(p => ringPts(p.rings[0])));
      for (const p of site.parts.filter(q => q.max <= 15)) prism('glass', p.rings.map(ringPts), base, 0, p.max, '#9fb0b8', '#c8ccce');
      const v0 = -4.3, v1 = 19.3, u0 = -33.9, u1 = 32.8, colour = linear('#d5d8d9');
      // the OSM parts step 5 m sideways at 37 m and 7.5 m at 50 m: a bend at 37 m, leaning ~21°
      const levels = [0, 37, 60];
      const lean = h => (h <= 37 ? 0 : -9 * (h - 37) / 23);
      const ring = h => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => { const [x, z] = f(u, v + lean(h)); return [x, h ? base + h * K : base - 1.5, z]; });
      const b = bucket('munch'), [bay, storey] = TILE.munch;
      for (let k = 0; k < levels.length - 1; k++) {
        const lo = ring(levels[k]), hi = ring(levels[k + 1]);
        let run = 0;
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4, len = Math.hypot(lo[j][0] - lo[i][0], lo[j][2] - lo[i][2]);
          const ua = run / (bay * M), ub = (run + len) / (bay * M), va = levels[k] / storey, vb = levels[k + 1] / storey;
          quad(b, [lo[i], lo[j], hi[j], hi[i]], colour, [[ua, va], [ub, va], [ub, vb], [ua, vb]]);
          run += len;
        }
      }
      const top = ring(60);
      quad(plain, [top[0], top[3], top[2], top[1]], linear('#b9bdbf'));
    },
    // Astrup Fearnley Museet (Renzo Piano, 2012): two timber-clad halls under sweeping glass sail
    // roofs that fall towards the tip of Tjuvholmen.
    astrup(site) {
      const f = frameOf(site), a = site.frame.angle * Math.PI / 180;
      const base = baseOf(site.outline.flatMap(ringPts));
      const toLocal = ([x, z]) => { const cx = wx(site.frame.center[0]), cz = wy(site.frame.center[1]), dx = (x - cx) / M, dz = (z - cz) / M; return [dx * Math.cos(a) - dz * Math.sin(a), -dx * Math.sin(a) - dz * Math.cos(a)]; };
      for (const flat of site.outline) {
        const pts = ccw(ringPts(flat)), local = pts.map(toLocal);
        const us = local.map(p => p[0]), vs = local.map(p => p[1]);
        const ua = Math.min(...us), ub = Math.max(...us), va = Math.min(...vs), vb = Math.max(...vs);
        const big = ub - ua > 60 || (ua + ub) / 2 > 0;                // the hall to the north is the taller one
        const wallTop = big ? 12 : 6, hiRoof = big ? 22 : 12, loRoof = big ? 12 : 4;
        prism('timber', [pts], base, 0, wallTop, '#c9a678', '#b8956a');
        // the sail: a curved glass sheet over the hall, overhanging by 3 m, highest at the north end
        const n = 10, m = 4, glass = linear('#c3d6de'), rib = linear('#f2f2ee');
        const U = i => ua - 3 + (ub - ua + 6) * i / n, V = j => va - 3 + (vb - va + 6) * j / m;
        const hAt = (i, j) => { const t = i / n; return loRoof + (hiRoof - loRoof) * t * t * (3 - 2 * t) + Math.sin(Math.PI * j / m) * 1.2; };
        const Q = (i, j) => { const [x, z] = f(U(i), V(j)); return [x, base + hAt(i, j) * K, z]; };
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) quad(plain, [Q(i, j), Q(i + 1, j), Q(i + 1, j + 1), Q(i, j + 1)], (i + j) % 2 ? glass : glass.map(v => v * .96));
        for (let i = 0; i <= n; i += 2) for (let j = 0; j < m; j++) { const p = Q(i, j), q = Q(i, j + 1); quad(plain, [p, q, [q[0], q[1] + .5, q[2]], [p[0], p[1] + .5, p[2]]], rib); }
      }
    },
    // Frammuseet: the two tent-like A-frame halls on Bygdøynes (the polar ships Fram and Gjøa).
    fram(site) {
      const base = baseOf(site.parts.flatMap(p => ringPts(p.rings[0])));
      for (const p of site.parts.filter(q => q.max >= 15)) {
        const pts = ccw(ringPts(p.rings[0])), { s0, s1, t0, t1, at } = axes(pts), tm = (t0 + t1) / 2;
        const eave = base + 2 * K, top = base + p.max * K, roofC = linear('#4f565e'), wall = linear('#ebe6dc');
        const Pt = (s, t, y) => { const [x, z] = at(s, t); return [x, y, z]; };
        quad(plain, [Pt(s0, t0, eave), Pt(s1, t0, eave), Pt(s1, tm, top), Pt(s0, tm, top)], roofC);
        quad(plain, [Pt(s1, t1, eave), Pt(s0, t1, eave), Pt(s0, tm, top), Pt(s1, tm, top)], roofC);
        for (const s of [s0, s1]) {
          tri(bucket('glass'), [Pt(s, t0, eave), Pt(s, t1, eave), Pt(s, tm, top)], wall, [[0, 0], [(t1 - t0) / (3 * M), 0], [(t1 - t0) / (6 * M), (top - eave) / (3.6 * K)]]);
        }
        walls('timber', [[...at(s0, t0)], [...at(s1, t0)], [...at(s1, t1)], [...at(s0, t1)]], base - 1.5, eave, wall);
      }
    },
    // Monolitten in Vigelandsparken: a 14 m granite column on a stepped plinth ringed by 36 figure groups.
    monolitten(site) {
      const x = wx(site.frame.center[0]), z = wy(site.frame.center[1]), base = heightAt(x, z), granite = '#c2bdb3';
      let y = base - 1.5, top = base;
      for (const r of [24, 18, 12]) { top += 1.2 * K; cone(x, z, y, top, r * M, r * M, granite, 16); y = top; }
      cone(x, z, y, y + 14.1 * K, 1.7 * M, 1.3 * M, '#bab4a8', 12);
      cone(x, z, y + 14.1 * K, y + 14.9 * K, 1.3 * M, 0, '#bab4a8', 12);
      for (let i = 0; i < 36; i++) {
        const a = i / 36 * Math.PI * 2, gx = x + Math.cos(a) * 15 * M, gz = z + Math.sin(a) * 15 * M, gy = base + 1.2 * K;
        cone(gx, gz, gy, gy + 2.4 * K, 1.3 * M, .7 * M, '#b3ada2', 5);
      }
    },
  };

  // ---- sites built from their OSM parts ----------------------------------------------------------
  for (const site of data.sites) {
    stats.sites++;
    stats.names.push(site.name);
    if (site.build === 'model') {
      const model = MODELS[site.model || site.id];
      if (model) model(site); else console.warn(`No landmark model "${site.model || site.id}" for ${site.name}`);
      continue;
    }
    const parts = site.parts || [];
    const base = baseOf(parts.flatMap(p => ringPts(p.rings[0])));
    const tallest = parts.reduce((m, p) => (p.max > (m?.max ?? -1) ? p : m), null);
    parts.forEach((p, i) => {
      let kind = site.facade || 'glass', wallHex = colourOf(p.colour, site.colour || '#d8d4cc');
      if (site.facade === 'barcode') {           // Barcode: each tower in its own skin
        kind = ['glass', 'stripes', 'dark', 'tower', 'glass', 'aluminium'][i % 6];
        wallHex = ['#8fa6b4', '#e8e6e1', '#53606b', '#dcdad5', '#a8b8c2', '#d6d8d6'][i % 6];
      }
      if (site.extras === 'light-hall' && p === tallest) { kind = 'alabaster'; wallHex = '#efe8d6'; }
      if (site.id === 'domkirke') kind = wallHex === '#b2cb65' ? 'alabaster' : 'church';   // copper tower top, arched windows
      const roofHex = site.extras === 'castle-roofs' || site.extras === 'portico' ? null : undefined;
      prism(kind, p.rings.map(ringPts), base, p.min, p.max, wallHex, roofHex);
      stats.parts++;
    });
    if (site.extras === 'castle-roofs') {
      // steep roofs: pyramids on the near-square towers, gables on the long wings
      for (const p of parts) {
        const pts = ringPts(p.rings[0]), { s0, s1, t0, t1 } = axes(pts), long = (s1 - s0) / Math.max(1e-6, t1 - t0);
        if (p.max < 12 || (s1 - s0) / M > 70) continue;
        const tower = long < 1.5 && (s1 - s0) / M < 20;
        roof(tower ? 'pyramid' : long < 1.5 ? 'hipped' : 'gabled', pts, base + p.max * K, ((t1 - t0) / 2) * (tower ? 1.6 : 1.1), tower ? '#6f9a85' : '#5b6466');
      }
    }
    if (site.extras === 'portico') {
      // low hipped zinc roofs, and the columned portico with its pediment on the main front (east)
      for (const p of parts.filter(q => q.min > 0)) { const pts = ringPts(p.rings[0]); roof('hipped', pts, base + p.max * K, (axes(pts).t1 - axes(pts).t0) * .18, '#7d8790'); }
      const main = parts.filter(q => q.min > 0).sort((a, b) => b.max - a.max || b.rings[0].length - a.rings[0].length)[0];
      if (main) {
        const pts = ringPts(main.rings[0]), { s0, s1, t0, t1, at } = axes(pts);
        // the long side facing east (+x), towards Karl Johans gate
        const sm = (s0 + s1) / 2, east = at(sm, t1)[0] > at(sm, t0)[0] ? t1 : t0, out = east === t1 ? 1 : -1;
        const y0 = base + main.min * K, y1 = base + (main.max - 4) * K, depth = 6 * M;
        for (let c = -2.5; c <= 2.5; c++) {
          const [cx, cz] = at(sm + c * 3.2 * M, east + out * (depth - .8 * M));
          cone(cx, cz, y0, y1, .75 * M, .65 * M, '#f7f1de', 10);
        }
        const A = at(sm - 9.5 * M, east), B = at(sm + 9.5 * M, east), C = at(sm + 9.5 * M, east + out * depth), D = at(sm - 9.5 * M, east + out * depth);
        prism('classic', [[A, B, C, D]], base, main.max - 4, main.max - 2.6, '#f7f1de');
        const peak = base + (main.max + .8) * K, ridgeA = at(sm, east), ridgeB = at(sm, east + out * depth), lo = base + (main.max - 2.6) * K;
        const c = linear('#f3ecd6');
        tri(plain, [[C[0], lo, C[1]], [D[0], lo, D[1]], [ridgeB[0], peak, ridgeB[1]]], c);
        quad(plain, [[D[0], lo, D[1]], [A[0], lo, A[1]], [ridgeA[0], peak, ridgeA[1]], [ridgeB[0], peak, ridgeB[1]]], shade('#7d8790', 1));
        quad(plain, [[B[0], lo, B[1]], [C[0], lo, C[1]], [ridgeB[0], peak, ridgeB[1]], [ridgeA[0], peak, ridgeA[1]]], shade('#7d8790', 1));
      }
    }
    if (site.extras === 'clocks') {
      // clock faces near the top of both towers, on all four sides
      for (const p of parts.filter(q => q.max >= 60)) {
        const pts = ccw(ringPts(p.rings[0])), y = base + (p.max - 9) * K;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 8 * M) continue;
          const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
          disc(mx, y, mz, nx, nz, 3.4 * K, '#2c2a28');
          disc(mx + nx * .05, y, mz + nz * .05, nx, nz, 2.9 * K, '#f3ead2');
        }
      }
    }
    if (site.extras === 'spire') {
      // steep roofs over the nave, choir and transepts
      for (const p of parts.filter(q => q.min === 0 && q.max <= 25 && q.max >= 12)) {
        const pts = ringPts(p.rings[0]), { t0, t1 } = axes(pts);
        roof('gabled', pts, base + p.max * K, (t1 - t0) / 2 * 1.15, '#4e5559');
      }
    }
    // shallow domes on round halls (Stortinget's chambers)
    for (const p of parts) {
      const pts = ringPts(p.rings[0]);
      if (pts.length < 10) continue;
      let cx = 0, cz = 0, r = 0;
      for (const [x, z] of pts) { cx += x; cz += z; }
      cx /= pts.length; cz /= pts.length;
      for (const [x, z] of pts) r = Math.max(r, Math.hypot(x - cx, z - cz));
      if (Math.abs(area(pts)) / (Math.PI * r * r) < .85) continue;
      const y = base + p.max * K;
      cone(cx, cz, y, y + r * .22, r, r * .55, '#a8916a', 16);
      cone(cx, cz, y + r * .22, y + r * .34, r * .55, 0, '#a8916a', 16);
    }
    if (site.extras === 'spire' && tallest) {
      // the copper spire above the clock tower
      const pts = ringPts(tallest.rings[0]);
      let cx = 0, cz = 0, r = 0;
      for (const [x, z] of pts) { cx += x; cz += z; }
      cx /= pts.length; cz /= pts.length;
      for (const [x, z] of pts) r = Math.max(r, Math.hypot(x - cx, z - cz));
      const y = base + tallest.max * K;
      cone(cx, cz, y, y + 16 * K, r * .9, 0, '#7fae8c', 8);
      cone(cx, cz, y + 16 * K, y + 18 * K, .3 * M, .3 * M, '#d7b65a', 4);
    }
  }

  // ---- one mesh per material ---------------------------------------------------------------------
  const meshes = [];
  for (const [kind, b] of buckets) {
    if (!b.vertices) continue;
    const material = kind === 'plain' ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ map: facadeTexture(kind), color: wallTint, vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(cartoon.geometry(b), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.renderOrder = 19;                 // with the buildings (20), counted apart from them
    mesh.userData.landmarks = true;
    scene.add(mesh);
    meshes.push(mesh);
  }
  meshes.push(...extraMeshes);
  // moving water: streaks drift downstream (one texture offset per frame, nothing rebuilt)
  const update = time => { for (const a of animated) a.texture.offset.y = -(time * a.speed) % 1; };
  return { meshes, stats, update: animated.length ? update : null };
}

// White water: drifts of foam a few metres across, stretched downstream, on a faint white wash,
// tiling both ways (u: 14 m across the river, v: 18 m along it). `rough` is a fall's churning step.
function foamTexture(rough = false) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  let seed = rough ? 7 : 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = `rgba(255,255,255,${rough ? .55 : .16})`;
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < (rough ? 60 : 34); i++) {
    const x = rand() * 64, y = rand() * 256, w = (rough ? 5 : 4) + rand() * (rough ? 9 : 8), len = w * (1.8 + rand() * 2.2);
    g.fillStyle = `rgba(255,255,255,${(rough ? .6 : .5) + rand() * .4})`;
    for (const dx of [0, -64, 64]) for (const dy of [0, -256, 256]) { g.beginPath(); g.ellipse(x + dx, y + dy, w, len, 0, 0, Math.PI * 2); g.fill(); }
  }
  // fine streaks on top, so the moving water reads up close too
  g.fillStyle = 'rgba(255,255,255,.75)';
  for (let i = 0; i < 40; i++) { const x = rand() * 64, y = rand() * 256; g.fillRect(x, y, 1.5, 10 + rand() * 24); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * (x, z) => true where a landmark stands (its parts or modelled outline, plus `margin` world units):
 * trees were planted before these buildings were in the data, so the 3D view clears them here.
 */
export function landmarkClearance(data, wx, wy, margin = 6) {
  const shapes = [];
  for (const site of data?.sites || []) {
    const rings = [...(site.parts || []).map(p => p.rings[0]), ...(site.outline || [])];
    if (site.id === 'monolitten') {               // the stepped plinth is 24 m across its radius
      const cx = site.frame.center[0], cy = site.frame.center[1], r = 26 / 1.113, k = Math.cos(cy / 1e5 * Math.PI / 180);
      rings.push(Array.from({ length: 24 }, (_, i) => [cx + Math.cos(i / 24 * Math.PI * 2) * r / k, cy + Math.sin(i / 24 * Math.PI * 2) * r]).flat());
    }
    for (const flat of rings) {
      if (flat.length < 6) continue;
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([wx(flat[i]), wy(flat[i + 1])]);
      const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
      shapes.push({ pts, x0: Math.min(...xs) - margin, x1: Math.max(...xs) + margin, z0: Math.min(...zs) - margin, z1: Math.max(...zs) + margin });
    }
  }
  const near = (x, z, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
      const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - t * dx, z - az - t * dz) < margin) return true;
    }
    return inside;
  };
  return (x, z) => shapes.some(s => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && near(x, z, s.pts));
}

/** (x, z) => the roof height in metres of the landmark part standing there, or null. */
export function landmarkTop(data, wx, wy) {
  const parts = [];
  for (const site of data?.sites || []) {
    if (site.build !== 'parts') continue;
    for (const p of site.parts || []) {
      const flat = p.rings[0], pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([wx(flat[i]), wy(flat[i + 1])]);
      parts.push({ pts, max: p.max });
    }
  }
  const inside = (x, z, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[j];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
    }
    return c;
  };
  return (x, z) => {
    let top = null;
    for (const p of parts) if (inside(x, z, p.pts)) top = Math.max(top ?? 0, p.max);
    return top;
  };
}
