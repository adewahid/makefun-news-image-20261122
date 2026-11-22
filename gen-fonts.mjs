// gen-fonts.mjs — own TTF parser + rasterizer. Reads system Liberation Serif
// (Regular/Bold/Italic/BoldItalic), flattens glyph outlines, rasterizes each
// glyph at fixed sizes with 2x2 supersampling into 2-bit alpha bitmaps, and
// writes fonts.json for main.ts. No external libraries: pure Node stdlib.
import { readFileSync, writeFileSync } from 'node:fs';

const FONT_DIR = '/usr/share/fonts/truetype/liberation/';
const FACES = {
  regular: 'LiberationSerif-Regular.ttf',
  bold: 'LiberationSerif-Bold.ttf',
  italic: 'LiberationSerif-Italic.ttf',
  bolditalic: 'LiberationSerif-BoldItalic.ttf',
};
const SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 22, 28, 36, 48, 60];
const CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  '–—‘’‚“”„•…·éèêëàáâäåãøæœçñíìîïóòôöõúùûüýÿ€£§°±×÷−←↑→↓★✓';
const SS = 2; // supersample factor

function parseTTF(buf) {
  const u16 = (o) => buf.readUInt16BE(o);
  const i16 = (o) => buf.readInt16BE(o);
  const u32 = (o) => buf.readUInt32BE(o);
  const numTables = u16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = buf.toString('ascii', o, o + 4);
    tables[tag] = { off: u32(o + 8), len: u32(o + 12) };
  }
  const t = (tag) => tables[tag].off;
  const upem = u16(t('head') + 18);
  const indexToLocFormat = i16(t('head') + 50);
  const numGlyphs = u16(t('maxp') + 4);
  const numHMetrics = u16(t('hhea') + 34);
  // cmap: prefer format 12, else format 4
  const cmapOff = t('cmap');
  const nSub = u16(cmapOff + 2);
  let cmap = null;
  for (let i = 0; i < nSub; i++) {
    const so = cmapOff + 4 + i * 8;
    const subOff = cmapOff + u32(so + 4);
    const fmt = u16(subOff);
    if (fmt === 12) { cmap = { fmt: 12, off: subOff }; break; }
    if (fmt === 4 && !cmap) cmap = { fmt: 4, off: subOff };
  }
  function glyphIndex(cp) {
    if (cmap.fmt === 12) {
      const n = u32(cmap.off + 12);
      for (let i = 0; i < n; i++) {
        const o = cmap.off + 16 + i * 12;
        if (cp >= u32(o) && cp <= u32(o + 4)) return u32(o + 8) + (cp - u32(o));
      }
      return 0;
    }
    const o = cmap.off;
    const segCount = u16(o + 6) / 2;
    const endOff = o + 14;
    const startOff = endOff + segCount * 2 + 2;
    const deltaOff = startOff + segCount * 2;
    const rangeOff = deltaOff + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = u16(endOff + s * 2);
      if (cp > end) continue;
      const start = u16(startOff + s * 2);
      if (cp < start) return 0;
      const delta = i16(deltaOff + s * 2);
      const ro = u16(rangeOff + s * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const go = rangeOff + s * 2 + ro + (cp - start) * 2;
      const g = u16(go);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }
  function advance(gid) {
    const hm = t('hmtx');
    const g = Math.min(gid, numHMetrics - 1);
    return u16(hm + g * 4);
  }
  // glyf
  const glyfOff = t('glyf');
  const locaOff = t('loca');
  function glyphOffset(gid) {
    if (indexToLocFormat === 0) return u16(locaOff + gid * 2) * 2;
    return u32(locaOff + gid * 4);
  }
  // returns array of contours; each contour is array of {x,y,on}
  function outline(gid, depth = 0) {
    if (depth > 4) return [];
    const start = glyphOffset(gid);
    const end = glyphOffset(gid + 1);
    if (end <= start) return [];
    const o = glyfOff + start;
    const nContours = i16(o);
    if (nContours < 0) {
      // compound glyph
      let p = o + 10;
      const out = [];
      for (;;) {
        const flags = u16(p); const comp = u16(p + 2); p += 4;
        let dx = 0, dy = 0, sx = 1, sy = 1;
        if (flags & 0x0001) { dx = i16(p); dy = i16(p + 2); p += 4; }
        else { dx = buf[p]; dy = buf[p + 1]; p += 2; }
        if (flags & 0x0008) { const s = i16(p) / 16384; sx = sy = s; p += 2; }
        else if (flags & 0x0080) { sx = i16(p) / 16384; sy = i16(p + 2) / 16384; p += 4; }
        else if (flags & 0x0040) { sx = i16(p) / 16384; p += 2; }
        for (const c of outline(comp, depth + 1)) {
          out.push(c.map((pt) => ({ x: pt.x * sx + dx, y: pt.y * sy + dy, on: pt.on })));
        }
        if (!(flags & 0x0020)) break;
      }
      return out;
    }
    const endPts = [];
    for (let i = 0; i < nContours; i++) endPts.push(u16(o + 10 + i * 2));
    const instrLen = u16(o + 10 + nContours * 2);
    let p = o + 10 + nContours * 2 + 2 + instrLen;
    const nPts = endPts[nContours - 1] + 1;
    const flags = [];
    let i = 0;
    while (i < nPts) {
      const f = buf[p++];
      flags.push(f);
      if (f & 0x08) {
        const rep = buf[p++];
        for (let r = 0; r < rep; r++) flags.push(f);
        i += rep + 1;
      } else i++;
    }
    const xs = []; let x = 0;
    for (let k = 0; k < nPts; k++) {
      const f = flags[k];
      if (f & 0x02) { const d = buf[p++]; x += (f & 0x10) ? d : -d; }
      else if (!(f & 0x10)) { x += i16(p); p += 2; }
      xs.push(x);
    }
    const ys = []; let y = 0;
    for (let k = 0; k < nPts; k++) {
      const f = flags[k];
      if (f & 0x04) { const d = buf[p++]; y += (f & 0x20) ? d : -d; }
      else if (!(f & 0x20)) { y += i16(p); p += 2; }
      ys.push(y);
    }
    const contours = [];
    let s0 = 0;
    for (const e of endPts) {
      const pts = [];
      for (let k = s0; k <= e; k++) pts.push({ x: xs[k], y: ys[k], on: !!(flags[k] & 0x01) });
      contours.push(pts);
      s0 = e + 1;
    }
    return contours;
  }
  return { upem, numGlyphs, glyphIndex, advance, outline };
}

function flatten(contours) {
  // returns array of polygons (arrays of [x,y]) in font units, y up positive
  const polys = [];
  for (const c of contours) {
    if (c.length === 0) continue;
    // expand implied on-curve points between consecutive off-curve points
    const pts = [];
    for (let i = 0; i < c.length; i++) {
      const cur = c[i];
      const nxt = c[(i + 1) % c.length];
      pts.push(cur);
      if (!cur.on && !nxt.on) pts.push({ x: (cur.x + nxt.x) / 2, y: (cur.y + nxt.y) / 2, on: true });
    }
    const poly = [];
    let start = pts.findIndex((p) => p.on);
    if (start < 0) start = 0;
    const n = pts.length;
    let pen = pts[start];
    poly.push([pen.x, pen.y]);
    for (let k = 1; k <= n; k++) {
      const p = pts[(start + k) % n];
      if (p.on) { poly.push([p.x, p.y]); pen = p; }
      else {
        const q = pts[(start + k + 1) % n];
        const qx = q.on ? q.x : (p.x + q.x) / 2;
        const qy = q.on ? q.y : (p.y + q.y) / 2;
        // quadratic bezier pen -> p -> (qx,qy), 10 segments
        for (let s = 1; s <= 10; s++) {
          const t = s / 10;
          const mt = 1 - t;
          poly.push([
            mt * mt * pen.x + 2 * mt * t * p.x + t * t * qx,
            mt * mt * pen.y + 2 * mt * t * p.y + t * t * qy,
          ]);
        }
        pen = { x: qx, y: qy };
      }
    }
    polys.push(poly);
  }
  return polys;
}

function rasterize(polys, size, upem) {
  const scale = (size * SS) / upem;
  // bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return { w: 0, h: 0, x: 0, y: 0, data: '' };
  const x0 = Math.floor(minX * scale), x1 = Math.ceil(maxX * scale);
  const yTop = maxY; // font units; bitmap row 0 is the top of the glyph
  const W = Math.max(1, x1 - x0), H = Math.max(1, Math.ceil((maxY - minY) * scale));
  // edges in supersampled pixel space, y down, origin at glyph top-left
  const edges = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const X1 = ax * scale - x0, Y1 = (yTop - ay) * scale;
      const X2 = bx * scale - x0, Y2 = (yTop - by) * scale;
      if (Y1 === Y2) continue;
      edges.push([X1, Y1, X2, Y2]);
    }
  }
  // supersampled scanline fill, 2-bit alpha
  const ow = Math.ceil(W / SS), oh = Math.ceil(H / SS);
  const px = new Uint8Array(ow * oh); // 0..4 coverage
  for (let sy = 0; sy < H; sy++) {
    const yc = sy + 0.5;
    const xs = [];
    for (const [X1, Y1, X2, Y2] of edges) {
      if ((yc >= Math.min(Y1, Y2)) && (yc < Math.max(Y1, Y2))) {
        xs.push(X1 + (yc - Y1) * (X2 - X1) / (Y2 - Y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.floor(xs[k])), b = Math.min(W, Math.ceil(xs[k + 1]));
      for (let sx = a; sx < b; sx++) {
        const ox = Math.floor(sx / SS), oy = Math.floor(sy / SS);
        px[oy * ow + ox]++;
      }
    }
  }
  // pack 2-bit alpha: coverage 0..4 -> 0..3
  const packed = Buffer.alloc(Math.ceil(ow * oh / 4));
  for (let i = 0; i < ow * oh; i++) {
    const vv = px[i] === 0 ? 0 : px[i] === 1 ? 1 : px[i] === 2 ? 2 : 3;
    const byte = Math.floor(i / 4), shift = (3 - (i % 4)) * 2;
    packed[byte] |= vv << shift;
  }
  return {
    w: ow, h: oh,
    x: Math.round(x0 / SS), // bearingX in output px
    y: Math.round((maxY * size) / upem), // distance from baseline up to top of bitmap
    data: packed.toString('base64'),
  };
}

const out = { metrics: {}, faces: {} };
for (const [face, file] of Object.entries(FACES)) {
  const buf = readFileSync(FONT_DIR + file);
  const font = parseTTF(buf);
  out.metrics[face] = { upem: font.upem };
  out.faces[face] = {};
  for (const size of SIZES) {
    const glyphs = {};
    for (const ch of CHARS) {
      const gid = font.glyphIndex(ch.codePointAt(0));
      const adv = Math.round((font.advance(gid) * size) / font.upem);
      if (ch === ' ') { glyphs[ch] = { a: adv, w: 0, h: 0, x: 0, y: 0, d: '' }; continue; }
      if (gid === 0) continue;
      const polys = flatten(font.outline(gid));
      if (polys.length === 0) { glyphs[ch] = { a: adv, w: 0, h: 0, x: 0, y: 0, d: '' }; continue; }
      const r = rasterize(polys, size, font.upem);
      glyphs[ch] = { a: adv, w: r.w, h: r.h, x: r.x, y: r.y, d: r.data };
    }
    out.faces[face][size] = glyphs;
  }
  console.log(face, 'done, upem', font.upem);
}
writeFileSync(process.argv[2] || 'fonts.json', JSON.stringify(out));
console.log('wrote', process.argv[2] || 'fonts.json');
