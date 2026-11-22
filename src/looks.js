export const COLORS = { red: '#c8102e', ink: '#2b2522', leaf: '#3f8f4f', milk: '#3b77b8', carrot: '#e8772e', plum: '#7a4a93', lemon: '#f1c232', oat: '#e9dfcc',
  teal: '#008b8b', rose: '#cf668f', indigo: '#5354bd', cocoa: '#916342' };
const colours = Object.keys(COLORS);
export const OPTIONS = {
  color: colours,
  shape: ['bean', 'round', 'box', 'tall', 'dome'],
  eyes: ['dots', 'happy', 'wink', 'visor', 'sleepy'],
  carriage: ['box', 'cooler', 'canvas', 'flatbed'],
  head: ['flat', 'nose', 'slant', 'high'],
  visor: ['none', 'shade', 'lights', 'tint'],
  decal: ['stripe', 'band', 'dots', 'plain'],
};
export const DEFAULT_LOOK = { shape: 'bean', color: 'red', eyes: 'dots', carriage: 'box', head: 'flat', visor: 'none', decal: 'stripe' };
export const LEGENDS = { color: 'Colours', shape: 'Characters', eyes: 'Expressions', carriage: 'Truck carriages', head: 'Truck heads', visor: 'Truck visors', decal: 'Truck decals' };
export const TRUCK_PARTS = ['carriage', 'head', 'visor', 'decal'];
export const LABELS = {
  bean: 'Bean', round: 'Round', box: 'Box', tall: 'Tall', dome: 'Dome',
  red: 'Red', ink: 'Ink', leaf: 'Leaf', milk: 'Blue', carrot: 'Carrot', plum: 'Plum', lemon: 'Lemon', oat: 'Oat',
  dots: 'Dots', happy: 'Happy', wink: 'Wink', visor: 'Visor', sleepy: 'Sleepy',
  stripe: 'Stripe', band: 'Band', plain: 'Plain',
  cooler: 'Cooler', canvas: 'Canvas', flatbed: 'Flatbed', flat: 'Flat', nose: 'Nose', slant: 'Slant', high: 'High', none: 'None', shade: 'Shade', lights: 'Lights', tint: 'Tint',
};
export const BOT_NAME_MAX = 32;
export const DEFAULT_BOT_NAME = 'Grocery Bot';

export function cleanLook(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const look = {};
  for (const [part, choices] of Object.entries(OPTIONS)) look[part] = choices.includes(source[part]) ? source[part] : DEFAULT_LOOK[part];
  if (typeof source.name === 'string' && source.name.trim()) look.name = source.name.trim().replace(/\s+/g, ' ').slice(0, BOT_NAME_MAX);
  return look;
}

export function label(part, choice) {
  return LABELS[choice] || choice;
}

export function mix(hex, to, k) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const channel = shift => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k);
  return '#' + [16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('');
}

export const INK = '#2b2522', SHELL = '#f6f2ee', EDGE = '#e1dcd8', WOOD = '#c9a877', LAMP = '#f1c232';
export const light = hex => { const n = parseInt(hex.slice(1), 16); return (.299 * (n >> 16) + .587 * ((n >> 8) & 255) + .114 * (n & 255)) / 255 > .62; };
const rect = (x, y, w, h, rx, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${extra}/>`;
const shell = `<path d="M-72 20V-45Q-72 -52 -65 -52H7Q14 -52 14 -45V20Z" fill="${SHELL}" stroke="${EDGE}" stroke-width="1.2"/>`;
const marks = {
  stripe: (paint, y, h) => rect(-72, y + h * .68, 86, h * .14, 0, paint),
  band: (paint, y, h) => rect(-72, y + h * .3, 86, h * .32, 0, paint),
  dots: (paint, y, h) => [-52, -29, -6].map(cx => `<circle cx="${cx}" cy="${y + h * .46}" r="${Math.min(7.5, h * .3)}" fill="${paint}"/>`).join(''),
  plain: () => '',
};

const CARRIAGES = {
  box: (paint, decal) => shell + decal(paint, -52, 72),
  cooler: (paint, decal) => rect(-34, -61, 28, 11, 3.5, '#d6cfc8') + `<path d="M-28 -57.5h16" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>` + shell +
    `<path d="${[-58, -44, -30, -16, -2].map(x => `M${x} -46V14`).join('')}" stroke="${EDGE}" stroke-width="1.6" stroke-linecap="round"/>` + decal(paint, -52, 72),
  canvas: (paint, decal) => {
    const cloth = mix(paint, '#ffffff', .78);
    return `<path d="M-70 8V-34Q-70 -52 -29 -52T12 -34V8Z" fill="${cloth}"/>` + decal(paint, -34, 42).replaceAll('x="-72"', 'x="-70"').replaceAll('width="86"', 'width="82"') +
      `<path d="M-43 -50V8M-15 -50V8" stroke="${mix(paint, '#ffffff', .5)}" stroke-width="1.4"/>` + rect(-72, 6, 86, 14, 3, WOOD);
  },
  flatbed: (paint, decal) => rect(-64, -22, 22, 28, 4, COLORS.oat) + rect(-60, -40, 16, 18, 4, COLORS.lemon) + rect(-40, -16, 24, 22, 4, COLORS.leaf) + rect(-14, -8, 18, 14, 4, COLORS.carrot) +
    `<path d="M-64 -8h22M-40 -5h24M-14 -1h18" stroke="rgba(23,20,18,.18)" stroke-width="1.4"/>` + rect(-72, 4, 86, 16, 3, WOOD) + decal(paint, 4, 16),
};

export const HEADS = {
  flat: { d: 'M18 20V-26Q18 -38 30 -38H52Q68 -38 68 -22V20Z', face: [46, -13], top: -38, roof: 40, brim: 70 },
  high: { d: 'M18 20V-38Q18 -50 30 -50H50Q68 -50 68 -32V20Z', face: [46, -18], top: -50, roof: 39, brim: 70 },
  nose: { d: 'M18 20V-26Q18 -38 29 -38H39Q50 -38 51 -28L53 -11H61Q71 -11 71 -1V20Z', face: [36, -19], top: -38, roof: 34, brim: 56 },
  slant: { d: 'M18 20V-26Q18 -38 30 -38H37Q45 -38 50 -31L66 -8Q68 -5 68 0V20Z', face: [40, -15], top: -38, roof: 33, brim: 60 },
};

export function face(kind, colour) {
  const stroke = d => `<path d="${d}" fill="none" stroke="${colour}" stroke-width="1.9" stroke-linecap="round"/>`;
  const arc = cx => `M${cx - 2.3} 1.2q2.3 -3.6 4.6 0`;
  const eye = cx => rect(cx - 2.35, -3.5, 4.7, 7, 2.35, colour);
  return {
    dots: eye(-3.4) + eye(5),
    happy: stroke(arc(-3.4) + arc(5)),
    wink: eye(-3.4) + stroke(arc(5)),
    visor: rect(-7.2, -2.6, 16, 5.2, 2.6, colour),
    sleepy: stroke('M-5.8 0h4.8M2.6 0h4.8'),
  }[kind];
}

export function truckArt(raw) {
  const look = cleanLook(raw);
  const paint = COLORS[look.color], head = HEADS[look.head], [fx, fy] = head.face;
  const tint = look.visor === 'tint';
  const wheel = cx => `<circle cx="${cx}" cy="29" r="9" fill="${INK}"/><circle cx="${cx}" cy="29" r="3.6" fill="#cfc7c1"/>`;
  return `<ellipse cx="0" cy="38" rx="78" ry="4" fill="#171412" opacity=".1"/>` + rect(-74, 16, 144, 7, 3.5, INK) +
    CARRIAGES[look.carriage](paint, marks[look.decal]) +
    `<path d="${head.d}" fill="${paint}"/><ellipse cx="27" cy="${head.top + 11}" rx="2.8" ry="4.8" transform="rotate(34 27 ${head.top + 11})" fill="#fff" opacity=".28"/>` +
    (tint ? rect(fx - 13.5, fy - 9.5, 30, 19, 9.5, paint === INK ? '#4a423d' : INK) : '') +
    `<g transform="translate(${fx} ${fy}) scale(1.7)">${face(look.eyes, !tint && light(paint) ? '#171412' : '#fff')}</g>` +
    (look.visor === 'shade' ? `<path d="M${fx - 12} ${fy - 13}H${head.brim}Q${head.brim + 5} ${fy - 13} ${head.brim + 5} ${fy - 10.5}T${head.brim} ${fy - 8}H${fx - 12}Z" fill="${mix(paint, '#171412', .38)}"/>` : '') +
    (look.visor === 'lights' ? rect(head.roof - 13, head.top - 6, 26, 7, 3.5, INK) + [-7, 0, 7].map(dx => `<circle cx="${head.roof + dx}" cy="${head.top - 2.5}" r="2" fill="${LAMP}"/>`).join('') : '') +
    rect(58, 13, 16, 9, 4.5, INK) + rect(64, 2, 6, 8, 3, LAMP) +
    wheel(-54) + wheel(-32) + wheel(46);
}

export function truckSvg(look, className = 'look-truck') {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="-88 -72 170 122" aria-hidden="true" focusable="false">${truckArt(look)}</svg>`;
}

export function botSvg(raw, className = 'team-bot') {
  const look = cleanLook(raw);
  const art = globalThis.GroceryBot?.markup({ shape: look.shape, color: look.color, kind: look.eyes }) ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" viewBox="-18 -38 36 43" aria-hidden="true" focusable="false"><ellipse cy="2" rx="12" ry="2.5" fill="#171412" opacity=".09"/>${art}</svg>`;
}

export function dressLiveBot(el, raw, state) {
  if (!el) return;
  const look = cleanLook(raw);
  Object.assign(el.dataset, { shape: look.shape, color: look.color, eyes: look.eyes });
  if (el.gbLive) el.gbLive.set({ shape: look.shape, color: look.color, kind: look.eyes, ...(state ? { state } : {}) });
}
