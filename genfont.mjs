// genfont.mjs — rasterises Liberation Serif (Regular + Bold) into fonts.bin,
// a small bitmap-font container my main.ts blits from. Written in this
// session for the news-image-20261122 entry. Run once:
//   node genfont.mjs
// Reads the system TTFs, parses their TrueType tables by hand (cmap, glyf,
// loca, hmtx, head, maxp, hhea), flattens each glyph outline, fills it with
// a non-zero winding scanline rasteriser at 4x supersampling, and stores
// 8-bit alpha bitmaps per glyph at the pixel sizes the page uses.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = '/usr/share/fonts/truetype/liberation';
const SIZES = [9, 10, 11, 12, 15, 40]; // em heights in final pixels
// Printable ASCII plus the punctuation this page needs.
const EXTRA = [0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x00b7, 0x00d7, 0x00b0, 0x2026];
const CODEPOINTS = [];
for (let c = 32; c <= 126; c++) CODEPOINTS.push(c);
for (const c of EXTRA) CODEPOINTS.push(c);

// ------------------------------------------------------------------ readers
class Reader {
  constructor(buf) { this.b = buf; }
  u8(o) { return this.b[o]; }
  u16(o) { return (this.b[o] << 8) | this.b[o + 1]; }
  i16(o) { const v = this.u16(o); return v >= 0x8000 ? v - 0x10000 : v; }
  u32(o) { return (this.b[o] * 0x1000000) + ((this.b[o + 1] << 16) | (this.b[o + 2] << 8) | this.b[o + 3]); }
  i32(o) { const v = this.u32(o); return v >= 0x80000000 ? v - 0x100000000 : v; }
  f2dot14(o) { return this.i16(o) / 16384; }
}

// ------------------------------------------------------------- TTF parsing
function parseTTF(path) {
  const buf = readFileSync(path);
  const r = new Reader(buf);
  const numTables = r.u16(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString('ascii', o, o + 4);
    tables.set(tag, { offset: r.u32(o + 8), length: r.u32(o + 12) });
  }
  const need = (t) => { const tb = tables.get(t); if (!tb) throw new Error('no table ' + t + ' in ' + path); return tb; };
  const head = need('head');
  const unitsPerEm = r.u16(head.offset + 18);
  const locFmt = r.i16(head.offset + 50);
  const maxp = need('maxp');
  const numGlyphs = r.u16(maxp.offset + 4);
  const hhea = need('hhea');
  const numHMetrics = r.u16(hhea.offset + 34);
  const hmtx = need('hmtx');
  const advances = new Float64Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    const i = Math.min(g, numHMetrics - 1);
    advances[g] = r.u16(hmtx.offset + i * 4);
  }
  const loca = need('loca');
  const glyphOff = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g <= numGlyphs; g++) {
    glyphOff[g] = locFmt === 1 ? r.u32(loca.offset + g * 4) : r.u16(loca.offset + g * 2) * 2;
  }
  const glyf = need('glyf');
  // cmap: prefer format 12, else format 4.
  const cmap = need('cmap');
  const nSub = r.u16(cmap.offset + 2);
  let cmap4 = null, cmap12 = null;
  for (let i = 0; i < nSub; i++) {
    const so = cmap.offset + 4 + i * 8;
    const sub = cmap.offset + r.u32(so + 4);
    const fmt = r.u16(sub);
    if (fmt === 4 && !cmap4) cmap4 = sub;
    if (fmt === 12 && !cmap12) cmap12 = sub;
  }
  const cmapMap = new Map();
  if (cmap12) {
    const nGroups = r.u32(cmap12 + 12);
    for (let i = 0; i < nGroups; i++) {
      const go = cmap12 + 16 + i * 12;
      const start = r.u32(go), end = r.u32(go + 4), g0 = r.u32(go + 8);
      for (let c = start; c <= end; c++) cmapMap.set(c, g0 + (c - start));
    }
  } else if (cmap4) {
    const segCount = r.u16(cmap4 + 6) / 2;
    const endBase = cmap4 + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = r.u16(endBase + s * 2);
      const start = r.u16(startBase + s * 2);
      const delta = r.i16(deltaBase + s * 2);
      const rangeOff = r.u16(rangeBase + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g = 0;
        if (rangeOff === 0) g = (c + delta) & 0xffff;
        else {
          const gi = rangeBase + s * 2 + rangeOff + (c - start) * 2;
          g = r.u16(gi);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g) cmapMap.set(c, g);
      }
    }
  } else throw new Error('no usable cmap in ' + path);

  // Decode one glyph's outline into contours: arrays of {x, y, on} points
  // in font units, y up. Handles simple and composite glyphs.
  function glyphContours(gid, depth) {
    if (depth > 4) return [];
    const o0 = glyphOff[gid], o1 = glyphOff[gid + 1];
    if (o1 <= o0) return [];
    const o = glyf.offset + o0;
    const nContours = r.i16(o);
    if (nContours >= 0) {
      const endPts = [];
      for (let i = 0; i < nContours; i++) endPts.push(r.u16(o + 10 + i * 2));
      const nPts = nContours ? endPts[endPts.length - 1] + 1 : 0;
      let p = o + 10 + nContours * 2;
      const instrLen = r.u16(p); p += 2 + instrLen;
      const flags = [];
      while (flags.length < nPts) {
        const f = r.u8(p++);
        flags.push(f);
        if (f & 0x08) { const rep = r.u8(p++); for (let k = 0; k < rep; k++) flags.push(f); }
      }
      const xs = [], ys = [];
      let x = 0;
      for (let i = 0; i < nPts; i++) {
        const f = flags[i];
        if (f & 0x02) { const v = r.u8(p++); x += (f & 0x10) ? v : -v; }
        else if (!(f & 0x10)) { x += r.i16(p); p += 2; }
        xs.push(x);
      }
      let y = 0;
      for (let i = 0; i < nPts; i++) {
        const f = flags[i];
        if (f & 0x04) { const v = r.u8(p++); y += (f & 0x20) ? v : -v; }
        else if (!(f & 0x20)) { y += r.i16(p); p += 2; }
        ys.push(y);
      }
      const contours = [];
      let start = 0;
      for (const end of endPts) {
        const pts = [];
        for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 0x01) });
        contours.push(pts);
        start = end + 1;
      }
      return contours;
    }
    // Composite glyph.
    let p = o + 10;
    const out = [];
    for (;;) {
      const flags = r.u16(p); p += 2;
      const comp = r.u16(p); p += 2;
      let ax = 0, ay = 0;
      if (flags & 0x0001) { ax = r.i16(p); ay = r.i16(p + 2); p += 4; }
      else { ax = r.i8(p); ay = r.i8(p + 1); p += 2; }
      // Note: ARG_1_AND_2_ARE_WORDS handled above; when args are point
      // numbers (not XY) we ignore them — Liberation composites use XY.
      let m = [1, 0, 0, 1];
      if (flags & 0x0008) { const s = r.f2dot14(p); p += 2; m = [s, 0, 0, s]; }
      else if (flags & 0x0040) { const sx = r.f2dot14(p), sy = r.f2dot14(p + 2); p += 4; m = [sx, 0, 0, sy]; }
      else if (flags & 0x0080) {
        m = [r.f2dot14(p), r.f2dot14(p + 2), r.f2dot14(p + 4), r.f2dot14(p + 6)]; p += 8;
      }
      const sub = glyphContours(comp, depth + 1);
      for (const contour of sub) {
        out.push(contour.map((pt) => ({
          x: pt.x * m[0] + pt.y * m[2] + ax,
          y: pt.x * m[1] + pt.y * m[3] + ay,
          on: pt.on,
        })));
      }
      if (!(flags & 0x0020)) break;
    }
    return out;
  }
  return { unitsPerEm, cmapMap, advances, glyphContours };
}

// ---------------------------------------------------------- rasterisation
// Flatten one contour to line segments (font-unit coords, y up).
function flatten(contour) {
  const pts = contour;
  const n = pts.length;
  if (n === 0) return [];
  // Expand to an on-curve walk: insert implied midpoints between
  // consecutive off-curve points; start at an on-curve point.
  const walk = [];
  let startIdx = 0;
  for (let i = 0; i < n; i++) if (pts[i].on) { startIdx = i; break; }
  const seq = [];
  for (let i = 0; i < n; i++) seq.push(pts[(startIdx + i) % n]);
  if (!seq[0].on) { // no on-curve point at all: midpoint of first pair
    const a = seq[0], b = seq[1];
    seq.unshift({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  }
  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i];
    const nxt = seq[(i + 1) % seq.length];
    walk.push(cur);
    if (!cur.on && !nxt.on) walk.push({ x: (cur.x + nxt.x) / 2, y: (cur.y + nxt.y) / 2, on: true });
  }
  // Walk now alternates on/off; emit segments, subdividing quadratics.
  const segs = [];
  let i = 0;
  while (i < walk.length) {
    const a = walk[i];
    const b = walk[(i + 1) % walk.length];
    if (b.on) { segs.push([a.x, a.y, b.x, b.y]); i++; continue; }
    const c = walk[(i + 2) % walk.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y);
    const steps = Math.max(4, Math.min(24, Math.ceil(d / 40)));
    let px = a.x, py = a.y;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const qx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * b.x + t * t * c.x;
      const qy = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * b.y + t * t * c.y;
      segs.push([px, py, qx, qy]);
      px = qx; py = qy;
    }
    i += 2;
  }
  return segs;
}

// Rasterise one glyph (contours in font units) at em size `size` px.
// Returns { xo, yo, w, h, adv, data } with xo/yo/adv in tenths of a px,
// bitmap top yo above the baseline, alpha bytes row-major.
function rasteriseGlyph(font, gid, size) {
  const scale = size / font.unitsPerEm;
  const contours = font.glyphContours(gid);
  const adv = font.advances[gid] * scale;
  // Empty glyphs (space has no outline) still need their advance, in
  // tenths of a px like every other glyph record.
  if (contours.length === 0) return { xo: 0, yo: 0, w: 0, h: 0, adv: Math.round(adv * 10), data: new Uint8Array(0) };
  const segs = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of contours) {
    for (const [x0, y0, x1, y1] of flatten(c)) {
      const a = x0 * scale, b = y0 * scale, d = x1 * scale, e = y1 * scale;
      segs.push([a, b, d, e]);
      minX = Math.min(minX, a, d); maxX = Math.max(maxX, a, d);
      minY = Math.min(minY, b, e); maxY = Math.max(maxY, b, e);
    }
  }
  if (!segs.length) return { xo: 0, yo: 0, w: 0, h: 0, adv: Math.round(adv * 10), data: new Uint8Array(0) };
  const SS = 4; // subpixels per final pixel
  const x0 = Math.floor(minX), x1 = Math.ceil(maxX);
  const y0 = Math.floor(minY), y1 = Math.ceil(maxY);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const cov = new Float32Array(w * h); // coverage 0..1 per final pixel
  // For each final pixel row, scan its SS sub-rows.
  for (let py = 0; py < h; py++) {
    for (let sy = 0; sy < SS; sy++) {
      const y = y0 + py + (sy + 0.5) / SS;
      const xs = [];
      for (const [ax, ay, bx, by] of segs) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const t = (y - ay) / (by - ay);
          xs.push({ x: ax + t * (bx - ax), dir: by > ay ? 1 : -1 });
        }
      }
      xs.sort((p, q) => p.x - q.x);
      let winding = 0;
      for (let i = 0; i + 1 < xs.length; i++) {
        winding += xs[i].dir;
        if (winding !== 0) {
          const xa = Math.max(x0, xs[i].x), xb = Math.min(x0 + w, xs[i + 1].x);
          // Accumulate fractional coverage of final pixels in [xa, xb).
          const ca = Math.max(0, Math.floor(xa - x0)), cb = Math.min(w, Math.ceil(xb - x0));
          for (let px = ca; px < cb; px++) {
            const left = Math.max(xa, x0 + px), right = Math.min(xb, x0 + px + 1);
            // Font y runs up; bitmap row 0 is the top, so store the
            // bottom-most scan row (py = 0) at the last bitmap row.
            if (right > left) cov[(h - 1 - py) * w + px] += (right - left) / SS;
          }
        }
      }
    }
  }
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = Math.max(0, Math.min(255, Math.round(cov[i] * 255)));
  return {
    xo: Math.round(x0 * 10),
    yo: Math.round(y1 * 10), // bitmap top is y1 font px above baseline
    w, h, adv: Math.round(adv * 10),
    data,
  };
}

// ------------------------------------------------------------------- build
const fonts = [];
for (const [file, bold] of [
  ['LiberationSerif-Regular.ttf', false],
  ['LiberationSerif-Bold.ttf', true],
]) {
  const font = parseTTF(join(FONT_DIR, file));
  for (const size of SIZES) {
    const glyphs = [];
    for (const cp of CODEPOINTS) {
      const gid = font.cmapMap.get(cp);
      if (gid === undefined) continue;
      const g = rasteriseGlyph(font, gid, size);
      glyphs.push({ cp, ...g });
    }
    fonts.push({ bold, size, glyphs });
    console.log(`${bold ? 'Bold  ' : 'Reg  '} ${size}px: ${glyphs.length} glyphs`);
  }
}

// Write NF01 container: magic, u16 font count; per font: u8 bold, u8 size,
// u16 glyph count; per glyph: u32 cp, i16 xo, i16 yo, u16 w, u16 h, u16 adv,
// then w*h alpha bytes.
const parts = [];
const head = Buffer.alloc(6);
head.write('NF01', 0, 'ascii');
head.writeUInt16BE(fonts.length, 4);
parts.push(head);
let total = 6;
for (const f of fonts) {
  const fh = Buffer.alloc(4);
  fh[0] = f.bold ? 1 : 0;
  fh[1] = f.size;
  fh.writeUInt16BE(f.glyphs.length, 2);
  parts.push(fh); total += 4;
  for (const g of f.glyphs) {
    const gh = Buffer.alloc(16);
    gh.writeUInt32BE(g.cp, 0);
    gh.writeInt16BE(g.xo, 4);
    gh.writeInt16BE(g.yo, 6);
    gh.writeUInt16BE(g.w, 8);
    gh.writeUInt16BE(g.h, 10);
    gh.writeUInt16BE(g.adv, 12);
    // two spare bytes at 14..15
    parts.push(gh, Buffer.from(g.data));
    total += 16 + g.data.length;
  }
}
writeFileSync(join(HERE, 'fonts.bin'), Buffer.concat(parts));
console.log('wrote fonts.bin', total, 'bytes');
