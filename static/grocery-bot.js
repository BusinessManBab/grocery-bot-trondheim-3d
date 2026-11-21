(() => {
  'use strict';

  const INK = '#171412';
  const SHAPES = {
    bean: { d: 'M-11.5 -6C-11.5 -15 -6.8 -19.5 0 -19.5S11.5 -15 11.5 -6C11.5 -2 9.4 0 5.2 0H-5.2C-9.4 0 -11.5 -2 -11.5 -6Z', eyes: -9, top: -19 },
    round: { d: 'M0 -21A10.5 10.5 0 1 1 0 0A10.5 10.5 0 1 1 0 -21Z', eyes: -10, top: -20.5 },
    box: { d: 'M-11 -13Q-11 -18.5 -5.5 -18.5H5.5Q11 -18.5 11 -13V-5Q11 0 5.5 0H-5.5Q-11 0 -11 -5Z', eyes: -9, top: -18 },
    tall: { d: 'M-8.5 -15.5C-8.5 -20.5 -4.7 -24.5 0 -24.5S8.5 -20.5 8.5 -15.5V-4.5C8.5 -1.5 6.5 0 3.5 0H-3.5C-6.5 0 -8.5 -1.5 -8.5 -4.5Z', eyes: -12.5, top: -24 },
    dome: { d: 'M-12.5 -4.5C-12.5 -12.5 -7 -16.5 0 -16.5S12.5 -12.5 12.5 -4.5C12.5 -1.5 10.8 0 7.8 0H-7.8C-10.8 0 -12.5 -1.5 -12.5 -4.5Z', eyes: -8, top: -16 }
  };
  const COLORS = {
    red: '#c8102e', ink: '#2b2522', leaf: '#3f8f4f', milk: '#3b77b8', carrot: '#e8772e', plum: '#7a4a93', lemon: '#f1c232', oat: '#e9dfcc'
  };

  const GOODS = {
    milk: '#5d8fbf', butter: '#e5c14b', yogurt: '#d08aa2', cheese: '#eea43c', cream: '#9fb9d2', eggs: '#c39a73',
    bread: '#a4642f', pasta: '#dfb95c', rice: '#c9bea4', cereal: '#d7792c', flour: '#b3a994', oats: '#98804f',
    apples: '#74a13a', bananas: '#e9cd4c', tomatoes: '#d4473a', onions: '#ae7a4f', carrots: '#e37c33',
    peppers: '#3c8a47', lettuce: '#8aba5a', juice: '#ee982f', sugar: '#d4ccbf'
  };

  function light(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
  }

  const COSTUMES = {
    bean: t => `<g transform="translate(-6.5 2.5) rotate(-34 0 ${t})"><path d="M-7 ${t + 0.6}L1 ${t - 15}Q2.6 ${t - 18.4} 4.6 ${t - 14}L8 ${t + 0.6}Z" fill="#1d1128"/><path d="M-6.2 ${t - 2.6}Q0.5 ${t - 1.2} 7.3 ${t - 2.8}L8 ${t + 0.6}H-7Z" fill="#7b3fe4"/><rect x="-0.8" y="${t - 3.2}" width="3.8" height="4" rx=".7" fill="none" stroke="#ff8a2b" stroke-width="1"/><path d="M3.4 ${t - 9.4}l.6 1.4 1.5.1-1.2.9.4 1.5-1.3-.8-1.3.8.4-1.5-1.2-.9 1.5-.1Z" fill="#ffd166"/><ellipse cx="0.5" cy="${t + 0.8}" rx="13.5" ry="2.9" fill="#1d1128"/><ellipse cx="0.5" cy="${t + 0.2}" rx="12" ry="1.6" fill="#33204d" opacity=".6"/></g>`,
    round: t => `<path d="M-3.5 -18Q-7.8 -10.5 -3.5 -2M3.5 -18Q7.8 -10.5 3.5 -2" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.2" stroke-linecap="round"/><path d="M-8 -17Q-11.5 -10 -8 -3M8 -17Q11.5 -10 8 -3" fill="none" stroke="rgba(0,0,0,.14)" stroke-width="1.1" stroke-linecap="round"/><path d="M-6 -5.4L-4 -2.6L-2 -5.4L0 -2.6L2 -5.4L4 -2.6L6 -5.4V-4.4L4 -1.6L2 -4.4L0 -1.6L-2 -4.4L-4 -1.6L-6 -4.4Z" fill="#1d1128"/><g transform="translate(7 ${t + 3.5}) rotate(24)"><path d="M-1.4 1V-5Q-1.4 -6.8 0.2 -6.8T1.8 -5V1Z" fill="#3f7d32"/><path d="M1.8 -3Q6 -8 9.6 -3.6Q5.5 -1.4 1.8 -3Z" fill="#5aa84a"/><path d="M3 -3.4Q5.8 -5 8.2 -3.8" fill="none" stroke="#3f7d32" stroke-width=".6"/></g>`,
    box: t => `<path d="M-10.8 ${t + 0.6}Q-10.8 ${t - 1.8} -6 ${t - 1.8}H6Q10.8 ${t - 1.8} 10.8 ${t + 0.6}V${t + 4.6}L7 ${t + 2.8}L3.5 ${t + 5}L0 ${t + 2.8}L-3.5 ${t + 5}L-7 ${t + 2.8}L-10.8 ${t + 4.6}Z" fill="#1d1128"/><path d="M-4.6 -3.6H4.6" stroke="#1d1128" stroke-width="1.1" stroke-linecap="round"/><path d="M-3.4 -4.8V-2.4M-1.1 -4.8V-2.4M1.1 -4.8V-2.4M3.4 -4.8V-2.4" stroke="#1d1128" stroke-width=".9" stroke-linecap="round"/><path d="M6.4 ${t + 7}L9.2 ${t + 9}M9.2 ${t + 7}L6.4 ${t + 9}" stroke="#1d1128" stroke-width="1" stroke-linecap="round"/><rect x="-14.6" y="-11.4" width="4" height="3" rx=".9" fill="#aab2b7"/><rect x="-12" y="-12.6" width="1.3" height="5.4" rx=".6" fill="#8c959a"/><rect x="10.6" y="-11.4" width="4" height="3" rx=".9" fill="#aab2b7"/><rect x="10.7" y="-12.6" width="1.3" height="5.4" rx=".6" fill="#8c959a"/>`,
    tall: t => `<path d="M-9 ${t + 7}L-8.6 ${t - 6.2}L-1.4 ${t + 1.2}Z" fill="#1d1128"/><path d="M9 ${t + 7}L8.6 ${t - 6.2}L1.4 ${t + 1.2}Z" fill="#1d1128"/><path d="M-7.6 ${t + 3.4}L-7.5 ${t - 2.6}L-3.6 ${t + 1.4}Z" fill="#ff9ec4"/><path d="M7.6 ${t + 3.4}L7.5 ${t - 2.6}L3.6 ${t + 1.4}Z" fill="#ff9ec4"/><path d="M-1.8 -6.8H1.8L0 -4.8Z" fill="#ff9ec4"/><path d="M0 -4.8V-3.4M-2.6 -3Q-1 -2.2 0 -3.4Q1 -2.2 2.6 -3" fill="none" stroke="#1d1128" stroke-width=".8" stroke-linecap="round"/><path d="M-9 -8.4L-15.5 -10.4M-9 -6L-15.5 -6M-9 -3.6L-15 -2M9 -8.4L15.5 -10.4M9 -6L15.5 -6M9 -3.6L15 -2" stroke="#1d1128" stroke-width=".9" stroke-linecap="round"/>`,
    dome: () => `<clipPath id="gb-wrap"><path d="${SHAPES.dome.d}"/></clipPath><g clip-path="url(#gb-wrap)" fill="none" stroke="#f3ead8" stroke-width="2.3" stroke-linecap="round" opacity=".94"><path d="M-14 -14L14 -11M-14 -1.5L14 -3.4M-14 2L14 0M-14 -17.5L8 -16"/><path d="M-14 -9.6L-8 -10.6M8 -10.6L14 -9.6" stroke="#e6d9bf" stroke-width="1.6"/></g><path d="M7 -1L12.5 3.2Q14 4.4 12.2 5.2L9 4.4" fill="none" stroke="#f3ead8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  };
  const dress = (shape, top, carried) => {
    if (!spooky() || !COSTUMES[shape]) return carried;
    return shape === 'bean' || shape === 'tall' ? carried + COSTUMES[shape](top) : COSTUMES[shape](top) + carried;
  };
  const spooky = () => document.documentElement.dataset.theme === 'halloween';

  function eyes({ mood = 'calm', kind = 'dots', gaze = 0, gazeY = 0, lid = 0, wide = 1, smear = 0, color = COLORS.red, y }) {
    const fill = light(color) ? INK : '#fff';
    const r2 = n => +n.toFixed(2);
    const x = gaze * 2.4;
    const cy = y + gazeY * 1.6;
    const gap = 4.2 * (1 - Math.min(.35, Math.abs(gaze) * .12));
    const arc = (cx, w = 1) => `M${r2(cx - 2.3 * w)} ${r2(cy + 1.2)}q${r2(2.3 * w)} -3.6 ${r2(4.6 * w)} 0`;
    const stroke = d => `<path d="${d}" fill="none" stroke="${fill}" stroke-width="1.9" stroke-linecap="round"/>`;
    const open = mood === 'blink' ? 1 : lid;
    const capsule = (cx, near) => {
      const depth = 1 + near * Math.min(1, Math.abs(gaze)) * .1;
      const sm = Math.min(.7, Math.abs(smear));
      const w = 4.7 * depth * (1 + (wide - 1) * .6) * (1 + sm), h0 = 7 * depth * wide * (1 - sm * .3);
      const h = Math.max(.9, h0 * (1 - open));
      const yc = cy + (h0 - h) * .38;
      return `<rect x="${r2(cx - w / 2)}" y="${r2(yc - h / 2)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(Math.min(w, h) / 2)}" fill="${fill}"/>`;
    };
    if (mood === 'happy' || kind === 'happy') return stroke(arc(x - gap) + arc(x + gap));
    if (mood === 'sleepy' || kind === 'sleepy') return `<path d="M${r2(x - gap - 2.4)} ${r2(cy)}h4.8M${r2(x + gap - 2.4)} ${r2(cy)}h4.8" stroke="${fill}" stroke-width="2" stroke-linecap="round"/>`;
    if (kind === 'wink') return capsule(x - gap, gaze < 0 ? 1 : -1) + stroke(arc(x + gap));
    if (kind === 'visor') { const h = Math.max(1, 5.2 * (1 - open * .8)); return `<rect x="${r2(x - 8)}" y="${r2(cy - h / 2)}" width="16" height="${r2(h)}" rx="${r2(h / 2)}" fill="${fill}"/>`; }
    return capsule(x - gap, gaze < 0 ? 1 : -1) + capsule(x + gap, gaze > 0 ? 1 : -1);
  }

  const NS = 'http://www.w3.org/2000/svg';
  const RAYS = 72;
  const PROFILES = {};
  function profile(shape) {
    if (shape in PROFILES) return PROFILES[shape];
    const s = SHAPES[shape];
    PROFILES[shape] = null;
    if (!s || typeof document === 'undefined' || !document.createElementNS || !document.body) return null;
    try {
      const svg = document.createElementNS(NS, 'svg');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', s.d); svg.append(path);
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
      document.body.append(svg);
      const len = path.getTotalLength(), cy = s.top / 2, pts = [];
      for (let i = 0; i < 480; i++) {
        const q = path.getPointAtLength(len * i / 480);
        pts.push([Math.atan2(q.y - cy, q.x), Math.hypot(q.x, q.y - cy)]);
      }
      svg.remove();
      if (!len) return null;
      pts.sort((a, b) => a[0] - b[0]);
      const r = [];
      for (let i = 0; i < RAYS; i++) {
        const a = -Math.PI + i * 2 * Math.PI / RAYS;
        let k = pts.findIndex(q => q[0] >= a);
        if (k < 0) k = 0;
        const hi = pts[k], lo = pts[(k - 1 + pts.length) % pts.length];
        let span = hi[0] - lo[0]; if (span <= 0) span += 2 * Math.PI;
        let off = a - lo[0]; if (off < 0) off += 2 * Math.PI;
        r.push(lo[1] + (hi[1] - lo[1]) * Math.min(1, off / span));
      }
      PROFILES[shape] = r;
    } catch { PROFILES[shape] = null; }
    return PROFILES[shape];
  }

  function bodyPath(radii, cy, jelly = 0, phase = 0) {
    const pts = radii.map((r, i) => {
      const a = -Math.PI + i * 2 * Math.PI / RAYS;
      const k = 1 + jelly * Math.cos(2 * a) + jelly * .35 * Math.sin(3 * a + phase);
      return [r * k * Math.cos(a), cy + r * k * Math.sin(a)];
    });
    const n = pts.length, r2 = v => +v.toFixed(2);
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += `C${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`;
    }
    return d + 'Z';
  }

  function geometry(shape, morph, jelly = 0, phase = 0) {
    const s = SHAPES[shape] || SHAPES.bean;
    const from = morph && SHAPES[morph.from];
    const p = from ? morph.p : 1;
    const top = from ? from.top + (s.top - from.top) * p : s.top;
    const eyesY = from ? from.eyes + (s.eyes - from.eyes) * p : s.eyes;
    const a = profile(shape), b = from && profile(morph.from);
    if (!a || (from && p < 1 && !b)) return { d: s.d, top, eyesY };
    if (!jelly && !(from && p < 1)) return { d: s.d, top, eyesY };
    const radii = from && p < 1 ? a.map((r, i) => b[i] + (r - b[i]) * p) : a;
    return { d: bodyPath(radii, top / 2, jelly, phase), top, eyesY };
  }

  function basket(top, items = [], palette = {}) {
    const goods = items.map((type, i) => {
      const cx = (i - (items.length - 1) / 2) * 4.8;
      return `<rect x="${cx - 2.4}" y="${top - 9.6}" width="4.8" height="5.4" rx="1.1" fill="${palette[type] || '#b3a994'}"/>`;
    }).join('');
    return `<g class="gb-basket">${goods}<path d="M-5.6 ${top - 5}C-5.6 ${top - 12.5} 5.6 ${top - 12.5} 5.6 ${top - 5}" fill="none" stroke="#cfc7c1" stroke-width="2.6"/><path d="M-5.6 ${top - 5}C-5.6 ${top - 12.5} 5.6 ${top - 12.5} 5.6 ${top - 5}" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M-8.2 ${top - 5.6}H8.2L6.6 ${top + 0.9}H-6.6Z" fill="#fff" stroke="#cfc7c1" stroke-width=".7" stroke-linejoin="round"/><path d="M-2.7 ${top - 4.4}V${top - 0.2}M2.7 ${top - 4.4}V${top - 0.2}" stroke="#ddd6d0" stroke-width=".9"/></g>`;
  }

  const PATCH = '<g transform="translate(9 -1) rotate(-10)"><path d="M-5 -5.5H5V1L0 4.5 -5 1Z" fill="#edc568" stroke="#78500d" stroke-width=".65"/><text y=".6" text-anchor="middle" fill="#513509" font-family="Mulish, Arial, sans-serif" font-size="5.5" font-weight="900">26</text></g>';
  function markup({ shape = 'bean', color = COLORS.red, mood = 'calm', kind = 'dots', gaze = 0, gazeY = 0, lid = 0, wide = 1, smear = 0, clip = '', back = false, patch = false, items = [], palette = {}, d, top, eyesY } = {}) {
    const s = SHAPES[shape] || SHAPES.bean;
    color = COLORS[color] || color;
    d = d || s.d; top = top ?? s.top;
    let face = back ? '' : eyes({ mood, kind, gaze, gazeY, lid, wide, smear, color, y: eyesY ?? s.eyes });
    if (face && clip) face = `<clipPath id="${clip}"><path d="${d}"/></clipPath><g clip-path="url(#${clip})">${face}</g>`;
    return `<path d="${d}" fill="${color}"/><ellipse cx="-6" cy="${f(top + 5)}" rx="1.8" ry="2.9" transform="rotate(34 -6 ${f(top + 5)})" fill="#fff" opacity=".28"/>${face}${dress(shape, top, basket(top, items, palette))}${patch ? PATCH : ''}`;
  }

  function avatar(opts = {}, size = 32) {
    const pad = spooky() ? 6 : 0;
    return `<svg class="gb-avatar" viewBox="${-14 - pad} -38 ${28 + pad * 2} 40" width="${Math.round(size * (28 + pad * 2) / 28)}" height="${Math.round(size * 40 / 28)}" aria-hidden="true">${markup(opts)}</svg>`;
  }

  const hash = n => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = p => 1 - Math.pow(1 - clamp(p), 4);
  const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
  const bell = p => (p <= 0 || p >= 1) ? 0 : Math.sin(p * Math.PI);
  const f = n => +n.toFixed(2);

  function blink(t, seed = 0) {
    const L = 4.3, k = Math.floor(t / L);
    let lid = 0;
    for (const j of [k - 1, k]) {
      if (j < 0) continue;
      const at = j * L + .5 + hash(seed * 7.1 + j) * 3.3;
      const times = hash(seed * 3.3 + j * 1.7) < .25 ? [at, at + .3] : [at];
      for (const b of times) lid = Math.max(lid, bell((t - b) / .16));
    }
    return lid;
  }

  function glance(t, seed = 0, reach = 1) {
    const L = 1.7, k = Math.floor(t / L);
    const at = j => {
      if (j < 0 || hash(seed * 4.1 + j * .7) < .3) return [0, 0];
      return [(hash(seed * 5.3 + j * 2.1) * 2 - 1) * reach, (hash(seed * 9.7 + j * 3.9) * 2 - 1) * .55 * reach];
    };
    const a = at(k - 1), b = at(k), p = ease((t - k * L) / .26);
    return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
  }

  const quint = p => 1 - Math.pow(1 - clamp(p), 5);
  const hop = (p, height = 7) => {
    if (p < .18) return { lift: 0, stretch: 1 - .14 * bell(p / .36) };
    if (p < .78) { const q = (p - .18) / .6; return { lift: Math.sin(q * Math.PI) * height, stretch: 1 + .08 * bell(q) }; }
    const q = (p - .78) / .22;
    return { lift: 0, stretch: 1 - .1 * bell(q), jelly: Math.sin(q * Math.PI * 3) * .06 * (1 - q) };
  };

  const STATES = {
    idle: (t, seed) => { const [gaze, gazeY] = glance(t, seed); return { gaze, gazeY, lid: blink(t, seed) }; },
    cheer: (t, seed) => {
      const L = 1.1, p = (t % L) / L, h = hop(p);
      return { ...h, mood: h.lift > .5 ? 'happy' : 'calm', lid: blink(t, seed), gazeY: -.3, sparkle: h.lift / 7, burst: (t % L) - .18 * L };
    },
    hello: (t, seed) => {
      const L = 3.2, q = (t % L) / .9;
      const lean = q < 1 ? Math.sin(q * Math.PI * 4) * 9 * (1 - q) : 0;
      const [gaze, gazeY] = glance(t, seed, .6);
      return { lean, jelly: q < 1 ? Math.sin(q * Math.PI * 6) * .035 * (1 - q) : 0, gaze: q < 1 ? 0 : gaze, gazeY: q < 1 ? -.2 : gazeY, mood: q < 1 ? 'happy' : 'calm', lid: q < 1 ? 0 : blink(t, seed) };
    },
    think: (t, seed) => ({
      gaze: .7 + Math.sin(t * 1.3) * .15, gazeY: -.85 + Math.sin(t * 2.1) * .1, lid: blink(t, seed) * .9 + .14, orbit: t
    }),
    load: t => {
      const a = t * 3.1;
      return { gaze: Math.cos(a) * .95, gazeY: Math.sin(a) * .7, comet: a, jelly: Math.sin(t * 6.2) * .012 };
    },
    scan: (t, seed) => {
      const L = 1.15, k = Math.floor(t / L), p = (t - k * L) / L;
      return { gaze: -1 + 2 * smooth(p / .85), gazeY: -.6 + (k % 3) * .55, lid: blink(t, seed) };
    },
    listen: (t, seed) => ({ gaze: Math.sin(t * .7) * .25, gazeY: -.15, wide: 1.08, lid: blink(t, seed), pulse: t, stretch: 1 + Math.sin(t * 2.4) * .02, jelly: Math.sin(t * 4.8) * .01 }),
    notify: (t, seed) => {
      const p = (t % 3) / 3, pop = p < .3 ? bell(p / .3) : 0;
      const [gaze, gazeY] = glance(t, seed, .5);
      return { gaze: p < .35 ? .6 : gaze, gazeY: p < .35 ? -.7 : gazeY, lid: blink(t, seed), badge: Math.min(1, t / .25), badgePop: pop, lift: pop * 2.5, jelly: p < .3 ? Math.sin(p / .3 * Math.PI * 3) * .04 * (1 - p / .3) : 0 };
    },
    sleep: t => ({ mood: 'sleepy', stretch: 1 + Math.sin(t * 1.7) * .035, jelly: Math.sin(t * 1.7) * .012, zzz: t }),
    surprise: (t, seed) => {
      const p = (t % 3.4) / 3.4, jolt = p < .12 ? bell(p / .12) : 0;
      return { lift: jolt * 4, jelly: p < .3 ? Math.sin(p / .3 * Math.PI * 4) * .05 * (1 - p / .3) : 0, wide: 1 + .35 * smooth(p / .06) * (1 - smooth((p - .6) / .3)), lid: p > .7 ? blink(t, seed) : 0, gazeY: -.4, shock: p };
    }
  };

  function fx(pose, g, color, weight = 1) {
    let back = '', front = '';
    const cy = g.top / 2, ink = INK;
    const o = v => f(clamp(v) * weight);
    if (pose.orbit !== undefined) {
      const tilt = -16 + Math.sin(pose.orbit * .6) * 6, rx = 17.5, ry = 4.6;
      const ring = sweep => `<path d="M${-rx} 0A${rx} ${ry} 0 0 ${sweep} ${rx} 0" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"/>`;
      const wrap = (inner, a) => `<g transform="translate(0 ${f(cy)}) rotate(${f(tilt)})" opacity="${o(a)}">${inner}</g>`;
      back += wrap(ring(1), .35);
      front += wrap(ring(0), .8);
      const a = pose.orbit * 2.6, bx = rx * Math.cos(a), by = ry * Math.sin(a);
      const bead = `<circle cx="${f(bx)}" cy="${f(by)}" r="${f(1.7 + Math.sin(a) * .5)}" fill="${color}" stroke="#fff" stroke-width=".6"/>`;
      if (Math.sin(a) < 0) back += wrap(bead, 1); else front += wrap(bead, 1);
    }
    if (pose.comet !== undefined) {
      const R = 19, cx0 = 0;
      let trail = '';
      for (let i = 9; i >= 0; i--) {
        const a = pose.comet - i * .1, k = 1 - i / 10;
        trail += `<circle cx="${f(cx0 + Math.cos(a) * R)}" cy="${f(cy + Math.sin(a) * R * .78)}" r="${f(.5 + 1.8 * k)}" fill="${color}" opacity="${o(k * k)}"/>`;
      }
      front += trail;
    }
    if (pose.burst !== undefined && pose.burst > 0 && pose.burst < .7) {
      const p = quint(pose.burst / .7);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (1.05 + i / 8 * .9) + Math.sin(i * 7.3) * .08, d = 10 + p * 9 + (i % 3) * 1.5;
        front += `<circle cx="${f(Math.cos(a) * d)}" cy="${f(Math.sin(a) * d * .9 + cy + 6)}" r="${f((1.3 - p) * (i % 2 ? 1 : .7))}" fill="${i % 3 ? color : '#f1c232'}" opacity="${o(1 - p)}"/>`;
      }
    }
    if (pose.sparkle > .05) {
      const s2 = clamp(pose.sparkle);
      [[-13, g.top - 4, 1], [13, g.top - 7, .8], [9, g.top - 15, .6]].forEach(([x, y, k]) => {
        const r = 2.2 * k * s2;
        front += `<path d="M${f(x)} ${f(y - r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y + r)}Q${f(x)} ${f(y)} ${f(x - r)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y - r)}Z" fill="#f1c232" opacity="${o(s2)}"/>`;
      });
    }
    if (pose.pulse !== undefined) {
      for (let i = 0; i < 3; i++) {
        const p = ((pose.pulse / 1.8 + i / 3) % 1), e = quint(p);
        back += `<ellipse cx="0" cy="${f(cy)}" rx="${f(13 + e * 11)}" ry="${f(12 + e * 10)}" fill="none" stroke="${color}" stroke-width="${f(1.4 * (1 - p))}" opacity="${o((1 - p) * .55)}"/>`;
      }
    }
    if (pose.badge > 0) {
      const sc = quint(pose.badge) * (1 + (pose.badgePop || 0) * .25);
      front += `<g transform="translate(9.5 ${f(g.top + 3)}) scale(${f(sc)})" opacity="${o(1)}"><circle r="4.1" fill="#fff"/><circle r="3.3" fill="${INK}"/><text y="1.5" text-anchor="middle" font-family="Mulish, Arial, sans-serif" font-weight="900" font-size="4.4" fill="#fff">1</text></g>`;
    }
    if (pose.shock !== undefined && pose.shock < .35) {
      const p = quint(pose.shock / .35);
      [-1, 0, 1].forEach(i => {
        const a = -Math.PI / 2 + i * .55, r0 = 13 + p * 4, r1 = r0 + 3.4 * (1 - p);
        front += `<path d="M${f(Math.cos(a) * r0)} ${f(g.top / 2 + Math.sin(a) * r0 - 2)}L${f(Math.cos(a) * r1)} ${f(g.top / 2 + Math.sin(a) * r1 - 2)}" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" opacity="${o(1 - p)}"/>`;
      });
    }
    if (pose.zzz !== undefined) {
      [0, 1].forEach(i => {
        const p = ((pose.zzz / 2.6 + i * .5) % 1), x = 9 + p * 6, y = g.top - 2 - p * 13, z = 2 + p * 2.4;
        front += `<path d="M${f(x)} ${f(y)}h${f(z)}l${f(-z)} ${f(z)}h${f(z)}" fill="none" stroke="${INK}" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round" opacity="${o(bell(p) * .6)}"/>`;
      });
    }
    return { back, front };
  }

  const NUMERIC = ['gaze', 'gazeY', 'lid', 'lift', 'stretch', 'lean', 'wide', 'jelly'];
  const BASE = { gaze: 0, gazeY: 0, lid: 0, lift: 0, stretch: 1, lean: 0, wide: 1, jelly: 0 };

  function poseAt(opts, t) {
    const { state = 'idle', seed = 0, look } = opts;
    const pose = { ...BASE, ...(STATES[state] || STATES.idle)(t, seed) };
    if (look && state === 'idle') { pose.gaze = look[0]; pose.gazeY = look[1]; }
    return pose;
  }

  function blended(opts, t) {
    const pose = poseAt(opts, t);
    if (!opts.prev || opts.prev.state === opts.state) return { pose, old: null, mix: 1 };
    const mix = quint((t - opts.prev.at) / .45);
    if (mix >= 1) return { pose, old: null, mix: 1 };
    const old = poseAt({ ...opts, state: opts.prev.state }, t);
    const blend = {};
    NUMERIC.forEach(k => { blend[k] = old[k] + (pose[k] - old[k]) * mix; });
    return { pose: { ...pose, ...blend, mood: mix > .5 ? pose.mood : old.mood }, old, mix };
  }

  function frame(opts = {}, t = 0) {
    const { shadow = true } = opts;
    const { pose, old, mix } = blended(opts, t);
    const before = blended(opts, t - .04).pose;
    pose.smear = clamp((pose.gaze - before.gaze) / .04 * .05, -.45, .45);
    const morph = opts.morph && opts.morph.from !== opts.shape ? { from: opts.morph.from, p: quint((t - opts.morph.at) / .6) } : null;
    const jelly = pose.jelly + (morph && morph.p < 1 ? Math.sin(morph.p * Math.PI * 2) * .05 * (1 - morph.p) : 0);
    const g = geometry(opts.shape, morph && morph.p < 1 ? morph : null, jelly, t * 2);
    const color = COLORS[opts.color] || opts.color || COLORS.red;
    const now = fx(pose, g, color, mix);
    const was = old ? fx(old, g, color, 1 - mix) : { back: '', front: '' };
    const lift = pose.lift, st = pose.stretch;
    const body = markup({ ...opts, ...pose, color, mood: pose.mood || opts.mood, d: g.d, top: g.top, eyesY: g.eyesY });
    const ground = shadow ? `<ellipse cx="0" cy="1" rx="${f(12 - lift * .4)}" ry="${f(2.4 - lift * .08)}" fill="${INK}" opacity="${f(.1 - lift * .004)}"/>` : '';
    return `${ground}<g transform="translate(0 ${f(-lift)})">${was.back}${now.back}<g transform="rotate(${f(pose.lean)}) scale(${f(1 / Math.sqrt(st))} ${f(st)})">${body}</g>${was.front}${now.front}</g>`;
  }

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animate(node, draw, still = 0) {
    let elapsed = still, last = 0, raf = 0, seen = true, html = '';
    const paint = t => { const next = draw(t); if (next !== html) { node.innerHTML = next; html = next; } };
    paint(still);
    if (reducedMotion()) return () => {};
    const tick = now => {
      raf = 0;
      if (!node.isConnected) return;
      elapsed += last ? Math.min((now - last) / 1000, .05) : 0;
      last = now;
      paint(elapsed);
      schedule();
    };
    const schedule = () => { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(tick); else if (!seen || document.hidden) last = 0; };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; last = 0; schedule(); }).observe(node.closest('svg') || node);
    }
    document.addEventListener('visibilitychange', () => { last = 0; schedule(); });
    schedule();
    return () => { if (raf) cancelAnimationFrame(raf); raf = 0; seen = false; };
  }

  let uid = 0;
  function live(node, opts = {}) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-24 -44 48 50');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'gb-live');
    const g = document.createElementNS(NS, 'g');
    svg.append(g);
    node.replaceChildren(svg);
    const look = [0, 0], target = [0, 0];
    let pointerAt = -1e9, clock = 0;
    const config = { clip: `gb-live-${++uid}`, seed: uid * 1.37, ...opts };
    if (config.follow) {
      addEventListener('pointermove', e => {
        const r = svg.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height * .45);
        const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 320);
        target[0] = dx / d * k; target[1] = dy / d * k * .8;
        pointerAt = clock;
      }, { passive: true });
    }
    const stop = animate(g, t => {
      const dt = t - clock; clock = t;
      const following = config.follow && t - pointerAt < 2.4;
      const goal = following ? target : glance(t, config.seed);
      const k = 1 - Math.exp(-Math.max(0, dt) * (following ? 14 : 18));
      look[0] += (goal[0] - look[0]) * k; look[1] += (goal[1] - look[1]) * k;
      return frame({ ...config, look: config.follow ? look : undefined }, t);
    });
    return {
      set(next) {
        if (next.state && next.state !== config.state) config.prev = { state: config.state || 'idle', at: clock };
        if (next.shape && next.shape !== config.shape) config.morph = { from: config.shape || 'bean', at: clock };
        Object.assign(config, next);
      },
      stop
    };
  }

  const bot = (x, y, opts, scale = 1, rotate = 0) =>
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rotate)}) scale(${scale})">${markup({ palette: GOODS, ...opts })}</g>`;
  const liveBot = (x, y, opts, t, scale = 1) =>
    `<g transform="translate(${f(x)} ${f(y)}) scale(${scale})">${frame({ palette: GOODS, ...opts }, t)}</g>`;
  const crate = (x, y, type, scale = 1, opacity = 1) =>
    `<rect x="${f(x - 2.4 * scale)}" y="${f(y - 2.7 * scale)}" width="${f(4.8 * scale)}" height="${f(5.4 * scale)}" rx="${f(1.1 * scale)}" fill="${GOODS[type] || '#b3a994'}" opacity="${f(opacity)}"/>`;
  const pop = (x, y, text, p, size = 8, color = '#c8102e') => p <= 0 || p >= 1 ? '' :
    `<text x="${f(x)}" y="${f(y - ease(p) * 9)}" text-anchor="middle" font-family="Mulish, Arial, sans-serif" font-weight="900" font-size="${f(size * (.7 + .3 * ease(p / .3)))}" fill="${color}" opacity="${f(1 - smooth((p - .6) / .4))}">${text}</text>`;
  const arc = (a, b, p, h) => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p - Math.sin(p * Math.PI) * h];

  function truck(x, filled, opts = {}) {
    const { blinkT = 0, happy = false, bounce = 0, wheel = 0 } = opts;
    let out = `<g transform="translate(${f(x)} ${f(-bounce)})">`;
    out += `<ellipse cx="-2" cy="1" rx="25" ry="2.6" fill="${INK}" opacity=".1"/>`;
    out += `<rect x="-22" y="-29" width="30" height="25" rx="2" fill="#f1ece8" stroke="#e1dcd8" stroke-width=".6"/>`;
    out += `<rect x="-19.5" y="-26.5" width="25" height="16" rx="1.2" fill="#3d3532"/>`;
    for (let i = 0; i < 3; i++) {
      const type = filled[i];
      if (type) out += `<rect x="${-18.8 + i * 8.2}" y="-18.4" width="7.4" height="7.4" rx="1.2" fill="${GOODS[type]}"/>`;
      else out += `<rect x="${-18.8 + i * 8.2}" y="-18.4" width="7.4" height="7.4" rx="1.2" fill="none" stroke="#6b635e" stroke-width=".6" stroke-dasharray="1.4 1.2"/>`;
    }
    out += `<rect x="-22" y="-8.5" width="30" height="2.6" fill="#c8102e"/>`;
    out += `<path d="M9 -22H16Q21 -22 22.5 -15L23.5 -9V-4H9Z" fill="#c8102e"/>`;
    out += `<path d="M15.6 -20H17Q19.6 -20 20.6 -15H15.6Z" fill="#fff" opacity=".3"/>`;
    const eyeY = -13.6;
    out += happy
      ? `<path d="M12.4 ${eyeY + 1}q1.4 -2.6 2.8 0M17 ${eyeY + 1}q1.4 -2.6 2.8 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`
      : [13.8, 18.4].map(cx => `<ellipse cx="${cx}" cy="${eyeY}" rx="1.4" ry="${f(Math.max(.35, 2.1 * (1 - blink(blinkT, 9))))}" fill="#fff"/>`).join('');
    out += `<rect x="-22.5" y="-5" width="46.5" height="2.4" rx="1.2" fill="#2b2522"/>`;
    for (const cx of [-15, -2, 16]) {
      out += `<circle cx="${cx}" cy="-1.2" r="3.4" fill="#2b2522"/><circle cx="${cx}" cy="-1.2" r="1.3" fill="#cfc7c1"/>`;
      out += `<path d="M${cx} -1.2l${f(Math.cos(wheel) * 2.6)} ${f(Math.sin(wheel) * 2.6)}" stroke="#cfc7c1" stroke-width=".6"/>`;
    }
    return out + '</g>';
  }

  const SCENES = {
    see: {
      view: '-26 -48 80 52', loop: 6.4, still: 3.6,
      draw(t) {
        const lines = [13, 19, 9, 16], start = .5;
        const shown = clamp((t - start) / 3.2) * lines.length;
        const reading = Math.min(lines.length - 1, Math.floor(shown));
        const fade = 1 - smooth((t - 5.6) / .6);
        const line = (w, i) => {
          const p = clamp(shown - i);
          return p <= 0 ? '' : `<rect x="${i === 2 ? 9 : 5}" y="${f(7 + i * 4.4)}" width="${f(w * ease(p))}" height="1.7" rx=".85" fill="${i === reading && shown < lines.length ? '#c8102e' : '#c9c1bb'}" opacity="${f(fade)}"/>`;
        };
        const card = `<g transform="translate(17 -43)"><rect width="34" height="28" rx="4" fill="#fff" stroke="#e1dcd8"/><text x="2.6" y="5.6" font-family="ui-monospace, Menlo, monospace" font-size="4.4" font-weight="700" fill="#6b635e">{</text><text x="2.6" y="26.2" font-family="ui-monospace, Menlo, monospace" font-size="4.4" font-weight="700" fill="#6b635e" opacity="${f(clamp(shown - 3.6) * fade)}">}</text>${lines.map(line).join('')}</g>`;
        const waves = [0, 1].map(i => {
          const p = ((t * .9 + i * .5) % 1);
          return `<path d="M${f(10 + p * 5)} ${f(-28 - p * 4)}q2 2 0 5" fill="none" stroke="#c8102e" stroke-width="1.1" stroke-linecap="round" opacity="${f(bell(p) * .5 * (shown < lines.length ? 1 : 0))}"/>`;
        }).join('');
        const reads = shown < lines.length && t > start;
        const gx = reads ? .55 + (shown % 1) * .45 : glance(t, 2)[0];
        const gy = reads ? -1 + reading * .38 : glance(t, 2)[1];
        const done = clamp((t - 4) / .3) * (1 - clamp((t - 5.4) / .3));
        return ground(0, 13) + card + waves + liveBot(0, 0, { state: 'idle', seed: 2, look: [gx, gy], mood: done > .5 ? 'happy' : 'calm', clip: 'gb-see' }, t, 1.25);
      }
    },
    move: {
      view: '-34 -46 100 50', loop: 4.8, still: 1.9,
      draw(t) {
        const cell = 14, step = .6;
        const shelf = `<rect x="-34" y="-45" width="100" height="5" rx="1.5" fill="#e9dfcc"/>${['milk', 'butter', 'cheese', 'eggs', 'bread', 'apples', 'tomatoes'].map((type, i) => crate(-28 + i * 14, -42.6, type, .9)).join('')}`;
        let out = shelf;
        const span = 98, n = 3;
        const k = Math.floor(t / step), p = (t - k * step) / step;
        for (let i = 0; i < n; i++) {
          const raw = (i * 28 + (k + ease(p)) * cell) % (span + cell);
          const x = raw - 30;
          const fade = smooth((x + 30) / 10) * (1 - smooth((x - 52) / 10));
          const h = hop(p, 3.2);
          const items = [['milk'], ['bread', 'eggs'], []][i];
          out += `<g opacity="${f(fade)}">${ground(x, 11)}<g transform="translate(${f(x)} ${f(-h.lift)}) rotate(${f(bell(p) * 6)}) scale(${f(1 / Math.sqrt(h.stretch))} ${f(h.stretch)})">${markup({ palette: GOODS, items, gaze: 1, gazeY: -.1, lid: blink(t, i + 3) })}</g></g>`;
        }
        const g = (t % 2.4) / 2.4;
        const fly = g > .35 && g < .75 ? arc([-1, -40], [14, -14], (g - .35) / .4, 10) : null;
        if (fly) out += crate(fly[0], fly[1], 'cheese', 1);
        out += `<path d="M-33 -12h7M-31 -7h5" stroke="#d6cfc9" stroke-width="1.6" stroke-linecap="round"/>`;
        return out;
      }
    },
    deliver: {
      view: '-30 -58 104 62', loop: 6, still: 3.2,
      draw(t) {
        const goods = ['tomatoes', 'cheese', 'milk'];
        const out = [];
        const driveOff = smooth((t - 3.9) / .8), arrive = 1 - ease((t - 4.9) / .9);
        const tx = 40 + (t < 4.9 ? driveOff * 80 : arrive * -90);
        const loaded = t >= 4.9 ? 0 : goods.filter((_, i) => t > 1.35 + i * .45).length;
        const filled = goods.slice(0, loaded);
        const full = loaded === 3 && t < 4.9;
        const bump = full ? bell((t - 2.85) / .3) * 1.6 : 0;
        out.push(ground(-8, 13));
        const approach = ease(t / .9);
        const bx = -18 + approach * 10;
        const hp = t < .9 ? hop(clamp(t / .9 * 2 % 1), 4) : { lift: 0, stretch: 1 };
        const hasItems = goods.filter((_, i) => t < 1.35 + i * .45 || t > 5.4);
        const cheering = t > 2.8 && t < 4.4;
        out.push(`<g transform="translate(${f(bx)} ${f(-hp.lift)}) scale(${f(1.25 / Math.sqrt(hp.stretch))} ${f(1.25 * hp.stretch)})">${frame({ palette: GOODS, items: hasItems, state: cheering ? 'cheer' : 'idle', look: [1, -.2], seed: 4, shadow: false, clip: 'gb-deliver', prev: t > 2.8 ? { state: 'idle', at: 2.8 } : undefined }, cheering ? t - 2.8 : t)}</g>`);
        out.push(truck(tx, filled, { blinkT: t, happy: full, bounce: bump, wheel: (t < 4.9 ? driveOff * 14 : arrive * -16) }));
        goods.forEach((type, i) => {
          const p = (t - (.9 + i * .45)) / .45;
          if (p > 0 && p < 1) {
            const [x, y] = arc([bx + (i - 1) * 6, -31], [tx - 14.9 + i * 8.2, -14.7], ease(p), 12);
            out.push(crate(x, y, type, 1.2));
          }
          out.push(pop(tx - 15 + i * 8.2, -32, '+1', (t - (1.35 + i * .45)) / .8, 7));
        });
        out.push(pop(tx - 4, -40, '+5', (t - 2.85) / 1.1, 13));
        if (t > 3.9 && t < 4.9) out.push(`<path d="M${f(tx - 32)} -20h-8M${f(tx - 30)} -12h-11" stroke="#d6cfc9" stroke-width="1.6" stroke-linecap="round" opacity="${f(bell((t - 3.9) / 1))}"/>`);
        return out.join('');
      }
    },
    block: {
      view: '-40 -50 100 54', loop: 4.8, still: 2,
      draw(t) {
        const out = [`<rect x="-40" y="-49" width="100" height="5" rx="1.5" fill="#e9dfcc"/><rect x="-40" y="2.4" width="100" height="1.6" rx=".8" fill="#e1dcd8"/>`];
        const fade = (1 - smooth((t - 4.3) / .5)) * smooth(t / .3);
        const stepA = ease((t - .2) / .5) - ease((t - 2.6) / .45);
        const ax = -26 + stepA * 24;
        const tryP = (t - 1) / .45, bump = bell(tryP);
        const stepB = ease((t - 3.05) / .5);
        const bx = 28 - bump * 4 - stepB * 26;
        const badge = (x, n, c) => `<circle cx="${f(x + 9)}" cy="-21" r="3.4" fill="#fff" stroke="${c}" stroke-width=".8"/><text x="${f(x + 9)}" y="-19.5" text-anchor="middle" font-family="Mulish, Arial, sans-serif" font-weight="900" font-size="4.4" fill="${c}">${n}</text>`;
        const hA = t < 1.5 ? hop(clamp((t - .2) / .5), 3) : hop(clamp((t - 2.6) / .45), 3);
        const hB = hop(clamp((t - 3.05) / .5), 3);
        const shocked = t > 1 && t < 2.9;
        const waiting = t > 1.45 && t < 2.6;
        out.push(`<g opacity="${f(fade)}">`);
        out.push(ground(ax, 11), `<g transform="translate(${f(ax)} ${f(-hA.lift)}) scale(${f(1 / Math.sqrt(hA.stretch))} ${f(hA.stretch)})">${markup({ color: 'milk', gaze: waiting ? .9 : t > 2.6 ? -1 : 1, gazeY: waiting ? -.2 : 0, lid: blink(t, 11) })}</g>`, badge(ax, 1, '#3b77b8'));
        out.push(ground(bx, 11), `<g transform="translate(${f(bx)} ${f(-hB.lift)}) rotate(${f(bump * 8)}) scale(${f(1 / Math.sqrt(hB.stretch))} ${f(hB.stretch)})">${markup({ color: 'carrot', gaze: -1, mood: t > 3.1 && t < 3.9 ? 'happy' : 'calm', wide: shocked ? 1.3 : 1, lid: shocked ? 0 : blink(t, 12) })}</g>`, badge(bx, 2, '#e8772e'));
        const w = clamp((t - 1.3) / .25) * (1 - clamp((t - 2.7) / .3));
        if (w > 0) out.push(`<g transform="translate(${f(bx)} ${f(-36 - ease(w) * 3)})" opacity="${f(w)}"><rect x="-10" y="-5.5" width="20" height="10" rx="5" fill="#fff" stroke="#e1dcd8" stroke-width=".7"/><text y="1.6" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-weight="700" font-size="5" fill="#6b635e">wait</text></g>`);
        if (bump > .2) out.push(`<path d="M${f(bx - 13)} -18l-2 -2M${f(bx - 13)} -13h-3M${f(bx - 13)} -8l-2 2" stroke="#c8102e" stroke-width="1" stroke-linecap="round" opacity="${f(bump)}"/>`);
        out.push('</g>');
        return out.join('');
      }
    },
    clock: {
      view: '-30 -50 88 54', loop: 6, still: 1.1,
      draw(t) {
        const second = t >= 3, local = second ? t - 3 : t;
        const left = 1 - clamp(local / 2.6);
        const sent = !second && local > 1.3;
        const r = 7.5, c = 2 * Math.PI * r;
        const late = second && left < .02;
        const ring = `<g transform="translate(36 -36)"><circle r="${r}" fill="#fff" stroke="#e1dcd8" stroke-width="2.4"/><circle r="${r}" fill="none" stroke="${second ? '#c8102e' : '#3f8f4f'}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${f(c * (sent ? 1 - clamp(1.3 / 2.6) : left))} ${f(c)}" transform="rotate(-90)"/><text y="1.8" text-anchor="middle" font-family="Mulish, Arial, sans-serif" font-weight="900" font-size="5.2" fill="#2b2522">2s</text></g>`;
        const state = second ? (late ? 'surprise' : 'sleep') : sent ? 'cheer' : 'think';
        const st = state === 'cheer' ? local - 1.3 : state === 'surprise' ? local - 2.6 : local;
        let out = ground(0, 13) + ring + liveBot(0, 0, { state, seed: 6, color: 'leaf' }, st, 1.25);
        if (sent) {
          const q = ease((local - 1.3) / .7);
          out += `<g transform="translate(${f(10 + q * 22)} ${f(-24 + bell(q) * -6)})" opacity="${f(1 - smooth((local - 2.4) / .5))}"><rect x="-11" y="-5" width="22" height="9.6" rx="2.4" fill="#2b2522"/><text y="1.4" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-weight="700" font-size="4.6" fill="#fff">move</text></g>`;
        }
        if (second) out += pop(24, -16, 'wait', (local - 2.5) / .9, 7, '#6b635e');
        return out;
      }
    },
    oops: {
      view: '-26 -50 68 54', loop: 3.4, still: .5,
      draw(t) {
        const p = t / 3.4, tag = clamp((t - .15) / .2) * (1 - smooth((p - .85) / .15));
        return ground(0, 13) + liveBot(0, 0, { state: 'surprise', seed: 8, color: 'plum' }, t, 1.25) +
          `<g transform="translate(26 ${f(-34 - ease(tag) * 4)}) rotate(${f(8 * (1 - ease(tag)))})" opacity="${f(tag)}"><rect x="-13" y="-6" width="26" height="12" rx="6" fill="#c8102e"/><text y="2" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-weight="700" font-size="6" fill="#fff">4003</text></g>`;
      }
    },
    crew: {
      view: '-16 -46 152 50', loop: 6.4, still: .2,
      draw(t) {
        const crew = [['bean', 'red'], ['round', 'milk'], ['box', 'leaf'], ['tall', 'carrot'], ['dome', 'plum']];
        return crew.map(([shape, color], i) => {
          const local = ((t - i * .32) % 6.4 + 6.4) % 6.4;
          const state = local < 3.2 ? 'hello' : 'idle';
          return ground(i * 30, 11) + liveBot(i * 30, 0, { shape, color, state, seed: i + 20 }, state === 'hello' ? local : local + i, 1);
        }).join('');
      }
    }
  };
  const ground = (x, w) => `<ellipse cx="${f(x)}" cy="0" rx="${w}" ry="${f(w * .28)}" fill="rgba(23,20,18,.1)"/>`;

  function pose(kind, t) {
    const scene = SCENES[kind];
    return scene ? `<svg viewBox="${scene.view}" aria-hidden="true">${scene.draw(t ?? scene.still)}</svg>` : '';
  }

  function play(node, kind) {
    const scene = SCENES[kind];
    if (!scene) return;
    node.innerHTML = pose(kind);
    const svg = node.firstElementChild;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.replaceChildren(g);
    animate(g, t => scene.draw(t % scene.loop), scene.still);
  }

  function hydrate(root = document) {
    root.querySelectorAll('[data-live-bot]').forEach(node => {
      if (node.gbLive) return;
      const d = node.dataset;
      node.gbLive = live(node, { shape: d.shape, color: d.color, kind: d.eyes, state: d.state || 'idle', follow: 'follow' in d, patch: 'patch' in d, items: d.items ? d.items.split(',') : [] });
      if (d.cycle && !reducedMotion()) {
        const steps = d.cycle.split(',').map(step => { const [state, secs] = step.split(':'); return [state, Number(secs) * 1000 || 3000]; });
        let i = 0;
        const next = () => { node.gbLive.set({ state: steps[i][0] }); setTimeout(() => { i = (i + 1) % steps.length; next(); }, steps[i][1]); };
        next();
      }
    });
    root.querySelectorAll('[data-scene]').forEach(node => { if (!node.gbScene) { node.gbScene = true; play(node, node.dataset.scene); } });
  }

  window.GroceryBot = { SHAPES, COLORS, GOODS, STATES, markup, avatar, pose, light, blink, glance, frame, animate, live, play, hydrate };
  hydrate();
})();
