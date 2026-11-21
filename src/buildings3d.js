// Cartoon buildings for the 3D view: each OSM footprint becomes a building in the style of what it
// really is (house, apartment block, shop or office, industrial shed, garage, church), with a few
// chunky details so the town doesn't look like blocks, cheap enough to keep the view at 60 fps:
//  - pitched roofs (gabled or hipped, steep and with a thick overhanging eave) on house-like
//    footprints, flat roofs with a parapet and a rooftop box on big blocks
//  - windows, frames, cladding and floor bands come from one small repeating texture per style
//    (no geometry per window); the wall colour comes from vertex colours
//  - a front door on houses, a chimney on most pitched roofs, a tower and spire on churches
//  - muted pastel wall and roof colours picked per building type, in the spirit of Norwegian towns
// Everything is written into a handful of merged buffers (one per facade style plus one for
// roofs and trim), so the whole town is ~5 draw calls however many buildings it has.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const STYLE_OF = {
  house: 'house', detached: 'house', semidetached_house: 'house', terrace: 'house', bungalow: 'house', cabin: 'house', farm: 'house',
  hut: 'house', residential: 'house', church: 'church', chapel: 'church', cathedral: 'church',
  apartments: 'apt', dormitory: 'apt', hotel: 'apt',
  retail: 'com', commercial: 'com', office: 'com', supermarket: 'com', kiosk: 'com', school: 'com', kindergarten: 'com', civic: 'com',
  public: 'com', hospital: 'com', university: 'com', college: 'com', government: 'com', train_station: 'com', sports_hall: 'com',
  industrial: 'ind', warehouse: 'ind', manufacture: 'ind', service: 'ind', hangar: 'ind', barn: 'ind', farm_auxiliary: 'ind',
  garage: 'shed', garages: 'shed', shed: 'shed', carport: 'shed', roof: 'shed', boathouse: 'shed', storage_tank: 'ind',
};
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

function facade(style) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const base = '#dedede';
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  const win = (x, y, w, h, frame = 6, cross = true, glass = '#6f8a9c') => {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill();
    g.fillStyle = glass;
    g.beginPath(); g.roundRect(x + frame, y + frame, w - frame * 2, h - frame * 2, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';                       // a cartoon glint
    g.beginPath(); g.moveTo(x + frame + 3, y + h - frame - 6); g.lineTo(x + frame + 12, y + frame + 3); g.lineTo(x + frame + 18, y + frame + 3); g.lineTo(x + frame + 9, y + h - frame - 6); g.fill();
    if (cross) { g.fillStyle = '#ffffff'; g.fillRect(x + w / 2 - 2, y + frame, 4, h - frame * 2); g.fillRect(x + frame, y + h / 2 - 2, w - frame * 2, 4); }
  };
  if (style === 'house' || style === 'church') {
    g.fillStyle = '#d0d0d0';
    for (let y = 5; y < 128; y += 9) g.fillRect(0, y, 128, 1.5);   // wooden cladding
    win(40, 28, 48, 58);
    g.fillStyle = '#bdbdbd'; g.fillRect(34, 86, 60, 6);           // sill
    g.fillStyle = '#c4c4c4'; g.fillRect(0, 120, 128, 8);          // plinth / storey band
  } else if (style === 'apt') {
    win(20, 24, 88, 60, 6, false);
    g.fillStyle = '#ffffff'; g.fillRect(62, 30, 4, 48);
    g.fillStyle = '#b9b9b9'; g.fillRect(14, 92, 100, 5);          // balcony slab
    g.fillStyle = '#cfcfcf'; for (let x = 16; x < 114; x += 7) g.fillRect(x, 97, 2, 14);
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 122, 128, 6);
  } else if (style === 'com') {
    g.fillStyle = '#c6c6c6'; g.fillRect(0, 4, 128, 14);           // sign band
    win(8, 28, 112, 80, 7, false, '#7d98a8');
    g.fillStyle = '#ffffff'; g.fillRect(62, 34, 4, 68);
  } else if (style === 'ind') {
    g.fillStyle = '#cbcbcb'; for (let x = 0; x < 128; x += 8) g.fillRect(x, 0, 2.5, 128);   // corrugated sheet
    win(28, 14, 72, 18, 4, false);
  } else {                                                          // shed / garage: a door every bay
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(22, 40, 84, 88, 5); g.fill();
    g.fillStyle = '#bfbfbf'; for (let y = 50; y < 128; y += 12) g.fillRect(28, y, 72, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

export function createBuildings({ heightAt, wx, wy, M, LIFT }) {
  const textures = Object.fromEntries(['house', 'apt', 'com', 'ind', 'shed'].map(s => [s, facade(s)]));
  textures.church = textures.house;
  const BASE = new THREE.Color('#dedede').r;                       // texture base level (linear)
  const STOREY = 3 * M * LIFT;
  const colour = new THREE.Color();

  const bucket = () => ({ pos: [], uv: [], col: [] });
  // tint: wall colours are divided by the texture's base level so plain wall shows the true colour
  const rgb = (hex, wall) => { colour.set(hex); return wall ? [colour.r / BASE, colour.g / BASE, colour.b / BASE] : [colour.r, colour.g, colour.b]; };
  const tri = (b, pts, c, uvs) => { for (let i = 0; i < 3; i++) { b.pos.push(...pts[i]); b.uv.push(...(uvs ? uvs[i] : [.02, .02])); b.col.push(...c); } };
  const quad = (b, p, c, uvs) => { tri(b, [p[0], p[1], p[2]], c, uvs && [uvs[0], uvs[1], uvs[2]]); tri(b, [p[0], p[2], p[3]], c, uvs && [uvs[0], uvs[2], uvs[3]]); };
  const box = (b, cx, cz, dx, dz, w, d, y0, y1, c) => {     // an oriented box (d along dx,dz)
    const nx = -dz, nz = dx, hw = w / 2, hd = d / 2;
    const P = (s, t, y) => [cx + dx * s + nx * t, y, cz + dz * s + nz * t];
    const k = [P(-hd, -hw, 0), P(hd, -hw, 0), P(hd, hw, 0), P(-hd, hw, 0)];
    for (let i = 0; i < 4; i++) { const a = k[i], b2 = k[(i + 1) % 4]; quad(b, [[a[0], y0, a[2]], [b2[0], y0, b2[2]], [b2[0], y1, b2[2]], [a[0], y1, a[2]]], c); }
    quad(b, k.map(p => [p[0], y1, p[2]]), c);
  };

  function pick(list, n) { return list[n % list.length]; }
  function tone(hex, osm) {
    const named = osm && (NAMED[osm.toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(osm) ? osm : null));
    if (!named) return hex;
    const a = new THREE.Color(hex), b = new THREE.Color(named);
    return '#' + a.lerp(b, .5).getHexString();                   // OSM colour, toned to the map palette
  }

  /**
   * One building into `out` = { walls: {style: bucket}, trim: bucket }.
   * ring: flat 1e5-degree ints; metres: OSM height; info: [type, roof:shape, building:colour, roof:colour]; id: a stable number.
   * Returns { pts, top } (top = highest point, for pins and labels).
   */
  function build(ring, metres, info, id, out) {
    const pts = [];
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(wx(ring[i]), wy(ring[i + 1])));
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    if (pts.length < 3) return { pts, top: 0 };
    const [type = 'yes', roofTag = '', wallTag = '', roofColTag = ''] = info || [];
    const area = Math.abs(THREE.ShapeUtils.area(pts)), areaM = area / (M * M), h0 = metres;
    let style = STYLE_OF[type] || (areaM < 220 && h0 <= 9 ? 'house' : h0 > 10 ? 'apt' : areaM > 900 ? 'ind' : 'com');
    const r = hash(id + 7);
    const pal = PALETTE[style];
    const wallHex = tone(pick(pal.walls, r), wallTag), roofHex = tone(pick(pal.roofs, r >>> 5), roofColTag);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const y = heightAt(p.x, p.y); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const foot = lo - 1.5, tiny = areaM < 30;

    // oriented rectangle along the longest edge, to decide on and lay out a pitched roof
    let best = 0, dir = new THREE.Vector2(1, 0);
    for (let i = 0; i < pts.length; i++) { const e = pts[(i + 1) % pts.length].clone().sub(pts[i]); if (e.length() > best) { best = e.length(); dir = e.normalize(); } }
    const nrm = new THREE.Vector2(-dir.y, dir.x);
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of pts) { const s = p.dot(dir), t = p.dot(nrm); s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const rectFill = area / ((s1 - s0) * (t1 - t0) || 1), widthM = (t1 - t0) / M;
    const wantsPitch = roofTag ? roofTag !== 'flat' : (style === 'house' || style === 'church' || style === 'shed' || (style === 'com' && areaM < 160));
    const pitched = wantsPitch && rectFill > .8 && widthM < 22 && pts.length <= 12;
    // houses: walls to the eaves, then the roof; flat blocks: walls to full height
    const eave = (pitched ? Math.max(style === 'shed' ? 2.4 : 3.2, h0 * .62) : h0) * M * LIFT;
    const top = hi + eave;

    // walls with the style's facade texture: u = metres along the wall / bay, v = height / storey
    const walls = out.walls[style] || (out.walls[style] = bucket()), bay = BAY[style] * M;
    const wc = out.plain ? [1 / BASE, 1 / BASE, 1 / BASE] : rgb(wallHex, true);
    out.style = style;
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = a.distanceTo(b);
      const u0 = run / bay, u1 = (run + len) / bay, vf = (foot - lo) / STOREY, vt = (top - lo) / STOREY;
      quad(walls, [[a.x, foot, a.y], [b.x, foot, b.y], [b.x, top, b.y], [a.x, top, a.y]], wc, [[u0, vf], [u1, vf], [u1, vt], [u0, vt]]);
      run += len;
    }

    const trim = out.trim, roofB = out.roof || trim, rc = out.roof ? [1, 1, 1] : rgb(roofHex), dark = rgb('#' + new THREE.Color(roofHex).multiplyScalar(.72).getHexString());
    const at = (s, t, y) => [dir.x * s + nrm.x * t, y, dir.y * s + nrm.y * t];
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
        for (const s of [s0, s1]) {
          const A = at(s, t0, top), B = at(s, t1, top), C = at(s, tm, ridge - .1 * M);
          const u = 0, vA = (top - lo) / STOREY, vC = (ridge - lo) / STOREY;
          tri(walls, [A, B, C], wc, [[u, vA], [(t1 - t0) / bay, vA], [(t1 - t0) / bay / 2, vC]]);
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
        box(trim, cx, cz, dir.x, dir.y, .9 * M, .9 * M, yRoof - .5 * M, ridge + .9 * M, rgb(r % 2 ? '#9a5f4c' : '#77706a'));
      }
      // church: a tower with a spire at one end
      if (style === 'church') {
        const side = Math.min(t1 - t0, 8 * M) * .8, cs = s0 + side / 2, [cx, , cz] = at(cs, tm, 0), towerTop = ridge + 6 * M;
        box(trim, cx, cz, dir.x, dir.y, side, side, lo, towerTop, rgb('#f6f3ec'));
        const hs = side / 2 + .2 * M, sp = towerTop + 11 * M, apex = [cx, sp, cz];
        const k = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]].map(([s, t]) => [cx + dir.x * s + nrm.x * t, towerTop, cz + dir.y * s + nrm.y * t]);
        for (let i = 0; i < 4; i++) tri(trim, [k[i], k[(i + 1) % 4], apex], rgb('#4f4a47'));
        peak = sp;
      }
    } else {
      // flat roof: cap, a parapet rim and (on big blocks) a rooftop box
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) tri(roofB, [[pts[i].x, top, pts[i].y], [pts[k].x, top, pts[k].y], [pts[j].x, top, pts[j].y]], rc);
      const pc = rgb('#' + new THREE.Color(wallHex).multiplyScalar(.86).getHexString()), ph = top + .55 * M;
      if (!tiny) for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; quad(trim, [[a.x, top, a.y], [b.x, top, b.y], [b.x, ph, b.y], [a.x, ph, a.y]], pc); }
      if (areaM > 380) {
        const c = pts.reduce((m, p) => m.add(p), new THREE.Vector2()).divideScalar(pts.length);
        const w = Math.min(t1 - t0, 9 * M) * .35, d = Math.min(s1 - s0, 12 * M) * .3;
        box(trim, c.x, c.y, dir.x, dir.y, w, d, top, top + 2.2 * M, rgb('#bfb8ae'));
        peak = top + 2.2 * M;
      }
    }

    // a front door on houses, in the middle of the longest wall, facing out
    if (!tiny && (style === 'house' || style === 'church' || (style === 'apt' && r % 2 === 0))) {
      let k = 0, len = 0;
      for (let i = 0; i < pts.length; i++) { const l = pts[i].distanceTo(pts[(i + 1) % pts.length]); if (l > len) { len = l; k = i; } }
      const a = pts[k], b = pts[(k + 1) % pts.length], m = a.clone().add(b).multiplyScalar(.5), e = b.clone().sub(a).normalize();
      const c = pts.reduce((s, p) => s.add(p), new THREE.Vector2()).divideScalar(pts.length);
      let n = new THREE.Vector2(-e.y, e.x);
      if (n.dot(m.clone().sub(c)) < 0) n.negate();
      const g = heightAt(m.x, m.y), w = .55 * M, off = .08 * M, dh = 2.2 * M * LIFT * .85;
      const p = (s, y) => [m.x + e.x * s + n.x * off, y, m.y + e.y * s + n.y * off];
      quad(trim, [p(-w, g), p(w, g), p(w, g + dh), p(-w, g + dh)], rgb(pick(DOORS, r >>> 3)));
      quad(trim, [p(-w - .25 * M, g + dh), p(w + .25 * M, g + dh), p(w + .25 * M, g + dh + .25 * M), p(-w - .25 * M, g + dh + .25 * M)], rgb('#ffffff'));
    }
    return { pts, top: peak };
  }

  // buckets -> one geometry; with several buckets, one draw group per bucket (for per-part materials)
  function geometry(...parts) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap(b => b.pos), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(parts.flatMap(b => b.uv), 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(parts.flatMap(b => b.col), 3));
    geo.computeVertexNormals();
    if (parts.length > 1) { let start = 0; parts.forEach((b, i) => { geo.addGroup(start, b.pos.length / 3, i); start += b.pos.length / 3; }); return geo; }
    // flat faces: the corners two triangles share become one vertex (indexed), about a third fewer
    return mergeVertices(geo, 1e-4);
  }

  return { build, geometry, textures, bucket };
}
