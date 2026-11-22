// Cartoon buildings for the 3D view, the three.js side: the facade textures, and geometry for the
// buildings made on the page (delivery homes and the twelve shop buildings). The shapes come from
// src/building-geometry.js, which also runs in the build workers for the ~54k background buildings.
//  - windows, frames, cladding and floor bands come from one small repeating texture per style
//    (no geometry per window); the wall colour comes from vertex colours, and wall materials
//    multiply by 1 / BASE so plain wall shows the true colour
import * as THREE from 'three';
import { BASE, Bucket, createBuilder, ringPoints } from './building-geometry.js?v=30';

export { BASE };

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

export function createBuildings({ heightAt, wx, wy, M, LIFT }) {
  const textures = Object.fromEntries(['house', 'apt', 'com', 'ind', 'shed'].map(s => [s, facade(s)]));
  textures.church = textures.house;
  const builder = createBuilder({ heightAt, M, LIFT });

  /** ring: flat 1e5-degree ints. Returns { pts: [[x, z], ...], top, style }. */
  const build = (ring, metres, info, id, out, hidden = null) => builder.build(ringPoints(ring, wx, wy), metres, info, id, out, hidden);
  const bucket = () => new Bucket(true);

  // buckets -> one indexed geometry; with several buckets, one draw group per bucket (per-part materials)
  function geometry(...parts) {
    parts = parts.filter(Boolean);
    const vertices = parts.reduce((n, b) => n + b.vertices, 0), indices = parts.reduce((n, b) => n + b.indices, 0);
    const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), color = new Float32Array(vertices * 3);
    const uv = new Float32Array(vertices * 2).fill(.02), index = new Uint32Array(indices);
    const geo = new THREE.BufferGeometry();
    let v = 0, i = 0;
    parts.forEach((b, group) => {
      position.set(b.position.subarray(0, b.vertices * 3), v * 3);
      normal.set(b.normal.subarray(0, b.vertices * 3), v * 3);
      color.set(b.color.subarray(0, b.vertices * 3), v * 3);
      if (b.uv) uv.set(b.uv.subarray(0, b.vertices * 2), v * 2);
      for (let k = 0; k < b.indices; k++) index[i + k] = b.index[k] + v;
      if (parts.length > 1) geo.addGroup(i, b.indices, group);
      v += b.vertices; i += b.indices;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(vertices > 65535 ? index : new Uint16Array(index), 1));
    return geo;
  }

  return { build, geometry, textures, bucket };
}
