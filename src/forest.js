// Where the forest grows, shared by the 2D map (green under the trees) and the 3D view (the trees).
// Trees go where OSM maps forest or wood (data/landcover.json), and on empty land away from town:
// around Kongsberg most land the map leaves empty is spruce forest in real life. Fields, meadows,
// built-up areas, parks, roads, water, land within ~35 m of a building and the shop plazas stay clear.
// Deterministic (seeded), so 2D and 3D agree and every visit looks the same.

export const FOREST_STEP = 11;      // map units between candidate trees (about 12 m)
export const FOREST_MAX = 22000;

function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Returns [[x, z, scale, spin, isSpruce]] in map units (the same wx/wy space as both views). */
export function plantForest({ town, buildings, cover, shops = [], wx, wy, plaza = 110 }) {
  const [b0, b1, b2, b3] = town.bounds;
  const X0 = wx(b0), X1 = wx(b2), Z0 = wy(b3), Z1 = wy(b1), W = X1 - X0, D = Z1 - Z0;
  const ring = p => { const pts = []; for (let i = 0; i < p.length; i += 2) pts.push([wx(p[i]), wy(p[i + 1])]); return pts; };
  const polys = list => list.map(p => {
    const pts = ring(p), xs = pts.map(q => q[0]), zs = pts.map(q => q[1]);
    return { pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
  });
  const within = (list, x, z) => list.some(p => x >= p.box[0] && x <= p.box[2] && z >= p.box[1] && z <= p.box[3] && inside([x, z], p.pts));

  // grids: water (from the map's water areas), roads/buildings/plazas, and "town" (near buildings)
  const grid = (cell) => { const cols = Math.ceil(W / cell), rows = Math.ceil(D / cell); return { cell, cols, rows, a: new Uint8Array(cols * rows) }; };
  const mark = (g, x, z, r) => {
    const c0 = Math.floor((x - r - X0) / g.cell), c1 = Math.floor((x + r - X0) / g.cell), r0 = Math.floor((z - r - Z0) / g.cell), r1 = Math.floor((z + r - Z0) / g.cell);
    for (let rr = Math.max(0, r0); rr <= Math.min(g.rows - 1, r1); rr++) for (let cc = Math.max(0, c0); cc <= Math.min(g.cols - 1, c1); cc++) g.a[rr * g.cols + cc] = 1;
  };
  const test = (g, x, z) => { const c = Math.floor((x - X0) / g.cell), r = Math.floor((z - Z0) / g.cell); return c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.a[r * g.cols + c] === 1; };

  const water = grid(6);
  {
    const canvas = document.createElement('canvas');
    canvas.width = water.cols; canvas.height = water.rows;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.setTransform(1 / 6, 0, 0, 1 / 6, -X0 / 6, -Z0 / 6);
    const path = new Path2D();
    for (const p of town.water) { path.moveTo(wx(p[0]), wy(p[1])); for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1])); path.closePath(); }
    g.fill(path);
    const px = g.getImageData(0, 0, water.cols, water.rows).data;
    for (let i = 0; i < water.a.length; i++) water.a[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  }
  const blocked = grid(4);
  for (const kind of ['lane', 'street', 'major']) for (const line of town.roads[kind] || []) {
    for (let i = 2; i < line.length; i += 2) {
      const ax = wx(line[i - 2]), az = wy(line[i - 1]), bx = wx(line[i]), bz = wy(line[i + 1]);
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 3);
      for (let s = 0; s <= steps; s++) mark(blocked, ax + (bx - ax) * s / steps, az + (bz - az) * s / steps, 14);
    }
  }
  const near = grid(8);
  for (const b of buildings) {
    mark(blocked, wx(b[1]), wy(b[2]), 10);
    for (let i = 1; i < b.length; i += 2) mark(near, wx(b[i]), wy(b[i + 1]), 32);
  }
  for (const [x, z] of shops) mark(blocked, x, z, plaza);

  const wood = polys(cover.wood || []), open = polys(cover.open || []), parks = polys(town.green || []);
  let seed = 23;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wet = (x, z) => test(water, x, z) || test(water, x + 8, z) || test(water, x - 8, z) || test(water, x, z + 8) || test(water, x, z - 8);
  const spots = [];
  for (let z = Z0 + FOREST_STEP / 2; z < Z1 && spots.length < FOREST_MAX; z += FOREST_STEP) for (let x = X0 + FOREST_STEP / 2; x < X1; x += FOREST_STEP) {
    const px = x + (rand() - .5) * FOREST_STEP * .9, pz = z + (rand() - .5) * FOREST_STEP * .9;
    if (px < X0 + 3 || px > X1 - 3 || pz < Z0 + 3 || pz > Z1 - 3) continue;
    if (test(blocked, px, pz) || wet(px, pz)) continue;
    const mapped = within(wood, px, pz);
    if (!mapped && (test(near, px, pz) || within(open, px, pz) || within(parks, px, pz))) continue;
    if (rand() > (mapped ? .85 : .7)) continue;
    spots.push([px, pz, .8 + rand() * .7, rand(), rand() < .78]);
  }
  return spots;
}

/** The green the 2D map paints under the trees: one round blob per tree, merging into woodland. */
export function forestPath(spots, radius = 9) {
  const path = new Path2D();
  for (const [x, z] of spots) { path.moveTo(x + radius, z); path.arc(x, z, radius, 0, Math.PI * 2); }
  return path;
}
