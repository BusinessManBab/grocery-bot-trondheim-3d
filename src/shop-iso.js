// The v1 grocerybot.no store animation (public/static/arena.js on main, by Erik Bohne), turned
// into a renderer the shop window drives frame by frame from the recorded match instead of the
// homepage's own canned replay. Same isometric store, shelves, fridges, produce bins, bread racks,
// Grocery Bots with their baskets, and trucks backing into the bays; the bots wear the player's
// look, and the trucks are the player's own map trucks (looks.js truckArt: same carriage, cab,
// visor, decal, colour and expression) seen from the side, with the loading door at the rear.
import { truckArt, mix, WOOD, HEADS } from './looks.js';
const NS = 'http://www.w3.org/2000/svg';
const A = 24, B = 12, SHELF = 21, WALL = 30, SLAB = 9, EDGE = .72;
const TRUCK = { CARGO: 2.25, GAP: .07, CAB: .78, TOP: 31, CAB_TOP: 24, FLOOR: 6, PARKED: .97, AWAY: -15 };
const FIXTURES = {
  shelf: { height: SHELF, tone: ['#fbfaf8', '#e6e0db', '#d4ccc5'] },
  fridge: { height: 23, tone: ['#e8f3f8', '#bfd7e4', '#a9cbdc'] },
  bin: { height: 12, tone: ['#b69668', '#547052', '#405b40'] },
  rack: { height: 17, tone: ['#e3cba3', '#ccb18b', '#b99b74'] },
};
// v1 grouped products into departments with their own fixture; the v2 shop mixes them, so each
// shelf cell gets the fixture of its product.
const FIXTURE_OF = {
  milk: 'fridge', butter: 'fridge', yogurt: 'fridge', cheese: 'fridge', cream: 'fridge', juice: 'fridge',
  apples: 'bin', bananas: 'bin', tomatoes: 'bin', onions: 'bin', carrots: 'bin', peppers: 'bin', lettuce: 'bin',
  bread: 'rack',
};
const SIZES = [[0, .3, 6], [.31, .64, 7.5], [.65, 1, 5.5]];
const DOCKED = 0, LEAVING = 1, AWAY = 2;

const P = (x, y, z = 0) => [(x - y) * A, (x + y) * B - z];
const pts = list => list.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
const clamp01 = u => Math.max(0, Math.min(1, u));
const outCubic = u => 1 - Math.pow(1 - u, 3);
const ease = f => f * f * (3 - 2 * f);
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

export function createIsoShop(svg, layout) {
  const GB = window.GroceryBot, COLORS = GB.GOODS;
  const W = layout.grid.width, H = layout.grid.height, X = W - 1, Y = H - 1;
  const BAYS = layout.bays;
  const el = (tag, attrs, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  };
  const poly = (list, fill, parent) => el('polygon', { points: pts(list), fill }, parent);

  const minX = -(H - 1 - EDGE) * A - 2;
  const maxX = Math.max((W - 1 - EDGE) * A + 2, ...BAYS.map(([x]) => P(x + 1, -2.4)[0] + 8));
  const minY = Math.min(2 * EDGE * B - WALL - 4, ...BAYS.map(([x]) => P(x + .5, -.2, TRUCK.TOP + 26)[1]));
  const maxY = (W + H - 2) * B + SLAB + 14;
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  svg.innerHTML = '';

  const walls = new Set(layout.grid.walls.map(([x, y]) => x + ',' + y));
  // The recorded layout says which fixture each shelf cell belongs to (a department, see
  // tools/simulate_match.py). Older files have no fixtures: fall back to the product.
  const FIXTURE_AT = new Map((layout.fixtures || []).map(([x, y, kind]) => [x + ',' + y, kind]));
  const shelves = {}, fixtures = {};
  for (const [x, y, p] of layout.items) {
    const type = layout.products[p];
    shelves[x + ',' + y] = type;
    fixtures[x + ',' + y] = FIXTURE_AT.get(x + ',' + y) || FIXTURE_OF[type] || 'shelf';
  }
  const bayX = new Set(BAYS.map(([x]) => x));
  const solid = (x, y) => walls.has(x + ',' + y) || (x + ',' + y) in shelves;
  const inside = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  const walkable = (x, y) => inside(x, y) && !solid(x, y);

  // ---- the store: floor, bay markings, walls, fixtures with goods (as in arena.js) ----
  const floor = el('g', {}, svg);
  poly([P(0, Y, -SLAB - 10), P(X, Y, -SLAB - 10), P(X + .6, Y + .6, -SLAB - 18), P(.6, Y + .6, -SLAB - 18)], 'rgba(60,44,36,.05)', floor);
  poly([P(EDGE, Y), P(X, Y), P(X, Y, -SLAB), P(EDGE, Y, -SLAB)], '#d3cbc4', floor);
  poly([P(X, EDGE), P(X, Y), P(X, Y, -SLAB), P(X, EDGE, -SLAB)], '#c2b9b1', floor);
  poly([P(EDGE, EDGE), P(X, EDGE), P(X, Y), P(EDGE, Y)], '#ebe6e2', floor);
  const grid = [];
  for (let x = 1; x < X; x++) grid.push(`M${pts([P(x, 1)])}L${pts([P(x, Y)])}`);
  for (let y = 1; y < Y; y++) grid.push(`M${pts([P(1, y)])}L${pts([P(X, y)])}`);
  el('path', { d: grid.join(''), stroke: '#ddd6d0', 'stroke-width': .6, fill: 'none' }, floor);
  for (const [x] of BAYS) {
    poly([P(x, EDGE), P(x + 1, EDGE), P(x + 1, 1), P(x, 1)], '#3d3532', floor);
    poly([P(x - 1, 1), P(x + 2, 1), P(x + 2, 2), P(x - 1, 2)], '#c8102e', floor);
    poly([P(x - .9, 1.1), P(x + 1.9, 1.1), P(x + 1.9, 1.9), P(x - .9, 1.9)], '#f6d9dd', floor);
    for (const dx of [-1, 1]) poly([P(x + (dx < 0 ? 0 : 1) - .02, 1.1), P(x + (dx < 0 ? 0 : 1) + .02, 1.1), P(x + (dx < 0 ? 0 : 1) + .02, 1.9), P(x + (dx < 0 ? 0 : 1) - .02, 1.9)], '#eab8c0', floor);
    for (const v of [1.3, 1.6]) poly([P(x + .25, v + .2), P(x + .5, v), P(x + .75, v + .2), P(x + .75, v + .3), P(x + .5, v + .1), P(x + .25, v + .3)], '#c8102e', floor);
  }

  const layers = [];
  for (let k = 0; k <= W + H; k++) layers.push(el('g', {}, svg));

  function box(x, y, h, tone, parent, x0 = x, y0 = y) {
    const g = el('g', {}, parent);
    if (!solid(x + 1, y) || x + 1 >= X) poly([P(x + 1, y0, h), P(x + 1, y + 1, h), P(x + 1, y + 1), P(x + 1, y0)], tone[2], g);
    if (!solid(x, y + 1) || y + 1 >= Y) poly([P(x0, y + 1, h), P(x + 1, y + 1, h), P(x + 1, y + 1), P(x0, y + 1)], tone[1], g);
    poly([P(x0, y0, h), P(x + 1, y0, h), P(x + 1, y + 1, h), P(x0, y + 1, h)], tone[0], g);
    return g;
  }

  function goods(g, x, y, type, kind, height) {
    const color = COLORS[type] || '#9a918a';
    const faces = [];
    if (walkable(x + 1, y)) faces.push((u, z) => P(x + 1, y + u, z));
    if (walkable(x, y + 1)) faces.push((u, z) => P(x + u, y + 1, z));
    if (kind === 'bin' || kind === 'rack') {
      poly([P(x + .07, y + .07, height + .1), P(x + .93, y + .07, height + .1), P(x + .93, y + .93, height + .1), P(x + .07, y + .93, height + .1)], kind === 'bin' ? '#68553a' : '#ad8b5b', g);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
        const [cx, cy] = P(x + .22 + col * .28, y + .22 + row * .28, height + 1.5);
        el('ellipse', { cx, cy, rx: kind === 'rack' ? 3.7 : 2.9, ry: 1.9, fill: kind === 'rack' ? ['#d5a765', '#e2bc82', '#c99550'][(row + col) % 3] : shade(color, ((row + col) % 3 - 1) * .12) }, g);
        if (kind === 'rack') el('path', { d: `M${cx - 1} ${cy - 1}l1 1.5`, stroke: '#f4d9ae', 'stroke-width': .7 }, g);
      }
    }
    for (const at of faces) {
      const cell = (u0, u1, z0, z1, fill) => poly([at(u0, z0), at(u1, z0), at(u1, z1), at(u0, z1)], fill, g);
      if (kind === 'bin' || kind === 'rack') {
        cell(.03, .97, 2, 3.4, '#d9c099');
        cell(.03, .97, height - 2.4, height - 1, '#d9c099');
        cell(.35, .65, 5, 8, '#f7f2e9');
        continue;
      }
      cell(.05, .95, 2, height - 2, kind === 'fridge' ? '#7098ac' : '#b8aea6');
      for (let level = 0; level < 2; level++) {
        const step = (height - 3) / 2, base = 2.5 + level * step;
        SIZES.forEach(([a, b, h], i) => {
          const u0 = .08 + a * .84, u1 = .08 + b * .84 - .015;
          if (kind === 'fridge') {
            cell(u0 + .02, u1 - .02, base, base + step * .66, type === 'milk' ? '#f7fafb' : shade(color, .08));
            cell(u0 + .07, u1 - .07, base + step * .66, base + step * .8, '#edf5f8');
          } else cell(u0, u1, base, base + h * step / 9, shade(color, [-.08, .12, -.18][(i + level) % 3]));
        });
        cell(.05, .95, base - 1.2, base, kind === 'fridge' ? '#d8eaf2' : '#f2eeea');
      }
      if (kind === 'fridge') {
        cell(.06, .94, 2, height - 2, '#c0e7f5');
        g.lastChild.setAttribute('opacity', '.28');
        cell(.03, .07, 2, height - 2, '#eaf4f8');
        cell(.93, .97, 2, height - 2, '#eaf4f8');
        cell(.83, .87, 8, 14, '#496d80');
      }
    }
  }

  const WALL_TONE = ['#f7f5f3', '#e2dcd7', '#d6cfc9'];
  const SIGN = 3.6, signY = (1 + Y) / 2 + SIGN / 2;
  const trim = y => y < Math.floor(signY - SIGN) || y > Math.floor(signY);
  for (let y = 0; y < Y; y++) {
    for (let x = 0; x < X; x++) {
      if (!solid(x, y)) continue;
      if (y === 0 && bayX.has(x)) continue;
      const layer = layers[x + y];
      if (x === 0 || y === 0) {
        box(x, y, WALL, WALL_TONE, layer, x === 0 ? EDGE : x, y === 0 ? EDGE : y);
        if (x > 0 || y > 0) {
          if (x === 0 && y > 0 && trim(y)) poly([P(1, y, WALL - 5), P(1, y + 1, WALL - 5), P(1, y + 1, WALL - 8), P(1, y, WALL - 8)], '#c8102e', layer);
          if (y === 0) poly([P(x, 1, WALL - 5), P(x + 1, 1, WALL - 5), P(x + 1, 1, WALL - 8), P(x, 1, WALL - 8)], '#c8102e', layer);
        }
      } else {
        const type = shelves[x + ',' + y], kind = fixtures[x + ',' + y] || 'shelf', fixture = FIXTURES[kind];
        const g = box(x, y, fixture.height, fixture.tone, layer);
        if (type) goods(g, x, y, type, kind, fixture.height);
      }
    }
  }
  const unit = Math.hypot(A, B), [ex, ey] = P(1, signY, WALL - 7);
  const sign = el('g', { transform: `matrix(${A / unit} ${-B / unit} 0 1 ${ex} ${ey})` }, layers[Math.floor(signY)]);
  el('image', { href: 'static/assets/grocery-bot-icon.svg', width: 15, height: 15 }, sign);
  el('text', { x: 20, y: 12, 'font-family': 'Mulish, Arial, sans-serif', 'font-weight': 900, 'font-size': 12.5, fill: '#c8102e' }, sign).textContent = 'Grocery Bot';

  // Department signs over each block, so the sections read as a real shop: dairy at the back,
  // produce and bakery together, dry goods in the middle aisles (OTHER-CITIES.md change 4).
  const DEPT_TONE = {
    fridge: { fill: '#e8f3f8', edge: '#a9cbdc', ink: '#35627a' },
    bin: { fill: '#eaf3e4', edge: '#9dbb8b', ink: '#40603a' },
    rack: { fill: '#fbf0dd', edge: '#d7b98a', ink: '#775b33' },
    shelf: { fill: '#f7f3ef', edge: '#d9cec5', ink: '#5f554e' },
  };
  for (const dept of layout.departments || []) {
    if (!dept.cells || !dept.cells.length) continue;
    const cx = dept.cells.reduce((sum, [x]) => sum + x + .5, 0) / dept.cells.length;
    const cy = dept.cells.reduce((sum, [, y]) => sum + y + .5, 0) / dept.cells.length;
    const z = (FIXTURES[dept.fixture] || FIXTURES.shelf).height + 9;
    const [px, py] = P(cx, cy, z);
    const tone = DEPT_TONE[dept.fixture] || DEPT_TONE.shelf;
    const text = dept.name;
    const w = text.length * 3.05 + 9;
    const g = el('g', {}, layers[Math.min(layers.length - 1, Math.round(cx + cy))]);
    const plane = el('g', { transform: `matrix(${A / unit} ${-B / unit} 0 1 ${px.toFixed(1)} ${py.toFixed(1)})` }, g);
    el('rect', { x: (-w / 2).toFixed(1), y: -7, width: w.toFixed(1), height: 8, rx: 2.4, fill: tone.fill, stroke: tone.edge, 'stroke-width': .6 }, plane);
    el('text', { x: 0, y: -1.3, 'text-anchor': 'middle', 'font-family': 'Mulish, Arial, sans-serif', 'font-weight': 800,
                 'font-size': 5.1, fill: tone.ink }, plane).textContent = text;
  }

  // ---- bots ----------------------------------------------------------------------
  const bots = Array.from({ length: layout.botsPerPlayer }, () => {
    const g = el('g', { class: 'bot' });
    const shadow = el('ellipse', { cx: 0, cy: 0, rx: 9, ry: 4.5, fill: 'rgba(23,20,18,.16)' }, g);
    const pose = el('g', {}, g);
    return { g, shadow, pose, key: '' };
  });
  const FOOT = .3;
  function frontLayer(bx, by) {
    let first = layers.length;
    for (let cx = Math.floor(bx) - 2; cx <= Math.floor(bx) + 2; cx++) {
      for (let cy = Math.floor(by) - 2; cy <= Math.floor(by) + 2; cy++) {
        if (cx < 0 || cy < 0 || cx >= X || cy >= Y || !solid(cx, cy)) continue;
        if ((cx >= bx + FOOT && cy + 1 > by - FOOT) || (cy >= by + FOOT && cx + 1 > bx - FOOT)) first = Math.min(first, cx + cy);
      }
    }
    return first - 1;
  }

  // ---- trucks: the player's map truck art on the isometric side, loading door at the rear ----
  let paint = '#c8102e';

  function truckMarkup(dock, s) {
    const { TOP, FLOOR } = TRUCK;
    const x0 = dock + .06, x1 = dock + .94, r = 0;
    const v = z => -z;
    const door = 21 * (1 - s.open);
    const goodsColor = type => COLORS[type] || '#b3a994';
    // The same side-view art the 2D and 3D map trucks use (looks.js truckArt), projected onto
    // the isometric side: svg x -74 (rear) … 71 (cab front) is 3.1 cells, svg y 38 is the ground
    // and the 90-unit-tall art is 31 units tall. The rear face stays a loading door.
    const truckLook = look || { carriage: 'box', head: 'flat', color: 'red', visor: 'none', decal: 'plain', eyes: 'dots' };
    const head = HEADS[truckLook.head] || HEADS.flat;
    const sideScale = 3.1 / 144, zScale = .344;
    const cargoFront = -(14 + 74) * sideScale;
    const cabFront = -(71 + 74) * sideScale, cabBack = -(18 + 74) * sideScale;
    const cargoZ = (38 + 52) * zScale;
    const cabZ = (38 - head.top) * zScale;
    const cargoRoof = truckLook.carriage === 'canvas' ? mix(paint, '#ffffff', .78)
      : truckLook.carriage === 'flatbed' ? WOOD : '#fbfaf8';
    const roofZ = truckLook.carriage === 'flatbed' ? (38 - 4) * zScale : cargoZ;
    let out = `<polygon points="${pts([P(x0 - .04, cabFront - .05), P(x1 + .2, cabFront - .05), P(x1 + .2, r + .12), P(x0 - .04, r + .12)])}" fill="rgba(23,20,18,.13)"/>`;
    out += `<g transform="translate(0 ${-(s.bounce || 0)})">`;
    out += `<g transform="matrix(${A * sideScale} ${-B * sideScale} 0 ${zScale} ${A * x1 + A * 74 * sideScale} ${B * x1 - B * 74 * sideScale - 38 * zScale})">${truckArt(truckLook, false)}</g>`;
    out += `<g transform="matrix(${A} ${B} 0 1 ${-r * A} ${r * B})">`;
    out += `<rect x="${x0}" y="${v(TOP)}" width="${x1 - x0}" height="${TOP - FLOOR + 1}" rx=".05" fill="#e2dcd6"/>`;
    out += `<rect x="${x0 + .07}" y="${v(TOP - 2)}" width="${x1 - x0 - .14}" height="${TOP - FLOOR - 3}" fill="#3d3532"/>`;
    const w = (x1 - x0 - .2) / 3;
    s.load.slice(0, 9).forEach((type, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      out += `<rect x="${x0 + .1 + col * w + .01}" y="${v(FLOOR + 1 + (row + 1) * 6.4)}" width="${w - .02}" height="6" rx=".02" fill="${goodsColor(type)}"/>`;
    });
    if (door > .2) {
      out += `<rect x="${x0 + .07}" y="${v(TOP - 2)}" width="${x1 - x0 - .14}" height="${door}" fill="#ece7e3"/>`;
      for (let i = 0; i < Math.floor(door / 3.2); i++) out += `<rect x="${x0 + .07}" y="${v(TOP - 2) + 3.2 * (i + 1)}" width="${x1 - x0 - .14}" height=".5" fill="#d6cfc9"/>`;
    }
    const lamp = s.hazard ? '#f2b441' : '#c8102e';
    out += `<rect x="${x0 + .05}" y="${v(TOP - 3.4)}" width=".42" height="1.6" rx=".2" fill="${lamp}"/>`;
    out += `<rect x="${x1 - .47}" y="${v(TOP - 3.4)}" width=".42" height="1.6" rx=".2" fill="${lamp}"/>`;
    out += `<rect x="${x0}" y="${v(FLOOR - .5)}" width="${x1 - x0}" height="3" fill="#2b2522"/></g>`;
    out += `<polygon points="${pts([P(x0, cabFront, cabZ), P(x1, cabFront, cabZ), P(x1, cabBack, cabZ), P(x0, cabBack, cabZ)])}" fill="${shade(paint, .16)}"/>`;
    out += `<polygon points="${pts([P(x0, cabBack, cabZ), P(x1, cabBack, cabZ), P(x1, cargoFront, cabZ), P(x0, cargoFront, cabZ)])}" fill="${shade(paint, .06)}"/>`;
    out += `<polygon points="${pts([P(x0, cargoFront, roofZ), P(x1, cargoFront, roofZ), P(x1, r, roofZ), P(x0, r, roofZ)])}" fill="${cargoRoof}"/>`;
    return out + '</g>';
  }

  // The order tag above a truck: one square per queued item, filled once a robot has loaded it.
  const TAG_MAX = 10;
  function tagMarkup(dock, order, mask) {
    const [cx, cy] = P(dock + .5, -1.1, TRUCK.TOP + 16);
    const shown = order.slice(0, order.length > TAG_MAX ? TAG_MAX - 1 : TAG_MAX), more = order.length - shown.length;
    const w = shown.length * 7 + 6 + (more ? 13 : 0);
    let out = `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})"><g class="tag-pop">`;
    out += `<rect x="${-w / 2}" y="-7" width="${w}" height="12" rx="6" fill="#fff" stroke="#e1dcd8" stroke-width=".6"/>`;
    shown.forEach((type, i) => {
      const color = COLORS[type] || '#b3a994';
      out += `<rect x="${-w / 2 + 3.6 + i * 7}" y="-3.6" width="5" height="5" rx="1.2" fill="${mask[i] === '1' ? color : 'none'}" stroke="${color}" stroke-width=".8"/>`;
    });
    if (more) out += `<text x="${w / 2 - 3}" y="1.2" text-anchor="end" font-family="Mulish, Arial, sans-serif" font-weight="800" font-size="5.5" fill="#6b635e">+${more}</text>`;
    return out + '</g></g>';
  }

  const trucks = BAYS.map(([dock]) => {
    const g = el('g', { class: 'truck' }, layers[dock]);
    const tag = el('g', { class: 'truck-tag' }, layers[layers.length - 1]);
    return { dock, g, tag, key: '', tagKey: '' };
  });

  // drawTruck from arena.js; `now`/`next` are {state, departedAt, back, order, mask} for this tick and the next
  function drawTruck(truck, now, next, raw, clock) {
    const { PARKED } = TRUCK, AWAY_X = TRUCK.AWAY;
    let rear = PARKED, open = 1, hazard = false, moving = false, happy = false, tagOpacity = 1, pop = 1;
    let shown = raw > .5 && next.order.join() === now.order.join() ? next : now;
    if (now.state === DOCKED) {
      if (next.state === LEAVING && raw > .5) happy = true;
    } else {
      const since = now.since + raw, until = now.back - raw;
      if (since < 2.6 && (now.state === LEAVING || since < until)) {
        happy = true;
        open = 1 - clamp01(since / .35);
        tagOpacity = 1 - clamp01((since - .15) / .3);
        const drive = clamp01((since - .4) / 2);
        rear = PARKED + (AWAY_X - PARKED) * drive * drive * drive;
        moving = since > .4;
      } else {
        const back = clamp01(1 - (until - .35) / 2.25);
        rear = AWAY_X + (PARKED - AWAY_X) * outCubic(back);
        open = clamp01(1 - until / .35);
        hazard = until > .35 && Math.floor(clock / 160) % 2 === 0;
        moving = until > .35 && until < 2.6;
        tagOpacity = clamp01((.6 - until) / .3);
        pop = 1 + .35 * Math.sin(Math.PI * clamp01((.6 - until) / .6));
      }
      shown = now.state === LEAVING ? now : { order: now.order, mask: '' };
    }
    const visible = rear > AWAY_X + .3;
    truck.g.style.display = visible ? '' : 'none';
    truck.tag.style.display = visible && tagOpacity > 0 && shown.order.length ? '' : 'none';
    if (!visible) return;
    const blink = ((clock / 1000 + truck.dock * .37) % 3.4) < .13;
    const bounce = moving ? .6 * Math.abs(Math.sin(clock / 55)) : 0;
    const load = shown.order.filter((_, k) => shown.mask[k] === '1');
    const key = [paint, open.toFixed(2), hazard, happy, blink, bounce.toFixed(1), load.join()].join('|');
    if (key !== truck.key) {
      truck.key = key;
      truck.g.innerHTML = truckMarkup(truck.dock, { open, hazard, happy, blink, bounce, load });
    }
    const [dx, dy] = [-rear * A, rear * B];
    truck.g.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
    if (tagOpacity > 0 && shown.order.length) {
      const tagKey = shown.order.join() + '|' + shown.mask;
      if (tagKey !== truck.tagKey) {
        truck.tagKey = tagKey;
        truck.tag.innerHTML = tagMarkup(truck.dock, shown.order, shown.mask);
      }
      truck.tag.setAttribute('transform', `translate(${dx.toFixed(1)} ${(dy - (1 - tagOpacity) * 4).toFixed(1)})`);
      truck.tag.setAttribute('opacity', tagOpacity.toFixed(2));
      const inner = truck.tag.firstChild && truck.tag.firstChild.firstChild;
      if (inner) inner.setAttribute('transform', `scale(${pop.toFixed(3)})`);
    }
  }

  // ---- per frame -----------------------------------------------------------------
  let look = null;
  function setPlayer(player) {
    look = player.look;
    paint = player.colour;
    for (const bot of bots) bot.key = '';
    for (const truck of trucks) truck.key = '';
  }

  /** bots: [{x0, y0, x1, y1, event: 'move'|'pick'|'drop'|'wait', items0, items1, face: {gaze, back}}]
   *  trucks: [{now, next}] per bay; raw: 0..1 within the tick; clock: ms for blinks and breathing */
  function draw(botStates, truckStates, raw, clock) {
    const f = ease(raw);
    const placed = bots.map((bot, i) => {
      const s = botStates[i];
      const x = s.x0 + (s.x1 - s.x0) * f + .5, y = s.y0 + (s.y1 - s.y0) * f + .5;
      const [sx, sy] = P(x, y);
      bot.g.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
      const lift = Math.sin(Math.PI * raw);
      const hop = { move: 3.4, pick: 4.5, drop: 7 }[s.event] * lift || 0;
      const lean = s.event === 'move' ? Math.sign((s.x1 - s.x0) - (s.y1 - s.y0)) * 7 * lift : 0;
      const breath = s.event === 'wait' ? 1 + .03 * Math.sin(clock / 380 + i * 1.3) : 1;
      const blink = ((clock / 1000 + i * 1.73) % 3.9) < .13;
      const mood = s.event === 'drop' && raw > .4 ? 'happy' : blink ? 'blink' : 'calm';
      const items = raw > .5 ? s.items1 : s.items0;
      const key = [mood, s.face.gaze, s.face.back, items.join()].join('|');
      if (key !== bot.key) {
        bot.key = key;
        bot.pose.innerHTML = GB.markup({ shape: look.shape, color: GB.COLORS[look.color] || look.color, kind: look.eyes, mood, gaze: s.face.gaze, back: s.face.back, items, palette: COLORS });
      }
      bot.pose.setAttribute('transform', `translate(0 ${(-hop).toFixed(2)}) rotate(${lean.toFixed(2)}) scale(.85 ${(.85 * breath).toFixed(3)})`);
      bot.shadow.setAttribute('rx', (9 - hop * .5).toFixed(2));
      return { bot, depth: x + y, layer: frontLayer(x, y) };
    });
    placed.sort((a, b) => a.depth - b.depth).forEach(({ bot, layer }) => layers[Math.max(0, layer)].appendChild(bot.g));
    trucks.forEach((truck, i) => drawTruck(truck, truckStates[i].now, truckStates[i].next, raw, clock));
  }

  return { setPlayer, draw, states: { DOCKED, LEAVING, AWAY } };
}
