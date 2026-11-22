// Bakes data/landmarks.json and data/places.json from tools/landmarks.spec.json: the town's famous
// buildings and places, which src/landmarks.js builds in the 3D view and the explore menu flies to.
//
//   node tools/bake_landmarks.mjs            (fetches OSM outlines once into .cache/landmarks-osm.json)
//
// A site in the spec names what it is and how it is built:
//   { id, name, model, at: [lon, lat], osm: "r14884037" | "w157765022", building: true, ... }
//  - `osm`: its outline comes from that OpenStreetMap way or relation (many famous buildings are
//    relations, which the plain building data leaves out, so the map showed nothing there)
//  - `building: true`: its outline is the background building at `at` (data/buildings.json),
//    which the landmark then replaces
//  - `line` / `crests`: [[lon, lat], ...] for river rapids and weirs (model "rapids"); the river's
//    width left and right of the line is measured here from the map's water areas
// Anything else in the site (colours, heights, which way a tower faces) goes through to the model.
// Background buildings whose centre lies inside a site's outline are replaced by the landmark
// (tools/bake_buildings.mjs leaves them out), so nothing stands twice.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const spec = read('tools/landmarks.spec.json');
const town = read('data/game-map.json');
const extra = read('data/buildings.json');
const CACHE = path.join(ROOT, '.cache', 'landmarks-osm.json');
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const E5 = v => Math.round(v * 1e5);

// ---- OSM outlines (cached) -----------------------------------------------------------------
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
async function overpass(query) {
  for (const url of MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'grocery-bot-map-bake' } });
        if (res.ok) return await res.json();
      } catch { /* next */ }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw new Error('Overpass unavailable');
}
// closed rings (outer first) as flat 1e5-degree int arrays, from a way or a multipolygon relation
function rings(element) {
  if (element.type === 'way') return [element.geometry.flatMap(p => [E5(p.lon), E5(p.lat)])];
  if (!element.members) throw new Error(`${element.type}${element.id}: no members in the Overpass answer`);
  if (false) return [element.geometry.flatMap(p => [E5(p.lon), E5(p.lat)])];
  const outer = [], inner = [];
  // relation members can be split ways: join them end to end into rings
  for (const role of ['outer', 'inner']) {
    const pieces = element.members.filter(m => m.type === 'way' && (m.role || 'outer') === role && m.geometry?.length > 1)
      .map(m => m.geometry.map(p => [E5(p.lon), E5(p.lat)]));
    const target = role === 'outer' ? outer : inner;
    while (pieces.length) {
      let ring = pieces.shift();
      let grew = true;
      while (grew && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
        grew = false;
        const end = ring[ring.length - 1];
        for (let i = 0; i < pieces.length; i++) {
          const p = pieces[i], same = (a, b) => a[0] === b[0] && a[1] === b[1];
          if (same(p[0], end)) { ring = ring.concat(p.slice(1)); }
          else if (same(p[p.length - 1], end)) { ring = ring.concat(p.slice(0, -1).reverse()); }
          else continue;
          pieces.splice(i, 1); grew = true; break;
        }
      }
      if (ring.length >= 4) target.push(ring.flat());
    }
  }
  return [...outer, ...inner];
}
const wanted = spec.sites.filter(s => s.osm && !cache[s.osm]).map(s => s.osm);
if (wanted.length) {
  const ids = { w: [], r: [] };
  for (const id of wanted) ids[id[0]].push(id.slice(1));
  const query = `[out:json][timeout:120];(${ids.w.length ? `way(id:${ids.w.join(',')});` : ''}${ids.r.length ? `rel(id:${ids.r.join(',')});` : ''});out geom;`;
  const data = await overpass(query);
  for (const element of data.elements) cache[element.type[0] + element.id] = { tags: element.tags, rings: rings(element) };
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}
// `parts: "osm"`: the site's OSM building:part ways (heights, roof shapes) inside its outline, cached
for (const s of spec.sites.filter(s => s.parts === 'osm' && s.osm && !cache['parts:' + s.osm])) {
  const flat = cache[s.osm].rings[0], xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2);
  const pad = 30, bbox = [Math.min(...ys) - pad, Math.min(...xs) - pad, Math.max(...ys) + pad, Math.max(...xs) + pad].map(v => (v / 1e5).toFixed(5));
  const data = await overpass(`[out:json][timeout:120];way["building:part"](${bbox.join(',')});out geom tags;`);
  cache['parts:' + s.osm] = data.elements.filter(e => e.geometry?.length > 3).map(e => ({ id: e.id, tags: e.tags, ring: e.geometry.flatMap(p => [E5(p.lon), E5(p.lat)]) }));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
}

// ---- geometry helpers (1e5-degree ints) ---------------------------------------------------
const [b0, b1, b2, b3] = town.bounds;
const origin = [(b0 + b2) / 2, (b1 + b3) / 2], squash = Math.cos(origin[1] / 1e5 * Math.PI / 180);
const METRE = 1 / 1.113;                                   // 1e-5 degree of latitude in metres^-1
const toM = ([lon, lat]) => [(lon - origin[0]) * squash / METRE, (lat - origin[1]) / METRE];   // metres east, north
const pairs = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
function inside([x, y], flat) {
  let c = false;
  for (let i = 0, n = flat.length / 2, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2], yi = flat[i * 2 + 1], xj = flat[j * 2], yj = flat[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const centre = flat => { const p = pairs(flat); return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; };
// measured frame: centre, angle of the longest outer edge (degrees, counter-clockwise from east), length, width (metres)
function frameOf(ringsList) {
  const pts = pairs(ringsList[0]).map(toM);
  let best = 0, angle = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay);
    if (len > best) { best = len; angle = Math.atan2(by - ay, bx - ax); }
  }
  if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;
  const c = Math.cos(angle), s = Math.sin(angle);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of pts) { const u = x * c + y * s, v = -x * s + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2, cx = um * c - vm * s, cy = um * s + vm * c;
  return { center: [Math.round(origin[0] + cx * METRE / squash), Math.round(origin[1] + cy * METRE)], angle: +(angle * 180 / Math.PI).toFixed(1),
    length: +(u1 - u0).toFixed(1), width: +(v1 - v0).toFixed(1) };
}

// water as the map paints it (nonzero rule over all water rings)
function onWater(x, y) {
  let winding = 0;
  for (const w of town.water) {
    for (let i = 0, n = w.length / 2; i < n; i++) {
      const j = (i + 1) % n, ax = w[i * 2], ay = w[i * 2 + 1], bx = w[j * 2], by = w[j * 2 + 1];
      if ((ay <= y) === (by <= y)) continue;
      if (ax + (y - ay) / (by - ay) * (bx - ax) > x) winding += by > ay ? 1 : -1;
    }
  }
  return winding !== 0;
}
// a river line resampled every `step` metres, with its width to each bank (metres)
function riverLine(line, step = 6) {
  const pts = line.map(([lon, lat]) => [lon * 1e5, lat * 1e5]), out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot((bx - ax) * squash, by - ay) / METRE, n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  out.push(pts[pts.length - 1]);
  return out.map((p, i) => {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    let dx = (b[0] - a[0]) * squash, dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const reach = side => {                                  // metres to the bank on this side (left = +1)
      let d = 0;
      while (d < 150 && onWater(p[0] + (-dy * side) * (d + 1) * METRE / squash, p[1] + dx * side * (d + 1) * METRE)) d += 1;
      return d;
    };
    return [Math.round(p[0]), Math.round(p[1]), reach(1), reach(-1)];
  });
}

// ---- sites -------------------------------------------------------------------------------------
const sites = [], places = [];
const replaces = new Set();
for (const s of spec.sites) {
  const site = { ...s };
  delete site.osm; delete site.building; delete site.place; delete site.keep;
  site.build = 'model';
  if (s.osm) {
    const found = cache[s.osm];
    if (!found) throw new Error(`${s.id}: ${s.osm} not found on OSM`);
    site.outline = found.rings;
  } else if (s.buildings) {
    // several background buildings (a row of wharves): one outline ring and height each
    site.outline = []; site.heights = [];
    for (const [lon, lat] of s.buildings) {
      const id = extra.buildings.findIndex(b => inside([lon * 1e5, lat * 1e5], b.slice(1)));
      if (id < 0) throw new Error(`${s.id}: no building at ${lon}, ${lat}`);
      site.outline.push(extra.buildings[id].slice(1)); site.heights.push(extra.buildings[id][0]); replaces.add(id); (site.replaces ||= []).push(id);
    }
    delete site.buildings;
  } else if (s.building) {
    const at = [s.at[0] * 1e5, s.at[1] * 1e5];
    const id = extra.buildings.findIndex(b => inside(at, b.slice(1)));
    if (id < 0) throw new Error(`${s.id}: no building at ${s.at}`);
    site.outline = [extra.buildings[id].slice(1)];
    site.height ??= extra.buildings[id][0];
  }
  if (site.outline) {
    site.frame = frameOf(site.outline);
    if (s.parts === 'osm') {
      const num = v => (v == null || v === '' || isNaN(parseFloat(v)) ? null : parseFloat(v));
      site.parts = cache['parts:' + s.osm].filter(p => site.outline.slice(0, 1).some(r => inside(centre(p.ring), r))).map(p => ({
        id: p.id, rings: [p.ring], max: num(p.tags.height) ?? 10, min: num(p.tags.min_height) ?? 0, roof: p.tags['roof:shape'] || 'flat',
        roofH: num(p.tags['roof:height']) ?? 0, across: p.tags['roof:orientation'] === 'across', copper: p.tags['roof:material'] === 'copper', name: p.tags.name }));
    }
    if (s.keep) { sites.push(site); if (s.place !== false) places.push({ name: s.name, lon: s.at[0], lat: s.at[1] }); continue; }
    const outer = site.outline.filter((r, i) => i === 0 || !site.outline.slice(0, i).some(o => inside(pairs(r)[0], o)));
    extra.buildings.forEach((b, id) => { if (!site.replaces?.includes(id) && outer.some(r => inside(centre(b.slice(1)), r))) { replaces.add(id); (site.replaces ||= []).push(id); } });
  } else if (s.at) {
    site.frame = { center: [E5(s.at[0]), E5(s.at[1])], angle: 0, length: 0, width: 0 };
  }
  if (s.line) site.line = riverLine(s.line);
  if (s.crests) site.crests = s.crests.map(c => c.map(([lon, lat]) => [E5(lon), E5(lat)]));
  sites.push(site);
  if (s.place !== false) {
    const [lon, lat] = s.at || [site.frame.center[0] / 1e5, site.frame.center[1] / 1e5];
    places.push({ name: s.name, lon: +lon.toFixed(5), lat: +lat.toFixed(5) });
  }
}
for (const p of spec.places || []) places.push(p);

const source = crypto.createHash('sha256').update(JSON.stringify(spec)).update(fs.readFileSync(path.join(ROOT, 'data', 'game-map.json'))).digest('hex').slice(0, 16);
fs.writeFileSync(path.join(ROOT, 'data', 'landmarks.json'), JSON.stringify({ format: 'grocery-bot-landmarks/2', source,
  attribution: 'Outlines © OpenStreetMap contributors (ODbL)', sites }));
fs.writeFileSync(path.join(ROOT, 'data', 'places.json'), JSON.stringify({ places }));
console.log(`landmarks.json: ${sites.length} sites (${sites.map(s => s.id).join(', ')}), replacing ${replaces.size} background buildings; places.json: ${places.length} places`);
