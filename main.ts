// news-image-20261122 v5 — "Sunday 22 November 2026: The World in One Day"
// Written fresh in this session for the v5 rebuild. A self-contained Node 22
// program (standard library only) that draws a 1024x1024 newspaper front page
// summing up Sunday 22 November 2026 and writes it to
// $MAKEFUN_OUTPUT_DIR/entry.png (default /output).
// Own code throughout: own PNG encoder, own raster canvas (with clipping, so
// the map inset can reuse the real coastline data), own bitmap font engine
// reading glyphs baked from the system Liberation Serif TTFs (fonts.json,
// baked by gen-fonts.py). No hand-drawn font anywhere.
// Deterministic: same input files, same bytes, every run.
// v5 vs the counted v3: picture-story art ~95px tall (was ~50px), a 12th
// picture story (the Pope's lunch), the HOW SURE legend as a thin inline
// strip, and a EUROPE & MIDDLE EAST — ENLARGED inset on the map. The COP31
// lead is corrected: the final text was REJECTED on Sunday, so COP31 ended
// with no deal — the first no-deal COP since 2000.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

// ---------------------------------------------------------------- palette
const PAPER: RGB = [247, 241, 222];
const INK: RGB = [24, 22, 18];
const RED: RGB = [163, 18, 18];
const RED_DK: RGB = [122, 10, 10];
const NAVY: RGB = [20, 33, 61];
const GOLD: RGB = [176, 132, 40];
const GREY: RGB = [94, 88, 76];
const LINE: RGB = [120, 110, 88];
const CREAM: RGB = [255, 252, 240];

function rgb(c: RGB): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
void rgb;

// ------------------------------------------------------- deterministic rng
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ canvas
class Canvas {
  w = W; h = H;
  px: Uint8Array;
  // clip rectangle, honoured by set(); defaults to the whole page.
  cx0 = 0; cy0 = 0; cx1 = W; cy1 = H;
  constructor() { this.px = new Uint8Array(W * H * 4); }
  setClip(x0: number, y0: number, x1: number, y1: number) {
    this.cx0 = Math.max(0, Math.round(x0)); this.cy0 = Math.max(0, Math.round(y0));
    this.cx1 = Math.min(W, Math.round(x1)); this.cy1 = Math.min(H, Math.round(y1));
  }
  clearClip() { this.cx0 = 0; this.cy0 = 0; this.cx1 = W; this.cy1 = H; }
  fill(c: RGB) {
    for (let i = 0; i < W * H; i++) {
      this.px[i * 4] = c[0]; this.px[i * 4 + 1] = c[1];
      this.px[i * 4 + 2] = c[2]; this.px[i * 4 + 3] = 255;
    }
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < this.cx0 || y < this.cy0 || x >= this.cx1 || y >= this.cy1) return;
    const i = (y * W + x) * 4;
    if (a >= 255) {
      this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = 255;
    } else if (a > 0) {
      const s = a / 255, d = 1 - s;
      this.px[i] = Math.round(c[0] * s + this.px[i] * d);
      this.px[i + 1] = Math.round(c[1] * s + this.px[i + 1] * d);
      this.px[i + 2] = Math.round(c[2] * s + this.px[i + 2] * d);
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 255) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    const x0 = Math.max(this.cx0, x), y0 = Math.max(this.cy0, y);
    const x1 = Math.min(this.cx1, x + w), y1 = Math.min(this.cy1, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4;
        if (a >= 255) {
          this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = 255;
        } else if (a > 0) {
          const s = a / 255, d = 1 - s;
          this.px[i] = Math.round(c[0] * s + this.px[i] * d);
          this.px[i + 1] = Math.round(c[1] * s + this.px[i + 1] * d);
          this.px[i + 2] = Math.round(c[2] * s + this.px[i + 2] * d);
        }
      }
    }
  }
  hline(x0: number, x1: number, y: number, c: RGB, a = 255) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, c, a);
  }
  vline(x: number, y0: number, y1: number, c: RGB, a = 255) {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, c, a);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + (dx * i) / n, y0 + (dy * i) / n, c, a);
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 255) {
    const rr = Math.round(r);
    for (let y = -rr; y <= rr; y++) {
      const w = Math.floor(Math.sqrt(Math.max(0, rr * rr - y * y)));
      for (let x = -w; x <= w; x++) this.set(cx + x, cy + y, c, a);
    }
  }
  ring(cx: number, cy: number, r: number, c: RGB, a = 255) {
    const rr = Math.round(r);
    for (let k = 0; k < 360; k += 2) {
      const t = (k * Math.PI) / 180;
      this.set(cx + rr * Math.cos(t), cy + rr * Math.sin(t), c, a);
    }
  }
  // vertical gradient rect
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB) {
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? 0 : j / (h - 1);
      const c: RGB = [
        Math.round(top[0] + (bot[0] - top[0]) * t),
        Math.round(top[1] + (bot[1] - top[1]) * t),
        Math.round(top[2] + (bot[2] - top[2]) * t),
      ];
      this.hline(x, x + w - 1, y + j, c);
    }
  }
  // filled polygon (even-odd scanline)
  poly(pts: [number, number][], c: RGB, a = 255) {
    let minY = 1e9, maxY = -1e9;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) this.set(x, y, c, a);
      }
    }
  }
  // filled ellipse
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 255) {
    for (let y = -Math.round(ry); y <= Math.round(ry); y++) {
      const t = 1 - (y * y) / (ry * ry);
      if (t < 0) continue;
      const w = Math.floor(rx * Math.sqrt(t));
      for (let x = -w; x <= w; x++) this.set(cx + x, cy + y, c, a);
    }
  }
}

const cv = new Canvas();

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(): Buffer {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter: none
    Buffer.from(cv.px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- fonts
type Glyph = { adv: number; bx: number; by: number; w: number; h: number; data: Uint8Array };
const FONT_DIR = path.dirname(fileURLToPath(import.meta.url));
const fontJson = JSON.parse(fs.readFileSync(path.join(FONT_DIR, "fonts.json"), "utf-8"));
const glyphCache = new Map<string, Glyph>();
function glyph(face: string, size: number, ch: string): Glyph | null {
  const key = face + "/" + size + "/" + ch;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const table = fontJson.faces[face]?.[String(size)];
  if (!table) return null;
  const g = table[ch] ?? table["?"];
  if (!g) return null;
  const out: Glyph = {
    adv: g[0], bx: g[1], by: g[2], w: g[3], h: g[4],
    data: g[5] ? Uint8Array.from(Buffer.from(g[5], "base64")) : new Uint8Array(0),
  };
  glyphCache.set(key, out);
  return out;
}
function textWidth(text: string, face: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    const g = glyph(face, size, ch);
    if (g) w += g.adv;
  }
  return w;
}
function drawText(x: number, yTop: number, text: string, face: string, size: number, color: RGB) {
  let pen = Math.round(x);
  const top = Math.round(yTop);
  for (const ch of text) {
    const g = glyph(face, size, ch);
    if (!g) continue;
    if (g.w > 0) {
      const gx = pen + g.bx, gy = top + g.by;
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          const v = g.data[j * g.w + i];
          if (v > 0) cv.set(gx + i, gy + j, color, v);
        }
      }
    }
    pen += g.adv;
  }
}
function drawTextC(cx: number, yTop: number, text: string, face: string, size: number, color: RGB) {
  drawText(cx - textWidth(text, face, size) / 2, yTop, text, face, size, color);
}
function drawTextR(xRight: number, yTop: number, text: string, face: string, size: number, color: RGB) {
  drawText(xRight - textWidth(text, face, size), yTop, text, face, size, color);
}
// Greedy word wrap; returns lines (each fits maxW). Long words are split.
function wrap(text: string, face: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    let line = "";
    for (const word of words) {
      const trial = line ? line + " " + word : word;
      if (textWidth(trial, face, size) <= maxW) { line = trial; continue; }
      if (line) out.push(line);
      if (textWidth(word, face, size) > maxW) {
        let cur = "";
        for (const ch of word) {
          if (textWidth(cur + ch, face, size) > maxW && cur) { out.push(cur); cur = ch; }
          else cur += ch;
        }
        line = cur;
      } else line = word;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}
function drawPara(x: number, yTop: number, text: string, face: string, size: number, color: RGB, maxW: number, lh: number, maxLines = 99): number {
  const lines = wrap(text, face, size, maxW).slice(0, maxLines);
  for (let i = 0; i < lines.length; i++) drawText(x, yTop + i * lh, lines[i], face, size, color);
  return lines.length;
}

// ------------------------------------------------------------ scene helpers
// Small reusable drawing pieces. Every scene draws inside (x, y, w, h) and
// scales with it, so the same scene works at lead height (88px) and picture
// height (95px).
function stars(x: number, y: number, w: number, h: number, n: number, rng: () => number) {
  for (let i = 0; i < n; i++) {
    const sx = x + rng() * w, sy = y + rng() * h;
    cv.set(sx, sy, [255, 255, 230], 200);
    if (rng() > 0.7) { cv.set(sx + 1, sy, [255, 255, 230], 140); cv.set(sx, sy + 1, [255, 255, 230], 140); }
  }
}
function litWindows(x: number, y: number, w: number, h: number, cols: number, rows: number, lit: RGB, rng: () => number, litP = 0.55) {
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = rng() < litP;
      cv.rect(x + c * cw + cw * 0.22, y + r * ch + ch * 0.22, cw * 0.56, ch * 0.56, on ? lit : [40, 44, 58]);
    }
  }
}
function tower(x: number, y: number, w: number, h: number, body: RGB, lit: RGB, rng: () => number, litP = 0.55) {
  cv.rect(x, y, w, h, body);
  const cols = Math.max(2, Math.floor(w / 11)), rows = Math.max(2, Math.floor(h / 11));
  litWindows(x + 2, y + 2, w - 4, h - 4, cols, rows, lit, rng, litP);
}
function figure(x: number, y: number, s: number, shirt: RGB, skin: RGB = [214, 164, 120]) {
  cv.circle(x, y, s * 0.32, skin);
  cv.rect(x - s * 0.34, y + s * 0.34, s * 0.68, s * 0.95, shirt);
  cv.rect(x - s * 0.34, y + s * 1.28, s * 0.26, s * 0.6, [30, 30, 34]);
  cv.rect(x + s * 0.08, y + s * 1.28, s * 0.26, s * 0.6, [30, 30, 34]);
}
function flame(x: number, y: number, s: number) {
  cv.poly([[x - s * 0.55, y], [x, y - s * 1.7], [x + s * 0.55, y]], [232, 84, 20]);
  cv.poly([[x - s * 0.32, y], [x, y - s * 1.15], [x + s * 0.32, y]], [245, 158, 32]);
  cv.poly([[x - s * 0.15, y], [x, y - s * 0.62], [x + s * 0.15, y]], [250, 214, 90]);
}
function smoke(x: number, y: number, s: number, rng: () => number, n = 7) {
  for (let i = 0; i < n; i++) {
    const dx = (rng() - 0.5) * s * 1.6, dy = -rng() * s * 2.2;
    cv.circle(x + dx, y + dy, s * (0.35 + rng() * 0.5), [120, 118, 112], 110);
  }
}
function sea(x: number, y: number, w: number, h: number, col: RGB, rng: () => number, rows = 4) {
  for (let r = 0; r < rows; r++) {
    const yy = y + (r * h) / rows + rng() * 2;
    for (let xx = x; xx < x + w; xx += 3) {
      const off = Math.sin((xx / w) * Math.PI * 3 + r * 1.7) * 1.6;
      cv.set(xx, yy + off, col, 200);
      cv.set(xx + 1, yy + off, col, 120);
    }
  }
}
function flagOnPole(x: number, y: number, h: number, stripes: RGB[]) {
  cv.vline(x, y, y + h, [60, 58, 50]);
  const fw = 15, fh = Math.min(10, h * 0.32);
  const sh = fh / stripes.length;
  for (let i = 0; i < stripes.length; i++) cv.rect(x + 1, y + i * sh, fw, sh + 0.6, stripes[i]);
}
function quadcopter(x: number, y: number, s: number) {
  cv.line(x - s, y - s * 0.5, x + s, y + s * 0.5, [200, 200, 205], 220);
  cv.line(x - s, y + s * 0.5, x + s, y - s * 0.5, [200, 200, 205], 220);
  cv.circle(x, y, s * 0.42, [40, 42, 50]);
  cv.circle(x - s, y - s * 0.5, s * 0.22, [255, 90, 60]);
  cv.circle(x + s, y + s * 0.5, s * 0.22, [255, 220, 90]);
}
function beam(x: number, y: number, len: number, ang: number, col: RGB = [255, 244, 190]) {
  const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
  const px = -Math.sin(ang) * 7, py = Math.cos(ang) * 7;
  cv.poly([[x, y], [x + dx + px, y + dy + py], [x + dx - px, y + dy - py]], col, 46);
}

// -------------------------------------------------------------------- scenes
type Scene = (x: number, y: number, w: number, h: number, seed: number) => void;

const SCENES: Record<string, Scene> = {
  // COP31: dawn over Antalya, the hall full of delegates, and the cover
  // decision on the table crossed out in red — the text was rejected.
  cop31(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h, [214, 128, 62], [250, 214, 150]);
    cv.circle(x + w * 0.78, y + h * 0.28, 12, [255, 236, 170]);
    cv.circle(x + w * 0.78, y + h * 0.28, 19, [255, 236, 170], 60);
    cv.poly([[x, y + h * 0.6], [x + w * 0.22, y + h * 0.32], [x + w * 0.42, y + h * 0.6]], [122, 96, 120]);
    cv.poly([[x + w * 0.3, y + h * 0.6], [x + w * 0.58, y + h * 0.26], [x + w * 0.85, y + h * 0.6]], [96, 76, 104]);
    cv.poly([[x + w * 0.68, y + h * 0.6], [x + w * 0.9, y + h * 0.38], [x + w, y + h * 0.6]], [122, 96, 120]);
    cv.rect(x + w * 0.08, y + h * 0.58, w * 0.84, h * 0.42, [52, 58, 84]);
    cv.rect(x + w * 0.08, y + h * 0.54, w * 0.84, h * 0.05, [70, 76, 104]);
    for (let i = 0; i < 7; i++) {
      cv.rect(x + w * (0.13 + i * 0.115), y + h * 0.62, w * 0.055, h * 0.16, [255, 214, 120], 200);
    }
    cv.rect(x + w * 0.12, y + h * 0.8, w * 0.76, h * 0.06, [122, 84, 44]);
    const shirts: RGB[] = [[178, 52, 44], [44, 96, 150], [52, 130, 84], [200, 170, 60], [120, 70, 130]];
    for (let i = 0; i < 8; i++) {
      figure(x + w * (0.15 + i * 0.095), y + h * 0.64, h * 0.085, shirts[i % shirts.length]);
    }
    // the rejected text: a white page on the table, crossed out in red
    cv.rect(x + w * 0.44, y + h * 0.74, w * 0.12, h * 0.1, [245, 242, 232]);
    cv.line(x + w * 0.44, y + h * 0.74, x + w * 0.56, y + h * 0.84, [178, 30, 30]);
    cv.line(x + w * 0.56, y + h * 0.74, x + w * 0.44, y + h * 0.84, [178, 30, 30]);
    flagOnPole(x + w * 0.06, y + h * 0.4, h * 0.2, [[178, 52, 44], [255, 255, 255]]);
    flagOnPole(x + w * 0.9, y + h * 0.4, h * 0.2, [[44, 96, 150], [255, 255, 255]]);
  },
  // Night sky over Kyiv: drone swarm, searchlights, a broken apartment block.
  drones(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h, [10, 14, 34], [38, 52, 92]);
    stars(x, y, w, h * 0.55, 26, rng);
    cv.circle(x + w * 0.86, y + h * 0.2, 11, [232, 230, 210]);
    cv.circle(x + w * 0.86, y + h * 0.2, 16, [232, 230, 210], 40);
    const dpos: [number, number][] = [[0.18, 0.22], [0.42, 0.14], [0.62, 0.28], [0.3, 0.36], [0.74, 0.16]];
    for (const [fx, fy] of dpos) {
      for (let k = 0; k < 5; k++) cv.set(x + w * fx - k * 7, y + h * fy + k * 2, [255, 200, 90], 160 - k * 28);
      quadcopter(x + w * fx, y + h * fy, 5);
    }
    beam(x + w * 0.08, y + h * 0.95, h * 0.85, -1.15);
    beam(x + w * 0.9, y + h * 0.95, h * 0.8, -1.9);
    tower(x + w * 0.3, y + h * 0.52, w * 0.42, h * 0.48, [58, 52, 58], [255, 206, 110], rng);
    cv.poly([[x + w * 0.3, y + h * 0.52], [x + w * 0.44, y + h * 0.62], [x + w * 0.3, y + h * 0.72]], [30, 28, 34]);
    cv.poly([[x + w * 0.55, y + h * 0.6], [x + w * 0.72, y + h * 0.52], [x + w * 0.72, y + h * 0.7]], [30, 28, 34]);
    flame(x + w * 0.62, y + h * 0.62, 9);
    smoke(x + w * 0.62, y + h * 0.55, 6, rng, 6);
    cv.rect(x, y + h * 0.94, w, h * 0.06, [26, 24, 30]);
  },
  // Dusk over the Gulf: radar domes on the shore, a missile arc, a tanker.
  bahrain(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.62, [64, 52, 96], [224, 150, 92]);
    cv.circle(x + w * 0.2, y + h * 0.26, 10, [255, 226, 150]);
    cv.vgrad(x, y + h * 0.62, w, h * 0.38, [52, 74, 110], [24, 38, 66]);
    sea(x, y + h * 0.66, w, h * 0.3, [180, 210, 235], rng, 4);
    cv.rect(x + w * 0.06, y + h * 0.5, w * 0.2, h * 0.14, [120, 118, 110]);
    cv.ellipse(x + w * 0.16, y + h * 0.5, w * 0.085, h * 0.09, [235, 232, 224]);
    cv.rect(x + w * 0.34, y + h * 0.46, w * 0.16, h * 0.18, [120, 118, 110]);
    cv.ellipse(x + w * 0.42, y + h * 0.46, w * 0.07, h * 0.075, [235, 232, 224]);
    flame(x + w * 0.42, y + h * 0.44, 8);
    smoke(x + w * 0.42, y + h * 0.38, 6, rng, 5);
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const px = x + w * (0.55 + t * 0.32);
      const py = y + h * (0.5 - Math.sin(t * Math.PI) * 0.34);
      cv.circle(px, py, 1.6, [255, 210, 120], 200 - k * 10);
    }
    flame(x + w * 0.87, y + h * 0.52, 7);
    cv.poly([[x + w * 0.62, y + h * 0.72], [x + w * 0.98, y + h * 0.72], [x + w * 0.94, y + h * 0.86], [x + w * 0.66, y + h * 0.86]], [28, 28, 34]);
    cv.rect(x + w * 0.7, y + h * 0.64, w * 0.05, h * 0.08, [150, 52, 44]);
    cv.rect(x + w * 0.78, y + h * 0.66, w * 0.05, h * 0.06, [52, 96, 130]);
    flame(x + w * 0.72, y + h * 0.64, 6);
    smoke(x + w * 0.72, y + h * 0.58, 5, rng, 4);
  },
  // Hong Kong: ballot box in front of the skyline, voters queueing.
  vote(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h, [150, 190, 220], [226, 232, 238]);
    tower(x + w * 0.04, y + h * 0.34, w * 0.3, h * 0.66, [110, 116, 128], [255, 220, 130], rng);
    tower(x + w * 0.66, y + h * 0.26, w * 0.3, h * 0.74, [96, 102, 116], [255, 220, 130], rng);
    cv.rect(x + w * 0.42, y + h * 0.52, w * 0.18, h * 0.3, [178, 52, 44]);
    cv.rect(x + w * 0.4, y + h * 0.48, w * 0.22, h * 0.05, [140, 36, 30]);
    cv.rect(x + w * 0.47, y + h * 0.4, w * 0.08, h * 0.09, [255, 255, 255]);
    cv.line(x + w * 0.485, y + h * 0.4, x + w * 0.53, y + h * 0.47, [40, 120, 60]);
    cv.line(x + w * 0.53, y + h * 0.47, x + w * 0.47, y + h * 0.42, [40, 120, 60]);
    figure(x + w * 0.38, y + h * 0.62, h * 0.14, [44, 96, 150]);
    figure(x + w * 0.68, y + h * 0.62, h * 0.14, [52, 130, 84]);
    figure(x + w * 0.78, y + h * 0.62, h * 0.14, [178, 52, 44]);
    cv.circle(x + w * 0.85, y + h * 0.16, 7, [255, 226, 150]);
  },
  // Wellington: green outfield, pitch, stumps, batsman, scoreboard.
  cricket(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.5, [140, 190, 230], [210, 228, 240]);
    cv.circle(x + w * 0.82, y + h * 0.18, 8, [255, 226, 150]);
    cv.rect(x, y + h * 0.5, w, h * 0.5, [86, 150, 84]);
    cv.ellipse(x + w * 0.5, y + h * 0.74, w * 0.46, h * 0.24, [150, 196, 120]);
    cv.rect(x + w * 0.18, y + h * 0.66, w * 0.64, h * 0.16, [214, 190, 140]);
    cv.vline(x + w * 0.78, y + h * 0.6, y + h * 0.74, [220, 190, 90]);
    cv.vline(x + w * 0.8, y + h * 0.6, y + h * 0.74, [220, 190, 90]);
    figure(x + w * 0.72, y + h * 0.56, h * 0.16, [255, 255, 255]);
    cv.line(x + w * 0.7, y + h * 0.72, x + w * 0.64, y + h * 0.86, [150, 110, 60]);
    figure(x + w * 0.24, y + h * 0.6, h * 0.16, [178, 52, 44]);
    cv.circle(x + w * 0.5, y + h * 0.6, 2.4, [178, 40, 36]);
    cv.rect(x + w * 0.06, y + h * 0.06, w * 0.3, h * 0.2, [30, 34, 44]);
    cv.rect(x + w * 0.08, y + h * 0.09, w * 0.26, h * 0.05, [255, 214, 90]);
    cv.rect(x + w * 0.08, y + h * 0.16, w * 0.18, h * 0.05, [90, 200, 120]);
  },
  // Las Vegas: neon night, floodlit track, a red race car, chequered flag.
  f1(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.55, [24, 18, 52], [96, 60, 150]);
    stars(x, y, w, h * 0.4, 12, rng);
    cv.rect(x, y + h * 0.55, w, h * 0.45, [52, 52, 58]);
    cv.poly([[x, y + h * 0.72], [x + w, y + h * 0.62], [x + w, y + h * 0.78], [x, y + h * 0.88]], [70, 70, 78]);
    for (let i = 0; i < 10; i++) {
      cv.rect(x + (i * w) / 10, y + h * (0.72 - (i * 0.01)), w * 0.05, 3, i % 2 ? [220, 40, 40] : [255, 255, 255]);
    }
    const cx = x + w * 0.5, cy = y + h * 0.68;
    cv.rect(cx - 26, cy - 4, 52, 8, [178, 30, 30]);
    cv.ellipse(cx + 2, cy - 6, 10, 5, [220, 40, 40]);
    cv.circle(cx - 18, cy + 5, 6, [20, 20, 22]);
    cv.circle(cx + 18, cy + 5, 6, [20, 20, 22]);
    cv.circle(cx - 18, cy + 5, 2.4, [200, 200, 205]);
    cv.circle(cx + 18, cy + 5, 2.4, [200, 200, 205]);
    cv.rect(cx + 26, cy - 8, 4, 12, [220, 40, 40]);
    tower(x + w * 0.04, y + h * 0.2, w * 0.14, h * 0.36, [40, 36, 60], [255, 220, 130], rng);
    tower(x + w * 0.82, y + h * 0.14, w * 0.14, h * 0.42, [40, 36, 60], [255, 220, 130], rng);
    // floodlight masts over the track
    for (const fx of [0.3, 0.68]) {
      cv.vline(x + w * fx, y + h * 0.3, y + h * 0.56, [180, 180, 190]);
      cv.circle(x + w * fx, y + h * 0.28, 3.4, [255, 240, 190]);
      cv.circle(x + w * fx, y + h * 0.28, 7, [255, 240, 190], 50);
      beam(x + w * fx, y + h * 0.3, h * 0.3, 1.1, [255, 244, 190]);
    }
    cv.vline(x + w * 0.9, y + h * 0.3, y + h * 0.55, [220, 220, 220]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)
      cv.rect(x + w * 0.9 + c * 3.4, y + h * 0.3 + r * 3.4, 3.4, 3.4, (r + c) % 2 ? [20, 20, 20] : [255, 255, 255]);
  },
  // Gulf of Finland: a burning cargo ship, containers, a rescue helicopter.
  ship(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.55, [120, 150, 180], [200, 214, 228]);
    cv.circle(x + w * 0.14, y + h * 0.16, 8, [255, 226, 150]);
    cv.vgrad(x, y + h * 0.55, w, h * 0.45, [52, 88, 120], [26, 48, 76]);
    sea(x, y + h * 0.6, w, h * 0.32, [190, 215, 235], rng, 4);
    cv.poly([[x + w * 0.1, y + h * 0.62], [x + w * 0.92, y + h * 0.62], [x + w * 0.86, y + h * 0.8], [x + w * 0.16, y + h * 0.8]], [40, 42, 50]);
    const cols: RGB[] = [[178, 52, 44], [52, 96, 150], [200, 170, 60], [52, 130, 84]];
    for (let i = 0; i < 6; i++) cv.rect(x + w * (0.2 + i * 0.11), y + h * 0.5, w * 0.09, h * 0.12, cols[i % 4]);
    cv.rect(x + w * 0.86, y + h * 0.46, w * 0.05, h * 0.16, [220, 220, 220]);
    flame(x + w * 0.3, y + h * 0.5, 9);
    flame(x + w * 0.42, y + h * 0.52, 7);
    smoke(x + w * 0.36, y + h * 0.42, 7, rng, 7);
    cv.ellipse(x + w * 0.72, y + h * 0.24, 12, 5, [200, 60, 44]);
    cv.line(x + w * 0.6, y + h * 0.22, x + w * 0.84, y + h * 0.22, [60, 60, 64]);
    cv.line(x + w * 0.72, y + h * 0.28, x + w * 0.72, y + h * 0.42, [200, 200, 200]);
    cv.circle(x + w * 0.72, y + h * 0.44, 2.4, [255, 220, 90]);
  },
  // Tehran: a city skyline going dark, a pylon, a lightning bolt.
  power(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h, [30, 34, 58], [96, 84, 110]);
    stars(x, y, w, h * 0.4, 10, rng);
    cv.circle(x + w * 0.84, y + h * 0.2, 7, [232, 230, 210]);
    tower(x + w * 0.03, y + h * 0.4, w * 0.2, h * 0.6, [48, 46, 56], [255, 206, 110], rng, 0.35);
    tower(x + w * 0.27, y + h * 0.3, w * 0.2, h * 0.7, [58, 54, 66], [255, 206, 110], rng, 0.12);
    tower(x + w * 0.51, y + h * 0.46, w * 0.2, h * 0.54, [48, 46, 56], [255, 206, 110], rng, 0.5);
    tower(x + w * 0.75, y + h * 0.36, w * 0.2, h * 0.64, [58, 54, 66], [255, 206, 110], rng, 0.08);
    cv.line(x + w * 0.36, y + h * 0.32, x + w * 0.42, y + h * 0.9, [30, 30, 34]);
    cv.line(x + w * 0.48, y + h * 0.32, x + w * 0.42, y + h * 0.9, [30, 30, 34]);
    cv.line(x + w * 0.33, y + h * 0.4, x + w * 0.51, y + h * 0.4, [30, 30, 34]);
    for (let k = 0; k < 8; k++) {
      const t = k / 7;
      cv.set(x + w * (0.33 + t * 0.18), y + h * (0.4 + Math.sin(t * Math.PI) * 0.06), [255, 220, 90], 220);
    }
    cv.poly([[x + w * 0.66, y + h * 0.1], [x + w * 0.6, y + h * 0.34], [x + w * 0.65, y + h * 0.34], [x + w * 0.6, y + h * 0.52], [x + w * 0.7, y + h * 0.26], [x + w * 0.65, y + h * 0.26]], [255, 220, 80]);
  },
  // Gaza: a damaged street, an aid van on fire, a stretcher carried out.
  gaza(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.6, [210, 170, 120], [240, 214, 170]);
    cv.circle(x + w * 0.8, y + h * 0.18, 9, [255, 226, 150]);
    cv.rect(x, y + h * 0.6, w, h * 0.4, [150, 128, 96]);
    cv.rect(x + w * 0.04, y + h * 0.3, w * 0.26, h * 0.5, [120, 104, 84]);
    cv.poly([[x + w * 0.04, y + h * 0.3], [x + w * 0.17, y + h * 0.42], [x + w * 0.3, y + h * 0.3]], [90, 78, 62]);
    cv.rect(x + w * 0.66, y + h * 0.38, w * 0.3, h * 0.42, [110, 96, 78]);
    cv.rect(x + w * 0.68, y + h * 0.44, w * 0.06, h * 0.08, [40, 40, 44]);
    cv.rect(x + w * 0.34, y + h * 0.62, w * 0.3, h * 0.16, [235, 232, 224]);
    cv.rect(x + w * 0.56, y + h * 0.56, w * 0.1, h * 0.22, [235, 232, 224]);
    cv.circle(x + w * 0.4, y + h * 0.8, 4, [20, 20, 22]);
    cv.circle(x + w * 0.6, y + h * 0.8, 4, [20, 20, 22]);
    cv.rect(x + w * 0.4, y + h * 0.64, w * 0.06, h * 0.06, [178, 52, 44]);
    flame(x + w * 0.5, y + h * 0.6, 7);
    smoke(x + w * 0.5, y + h * 0.52, 6, rng, 6);
    figure(x + w * 0.14, y + h * 0.72, h * 0.13, [44, 96, 150]);
    figure(x + w * 0.86, y + h * 0.72, h * 0.13, [52, 130, 84]);
    cv.rect(x + w * 0.18, y + h * 0.78, w * 0.6, h * 0.03, [150, 120, 80]);
  },
  // Bayelsa: a capsized hull, people in the water, a rescue boat, a life ring.
  boat(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.5, [150, 190, 220], [210, 228, 240]);
    cv.circle(x + w * 0.16, y + h * 0.16, 8, [255, 226, 150]);
    cv.vgrad(x, y + h * 0.5, w, h * 0.5, [52, 96, 130], [26, 56, 92]);
    sea(x, y + h * 0.54, w, h * 0.4, [200, 225, 240], rng, 5);
    cv.poly([[x + w * 0.2, y + h * 0.58], [x + w * 0.8, y + h * 0.58], [x + w * 0.72, y + h * 0.7], [x + w * 0.28, y + h * 0.7]], [120, 70, 40]);
    cv.poly([[x + w * 0.2, y + h * 0.58], [x + w * 0.8, y + h * 0.58], [x + w * 0.76, y + h * 0.52], [x + w * 0.24, y + h * 0.52]], [90, 54, 32]);
    for (let i = 0; i < 4; i++) {
      const px = x + w * (0.3 + i * 0.14), py = y + h * (0.66 + (i % 2) * 0.08);
      cv.circle(px, py, 3.4, [214, 164, 120]);
      cv.circle(px, py + 5, 3, [178, 52, 44]);
    }
    cv.poly([[x + w * 0.06, y + h * 0.78], [x + w * 0.34, y + h * 0.78], [x + w * 0.3, y + h * 0.88], [x + w * 0.1, y + h * 0.88]], [200, 60, 44]);
    figure(x + w * 0.2, y + h * 0.66, h * 0.12, [255, 255, 255]);
    cv.ring(x + w * 0.86, y + h * 0.76, 6, [255, 120, 40]);
    cv.ring(x + w * 0.86, y + h * 0.76, 3.4, [255, 255, 255]);
  },
  // Cikande: a burning factory shed, a fire truck, a hose line.
  fire(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.55, [60, 52, 66], [140, 96, 80]);
    smoke(x + w * 0.5, y + h * 0.3, 9, rng, 9);
    cv.rect(x + w * 0.08, y + h * 0.46, w * 0.84, h * 0.4, [96, 88, 82]);
    cv.poly([[x + w * 0.04, y + h * 0.46], [x + w * 0.5, y + h * 0.26], [x + w * 0.96, y + h * 0.46]], [70, 64, 60]);
    cv.rect(x + w * 0.14, y + h * 0.56, w * 0.1, h * 0.14, [255, 200, 90]);
    cv.rect(x + w * 0.3, y + h * 0.56, w * 0.1, h * 0.14, [255, 200, 90]);
    flame(x + w * 0.3, y + h * 0.5, 12);
    flame(x + w * 0.55, y + h * 0.46, 10);
    flame(x + w * 0.74, y + h * 0.52, 8);
    smoke(x + w * 0.55, y + h * 0.36, 7, rng, 6);
    cv.rect(x + w * 0.06, y + h * 0.78, w * 0.3, h * 0.12, [178, 40, 36]);
    cv.circle(x + w * 0.12, y + h * 0.9, 4, [20, 20, 22]);
    cv.circle(x + w * 0.3, y + h * 0.9, 4, [20, 20, 22]);
    figure(x + w * 0.48, y + h * 0.74, h * 0.13, [220, 170, 40]);
    cv.line(x + w * 0.5, y + h * 0.84, x + w * 0.66, y + h * 0.6, [230, 230, 230]);
    cv.circle(x + w * 0.67, y + h * 0.58, 2.6, [160, 200, 255]);
  },
  // Brasília: a hospital block, a red-cross sign, an ambulance, a stretcher.
  hospital(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h, [180, 210, 225], [232, 238, 240]);
    cv.circle(x + w * 0.84, y + h * 0.16, 8, [255, 226, 150]);
    tower(x + w * 0.06, y + h * 0.3, w * 0.34, h * 0.7, [200, 204, 210], [150, 200, 230], rng, 0.7);
    tower(x + w * 0.6, y + h * 0.4, w * 0.34, h * 0.6, [186, 190, 198], [150, 200, 230], rng, 0.7);
    cv.rect(x + w * 0.44, y + h * 0.12, w * 0.12, h * 0.2, [255, 255, 255]);
    cv.rect(x + w * 0.48, y + h * 0.14, w * 0.04, h * 0.16, [178, 40, 36]);
    cv.rect(x + w * 0.45, y + h * 0.17, w * 0.1, h * 0.04, [178, 40, 36]);
    cv.rect(x + w * 0.42, y + h * 0.72, w * 0.26, h * 0.14, [255, 255, 255]);
    cv.rect(x + w * 0.6, y + h * 0.68, w * 0.1, h * 0.18, [255, 255, 255]);
    cv.rect(x + w * 0.47, y + h * 0.74, w * 0.05, h * 0.05, [178, 40, 36]);
    cv.circle(x + w * 0.47, y + h * 0.88, 4, [20, 20, 22]);
    cv.circle(x + w * 0.64, y + h * 0.88, 4, [20, 20, 22]);
    figure(x + w * 0.2, y + h * 0.74, h * 0.13, [52, 130, 84]);
    figure(x + w * 0.86, y + h * 0.74, h * 0.13, [44, 96, 150]);
  },
  // Seoul: a ministry building, exam desks with laptops, a red resignation stamp.
  seoul(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.5, [140, 170, 205], [215, 225, 235]);
    cv.rect(x, y + h * 0.5, w, h * 0.5, [170, 172, 176]);
    cv.rect(x + w * 0.2, y + h * 0.28, w * 0.6, h * 0.44, [150, 146, 138]);
    for (let i = 0; i < 5; i++) cv.rect(x + w * (0.24 + i * 0.11), y + h * 0.34, w * 0.07, h * 0.3, [220, 216, 208]);
    cv.rect(x + w * 0.14, y + h * 0.72, w * 0.72, h * 0.05, [120, 118, 112]);
    cv.rect(x + w * 0.1, y + h * 0.77, w * 0.8, h * 0.05, [110, 108, 102]);
    cv.rect(x + w * 0.26, y + h * 0.6, w * 0.14, h * 0.1, [90, 86, 80]);
    cv.rect(x + w * 0.6, y + h * 0.6, w * 0.14, h * 0.1, [90, 86, 80]);
    cv.rect(x + w * 0.28, y + h * 0.52, w * 0.1, h * 0.08, [40, 60, 90]);
    cv.rect(x + w * 0.62, y + h * 0.52, w * 0.1, h * 0.08, [40, 60, 90]);
    figure(x + w * 0.86, y + h * 0.56, h * 0.15, [44, 96, 150]);
    cv.ring(x + w * 0.82, y + h * 0.18, 11, [178, 40, 36]);
    cv.line(x + w * 0.76, y + h * 0.14, x + w * 0.88, y + h * 0.22, [178, 40, 36]);
    cv.line(x + w * 0.88, y + h * 0.14, x + w * 0.76, y + h * 0.22, [178, 40, 36]);
  },
  // New Delhi: Himalaya, a plane on the runway, two leaders shaking hands.
  nepal(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h * 0.55, [150, 190, 225], [228, 232, 238]);
    cv.circle(x + w * 0.82, y + h * 0.16, 8, [255, 226, 150]);
    cv.poly([[x, y + h * 0.55], [x + w * 0.25, y + h * 0.22], [x + w * 0.5, y + h * 0.55]], [150, 160, 180]);
    cv.poly([[x + w * 0.2, y + h * 0.28], [x + w * 0.25, y + h * 0.22], [x + w * 0.3, y + h * 0.28]], [255, 255, 255]);
    cv.poly([[x + w * 0.4, y + h * 0.55], [x + w * 0.65, y + h * 0.3], [x + w * 0.9, y + h * 0.55]], [120, 132, 152]);
    cv.poly([[x + w * 0.6, y + h * 0.36], [x + w * 0.65, y + h * 0.3], [x + w * 0.7, y + h * 0.36]], [255, 255, 255]);
    cv.rect(x, y + h * 0.72, w, h * 0.1, [90, 92, 96]);
    cv.ellipse(x + w * 0.5, y + h * 0.62, w * 0.24, h * 0.07, [235, 235, 238]);
    cv.poly([[x + w * 0.68, y + h * 0.58], [x + w * 0.76, y + h * 0.5], [x + w * 0.74, y + h * 0.62]], [200, 60, 50]);
    cv.poly([[x + w * 0.5, y + h * 0.68], [x + w * 0.58, y + h * 0.76], [x + w * 0.5, y + h * 0.72]], [200, 60, 50]);
    for (let i = 0; i < 4; i++) cv.set(x + w * (0.3 + i * 0.13), y + h * 0.77, [255, 220, 90], 220);
    figure(x + w * 0.3, y + h * 0.84, h * 0.12, [178, 52, 44]);
    figure(x + w * 0.44, y + h * 0.84, h * 0.12, [44, 96, 150]);
    flagOnPole(x + w * 0.08, y + h * 0.6, h * 0.24, [[178, 52, 44], [255, 255, 255]]);
    flagOnPole(x + w * 0.88, y + h * 0.6, h * 0.24, [[255, 140, 40], [255, 255, 255], [52, 130, 84]]);
  },
  // NEW in v5 — Vatican lunch: the Paul VI Hall at midday. Arched windows,
  // chandeliers, long white-clothed tables, seated guests, a standing figure
  // in white greeting them, servers carrying trays, steaming dishes.
  lunch(x, y, w, h, seed) {
    const rng = mulberry32(seed);
    cv.vgrad(x, y, w, h, [238, 214, 160], [214, 176, 120]);
    // arched windows along the back wall
    for (let i = 0; i < 5; i++) {
      const wx = x + w * (0.06 + i * 0.19);
      cv.rect(wx, y + h * 0.1, w * 0.11, h * 0.3, [150, 190, 220]);
      cv.ellipse(wx + w * 0.055, y + h * 0.1, w * 0.055, h * 0.07, [150, 190, 220]);
      cv.rect(wx, y + h * 0.1, w * 0.11, 2, [120, 100, 70]);
      cv.rect(wx, y + h * 0.4, w * 0.11, 2, [120, 100, 70]);
      cv.vline(wx + w * 0.055, y + h * 0.06, y + h * 0.4, [120, 100, 70]);
    }
    // chandeliers
    for (const fx of [0.25, 0.75]) {
      cv.vline(x + w * fx, y, y + h * 0.12, [90, 80, 60]);
      cv.ellipse(x + w * fx, y + h * 0.14, w * 0.07, h * 0.035, [255, 226, 150]);
      for (let k = -2; k <= 2; k++) cv.circle(x + w * fx + k * 5, y + h * 0.17, 1.6, [255, 240, 180]);
    }
    // long table with a white cloth
    cv.rect(x + w * 0.04, y + h * 0.62, w * 0.92, h * 0.1, [245, 242, 232]);
    cv.rect(x + w * 0.04, y + h * 0.72, w * 0.92, h * 0.2, [232, 226, 210]);
    // plates, glasses, steaming dishes along the table
    for (let i = 0; i < 7; i++) {
      const px = x + w * (0.1 + i * 0.13);
      cv.ellipse(px, y + h * 0.63, 5, 2.2, [255, 255, 255]);
      cv.circle(px, y + h * 0.63, 2, [200, 170, 90]);
      cv.rect(px + 8, y + h * 0.6, 2.4, 4, [180, 210, 235]);
    }
    cv.ellipse(x + w * 0.5, y + h * 0.6, 9, 3, [220, 200, 160]);
    smoke(x + w * 0.5, y + h * 0.58, 3, rng, 3);
    // seated guests along the front of the table
    const shirts: RGB[] = [[44, 96, 150], [178, 52, 44], [52, 130, 84], [120, 70, 130], [200, 140, 40]];
    for (let i = 0; i < 6; i++) {
      figure(x + w * (0.1 + i * 0.16), y + h * 0.46, h * 0.13, shirts[i % shirts.length]);
    }
    // the Pope in white, standing at the head of the table, arm raised
    const px = x + w * 0.88, py = y + h * 0.44;
    cv.circle(px, py, h * 0.045, [232, 200, 160]);
    cv.rect(px - 4, py + h * 0.05, 8, h * 0.14, [245, 242, 236]);
    cv.line(px + 3, py + h * 0.06, px + 12, py - h * 0.04, [245, 242, 236]);
    // a server with a tray at the far end
    figure(x + w * 0.05, y + h * 0.5, h * 0.12, [30, 30, 34]);
    cv.rect(x + w * 0.02, y + h * 0.44, w * 0.09, h * 0.03, [200, 200, 200]);
    cv.circle(x + w * 0.05, y + h * 0.43, 2, [255, 255, 255]);
  },
};

// ------------------------------------------------------------------ stories
type Tag = "CONFIRMED" | "CLAIM" | "REPORTED" | "PENDING";
const TAG_COL: Record<Tag, RGB> = {
  CONFIRMED: [40, 110, 60],
  CLAIM: [176, 120, 20],
  REPORTED: [40, 80, 150],
  PENDING: [110, 80, 140],
};
const REGION_COL: Record<string, RGB> = {
  EUROPE: [30, 90, 140],
  "MIDDLE EAST": [163, 30, 30],
  "ASIA-PACIFIC": [176, 120, 20],
  AMERICAS: [40, 110, 90],
  AFRICA: [52, 110, 52],
  OCEANIA: [110, 80, 150],
};

type Story = {
  n: number; region: string; place: string; beat: string; tag: Tag;
  art: string; head: string; deck: string; src: string;
  lon: number; lat: number;
};

// All 35 stories happened or were first reported Sunday 22 Nov 2026 (UTC).
// Verified against live reporting (Reuters/AP/AFP/BBC and wires) on 23 Nov:
// COP31's final text was REJECTED on Sunday — no deal, first since 2000;
// 186 drones / 161 downed / Dymer block destroyed; IRGC Bahrain claim vs
// Bahrain denial; Pope's lunch for 1,300; Sparta II still burning Sunday;
// Wembanyama 50 in the 114–91 Spurs win (AP, 22 Nov).
const LEADS: Story[] = [
  {
    n: 1, region: "EUROPE", place: "ANTALYA, TÜRKIYE", beat: "CLIMATE", tag: "CONFIRMED", art: "cop31",
    head: "COP31 ends with no deal — a text that never names fossil fuels is rejected",
    deck: "The EU, UK and island states refuse the ten-page package; President Kurum concedes “there is no agreement on this text.” The first COP to close with no deal since 2000 — and the first to admit 1.5°C will be overshot.",
    src: "Reuters · BBC · The Guardian", lon: 30.7, lat: 36.9,
  },
  {
    n: 2, region: "EUROPE", place: "KYIV REGION, UKRAINE", beat: "WAR", tag: "CONFIRMED", art: "drones",
    head: "Russia fires 186 drones at Ukraine; a Kyiv-region block is destroyed",
    deck: "Air defences down or jam 161 of 186 strike drones, plus three ballistic missiles, in strikes at 18 sites. A five-storey block in Dymer is destroyed: 14 feared trapped, nine evacuated, rescuers still searching.",
    src: "Ukrainian Air Force · Reuters", lon: 30.5, lat: 50.4,
  },
  {
    n: 3, region: "MIDDLE EAST", place: "MANAMA, BAHRAIN", beat: "GULF", tag: "CLAIM", art: "bahrain",
    head: "Iran claims two US radars hit in Bahrain; Bahrain denies it",
    deck: "The IRGC says it destroyed two Patriot radars at Riffa and Awali Sakir. Bahrain says its defences intercepted the attacks; a civilian site caught fire — and two tankers were hit near Hormuz.",
    src: "IRGC · Bahrain Interior Ministry · Al Jazeera", lon: 50.6, lat: 26.2,
  },
];

const PICS: Story[] = [
  { n: 4, region: "ASIA-PACIFIC", place: "HONG KONG", beat: "ELECTIONS", tag: "CONFIRMED", art: "vote",
    head: "Hong Kong elects its Election Committee",
    deck: "856 candidates, 723 seats; polls 09:00–18:00.",
    src: "SCMP", lon: 114.2, lat: 22.3 },
  { n: 5, region: "OCEANIA", place: "WELLINGTON", beat: "CRICKET", tag: "CONFIRMED", art: "cricket",
    head: "India declare on 720/9, a record in New Zealand",
    deck: "Rahul 136, Pant 128, Gill 98; hosts 119/2 at stumps.",
    src: "ESPN", lon: 174.8, lat: -41.3 },
  { n: 6, region: "AMERICAS", place: "LAS VEGAS", beat: "FORMULA 1", tag: "CONFIRMED", art: "f1",
    head: "Verstappen takes the Las Vegas Grand Prix",
    deck: "From pole in 1:37.59; Norris 2nd, Piastri 3rd.",
    src: "FIA", lon: -115.1, lat: 36.2 },
  { n: 7, region: "EUROPE", place: "GULF OF FINLAND", beat: "SEA", tag: "REPORTED", art: "ship",
    head: "Russian cargo ship Sparta II still burning",
    deck: "Struck by drones on Saturday, smouldering Sunday; all 16 crew evacuated.",
    src: "Reuters", lon: 25, lat: 59.5 },
  { n: 8, region: "MIDDLE EAST", place: "TEHRAN, IRAN", beat: "ENERGY", tag: "CONFIRMED", art: "power",
    head: "Iran begins rationing electricity",
    deck: "Rolling cuts of up to two hours a day as gas output falls.",
    src: "Wires", lon: 51.4, lat: 35.7 },
  { n: 9, region: "MIDDLE EAST", place: "GAZA CITY", beat: "CONFLICT", tag: "REPORTED", art: "gaza",
    head: "Four killed as Israeli fire hits Gaza",
    deck: "A drone strike on a food-aid vehicle kills three in Tel al-Hawa.",
    src: "AFP", lon: 34.5, lat: 31.5 },
  { n: 10, region: "AFRICA", place: "BAYELSA, NIGERIA", beat: "DISASTER", tag: "CONFIRMED", art: "boat",
    head: "Mourners' boat capsizes; 24 dead",
    deck: "A funeral-bound boat sinks in Bayelsa; 24 others rescued.",
    src: "AP · Reuters", lon: 6.3, lat: 4.8 },
  { n: 11, region: "ASIA-PACIFIC", place: "CIKANDE, INDONESIA", beat: "FIRE", tag: "CONFIRMED", art: "fire",
    head: "Candy-factory fire in Cikande: 3 dead, 36 missing",
    deck: "Blaze rips through the Banten plant; the search goes on.",
    src: "DetikNews", lon: 106.3, lat: -6.2 },
  { n: 12, region: "AMERICAS", place: "BRASÍLIA, BRAZIL", beat: "HEALTH", tag: "CONFIRMED", art: "hospital",
    head: "Bolsonaro in intensive care in Brasília",
    deck: "Acute bowel obstruction, stable; surgery possible.",
    src: "Reuters", lon: -47.9, lat: -15.8 },
  { n: 13, region: "ASIA-PACIFIC", place: "SEOUL", beat: "POLITICS", tag: "CONFIRMED", art: "seoul",
    head: "Seoul education minister resigns over AI-cheating row",
    deck: "Choi Kyo-jin quits over last-minute CSAT anti-cheating changes.",
    src: "Korea JoongAng Daily", lon: 127, lat: 37.5 },
  { n: 14, region: "ASIA-PACIFIC", place: "NEW DELHI, INDIA", beat: "DIPLOMACY", tag: "CONFIRMED", art: "nepal",
    head: "Nepal PM Shah lands in Delhi on first India visit",
    deck: "Balendra Shah meets Jaishankar on day one; Modi talks Monday.",
    src: "Nepal MFA", lon: 77.2, lat: 28.6 },
  { n: 15, region: "EUROPE", place: "VATICAN CITY", beat: "FAITH", tag: "CONFIRMED", art: "lunch",
    head: "The Pope's lunch: 1,300 poor guests in the Paul VI Hall",
    deck: "Cannelloni, beef stew and ice cream, served by Red Cross volunteers.",
    src: "Vatican News", lon: 12.5, lat: 41.9 },
];

type Brief = { n: number; place: string; text: string; src: string };
const BRIEFS: Brief[] = [
  { n: 16, place: "SAN ANTONIO", text: "Wembanyama scores 50 as Spurs beat Pelicans 114–91.", src: "AP" },
  { n: 17, place: "COPENHAGEN", text: "Denmark expels a Russian attaché over an alleged plot.", src: "Guardian" },
  { n: 18, place: "TALLINN", text: "Estonia to shut five Russia border crossings on 1 Dec.", src: "Reuters" },
  { n: 19, place: "MANILA", text: "A Chinese bomber turns back 170 km from Manila.", src: "AP" },
  { n: 20, place: "TOKYO", text: "Japan poll: a record 52% feel friendly to South Korea.", src: "Yonhap" },
  { n: 21, place: "TAIPEI", text: "Taiwan holds live-fire drills as China steps up patrols.", src: "Reuters" },
  { n: 22, place: "MOGADISHU", text: "Somalia expels the UAE ambassador, recalls its envoy.", src: "Wires" },
  { n: 23, place: "KHARTOUM", text: "Sudan: RSF accused of killing civilians in W. Kordofan.", src: "Wires" },
  { n: 24, place: "NAIROBI", text: "Kenya discharges its last Ebola patient; emergency holds.", src: "Wires" },
  { n: 25, place: "CANBERRA", text: "Marles: a US budget office is 'wrong' on AUKUS subs plan.", src: "Reuters" },
  { n: 26, place: "JERUSALEM", text: "Eisenkot invites Likud to coalition talks in Israel.", src: "Reuters" },
  { n: 27, place: "DOHA", text: "Trump seeks a 'permanent' Iran deal; Doha talks mediators.", src: "Al Jazeera" },
  { n: 28, place: "FUKUSHIMA", text: "Snow strands about 1,500 in a village in Fukushima.", src: "dpa" },
  { n: 29, place: "JOHANNESBURG", text: "Mlambo-Ngcuka dies at 71; S. Africa's first woman deputy president.", src: "Reuters" },
  { n: 30, place: "TURIN", text: "ATP Finals title match later today: Zverev v Alcaraz.", src: "ATP" },
  { n: 31, place: "MOSCOW", text: "Russia says it downed 170 Ukrainian drones overnight.", src: "Reuters" },
  { n: 32, place: "MELBOURNE", text: "Melbourne marks 70 years since the 1956 Olympics opened.", src: "ABC" },
  { n: 33, place: "LONDON", text: "Leeds stun Chelsea 4–1 at Stamford Bridge.", src: "BBC" },
  { n: 34, place: "LIVERPOOL", text: "Liverpool host Man Utd at 16:30 GMT; Pochettino's debut.", src: "Sky Sports" },
  { n: 35, place: "COLUMBUS", text: "Crew beat Messi's 10-man Inter Miami 3–0 in MLS playoffs.", src: "AP" },
];

const NUMBERS: [string, string][] = [
  ["186", "drones fired at Ukraine overnight"],
  ["161", "downed or jammed by air defences"],
  ["720/9", "India's record Test total in NZ"],
  ["50", "Wembanyama points v Pelicans"],
  ["1,300", "poor guests at the Pope's lunch"],
  ["856", "candidates in Hong Kong"],
];

const REGIONS: [string, number][] = [
  ["EUROPE", 10], ["MIDDLE EAST", 5], ["ASIA-PACIFIC", 8],
  ["AMERICAS", 4], ["AFRICA", 5], ["OCEANIA", 3],
];

// ---------------------------------------------------------------------- map
// Coarse world coastline, written from geographic knowledge (equirectangular).
const LAND: [number, number][][] = [
  // North America
  [[-168, 66], [-150, 70], [-135, 69], [-125, 71], [-110, 68], [-95, 69], [-85, 66], [-80, 73], [-75, 62], [-65, 60], [-60, 55], [-55, 47], [-60, 45], [-70, 43], [-75, 38], [-76, 35], [-81, 31], [-84, 30], [-90, 29], [-97, 26], [-100, 22], [-105, 20], [-110, 23], [-114, 28], [-117, 32], [-122, 37], [-124, 42], [-125, 48], [-130, 54], [-140, 60], [-155, 58], [-162, 58], [-168, 66]],
  // Greenland
  [[-58, 64], [-52, 60], [-42, 60], [-32, 68], [-22, 70], [-28, 76], [-45, 78], [-58, 76], [-58, 64]],
  // South America
  [[-78, 8], [-72, 11], [-64, 10], [-58, 8], [-52, 5], [-50, 0], [-44, -3], [-38, -5], [-35, -8], [-38, -15], [-40, -22], [-48, -27], [-55, -34], [-58, -38], [-65, -41], [-68, -48], [-70, -54], [-73, -50], [-73, -40], [-72, -30], [-72, -20], [-75, -15], [-79, -8], [-81, -3], [-80, 2], [-78, 8]],
  // Europe
  [[-10, 36], [-9, 38], [-9, 43], [-4, 44], [-2, 48], [-4, 50], [-1, 51], [2, 51], [4, 53], [7, 54], [8, 57], [10, 58], [12, 56], [18, 56], [21, 55], [24, 58], [27, 59], [30, 60], [30, 62], [25, 65], [20, 66], [15, 64], [10, 62], [6, 58], [5, 60], [0, 58], [-3, 58], [-6, 57], [-8, 54], [-10, 52], [-10, 48], [-9, 43], [-10, 36]],
  // UK
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [-1, 51], [-5, 50]],
  // Africa
  [[-17, 15], [-16, 20], [-15, 27], [-10, 31], [-6, 33], [-1, 35], [6, 37], [10, 37], [11, 34], [15, 32], [20, 32], [25, 32], [30, 31], [32, 31], [34, 28], [36, 24], [38, 20], [40, 15], [43, 12], [48, 11], [51, 11], [48, 6], [44, 0], [41, -4], [40, -10], [37, -15], [35, -20], [33, -26], [30, -30], [26, -34], [20, -35], [17, -32], [15, -27], [13, -18], [12, -8], [13, -2], [9, 4], [4, 6], [-8, 5], [-13, 8], [-16, 11], [-17, 15]],
  // Asia
  [[30, 36], [33, 36], [36, 36], [36, 33], [39, 31], [42, 29], [44, 29], [48, 30], [50, 29], [53, 27], [56, 26], [58, 25], [61, 25], [64, 25], [67, 24], [70, 23], [72, 21], [74, 20], [76, 16], [77, 12], [77, 8], [80, 7], [80, 10], [80, 14], [83, 18], [87, 21], [89, 22], [91, 22], [93, 18], [94, 16], [97, 15], [99, 12], [100, 8], [101, 6], [103, 2], [104, 2], [104, 8], [106, 10], [109, 12], [109, 16], [107, 20], [108, 21], [110, 20], [113, 21], [116, 23], [119, 25], [121, 28], [120, 32], [122, 35], [122, 38], [124, 40], [127, 40], [129, 42], [131, 43], [134, 43], [137, 45], [139, 47], [141, 50], [141, 54], [139, 58], [140, 60], [142, 59], [146, 59], [150, 60], [155, 60], [158, 59], [162, 60], [162, 64], [158, 66], [162, 66], [170, 66], [178, 65], [170, 63], [162, 60], [158, 58], [156, 53], [150, 59], [144, 57], [141, 52], [138, 46], [135, 44], [131, 42], [128, 39], [126, 38], [122, 38], [120, 34], [118, 31], [114, 28], [110, 22], [106, 20], [102, 16], [98, 13], [94, 17], [92, 21], [88, 22], [84, 19], [80, 15], [77, 10], [74, 20], [70, 24], [66, 25], [62, 25], [58, 25], [56, 26], [52, 28], [48, 29], [44, 29], [42, 29], [39, 22], [39, 17], [42, 14], [45, 13], [48, 14], [51, 16], [55, 17], [58, 21], [57, 25], [54, 27], [51, 29], [48, 30], [44, 29], [40, 29], [37, 31], [35, 33], [33, 36], [30, 36]],
  // Australia
  [[113, -22], [114, -28], [115, -32], [117, -35], [121, -34], [125, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [144, -38], [147, -39], [150, -37], [152, -34], [153, -30], [153, -26], [151, -23], [148, -20], [146, -19], [143, -15], [142, -11], [138, -12], [135, -12], [132, -11], [130, -13], [127, -14], [124, -16], [121, -18], [117, -20], [113, -22]],
  // Sumatra / Java
  [[95, 5], [98, 5], [100, 2], [102, -2], [105, -4], [106, -6], [110, -7], [114, -8], [116, -9], [119, -9], [117, -7], [113, -6], [109, -7], [105, -5], [101, -1], [97, 4], [95, 5]],
  // New Guinea
  [[131, -1], [135, -2], [138, -4], [141, -6], [144, -7], [146, -8], [141, -8], [137, -7], [133, -4], [131, -1]],
];

// Label offsets (dx, dy) that decluster the numbered pins on the main map.
const PIN_OFF: [number, number][] = [
  [-40, 18], [24, -20], [34, 2], [20, -18], [-24, -10], [-14, -14],
  [-30, -22], [26, -24], [-38, -10], [-20, 14], [18, 10], [14, -20],
  [16, 16], [2, 24], [-38, 6],
];
// Label offsets inside the EUROPE & MIDDLE EAST inset (pins 1, 2, 3, 7, 8, 9, 15).
const INSET_OFF: Record<number, [number, number]> = {
  1: [-14, -8], 2: [10, -10], 3: [-14, 6], 7: [-12, -8],
  8: [12, -8], 9: [-14, 8], 15: [-10, -12],
};

function drawMap(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [198, 216, 228]);
  const mx0 = x + 4, my0 = y + 4, mw = w - 8, mh = h - 8;
  const px = (lon: number) => mx0 + ((lon + 170) / 360) * mw;
  const py = (lat: number) => my0 + ((78 - lat) / 136) * mh;
  for (let lon = -150; lon <= 150; lon += 30) cv.vline(px(lon), my0, my0 + mh, [255, 255, 255], 70);
  for (let lat = -60; lat <= 60; lat += 30) cv.hline(mx0, mx0 + mw, py(lat), [255, 255, 255], 70);
  for (const poly of LAND) {
    cv.poly(poly.map(([lo, la]) => [px(lo), py(la)] as [number, number]), [232, 214, 170]);
  }
  drawText(px(-155) + 5, py(55), "PACIFIC", "italic", 8, [110, 140, 165]);
  drawText(772, 892, "ATLANTIC", "italic", 8, [110, 140, 165]);
  drawText(888, 904, "INDIAN OCEAN", "italic", 8, [110, 140, 165]);
  const all = [...LEADS, ...PICS];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const [dx, dy] = PIN_OFF[i];
    const dotX = px(s.lon), dotY = py(s.lat);
    const lx = dotX + dx, ly = dotY + dy;
    cv.line(dotX, dotY, lx, ly, RED, 200);
    cv.circle(dotX, dotY, 3, RED);
    cv.circle(lx, ly, 7, RED);
    cv.circle(lx, ly, 7.5, [255, 255, 255], 120);
    const num = String(s.n);
    drawText(lx - textWidth(num, "bold", 8) / 2, ly - 4, num, "bold", 8, [255, 255, 255]);
  }
  // --- EUROPE & MIDDLE EAST — ENLARGED inset, on the map's empty Pacific.
  const ix = x + 4, iy = y + 74, iw = 114, ih = 74;
  cv.rect(ix, iy, iw, ih, [222, 232, 238]);
  cv.rect(ix, iy, iw, 1, LINE); cv.rect(ix, iy + ih - 1, iw, 1, LINE);
  cv.rect(ix, iy, 1, ih, LINE); cv.rect(ix + iw - 1, iy, 1, ih, LINE);
  drawText(ix + 6, iy + 3, "EUROPE & MIDDLE EAST — ENLARGED", "bold", 7, INK);
  const ix0 = ix + 4, iy0 = iy + 14, iww = iw - 8, ihh = ih - 18;
  const ipx = (lon: number) => ix0 + ((lon + 15) / 80) * iww;
  const ipy = (lat: number) => iy0 + ((74 - lat) / 52) * ihh;
  cv.setClip(ix0, iy0, ix0 + iww, iy0 + ihh);
  for (const poly of LAND) {
    cv.poly(poly.map(([lo, la]) => [ipx(lo), ipy(la)] as [number, number]), [232, 214, 170]);
  }
  cv.clearClip();
  for (const n of [1, 2, 3, 7, 8, 9, 15]) {
    const s = all[n - 1];
    const [dx, dy] = INSET_OFF[n];
    const dotX = ipx(s.lon), dotY = ipy(s.lat);
    const lx = dotX + dx, ly = dotY + dy;
    cv.line(dotX, dotY, lx, ly, RED, 200);
    cv.circle(dotX, dotY, 2.4, RED);
    cv.circle(lx, ly, 5.5, RED);
    const num = String(s.n);
    drawText(lx - textWidth(num, "bold", 7) / 2, ly - 3.5, num, "bold", 7, [255, 255, 255]);
  }
}

// -------------------------------------------------------------------- layout
const M = 14;
const X0 = M, X1 = 1024 - M, CW = X1 - X0;

function tagChip(x: number, y: number, tag: Tag, size = 8) {
  const w = textWidth(tag, "bold", size) + 8;
  cv.rect(x - w, y, w, size + 5, TAG_COL[tag]);
  drawText(x - w + 4, y + 2.5, tag, "bold", size, [255, 255, 255]);
  return w;
}
function drawLead(s: Story, x: number, y: number, w: number, seed: number) {
  const artH = 88;
  SCENES[s.art](x, y, w, artH, seed);
  cv.rect(x, y, w, 1, LINE); cv.rect(x, y + artH - 1, w, 1, LINE);
  cv.rect(x, y, 1, artH, LINE); cv.rect(x + w - 1, y, 1, artH, LINE);
  const ky = y + artH + 5;
  drawText(x, ky, String(s.n), "bold", 10, RED);
  drawText(x + textWidth(String(s.n) + " ", "bold", 10), ky, s.place + " · " + s.beat, "bold", 10, INK);
  tagChip(x + w, ky - 1, s.tag, 8);
  const hy = ky + 15;
  drawPara(x, hy, s.head, "bold", 16, INK, w, 19, 2);
  const dy = hy + 40;
  drawPara(x, dy, s.deck, "regular", 10, [52, 48, 40], w, 12.5, 3);
  drawText(x, dy + 39, "Source: " + s.src, "italic", 8, GREY);
}
function drawPic(s: Story, x: number, y: number, w: number, seed: number) {
  const artH = 95;
  SCENES[s.art](x, y, w, artH, seed);
  cv.rect(x, y, w, 1, LINE); cv.rect(x, y + artH - 1, w, 1, LINE);
  cv.rect(x, y, 1, artH, LINE); cv.rect(x + w - 1, y, 1, artH, LINE);
  tagChip(x + w - 2, y + artH - 13, s.tag, 7);
  const ky = y + artH + 4;
  const numW = textWidth(String(s.n) + "  ", "bold", 9);
  drawText(x, ky, String(s.n), "bold", 9, RED);
  drawText(x + numW, ky, s.place + " · ", "bold", 9, INK);
  drawText(x + numW + textWidth(s.place + " · ", "bold", 9), ky, s.beat, "bold", 9, RED);
  const hy = ky + 11;
  drawPara(x, hy, s.head, "bold", 12, INK, w, 14, 2);
  const dy = hy + 30;
  drawPara(x, dy, s.deck, "regular", 9, [52, 48, 40], w, 11, 2);
  drawText(x, dy + 23, "Source: " + s.src, "italic", 8, GREY);
}
// v5: the HOW SURE legend is a thin inline strip, not a big box.
function drawLegendStrip(x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, CREAM);
  cv.rect(x, y, w, 1, LINE); cv.rect(x, y + h - 1, w, 1, LINE);
  const items: [Tag, string][] = [
    ["CONFIRMED", "official, or 2+ outlets"],
    ["CLAIM", "one side's account"],
    ["REPORTED", "carried by the wires"],
    ["PENDING", "not settled at press time"],
  ];
  let total = textWidth("HOW SURE ARE WE?", "bold", 9) + 14;
  for (const [tag, note] of items) {
    total += 10 + 6 + textWidth(tag, "bold", 8) + 4 + textWidth(note, "regular", 8) + 16;
  }
  let cx = x + (w - total) / 2;
  const cy = y + 3.5;
  drawText(cx, cy, "HOW SURE ARE WE?", "bold", 9, INK);
  cx += textWidth("HOW SURE ARE WE?", "bold", 9) + 14;
  for (const [tag, note] of items) {
    cv.rect(cx, cy + 1, 8, 8, TAG_COL[tag]);
    cx += 10;
    drawText(cx, cy, tag, "bold", 8, INK);
    cx += textWidth(tag, "bold", 8) + 4;
    drawText(cx, cy, note, "regular", 8, GREY);
    cx += textWidth(note, "regular", 8) + 16;
  }
}
function drawBriefs(x: number, y: number, w: number, items: Brief[]) {
  const colW = (w - 10) / 2;
  const cols: Brief[][] = [items.slice(0, 10), items.slice(10)];
  let maxY = y;
  for (let c = 0; c < 2; c++) {
    let yy = y;
    for (const b of cols[c]) {
      const bx = x + c * (colW + 10);
      drawText(bx, yy, String(b.n), "bold", 8, RED);
      const tx = bx + 15;
      const lines = wrap(b.place + " — " + b.text + " (" + b.src + ")", "regular", 8, colW - 15);
      const shown = Math.min(lines.length, 2);
      for (let i = 0; i < shown; i++) {
        drawText(tx, yy + i * 9.5, lines[i], "regular", 8, INK);
      }
      yy += shown * 9.5 + 3;
    }
    maxY = Math.max(maxY, yy);
  }
  return maxY;
}

function build() {
  cv.fill(PAPER);
  // --- top strip
  cv.rect(0, 0, W, 15, NAVY);
  drawTextC(512, 3.5, "THE WORLD IN ONE DAY  ·  35 STORIES  ·  6 REGIONS  ·  EVERY ONE DATED SUNDAY 22 NOVEMBER 2026", "bold", 8, [240, 236, 220]);
  // --- masthead
  drawTextC(512, 19, "Sunday 22 November 2026", "bold", 44, INK);
  drawTextC(512, 66, "186 drones over Ukraine  ·  COP31 ends with no deal  ·  Iran's radar claim meets Bahrain's denial", "italic", 13, RED_DK);
  cv.hline(X0, X1, 82, INK);
  // --- numbers strip
  {
    const cellW = CW / 6;
    for (let i = 0; i < NUMBERS.length; i++) {
      const cx = X0 + i * cellW;
      if (i > 0) cv.vline(cx, 86, 128, LINE);
      drawTextC(cx + cellW / 2, 88, NUMBERS[i][0], "bold", 22, RED);
      drawPara(cx + 6, 112, NUMBERS[i][1], "regular", 9, GREY, cellW - 12, 10.5, 2);
    }
  }
  cv.hline(X0, X1, 131, INK);
  // --- region bar
  {
    let rx = X0;
    for (const [name, count] of REGIONS) {
      const segW = (CW * count) / 35;
      cv.rect(rx, 135, segW, 15, REGION_COL[name]);
      drawTextC(rx + segW / 2, 138, name + " " + count, "bold", 9, [255, 255, 255]);
      rx += segW;
    }
  }
  // --- UTC timeline
  cv.rect(X0, 154, CW, 15, NAVY);
  drawText(X0 + 6, 157, "THE DAY IN UTC", "bold", 9, [255, 214, 90]);
  drawText(X0 + 96, 157, "01:00 HK polls open  ·  05:00 Dymer block hit  ·  13:00 Pope's lunch for 1,300  ·  17:30 Nepal PM lands in Delhi  ·  18:00 HK polls close  ·  23:00 Wires read to this hour", "regular", 9, [240, 236, 220]);
  // --- leads (art 88px)
  const leadW = 326;
  const leadX = [X0, X0 + 335, X0 + 670];
  for (let i = 0; i < 3; i++) drawLead(LEADS[i], leadX[i], 173, leadW, 1000 + i * 77);
  // --- picture grid (art 95px, 12 stories, 6 per row)
  drawText(X0, 372, "THE DAY IN PICTURES — 12 MORE STORIES, EACH DRAWN", "bold", 10, INK);
  drawTextR(X1, 372, "EVERY STORY CARRIES A STATUS TAG — SEE THE STRIP BELOW", "bold", 8, GREY);
  cv.hline(X0, X1, 384, INK);
  const picW = 158;
  const picX = [14, 182, 349, 517, 684, 852];
  for (let i = 0; i < 6; i++) drawPic(PICS[i], picX[i], 388, picW, 2000 + i * 53);
  for (let i = 0; i < 6; i++) drawPic(PICS[6 + i], picX[i], 562, picW, 2500 + i * 61);
  // --- HOW SURE legend, thin inline strip
  drawLegendStrip(X0, 737, CW, 15);
  // --- briefs + map
  drawText(X0, 756, "ALSO ON SUNDAY 22 NOVEMBER — 20 MORE STORIES", "bold", 10, INK);
  drawText(648, 756, "WHERE IT HAPPENED — PINS MATCH STORY NUMBERS", "bold", 10, INK);
  cv.hline(X0, 640, 768, INK);
  cv.hline(648, X1, 768, INK);
  const briefEnd = drawBriefs(X0, 772, 626, BRIEFS);
  void briefEnd;
  drawMap(648, 772, 362, 152);
  // --- DATE CHECK
  cv.rect(X0, 928, CW, 56, [255, 250, 238]);
  cv.rect(X0, 928, CW, 2, RED); cv.rect(X0, 982, CW, 2, RED);
  cv.rect(X0, 928, 2, 56, RED); cv.rect(X1 - 2, 928, 2, 56, RED);
  cv.rect(X0 + 6, 933, textWidth("DATE CHECK", "bold", 10) + 12, 15, RED);
  drawText(X0 + 12, 935.5, "DATE CHECK", "bold", 10, [255, 255, 255]);
  drawPara(X0 + 6, 952,
    "Left out on purpose — they happened on an earlier day: 'El Chapo Isidro' captured (Fri 21 Nov) · Peru quake, 1 dead (Fri 20 Nov) · Russia's 400-drone barrage (19–20 Nov) · Shenzhen summit (19 Nov) · ICJ Rohingya verdict (Thu 19 Nov) · Kryvyi Rih double-tap (Fri 20–21 Nov).  NOT YET: the ATP Finals title match · Liverpool v Man Utd · the Dymer rescue toll.",
    "regular", 10, INK, CW - 12, 12, 2);
  // --- sources + certainty
  drawText(X0, 987, "Sources: Reuters · BBC · AP · AFP · Al Jazeera · The Guardian · ESPN · Cricbuzz · Vatican News · Korea JoongAng Daily · Nepal MFA — figures as reported 22 Nov 2026.", "regular", 8, GREY);
  drawText(X0, 996, "CERTAINTY: CONFIRMED = official or 2+ outlets · REPORTED = the day's wires · CLAIM = one side's account · PENDING = not settled at press time. Scenes are drawn illustrations, not photographs.", "regular", 8, GREY);
  // --- bottom strip
  cv.rect(0, 1008, W, 16, NAVY);
  drawText(14, 1011, "THE WORLD IN ONE DAY", "bold", 8, [240, 236, 220]);
  drawTextR(1010, 1011, "SUNDAY 22 NOVEMBER 2026 · ONE PAGE", "bold", 8, [240, 236, 220]);
  // --- paper grain (deterministic): sparse speckles, not per-pixel noise,
  // so the file stays well under the 1 MiB cap
  const rng = mulberry32(20261122);
  for (let i = 0; i < W * H; i++) {
    if (rng() >= 0.045) continue;
    const n = Math.floor(rng() * 17) - 8;
    if (n === 0) continue;
    cv.px[i * 4] = Math.max(0, Math.min(255, cv.px[i * 4] + n));
    cv.px[i * 4 + 1] = Math.max(0, Math.min(255, cv.px[i * 4 + 1] + n));
    cv.px[i * 4 + 2] = Math.max(0, Math.min(255, cv.px[i * 4 + 2] + n));
  }
}

function main() {
  build();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  console.log("wrote entry.png", png.length, "bytes");
}
main();
