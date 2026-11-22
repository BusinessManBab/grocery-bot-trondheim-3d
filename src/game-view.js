// Preview build of the live /game/CODE page (prototypes/town-rush/game-view.js) with a 3D view added.
import { MAP_LABELS } from './game-map-labels.js';
import { forestPath, unpackTrees } from './forest.js?v=30';
import { COLORS, DEFAULT_LOOK, botSvg, cleanLook, truckSvg } from './looks.js';
import { createPanels } from './panels.js?v=30';

const $ = id => document.getElementById(id);
const code = 'PREVIEW';
const params = new URLSearchParams(location.search);
const wants3d = params.get('view') !== '2d';
// Start every download the first view needs at once, instead of one after another: the replay and
// map now, and for the 3D view also its code, the terrain, the baked buildings and the trees.
const early = new Map();
function grab(url, kind) {
  if (!early.has(url)) early.set(url, fetch(url).then(res => { if (!res.ok) throw new Error(`${url}: ${res.status}`); return res[kind](); }));
  return early.get(url);
}
const firstGame = fetch('data/game.json?v=30').catch(() => null);
grab('data/game-map.json?v=30', 'json');
grab('data/trees.bin?v=30', 'arrayBuffer').catch(() => null);
let view3dModule = null;
if (wants3d) {
  view3dModule = import('./view3d.js?v=30');
  for (const [url, kind] of [['data/terrain.json?v=30', 'json'], ['data/terrain.bin?v=30', 'arrayBuffer'],
    ['data/buildings.bin?v=30', 'arrayBuffer'], ['data/homes.json?v=30', 'json'], ['data/landmarks.json?v=30', 'json']]) grab(url, kind).catch(() => null);
}
const canvas = $('map'), ctx = canvas.getContext('2d');
const terrain = $('terrain'), mapCtx = terrain.getContext('2d', { alpha: false });
const shopSign = new Image();
shopSign.src = 'assets/grocery-bot-shop.svg';
const SPEEDS = [1, 2, 4, 8, 16];
const OPEN = 0, CLAIMED = 1, DELIVERED = 2, MISSED = 3;
const PARKED = 4, TRAIL = 7, POP_TICKS = 7;
const INK = '#171412';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const game = { meta: null, frames: [], activeOrders: new Map(), orderFrame: -1, finished: false, players: [] };
const play = { head: 0, speed: 4, paused: false, following: false, focus: null };
const view = { scale: 1, x: 0, y: 0, fit: 1, w: 0, h: 0, dpr: 1, touched: false };
let mapKey = '', hudTick = '', panels = null, picks = [];
let town = null, paths = null, origin = [0, 0], squash = 1, lastBoardTick = -1, pointers = new Map();

const wx = lon => (lon - origin[0]) * squash;
const wy = lat => -(lat - origin[1]);
const sx = x => x * view.scale + view.x;
const sy = y => y * view.scale + view.y;

function sprite(svg, width, height) {
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', `<svg width="${width}" height="${height}" `));
  return image;
}

function seatColours(players) {
  const names = Object.keys(COLORS), taken = new Set();
  return players.map(player => {
    const wanted = player.look ? cleanLook(player.look).color : null;
    const colour = wanted && !taken.has(wanted) ? wanted : names.find(name => !taken.has(name)) || 'red';
    taken.add(colour);
    return colour;
  });
}

function setMeta(meta) {
  game.meta = meta;
  const colours = seatColours(meta.players);
  game.players = meta.players.map((player, seat) => {
    const look = { ...cleanLook(player.look), color: colours[seat] };
    return { ...player, seat, look, colour: COLORS[colours[seat]], truck: sprite(truckSvg(look), 340, 244),
      shop: [wx(player.shop[0]), wy(player.shop[1])], facing: [] };
  });
  $('seek').max = meta.ticks;
  const span = meta.dayEnd - meta.clockStart;
  $('day').innerHTML = meta.rushHours.map(([a, b]) => `<i style="left:${(a - meta.clockStart) / span * 100}%;width:${(b - a) / span * 100}%"></i>`).join('') + '<b id="day-fill"></b>';
  $('board').style.height = `${game.players.length * 52}px`;
  $('board-title').textContent = `Standings · ${game.players.length} AI players`;
  $('board').replaceChildren(...game.players.map(player => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'g-row';
    row.style.setProperty('--seat', player.colour);
    row.innerHTML = `<span class="g-rank"></span><span class="g-face">${botSvg(player.look)}</span><span class="g-who"><strong></strong><small></small></span><span class="g-score"></span>`;
    row.querySelector('strong').textContent = player.name;
    if (player.store) row.title = `${player.store.name} · ${player.district}`;
    row.addEventListener('click', () => { play.focus = play.focus === player.seat ? null : player.seat; panels?.showShop(player.seat); lastBoardTick = -1; });
    player.row = row;
    return row;
  }));
}

function addFrames(frames) {
  for (const frame of frames) {
    if (game.frames.length && frame.t <= game.frames[game.frames.length - 1].t) continue;
    game.frames.push(frame);
  }
}

let gameRequests = 0;
async function load() {
  const res = await (gameRequests++ ? fetch('data/game.json?v=30').catch(() => null) : firstGame);
  const body = res && res.ok ? await res.json().catch(() => null) : null;
  if (!body) {
    if (!game.meta) $('message').textContent = res && res.status === 404 ? 'This game has not started yet. It opens here the moment it starts.' : 'Could not reach the game. Trying again ...';
    return setTimeout(load, game.meta ? 1500 : 3000);
  }
  const first = !game.meta;
  if (body.meta) setMeta(body.meta);
  addFrames(body.frames);
  game.finished = body.finished;
  if (first) {
    if (!wants3d) $('message').hidden = true;
    play.following = !game.finished;
    // Open on active deliveries rather than asking spectators to wait through packing.
    // The entire recording, including the opening, remains available on the timeline.
    const requestedTick = new URLSearchParams(location.search).get('t');
    const openingTick = requestedTick !== null && Number.isFinite(Number(requestedTick)) ? Number(requestedTick) : 120;
    play.head = game.finished ? clamp(openingTick, 0, latest()) : Math.max(0, latest() - 1);
    if (!game.finished) play.speed = 1;
    fit();
  }
  if (!game.finished) setTimeout(load, 1000);
}

const latest = () => game.frames.length ? game.frames[game.frames.length - 1].t : 0;

function buildPaths() {
  const line = list => { const path = new Path2D(); for (const p of list) { path.moveTo(wx(p[0]), wy(p[1])); for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1])); } return path; };
  const area = list => { const path = new Path2D(); for (const p of list) { path.moveTo(wx(p[0]), wy(p[1])); for (let i = 2; i < p.length; i += 2) path.lineTo(wx(p[i]), wy(p[i + 1])); path.closePath(); } return path; };
  paths = { water: area(town.water), green: area(town.green), lane: line(town.roads.lane), street: line(town.roads.street), major: line(town.roads.major) };
}

function resize() {
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = canvas.clientWidth;
  view.h = canvas.clientHeight;
  for (const layer of [terrain, canvas]) {
    layer.width = Math.round(view.w * view.dpr);
    layer.height = Math.round(view.h * view.dpr);
  }
  mapKey = '';
  if (!view.touched) fit();
}

function fit(wholeCity = false) {
  if (!town || !view.w) return;
  const wide = view.w > 760;
  const boardHeight = 40 + 52 * game.players.length;
  const pad = { l: wide ? 44 : 30, t: 104, r: wide ? 334 : 30,
    b: wide ? 92 : Math.min(boardHeight, view.h * .34) + 101 };
  let [x0, y0, x1, y1] = town.bounds;
  if (game.players.length) {
    const xs = game.players.map(p => p.shop[0]), ys = game.players.map(p => p.shop[1]);
    const mx = [wx(x0), wx(x1), ...xs], my = [wy(y0), wy(y1), ...ys];
    [x0, x1, y0, y1] = [Math.min(...mx), Math.max(...mx), Math.min(...my), Math.max(...my)];
  } else {
    [x0, x1, y0, y1] = [wx(x0), wx(x1), wy(y1), wy(y0)];
  }
  const w = Math.max(1, view.w - pad.l - pad.r), h = Math.max(1, view.h - pad.t - pad.b);
  view.scale = view.fit = Math.min(w / (x1 - x0), h / (y1 - y0));
  view.x = pad.l + (w - (x1 - x0) * view.scale) / 2 - x0 * view.scale;
  view.y = pad.t + (h - (y1 - y0) * view.scale) / 2 - y0 * view.scale;
  if (town.coverage && wholeCity !== true) {
    view.scale *= town.coverage.kind === 'distributed-city-match' ? 1.2 : 2.4;
    view.x = pad.l + w / 2 - (x0 + x1) / 2 * view.scale;
    view.y = pad.t + h / 2 - (y0 + y1) / 2 * view.scale;
  }
  view.touched = false;
}

function zoomAt(px, py, factor) {
  const next = clamp(view.scale * factor, view.fit * .6, view.fit * 14);
  const k = next / view.scale;
  view.x = px - (px - view.x) * k;
  view.y = py - (py - view.y) * k;
  view.scale = next;
  view.touched = true;
}

canvas.addEventListener('wheel', event => { event.preventDefault(); zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * (event.ctrlKey ? .01 : .0016))); }, { passive: false });
let tap = null;
canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, [event.offsetX, event.offsetY]); canvas.classList.add('is-dragging'); tap = pointers.size === 1 ? { x: event.offsetX, y: event.offsetY, t: performance.now() } : null; });
canvas.addEventListener('pointermove', event => {
  const before = pointers.get(event.pointerId);
  if (!before) { canvas.style.cursor = pickAt(event.offsetX, event.offsetY) ? 'pointer' : ''; return; }
  const now = [event.offsetX, event.offsetY];
  if (pointers.size === 2) {
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
    const was = Math.hypot(before[0] - other[0], before[1] - other[1]), is = Math.hypot(now[0] - other[0], now[1] - other[1]);
    if (was > 0) zoomAt((now[0] + other[0]) / 2, (now[1] + other[1]) / 2, is / was);
  } else {
    view.x += now[0] - before[0];
    view.y += now[1] - before[1];
    view.touched = true;
  }
  pointers.set(event.pointerId, now);
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, event => {
  if (type === 'pointerup' && tap && pointers.size === 1 && Math.hypot(event.offsetX - tap.x, event.offsetY - tap.y) < 6 && performance.now() - tap.t < 500) choose(event.offsetX, event.offsetY);
  tap = null;
  pointers.delete(event.pointerId);
  if (!pointers.size) canvas.classList.remove('is-dragging');
});

// Clicking on the map: an order house opens the order card, a shop opens that shop's window.
// `picks` holds this frame's clickable things in screen pixels, from the 2D or the 3D drawing.
function pickAt(x, y) {
  const list = mode === '3d' && world3d ? world3d.picks : picks;
  let best = null, score = Infinity;
  for (const p of list) {
    const d = Math.hypot(x - p.x, y - p.y) / p.r;
    if (d > 1) continue;
    const s = d + (p.kind === 'shop' ? .5 : 0);      // small orders win over the big shop next to them
    if (s < score) { score = s; best = p; }
  }
  return best;
}
function choose(x, y) {
  const hit = pickAt(x, y);
  if (!hit || !panels) return;
  if (hit.kind === 'order') panels.showOrder(hit.id);
  else panels.showShop(hit.seat);
}
canvas.addEventListener('dblclick', () => fit());

function seekTo(tick) {
  play.head = clamp(tick, 0, latest());
  play.following = false;
  lastBoardTick = -1;
}
$('seek').addEventListener('input', event => seekTo(Number(event.target.value)));
$('play').addEventListener('click', () => { play.paused = !play.paused; if (!play.paused && play.head >= latest() && game.finished) play.head = 0; });
$('speed').addEventListener('click', () => { play.speed = SPEEDS[(SPEEDS.indexOf(play.speed) + 1) % SPEEDS.length]; play.following = false; });
$('live').addEventListener('click', () => { play.following = true; play.paused = false; play.speed = 1; });
addEventListener('keydown', event => {
  if (event.target.closest?.('button, a')) return;
  if (event.code === 'Space') { event.preventDefault(); $('play').click(); }
  if (event.code === 'ArrowLeft') seekTo(play.head - 10);
  if (event.code === 'ArrowRight') seekTo(play.head + 10);
});
addEventListener('resize', resize);

function advanceOrders(index) {
  if (index < game.orderFrame) {
    game.activeOrders.clear();
    game.orderFrame = -1;
  }
  while (game.orderFrame < index) {
    const frame = game.frames[++game.orderFrame];
    for (const [id, status, owner, points, , lon, lat] of frame.o) {
      if (status === MISSED) game.activeOrders.delete(id);
      else {
        const position = lon === undefined ? game.activeOrders.get(id) : { x: wx(lon), y: wy(lat), lon, lat };
        if (position) game.activeOrders.set(id, { x: position.x, y: position.y, lon: position.lon, lat: position.lat, status, owner, points, t: frame.t });
      }
    }
    for (const id of frame.x) {
      if (game.activeOrders.get(id)?.status === OPEN) game.activeOrders.delete(id);
    }
  }
}

function visible(x, y, margin = 20) {
  return x >= -margin && y >= -margin && x <= view.w + margin && y <= view.h + margin;
}

function truckAt(player, index, a, b, k) {
  const ta = a.p[player.seat][4], tb = b.p[player.seat][4], i = index * 3;
  const ax = wx(ta[i]), ay = wy(ta[i + 1]), bx = wx(tb[i]), by = wy(tb[i + 1]);
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, dx: bx - ax, parked: (k < .5 ? ta : tb)[i + 2] < PARKED };
}

function drawMap() {
  const key = [view.x, view.y, view.scale, view.fit].join(',');
  if (key === mapKey) return;
  mapKey = key;
  const ctx = mapCtx;
  const s = view.scale, grow = Math.sqrt(s / view.fit);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#f0e9d8';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.setTransform(s * view.dpr, 0, 0, s * view.dpr, view.x * view.dpr, view.y * view.dpr);
  ctx.fillStyle = '#c9d8ac';
  ctx.fill(paths.green);
  if (paths.forest) ctx.fill(paths.forest);
  ctx.fillStyle = '#86b8c5';
  ctx.fill(paths.water);
  ctx.lineCap = ctx.lineJoin = 'round';
  const stroke = (path, width, colour) => { ctx.lineWidth = width * grow / s; ctx.strokeStyle = colour; ctx.stroke(path); };
  stroke(paths.lane, 1.4, '#ded4bd');
  stroke(paths.street, 4.4, '#d0c4aa');
  stroke(paths.major, 7, '#bca989');
  stroke(paths.street, 3, '#fff');
  stroke(paths.major, 5.2, '#fff7e5');
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = '#b5a489';
  for (const [lon, lat] of town.homes) {
    const x = sx(wx(lon)), y = sy(wy(lat));
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  const labels = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [name, lon, lat, zoom, kind] of town.labels || MAP_LABELS) {
    if (s / view.fit < zoom) continue;
    const x = sx(wx(lon)), y = sy(wy(lat));
    if (!visible(x, y, 0)) continue;
    ctx.font = kind === 'river' ? 'italic 700 13px Georgia, serif' : '700 12px system-ui, sans-serif';
    const half = ctx.measureText(name).width / 2 + 6;
    if (labels.some(label => Math.abs(y - label.y) < 18 && Math.abs(x - label.x) < half + label.half)) continue;
    labels.push({ x, y, half });
    ctx.lineWidth = 3;
    ctx.strokeStyle = kind === 'river' ? '#b8d9de' : '#fff7e5';
    ctx.strokeText(name, x, y);
    ctx.fillStyle = kind === 'river' ? '#1d5163' : '#514129';
    ctx.fillText(name, x, y);
  }
}

function drawOrders(tick) {
  const pops = [];
  for (const [id, now] of game.activeOrders) {
    const age = tick - now.t;
    if (now.status === DELIVERED && Math.floor(age) >= POP_TICKS) {
      game.activeOrders.delete(id);
      continue;
    }
    const x = sx(now.x), y = sy(now.y), owner = game.players[now.owner];
    if (!visible(x, y)) continue;
    const dim = play.focus !== null && now.owner !== play.focus && now.status !== OPEN ? .25 : 1;
    if (now.status === DELIVERED) {
      if (owner) pops.push({ x, y, age: age / POP_TICKS, text: `+${now.points}`, colour: owner.colour, dim });
      continue;
    }
    picks.push({ kind: 'order', id, x, y, r: 12 });
    if (panels?.selectedOrder === id) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9 + Math.sin(performance.now() / 180) * 1.5, 0, 7);
      ctx.stroke();
    }
    ctx.globalAlpha = dim;
    ctx.fillStyle = owner?.colour || '#fff5da';
    ctx.strokeStyle = owner ? '#fff' : '#735536';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = owner ? '#fff' : '#735536';
    ctx.fillRect(x - 1, y - 3, 2, 4);
  }
  ctx.globalAlpha = 1;
  return pops;
}

function drawTrails(index, k) {
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const player of game.players) {
    const dim = play.focus !== null && play.focus !== player.seat;
    const count = game.frames[index].p[player.seat][4].length / 3;
    for (let t = 0; t < count; t++) {
      const now = truckAt(player, t, game.frames[index], game.frames[Math.min(index + 1, game.frames.length - 1)], k);
      if (now.parked || !visible(sx(now.x), sy(now.y), 100)) continue;
      let px = sx(now.x), py = sy(now.y);
      for (let back = 0; back < TRAIL && index - back >= 0; back++) {
        const trucks = game.frames[index - back].p[player.seat][4];
        if (trucks[t * 3 + 2] < PARKED) break;
        const x = sx(wx(trucks[t * 3])), y = sy(wy(trucks[t * 3 + 1]));
        ctx.globalAlpha = (dim ? .12 : .55) * (1 - (back + k) / TRAIL);
        ctx.strokeStyle = player.colour;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        px = x;
        py = y;
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawActors(index, k, time) {
  const a = game.frames[index], b = game.frames[Math.min(index + 1, game.frames.length - 1)];
  const size = clamp(56 * Math.sqrt(view.scale / view.fit), 50, 96), items = [];
  for (const player of game.players) {
    const dim = play.focus !== null && play.focus !== player.seat ? .3 : 1;
    const count = a.p[player.seat][4].length / 3;
    let parked = 0;
    for (let t = 0; t < count; t++) {
      const now = truckAt(player, t, a, b, k);
      if (Math.abs(now.dx) > .4) player.facing[t] = now.dx < 0 ? -1 : 1;
      if (now.parked) { parked++; continue; }
      if (!visible(sx(now.x), sy(now.y), size)) continue;
      items.push({ y: sy(now.y), draw: () => truckImage(player, sx(now.x), sy(now.y) + Math.sin(time * 9 + t * 2 + player.seat) * .8, size, player.facing[t] || 1, dim) });
    }
    const hx = sx(player.shop[0]), hy = sy(player.shop[1]);
    if (visible(hx, hy, 90)) items.push({ y: hy - 1, draw: () => shop(player, hx, hy, dim, parked) });
  }
  items.sort((p, q) => p.y - q.y);
  for (const item of items) item.draw();
  ctx.globalAlpha = 1;
}

function truckImage(player, x, y, size, facing, alpha) {
  if (!player.truck.complete) return;
  const h = size * 122 / 170;
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.fillStyle = 'rgba(40,29,20,.22)';
  ctx.beginPath();
  ctx.ellipse(0, -3, size * .35, size * .08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(player.truck, -size * .518, -h * .9, size, h);
  ctx.restore();
}

function shop(player, x, y, alpha, parked) {
  picks.push({ kind: 'shop', seat: player.seat, x, y: y - 10, r: 36 });
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#583a2d';
  ctx.fillRect(x - 31, y - 24, 62, 34);
  ctx.fillStyle = '#fff3da';
  ctx.fillRect(x - 29, y - 22, 58, 30);
  ctx.fillStyle = player.colour;
  ctx.fillRect(x - 31, y - 24, 62, 6);
  ctx.fillStyle = '#b6d4d7';
  ctx.fillRect(x - 23, y - 11, 21, 13);
  ctx.fillStyle = '#65493a';
  ctx.fillRect(x + 8, y - 11, 12, 19);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#fff3da' : player.colour;
    ctx.fillRect(x - 32 + i * 8, y - 17, 8, 6);
  }
  if (shopSign.complete && shopSign.naturalWidth) ctx.drawImage(shopSign, x - 25, y - 39, 50, 17);
  ctx.font = '800 12px Mulish, Arial, sans-serif';
  const width = Math.min(132, ctx.measureText(player.name).width + 16);
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y + 13, width, 20, 10);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(player.name, x, y + 23.5, width - 12);
  ctx.fillStyle = player.colour;
  for (let i = 0; i < parked; i++) { ctx.beginPath(); ctx.arc(x + (i - (parked - 1) / 2) * 9, y + 39, 3, 0, 7); ctx.fill(); }
}

function drawPops(pops) {
  ctx.font = '900 15px Mulish, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pop of pops) {
    ctx.globalAlpha = (1 - smooth(.55, 1, pop.age)) * pop.dim;
    ctx.beginPath();
    ctx.arc(pop.x, pop.y, 5 + pop.age * 16, 0, 7);
    ctx.lineWidth = 2.5 * (1 - pop.age);
    ctx.strokeStyle = pop.colour;
    ctx.stroke();
    const y = pop.y - 14 - pop.age * 22;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(pop.text, pop.x, y);
    ctx.fillStyle = pop.colour;
    ctx.fillText(pop.text, pop.x, y);
  }
  ctx.globalAlpha = 1;
}

function board(frame) {
  const order = game.players.map(player => ({ player, row: frame.p[player.seat] })).sort((p, q) => q.row[0] - p.row[0] || q.row[1] - p.row[1] || p.player.seat - q.player.seat);
  order.forEach(({ player, row }, place) => {
    const el = player.row;
    el.style.transform = `translateY(${place * 52}px)`;
    el.classList.toggle('is-focus', play.focus === player.seat);
    el.classList.toggle('is-dim', play.focus !== null && play.focus !== player.seat);
    el.querySelector('.g-rank').textContent = place + 1;
    el.querySelector('.g-score').textContent = row[0].toLocaleString('en-US');
    el.querySelector('small').textContent = `${row[1]} delivered` + (row[3] == null ? '' : ` · ${row[3]}% happy`);
  });
}

function hud(frame, next, k) {
  const clock = frame.c + (next.c - frame.c) * k, minutes = Math.floor(clock / 60);
  $('clock').textContent = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  $('rush').hidden = !frame.r;
  const live = !game.finished && play.following, done = game.finished && play.head >= game.meta.ticks;
  $('badge').textContent = live ? 'Live' : done ? 'Final' : game.finished ? 'Replay' : 'Behind live';
  $('badge').classList.toggle('is-live', live);
  $('board-title').textContent = `${done ? 'Final result' : 'Standings'} · ${game.players.length} AI players`;
  $('live').hidden = game.finished || play.following;
  $('speed').hidden = !game.finished && play.following;
  $('speed').textContent = `${play.speed}×`;
  $('play').classList.toggle('is-paused', play.paused);
  $('play').setAttribute('aria-label', play.paused ? 'Play' : 'Pause');
  if (document.activeElement !== $('seek')) $('seek').value = play.head;
  $('tick').textContent = `${Math.floor(play.head)} / ${game.meta.ticks}`;
  const fill = $('day-fill');
  if (fill) fill.style.width = `${play.head / game.meta.ticks * 100}%`;
}

function darkness(clock) {
  return .16 * (1 - smooth(6 * 3600, 7.2 * 3600, clock)) + .26 * smooth(19.5 * 3600, 22.5 * 3600, clock);
}

let before = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - before) / 1000);
  before = now;
  if (!paths || !view.w) return;
  if (mode !== '3d') drawMap();
  if (!game.frames.length) return;
  const end = latest();
  if (play.following) {
    const target = Math.max(0, end - 1);
    play.head = clamp(play.head + dt * clamp(1 + (target - play.head) * .6, 0, 6), 0, end);
  } else if (!play.paused) {
    play.head = Math.min(end, play.head + dt * play.speed);
  }
  const index = clamp(Math.floor(play.head), 0, game.frames.length - 1), k = clamp(play.head - index, 0, 1);
  const a = game.frames[index], b = game.frames[Math.min(index + 1, game.frames.length - 1)];
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  picks = [];
  const dark = darkness(a.c + (b.c - a.c) * k);
  advanceOrders(index);
  if (mode === '3d' && world3d) {
    drawPops(world3d.render({ index, k, a, b, time: now / 1000, dark, tick: play.head }));
  } else {
    if (dark > 0) {
      ctx.fillStyle = `rgba(22,30,52,${dark})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    const pops = drawOrders(play.head);
    drawTrails(index, k);
    drawActors(index, k, now / 1000);
    drawPops(pops);
  }
  const hudKey = [Math.floor(play.head * 10), play.speed, play.paused, play.following, game.finished].join(',');
  if (hudKey !== hudTick) {
    hudTick = hudKey;
    hud(a, b, k);
  }
  if (index !== lastBoardTick) { lastBoardTick = index; board(a); }
  panels?.update(index, k, a, play.head, now / 1000);
}

// ---- 2D / 3D switch -------------------------------------------------------
let mode = '2d', world3d = null, loading3d = null;
const host3d = $('world3d');

async function setMode(next) {
  if (next === '3d' && !world3d) {
    $('view-3d').setAttribute('aria-busy', 'true');
    $('message').hidden = false;
    $('message').textContent = `Preparing ${town.name || 'the town'}…`;
    await forestReady;
    loading3d ||= (view3dModule || import('./view3d.js?v=30')).then(m => m.createWorld3d({
      host: host3d, overlay: ctx, view, town, game, play, wx, wy, truckAt, shopSign, labels: town.labels || MAP_LABELS, trees, grab, paths,
      constants: { OPEN, CLAIMED, DELIVERED, MISSED, PARKED, TRAIL, POP_TICKS, INK },
      selected: () => panels?.selectedOrder ?? null, onTap: choose, hover: pickAt,
      onProgress: buildingProgress,
      onContextLost: () => { $('message').hidden = false; $('message').textContent = 'The graphics memory was reset. Reloading…'; setTimeout(() => location.reload(), 800); },
    }));
    try {
      world3d = await loading3d;
      $('message').hidden = true;
      world3d.ready.then(stats => {
        $('building-mode-label').textContent = `All ${stats.count.toLocaleString('en-US')} buildings resident`;
      }).catch(error => console.error(error));
    }
    catch (error) { console.error(error); $('message').hidden = false; $('message').textContent = 'The 3D view could not start in this browser.'; setTimeout(() => { $('message').hidden = true; }, 3000); next = '2d'; }
    $('view-3d').removeAttribute('aria-busy');
  }
  mode = next;
  document.body.classList.toggle('is-3d', mode === '3d');
  host3d.hidden = mode !== '3d';
  $('hint3d').hidden = mode !== '3d';
  $('view-2d').setAttribute('aria-pressed', String(mode === '2d'));
  $('view-3d').setAttribute('aria-pressed', String(mode === '3d'));
  if (world3d) world3d.setActive(mode === '3d');
  mapKey = '';
  const url = new URL(location.href);
  url.searchParams.set('view', mode);
  history.replaceState(null, '', url);
}
$('view-2d').addEventListener('click', () => setMode('2d'));
$('view-3d').addEventListener('click', () => setMode('3d'));
$('city-overview').addEventListener('click', () => {
  if (mode === '3d' && world3d) world3d.overview();
  else fit(true);
  $('explore-place').value = '';
});
$('city-home').addEventListener('click', () => {
  if (mode === '3d' && world3d) world3d.flyHome();
  else fit();
  $('explore-place').value = '';
});
for (const [id, factor] of [['zoom-in', .7], ['zoom-out', 1 / .7]]) {
  $(id).addEventListener('click', () => {
    if (mode === '3d' && world3d) world3d.zoomBy(factor);
    else zoomAt(view.w / 2, view.h / 2, 1 / factor);
  });
}
$('explore-place').addEventListener('change', event => {
  if (!event.target.value) return;
  const [lon, lat] = event.target.value.split(',').map(Number);
  if (mode === '3d' && world3d) world3d.explore(lon, lat);
  else {
    view.scale = view.fit * 4.5;
    view.x = (view.w - (view.w > 760 ? 300 : 0)) / 2 - wx(lon * 1e5) * view.scale;
    view.y = view.h * .4 - wy(lat * 1e5) * view.scale;
    view.touched = true;
  }
});
addEventListener('keydown', event => {
  if (event.target.closest?.('input, textarea')) return;
  if (event.key === 'v' || event.key === 'V') setMode(mode === '3d' ? '2d' : '3d');
});
window.groceryView = { setMode, play, game, toWorld: (lon, lat) => [wx(lon), wy(lat)], get picks() { return mode === '3d' && world3d ? world3d.picks : picks; }, get panels() { return panels; }, get world3d() { return world3d; } };

// Forest: the same spots as the 3D trees, painted green under them in 2D. Planted once by
// tools/bake_trees.cjs (data/trees.bin) rather than on every visit.
let trees = { forest: [], parks: [] }, forestReady = null;
function growForest() {
  if (params.get('forest') === '0') return;
  forestReady = grab('data/trees.bin?v=30', 'arrayBuffer').then(buffer => {
    trees = unpackTrees(buffer);
    paths.forest = forestPath(trees.forest);
    mapKey = '';
  }).catch(error => console.error(error));
}

// "Building Bergen: 12,400 / 54,326" while the city workers stream the chunks in
function buildingProgress(count, total) {
  const label = $('building-mode-label');
  if (count < total) label.textContent = `Building ${town.name || 'the town'}: ${count.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`;
}

function openPanels() {
  // shop window + order card; `meta.you` is the viewer's seat (in the live game: the signed-in player's)
  createPanels({ game, play, you: Number.isInteger(game.meta.you) ? game.meta.you : null,
    autoOpen: innerWidth > 760 || params.get('buildings') === 'adaptive',
  }).then(made => { panels = made; }).catch(error => console.error(error));
}

// The explore menu: the town's landmarks and districts from data/places.json ([{ name, lon, lat }]).
function addPlaces() {
  const select = $('explore-place'), name = town.name || 'the town';
  select.options[0].textContent = `Explore ${town.name || ''}`.trim();
  select.setAttribute('aria-label', `Fly to a place in ${name}`);
  grab('data/places.json?v=30', 'json').then(({ places }) => {
    for (const place of places) select.add(new Option(place.name, `${place.lon},${place.lat}`));
  }).catch(() => { select.hidden = true; });
}

async function start() {
  document.querySelector('.g-mark').innerHTML = botSvg(DEFAULT_LOOK);
  $('building-mode-label').textContent = 'Every building resident once built';
  if (!code) { $('message').textContent = 'This link has no game code.'; return; }
  town = await grab('data/game-map.json?v=30', 'json');
  // per-town maps (tools/build-town-game-map.py) carry their own name and labels; Kongsberg's do not
  if (town.name) {
    const [west, south, east, north] = town.bounds;
    const km2 = (east - west) * (north - south) / 1e10 * 111.32 * 111.32 * Math.cos((south + north) / 2e5 * Math.PI / 180);
    document.querySelector('.g-brand small').textContent = town.name + (town.coverage ? ` · ${Math.round(km2)} km² to explore` : '');
    document.title = `Grocery Bot ${town.name} Map`;
  }
  origin = [(town.bounds[0] + town.bounds[2]) / 2, (town.bounds[1] + town.bounds[3]) / 2];
  squash = Math.cos(origin[1] / 1e5 * Math.PI / 180);
  buildPaths();
  growForest();
  addPlaces();
  resize();
  requestAnimationFrame(frame);
  await load();
  while (!game.meta) await new Promise(resolve => setTimeout(resolve, 500));
  // The shop window's own data and drawing wait until the 3D view is up, so they do not compete with it.
  if (wants3d) await setMode('3d');
  openPanels();
}

start();
