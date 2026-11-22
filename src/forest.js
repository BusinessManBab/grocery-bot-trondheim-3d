// Where the forest grows, shared by the 2D map (green under the trees) and the 3D view.
// Trees go on OSM woodland and on empty land away from town. A dense city has thousands
// of open/wood polygons, so all exclusion tests are rasterized once instead of testing
// every candidate against every polygon.
export const FOREST_STEP = 11;
export const FOREST_MAX = 22000;

function areaPath(list, wx, wy) {
  const path = new Path2D();
  for (const p of list) {
    path.moveTo(wx(p[0]), wy(p[1]));
    for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1]));
    path.closePath();
  }
  return path;
}

function rasterGrid({ X0, Z0, W, D, cell, draw }) {
  const cols = Math.ceil(W / cell), rows = Math.ceil(D / cell);
  const canvas = document.createElement('canvas');
  canvas.width = cols; canvas.height = rows;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.setTransform(1 / cell, 0, 0, 1 / cell, -X0 / cell, -Z0 / cell);
  draw(g);
  const pixels = g.getImageData(0, 0, cols, rows).data;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 24 ? 1 : 0;
  return { cols, rows, mask, cell };
}

/** Returns [[x, z, scale, spin, isSpruce]] in the same map-unit space as both views. */
export function plantForest({ town, buildings, cover, shops = [], wx, wy, plaza = 110 }) {
  const [b0, b1, b2, b3] = town.bounds;
  const X0 = wx(b0), X1 = wx(b2), Z0 = wy(b3), Z1 = wy(b1), W = X1 - X0, D = Z1 - Z0;
  const base = { X0, Z0, W, D };
  const test = (grid, x, z) => {
    const c = Math.floor((x - X0) / grid.cell), r = Math.floor((z - Z0) / grid.cell);
    return c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && grid.mask[r * grid.cols + c] === 1;
  };
  const water = rasterGrid({ ...base, cell: 6, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(town.water || [], wx, wy)); } });
  const parks = rasterGrid({ ...base, cell: 8, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(town.green || [], wx, wy)); } });
  const wood = rasterGrid({ ...base, cell: 8, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(cover.wood || [], wx, wy)); } });
  const open = rasterGrid({ ...base, cell: 8, draw: g => { g.fillStyle = '#000'; g.fill(areaPath(cover.open || [], wx, wy)); } });
  const blocked = rasterGrid({ ...base, cell: 4, draw: g => {
    g.strokeStyle = g.fillStyle = '#000'; g.lineWidth = 28; g.lineCap = g.lineJoin = 'round';
    for (const kind of ['lane', 'street', 'major']) {
      const path = new Path2D();
      for (const line of town.roads[kind] || []) {
        path.moveTo(wx(line[0]), wy(line[1]));
        for (let i = 2; i < line.length; i += 2) path.lineTo(wx(line[i]), wy(line[i + 1]));
      }
      g.stroke(path);
    }
    const footprints = new Path2D();
    for (const b of buildings) {
      footprints.moveTo(wx(b[1]), wy(b[2]));
      for (let i = 3; i < b.length; i += 2) footprints.lineTo(wx(b[i]), wy(b[i + 1]));
      footprints.closePath();
    }
    g.fill(footprints); g.lineWidth = 20; g.stroke(footprints);
    for (const [x, z] of shops) { g.beginPath(); g.arc(x, z, plaza, 0, Math.PI * 2); g.fill(); }
  } });
  // "Town" is ~35 m around buildings; one thicker stroke of all footprints is much
  // cheaper than marking every footprint corner into an array.
  const near = rasterGrid({ ...base, cell: 8, draw: g => {
    g.strokeStyle = g.fillStyle = '#000'; g.lineWidth = 70; g.lineJoin = 'round';
    const footprints = new Path2D();
    for (const b of buildings) {
      footprints.moveTo(wx(b[1]), wy(b[2]));
      for (let i = 3; i < b.length; i += 2) footprints.lineTo(wx(b[i]), wy(b[i + 1]));
      footprints.closePath();
    }
    g.fill(footprints); g.stroke(footprints);
  } });

  let seed = 23;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wet = (x, z) => test(water, x, z) || test(water, x + 8, z) || test(water, x - 8, z) || test(water, x, z + 8) || test(water, x, z - 8);
  const spots = [];
  for (let z = Z0 + FOREST_STEP / 2; z < Z1 && spots.length < FOREST_MAX; z += FOREST_STEP) {
    for (let x = X0 + FOREST_STEP / 2; x < X1; x += FOREST_STEP) {
      const px = x + (rand() - .5) * FOREST_STEP * .9, pz = z + (rand() - .5) * FOREST_STEP * .9;
      if (px < X0 + 3 || px > X1 - 3 || pz < Z0 + 3 || pz > Z1 - 3) continue;
      if (test(blocked, px, pz) || wet(px, pz)) continue;
      const mapped = test(wood, px, pz);
      if (!mapped && (test(near, px, pz) || test(open, px, pz) || test(parks, px, pz))) continue;
      if (rand() > (mapped ? .85 : .7)) continue;
      spots.push([px, pz, .8 + rand() * .7, rand(), rand() < .78]);
    }
  }
  return spots;
}

/** The green the 2D map paints under the trees: one round blob per tree. */
export function forestPath(spots, radius = 9) {
  const path = new Path2D();
  for (const [x, z] of spots) { path.moveTo(x + radius, z); path.arc(x, z, radius, 0, Math.PI * 2); }
  return path;
}

/**
 * Park trees for the 3D view (formerly planted in view3d.js at load time): random spots in mapped
 * parks, clear of roads, buildings, shop plazas, woodland (which has the forest) and water.
 * Returns [[x, z, scale, spin]].
 */
export function plantParks({ town, buildings, homes = [], cover, shops = [], wx, wy, plaza = 100 }) {
  const [b0, b1, b2, b3] = town.bounds;
  const X0 = wx(b0), X1 = wx(b2), Z0 = wy(b3), Z1 = wy(b1), W = X1 - X0, D = Z1 - Z0;
  const WC = 6, wcols = Math.ceil(W / WC), wrows = Math.ceil(D / WC);
  const cellOf = (x, z) => {
    const c = Math.floor((x - X0) / WC), r = Math.floor((z - Z0) / WC);
    return c < 0 || r < 0 || c >= wcols || r >= wrows ? -1 : r * wcols + c;
  };
  const landMask = polygons => {
    const canvas = document.createElement('canvas');
    canvas.width = wcols; canvas.height = wrows;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / WC, 0, 0, 1 / WC, -X0 / WC, -Z0 / WC);
    g.fillStyle = '#000';
    g.fill(areaPath(polygons, wx, wy));
    const pixels = g.getImageData(0, 0, wcols, wrows).data, mask = new Uint8Array(wcols * wrows);
    for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 127 ? 1 : 0;
    return (x, z) => { const i = cellOf(x, z); return i >= 0 && mask[i] === 1; };
  };
  const isWater = landMask(town.water || []), wooded = landMask(cover.wood || []), park = landMask(town.green || []);
  const cell = 4, cols = Math.ceil(W / cell), rows = Math.ceil(D / cell);
  const canvas = document.createElement('canvas');
  canvas.width = cols; canvas.height = rows;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.setTransform(1 / cell, 0, 0, 1 / cell, -X0 / cell, -Z0 / cell);
  g.lineWidth = 28; g.lineCap = g.lineJoin = 'round'; g.beginPath();
  for (const kind of ['lane', 'street', 'major']) for (const line of town.roads[kind] || []) {
    g.moveTo(wx(line[0]), wy(line[1]));
    for (let i = 2; i < line.length; i += 2) g.lineTo(wx(line[i]), wy(line[i + 1]));
  }
  g.stroke();
  const path = areaPath(buildings.map(b => b.slice(1)).concat(homes.map(h => h.ring)), wx, wy);
  g.fill(path); g.lineWidth = 16; g.stroke(path);
  for (const [x, z] of shops) { g.beginPath(); g.arc(x, z, plaza + 10, 0, Math.PI * 2); g.fill(); }
  const px = g.getImageData(0, 0, cols, rows).data, grid = new Uint8Array(cols * rows);
  for (let i = 0; i < grid.length; i++) grid[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  const blocked = (x, z) => grid[Math.floor((z - Z0) / cell) * cols + Math.floor((x - X0) / cell)] === 1;

  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots = [];
  for (let tries = 0; tries < 200000 && spots.length < 6000; tries++) {
    const x = X0 + rand() * W, z = Z0 + rand() * D;
    if (blocked(x, z) || wooded(x, z)) continue;
    if (isWater(x, z) || isWater(x + 9, z) || isWater(x - 9, z) || isWater(x, z + 9) || isWater(x, z - 9)) continue;
    if (!park(x, z)) continue;
    spots.push([x, z, .7 + rand() * .7, rand()]);
  }
  return spots;
}

// ---- data/trees.bin: the forest and park trees, planted once by tools/bake_trees.cjs ----------
// Planting rasterizes every road and all ~54k building footprints several times, which took seconds
// and ~100 MB on a phone at every visit. The result is fixed by the data, so it is baked instead.
// Per tree: x, z as int16 quarter units; scale as uint8 (0.5 + n / 200); spin as uint8 ((n + .5) / 256).
export function packTrees({ forest, parks, source = '' }) {
  const header = { format: 'grocery-bot-trees/1', source, forest: forest.length, parks: parks.length };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const head = Math.ceil((4 + json.length) / 4) * 4, n = forest.length + parks.length;
  const buffer = new ArrayBuffer(head + n * 4 + Math.ceil(n * 3 / 4) * 4);
  new DataView(buffer).setUint32(0, json.length, true);
  new Uint8Array(buffer, 4, json.length).set(json);
  const xz = new Int16Array(buffer, head, n * 2), bytes = new Uint8Array(buffer, head + n * 4, n * 3);
  const q = v => Math.max(-32768, Math.min(32767, Math.round(v * 4)));
  [...forest, ...parks].forEach(([x, z, scale, spin, spruce], i) => {
    xz[i * 2] = q(x); xz[i * 2 + 1] = q(z);
    bytes[i * 3] = Math.max(0, Math.min(255, Math.round((scale - .5) * 200)));
    bytes[i * 3 + 1] = Math.min(255, Math.floor(spin * 256));
    bytes[i * 3 + 2] = spruce ? 1 : 0;
  });
  return buffer;
}

export function unpackTrees(buffer) {
  const size = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
  const head = Math.ceil((4 + size) / 4) * 4, n = header.forest + header.parks;
  const xz = new Int16Array(buffer, head, n * 2), bytes = new Uint8Array(buffer, head + n * 4, n * 3);
  const tree = i => [xz[i * 2] / 4, xz[i * 2 + 1] / 4, .5 + bytes[i * 3] / 200, (bytes[i * 3 + 1] + .5) / 256, bytes[i * 3 + 2] === 1];
  const forest = [], parks = [];
  for (let i = 0; i < header.forest; i++) forest.push(tree(i));
  for (let i = header.forest; i < n; i++) parks.push(tree(i).slice(0, 4));
  return { forest, parks };
}
