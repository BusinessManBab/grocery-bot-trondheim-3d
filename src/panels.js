// The shop window (bottom right: robots picking and loading inside one player's shop) and the
// order card (left: what a clicked order is, how long ago, how happy). Both read data/shop.json
// and data/shop.bin, recorded from the engine alongside the public feed (tools/simulate_match.py).
import { botSvg } from './looks.js';
import { createIsoShop } from './shop-iso.js?v=14';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PARKED = 4;
// One colour per product, for shelves, carried items and the order card.
const PRODUCT_COLOURS = {
  milk: '#7fb2e5', bread: '#c98f4f', apples: '#d6453d', pasta: '#e8c547', butter: '#f2d675', flour: '#cfc6b8', bananas: '#f1d02e',
  rice: '#b9b1a4', yogurt: '#9fc7d9', oats: '#b48a5a', tomatoes: '#e0533a', cereal: '#e39a3b', cheese: '#f0b429', eggs: '#e9d8b4',
  carrots: '#ef7d2d', juice: '#f59f2a', cream: '#c7d7e6', onions: '#a86a9b', peppers: '#4f9d4a', lettuce: '#7cbf4f', sugar: '#d9d2e8',
};
// the v1 goods palette (GroceryBot.GOODS) so the card matches the baskets and shelves in the shop window
const productColour = name => window.GroceryBot?.GOODS?.[name] || PRODUCT_COLOURS[name] || '#a99';
const STATUS = {
  open: 'Open: waiting for a shop to claim it', claimed: 'Claimed', delivering: 'On the way', delivered: 'Delivered',
  expired: 'Expired: no shop claimed it in time', undelivered: 'Not delivered before the day ended',
};

export async function createPanels({ game, play, you }) {
  const [data, bin] = await Promise.all([
    fetch('data/shop.json').then(res => res.ok ? res.json() : null),
    fetch('data/shop.bin').then(res => res.ok ? res.arrayBuffer() : null),
  ]).catch(() => [null, null]);
  if (!data || !bin) return null;               // towns without recorded shop data: no panels
  const frames = new Uint8Array(bin);
  const state = { seat: you ?? null, open: false, order: null, lastCard: '' };

  // ---- shop window: the v1 store animation (shop-iso.js), driven by the recorded match ----
  const win = $('shopwin'), iso = createIsoShop($('shop-svg'), data);
  $('shop-close').addEventListener('click', () => closeShop());
  let trucks = [];                                // per bay: per tick {state, since, back}

  function showShop(seat) {
    if (!game.players[seat]) return;
    state.seat = seat;
    state.open = true;
    state.footKey = '';
    const player = game.players[seat];
    win.hidden = false;
    document.body.classList.add('has-shop');
    win.style.setProperty('--seat', player.colour);
    $('shop-title').textContent = seat === you ? 'Your shop' : `${player.name}'s shop`;
    $('shop-face').innerHTML = botSvg(player.look);
    iso.setPlayer(player);
    trucks = truckTimeline(seat);
    fitBoard();
  }

  // keep the standings above the (now bigger) shop window
  function fitBoard() { requestAnimationFrame(() => document.body.style.setProperty('--shop-h', win.offsetHeight + 'px')); }
  addEventListener('resize', () => { if (state.open) fitBoard(); });

  function closeShop() {
    state.open = false;
    win.hidden = true;
    document.body.classList.remove('has-shop');
  }

  // When each truck is home, leaving (home now, gone next tick) or away, how long since it left
  // and how long until it is back: what arena.js needs to back trucks in and out of the bays.
  function truckTimeline(seat) {
    const T = game.frames.length, { DOCKED, LEAVING, AWAY } = iso.states;
    return data.bays.map((_, bay) => {
      const home = game.frames.map(frame => frame.p[seat][4][bay * 3 + 2] < PARKED);
      const out = new Array(T);
      let left = 0;
      for (let t = 0; t < T; t++) {
        const st = home[t] ? (t + 1 < T && !home[t + 1] ? LEAVING : DOCKED) : AWAY;
        if (st === LEAVING) left = t;
        out[t] = { state: st, since: st === DOCKED ? 0 : t - left };
      }
      let back = T + 100;
      for (let t = T - 1; t >= 0; t--) {
        if (home[t] && out[t].state === DOCKED) back = t;
        out[t].back = back - t;
      }
      return out;
    });
  }

  // The items queued on a bay's truck at a tick and which are loaded (truckLoads change log).
  function loadAt(seat, bay, tick) {
    const log = data.truckLoads?.[seat]?.[bay] || [];
    let entry = null;
    for (const e of log) { if (e[0] > tick) break; entry = e; }
    return entry ? { order: entry[1].map(p => data.products[p]), mask: entry[2] } : { order: [], mask: '' };
  }

  // byte layout per tick and seat: robots x [x, y, action, item1+1, item2+1, item3+1], trucks x [loaded, needed]
  const at = (tick, seat) => (clamp(tick, 0, data.ticks - 1) * data.seats + seat) * data.frameBytes;
  const EVENTS = ['wait', 'move', 'pick', 'drop'];
  const itemsAt = i => [frames[i + 3], frames[i + 4], frames[i + 5]].filter(Boolean).map(p => data.products[p - 1]);

  // Which way a robot looks: its last move (arena.js keeps facing between moves).
  function facing(seat, bot, index) {
    for (let r = index; r >= Math.max(0, index - 40); r--) {
      const i = at(r, seat) + bot * 6, j = at(r + 1, seat) + bot * 6;
      const dx = frames[j] - frames[i], dy = frames[j + 1] - frames[i + 1];
      if (dx > 0) return { gaze: 1, back: false };
      if (dy > 0) return { gaze: -1, back: false };
      if (dx < 0 || dy < 0) return { gaze: 0, back: true };
    }
    return { gaze: 0, back: false };
  }

  function drawShop(index, k, time) {
    const seat = state.seat, o = at(index, seat), n = at(index + 1, seat), bots = [];
    for (let b = 0; b < data.botsPerPlayer; b++) {
      const i = o + b * 6, j = n + b * 6;
      const moved = frames[i] !== frames[j] || frames[i + 1] !== frames[j + 1];
      bots.push({ x0: frames[i], y0: frames[i + 1], x1: frames[j], y1: frames[j + 1], event: moved ? 'move' : EVENTS[frames[j + 2]] === 'move' ? 'wait' : EVENTS[frames[j + 2]],
        items0: itemsAt(i), items1: itemsAt(j), face: facing(seat, b, index) });
    }
    const truckStates = data.bays.map((_, bay) => {
      const line = trucks[bay], t0 = clamp(index, 0, line.length - 1), t1 = clamp(index + 1, 0, line.length - 1);
      return { now: { ...line[t0], ...loadAt(seat, bay, t0) }, next: { ...line[t1], ...loadAt(seat, bay, t1) } };
    });
    iso.draw(bots, truckStates, k, time * 1000);
    return bots;
  }

  function footer(index, frameA, bots) {
    const seat = state.seat, trucks = frameA.p[seat][4];
    let home = 0;
    for (let t = 0; t < trucks.length / 3; t++) if (trucks[t * 3 + 2] < PARKED) home++;
    const busy = bots.filter(b => b.event !== 'wait').length;
    let picking = 0, out = 0;
    for (const order of Object.values(data.orders)) {
      const s = statusAt(order, index);
      if (s.seat !== seat) continue;
      if (s.status === 'claimed') picking++;
      if (s.status === 'delivering') out++;
    }
    $('shop-foot').textContent = `${busy} of ${data.botsPerPlayer} robots working · ${picking} order${picking === 1 ? '' : 's'} being packed · ${home} truck${home === 1 ? '' : 's'} home, ${trucks.length / 3 - home} out with ${out}`;
  }

  // ---- order card --------------------------------------------------------------
  const card = $('ordercard');
  addEventListener('keydown', event => { if (event.key === 'Escape') closeOrder(); });

  function statusAt(order, tick) {
    let now = { status: 'open', seat: -1, since: order.placed };
    for (const [t, status, seat] of order.history) {
      if (t > tick) break;
      if (status !== now.status || seat !== now.seat) now = { status, seat, since: t };
    }
    return now;
  }

  function showOrder(id) {
    if (!data.orders[id]) return;
    state.order = id;
    state.lastCard = '';
    state.cardTick = -1;
    card.hidden = false;
  }

  function closeOrder() {
    state.order = null;
    card.hidden = true;
  }

  const clockText = seconds => { const m = Math.floor(seconds / 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  // One tick is (dayEnd - clockStart) / ticks seconds of the day shown in the HUD clock.
  const dayAt = tick => game.meta.clockStart + (game.meta.dayEnd - game.meta.clockStart) * tick / game.meta.ticks;
  const span = ticks => { const m = Math.round(Math.max(0, ticks) * (game.meta.dayEnd - game.meta.clockStart) / game.meta.ticks / 60); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
  const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function drawOrder(head) {
    const order = data.orders[state.order], tick = Math.floor(head), ts = data.tickSeconds;
    const s = statusAt(order, tick), owner = game.players[s.seat];
    const nowSec = head * ts;     // engine seconds: lateness is measured in these
    // happiness: final when delivered; else how late it is against the deadline (5% per 2.5 min late)
    let happy = 100, mood = '';
    if (s.status === 'delivered') happy = order.satisfaction ?? 100;
    else if (s.status === 'expired' || s.status === 'undelivered') happy = 0;
    else if (order.deadline != null && s.status !== 'open') {
      const late = Math.max(0, nowSec - order.deadline * ts);
      happy = Math.max(0, 100 - Math.floor(late / (data.lateStepTicks * ts)) * data.lateStepPercent);
    }
    mood = happy >= 95 ? 'Happy' : happy >= 70 ? 'Getting impatient' : happy > 0 ? 'Unhappy' : 'Gave up';
    let detail = STATUS[s.status];
    if (s.status === 'claimed') {
      const loading = order.firstLoad != null && tick >= order.firstLoad, ready = order.ready != null && tick >= order.ready;
      detail = `Claimed by ${owner?.name ?? 'a shop'}: ${ready ? 'packed, waiting for the truck to leave' : loading ? 'robots are loading it onto the truck' : 'robots are picking the items'}`;
    } else if (s.status === 'delivering') detail = `On the way in a ${owner?.name ?? ''} truck`;
    else if (s.status === 'delivered') detail = `Delivered by ${owner?.name ?? 'a shop'}`;
    let timing;
    if (s.status === 'delivered') timing = `Took ${span(order.deliveredAt - order.placed)} from order to doorstep`;
    else if (s.status === 'open') timing = `Expires in ${span(order.expires - head)} if no shop claims it`;
    else if (order.deadline != null && s.status !== 'expired' && s.status !== 'undelivered') {
      const left = order.deadline - head;
      timing = left >= 0 ? `Due ${clockText(dayAt(order.deadline))}, in ${span(left)}` : `${span(-left)} late (was due ${clockText(dayAt(order.deadline))})`;
    } else timing = '';
    const counts = {};
    for (const item of order.items) counts[item] = (counts[item] || 0) + 1;
    const items = Object.entries(counts).map(([name, n]) => `<li><i style="background:${productColour(name)}"></i>${n > 1 ? `${n} × ` : ''}${escape(name)}</li>`).join('');
    const points = s.status === 'delivered' ? `+${order.points} points${order.rushBonus ? ` (incl. ${order.rushBonus} rush-hour bonus)` : ''}` : `Worth ${order.reward} points on time`;
    const html = `
      <header><h2>Order ${escape(state.order)}</h2><button class="g-x" id="order-close" type="button" aria-label="Close order">×</button></header>
      <p class="g-order-where">${escape(order.address)}</p>
      <p class="g-order-status" style="--seat:${owner ? owner.colour : '#735536'}">${owner ? `<button type="button" class="g-order-shop" data-seat="${s.seat}">${escape(detail)}</button>` : escape(detail)}</p>
      <h3>${order.items.length} item${order.items.length === 1 ? '' : 's'}</h3><ul class="g-order-items">${items}</ul>
      <dl>
        <div><dt>Ordered</dt><dd>${clockText(dayAt(order.placed))}, ${span(head - order.placed)} ago</dd></div>
        ${timing ? `<div><dt>Time</dt><dd>${escape(timing)}</dd></div>` : ''}
        <div><dt>Customer</dt><dd><span class="g-happy"><b style="width:${happy}%;background:${happy >= 95 ? '#3f8f4f' : happy >= 70 ? '#e8a32e' : '#c8102e'}"></b></span> ${happy}% · ${mood}</dd></div>
        <div><dt>Points</dt><dd>${escape(points)}</dd></div>
      </dl>`;
    if (html !== state.lastCard) {
      card.innerHTML = html;
      state.lastCard = html;
      $('order-close').addEventListener('click', () => closeOrder());
      card.querySelector('.g-order-shop')?.addEventListener('click', event => showShop(Number(event.currentTarget.dataset.seat)));
    }
  }

  // ---- per frame ----------------------------------------------------------------
  function update(index, k, frameA, head, time) {
    if (state.open) {
      const bots = drawShop(index, k, time), key = index + ':' + state.seat;
      if (key !== state.footKey) { state.footKey = key; footer(index, frameA, bots); }
    }
    if (state.order && Math.floor(head * 4) !== state.cardTick) { state.cardTick = Math.floor(head * 4); drawOrder(head); }
  }

  if (state.seat !== null) showShop(state.seat);
  return { showShop, closeShop, showOrder, closeOrder, update, get selectedOrder() { return state.order; }, get seat() { return state.open ? state.seat : null; } };
}
