// main.ts — "The World in One Page": a one-page newspaper front page summing
// up the world's news of Sunday 22 November 2026.
//
// Everything is drawn in code from data in this file: a cream broadsheet with
// a masthead, a numbers strip, four illustrated lead stories, a pinned world
// map, eight picture stories, twenty-seven briefs, a region count, a UTC
// timeline and a DATE CHECK footer. The type is real Liberation Serif,
// rasterised by genfont.py into fonts.bin (never a hand-drawn font).
//
// Runs on Node 22, standard library only, no network. Deterministic: two
// runs write byte-identical PNGs. Output goes to $MAKEFUN_OUTPUT_DIR (or
// /output when unset).
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [245, 238, 220];
const INK: RGB = [26, 26, 26];
const RED: RGB = [164, 18, 31];
const MUTED: RGB = [107, 98, 87];
const RULE: RGB = [60, 52, 44];
const SEA: RGB = [188, 214, 228];
const LAND: RGB = [203, 213, 164];
const LAND_LINE: RGB = [138, 154, 107];
const GRAT: RGB = [168, 196, 212];
const CARD: RGB = [250, 246, 236];

// ---------------------------------------------------------------- canvas
const px = new Uint8Array(W * H * 3);

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  // a in 0..255; composite the colour over what is already there.
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  if (a >= 255) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; return; }
  const inv = 255 - a;
  px[i] = (c[0] * a + px[i] * inv) / 255 | 0;
  px[i + 1] = (c[1] * a + px[i + 1] * inv) / 255 | 0;
  px[i + 2] = (c[2] * a + px[i + 2] * inv) / 255 | 0;
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
      i += 3;
    }
  }
}

function hline(x0: number, x1: number, y: number, c: RGB): void {
  fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), 1, c);
}

function vline(x: number, y0: number, y1: number, c: RGB): void {
  fillRect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0), c);
}

// Bresenham line, 1px wide.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  let ax = Math.round(x0), ay = Math.round(y0);
  const bx = Math.round(x1), by = Math.round(y1);
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(ax, ay, c);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}

function vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB): void {
  for (let yy = 0; yy < h; yy++) {
    const t = h <= 1 ? 0 : yy / (h - 1);
    const c: RGB = [
      Math.round(top[0] + (bot[0] - top[0]) * t),
      Math.round(top[1] + (bot[1] - top[1]) * t),
      Math.round(top[2] + (bot[2] - top[2]) * t),
    ];
    fillRect(x, y + yy, w, 1, c);
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
    for (let xx = Math.floor(cx - r); xx <= Math.ceil(cx + r); xx++) {
      const dx = xx - cx + 0.5, dy = yy - cy + 0.5;
      if (dx * dx + dy * dy <= r2) setPx(xx, yy, c);
    }
  }
}

function discOutline(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const t = (a * Math.PI) / 180;
    setPx(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), c);
  }
}

// Scanline polygon fill. pts are [x, y] pairs, integer-friendly.
function poly(pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) setPx(x, y, c);
    }
  }
}

function polyStroke(pts: Array<[number, number]>, c: RGB): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    line(a[0], a[1], b[0], b[1], c);
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  circle(x + r, y + r, r, c);
  circle(x + w - r - 1, y + r, r, c);
  circle(x + r, y + h - r - 1, r, c);
  circle(x + w - r - 1, y + h - r - 1, r, c);
}

// ---------------------------------------------------------------- fonts (MFN2, written by genfont.py)
type Glyph = { bx: number; top: number; adv: number; w: number; h: number; off: number };
type Font = { size: number; weight: number; glyphs: Map<number, Glyph> };

const fontCache = new Map<string, Font>();

function loadFonts(): void {
  const d = readFileSync(join(HERE, 'fonts.bin'));
  if (d.toString('ascii', 0, 4) !== 'MFN2') throw new Error('bad fonts.bin magic');
  const n = d.readUInt32LE(4);
  let off = 8;
  for (let i = 0; i < n; i++) {
    const size = d.readUInt16LE(off);
    const weight = d.readUInt8(off + 2);
    const count = d.readUInt16LE(off + 4);
    const tableOff = d.readUInt32LE(off + 6);
    off += 16;
    const glyphs = new Map<number, Glyph>();
    for (let j = 0; j < count; j++) {
      const g = tableOff + j * 20;
      const cp = d.readUInt32LE(g);
      glyphs.set(cp, {
        bx: d.readInt16LE(g + 4),
        top: d.readInt16LE(g + 6),
        adv: d.readUInt16LE(g + 8),
        w: d.readUInt16LE(g + 10),
        h: d.readUInt16LE(g + 12),
        off: d.readUInt32LE(g + 14),
      });
    }
    fontCache.set(`${size}:${weight}`, { size, weight, glyphs });
  }
  // stash the raw bytes for the pixel reader below
  (globalThis as any).__fontBytes = d;
}

function font(size: number, weight: number): Font {
  const f = fontCache.get(`${size}:${weight}`);
  if (!f) throw new Error(`missing font ${size}:${weight}`);
  return f;
}

const GREY = [0, 85, 170, 255];

function textWidth(s: string, f: Font, tracking = 0): number {
  let w = 0;
  for (const ch of s) {
    const g = f.glyphs.get(ch.codePointAt(0)!);
    if (!g) continue;
    w += g.adv + tracking;
  }
  return w > 0 ? w - tracking : 0;
}

function drawText(
  x: number, baselineY: number, s: string, f: Font, c: RGB,
  opts: { align?: 'l' | 'c' | 'r'; tracking?: number } = {},
): number {
  const tracking = opts.tracking ?? 0;
  let cx = x;
  const w = textWidth(s, f, tracking);
  if (opts.align === 'c') cx = x - w / 2;
  else if (opts.align === 'r') cx = x - w;
  const d: Buffer = (globalThis as any).__fontBytes;
  const startX = cx;
  for (const ch of s) {
    const g = f.glyphs.get(ch.codePointAt(0)!);
    if (!g) { cx += 0; continue; }
    if (g.w > 0 && g.h > 0) {
      const rowBytes = ((g.w * 2 + 7) / 8) | 0;
      for (let yy = 0; yy < g.h; yy++) {
        for (let xx = 0; xx < g.w; xx++) {
          const byte = d[g.off + yy * rowBytes + ((xx * 2) / 8 | 0)];
          const v = (byte >> (6 - ((xx * 2) % 8))) & 3;
          if (v) blendPx(Math.round(cx) + g.bx + xx, Math.round(baselineY) + g.top + yy, c, GREY[v]);
        }
      }
    }
    cx += g.adv + tracking;
  }
  return startX + w;
}

function wrapText(s: string, f: Font, maxW: number, tracking = 0): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? cur + ' ' + word : word;
    if (textWidth(trial, f, tracking) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- PNG output
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc32(crcData));
  return out;
}

function encodePNG(): Buffer {
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(idat)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

// ---------------------------------------------------------------- world map
// Hand-drawn simplified coastlines as [lon, lat] polygons, equirectangular.
// The Arctic coast of Eurasia is drawn with its real bays and peninsulas
// (Taymyr, Yamal, Chukotka) instead of a straight line.
type LonLat = [number, number];

const NORTH_AMERICA: LonLat[] = [
  [-168, 66], [-165, 60], [-158, 58], [-152, 60], [-145, 60], [-140, 60],
  [-135, 58], [-130, 54], [-125, 49], [-124, 42], [-120, 34], [-114, 29],
  [-110, 24], [-105, 20], [-97, 16], [-94, 17], [-90, 14], [-86, 12],
  [-83, 9], [-80, 8], [-77, 7], [-79, 9], [-82, 16], [-86, 16], [-88, 18],
  [-90, 21], [-91, 19], [-96, 19], [-97, 22], [-97, 26], [-93, 30],
  [-89, 30], [-84, 30], [-81, 26], [-80, 32], [-76, 35], [-74, 39],
  [-70, 42], [-68, 45], [-65, 45], [-60, 47], [-65, 50], [-60, 52],
  [-55, 52], [-60, 55], [-65, 58], [-68, 58], [-72, 62], [-78, 62],
  [-82, 66], [-85, 66], [-90, 69], [-95, 69], [-110, 68], [-125, 70],
  [-140, 70], [-155, 71], [-165, 68],
];

const GREENLAND: LonLat[] = [
  [-45, 60], [-40, 65], [-30, 68], [-22, 70], [-25, 76], [-35, 80],
  [-50, 80], [-58, 76], [-55, 72], [-52, 68], [-48, 64],
];

const SOUTH_AMERICA: LonLat[] = [
  [-77, 7], [-80, 4], [-81, -2], [-81, -6], [-77, -12], [-72, -18],
  [-70, -20], [-70, -25], [-70, -30], [-72, -37], [-73, -44], [-74, -50],
  [-70, -54], [-66, -55], [-68, -52], [-65, -45], [-62, -41], [-58, -35],
  [-52, -32], [-48, -28], [-41, -23], [-39, -17], [-35, -9], [-35, -6],
  [-40, -3], [-44, -2], [-50, 0], [-53, 4], [-58, 6], [-62, 9],
  [-68, 11], [-72, 12],
];

const AFRICA: LonLat[] = [
  [-6, 35], [-10, 31], [-15, 27], [-17, 21], [-17, 15], [-15, 12],
  [-13, 8], [-8, 5], [-4, 5], [0, 6], [6, 4], [9, 4], [9, 0], [12, -4],
  [13, -10], [12, -17], [14, -22], [16, -28], [18, -33], [20, -35],
  [26, -34], [32, -29], [36, -24], [40, -18], [40, -12], [41, -10],
  [46, -2], [51, 2], [51, 11], [48, 11], [44, 11], [40, 15], [38, 18],
  [37, 22], [35, 24], [33, 27], [32, 31], [30, 32], [22, 33], [15, 32],
  [10, 34], [8, 37], [3, 37],
];

const EURASIA: LonLat[] = [
  // Iberia up the Atlantic coast, then east along the Arctic.
  [-9, 37], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [-1, 49], [0, 51],
  [3, 53], [5, 53], [8, 55], [8, 57], [10, 59], [5, 60], [5, 62],
  [10, 64], [13, 66], [16, 68], [18, 69], [22, 70], [26, 71], [30, 70],
  [32, 70], [35, 68], [40, 67], [44, 68], [48, 68], [52, 68], [55, 69],
  [58, 69], [62, 70], [66, 71], [68, 73], [72, 72], [74, 73], [77, 74],
  [80, 73], [84, 74], [88, 75], [92, 76], [95, 76], [98, 76], [102, 77],
  [105, 78], [108, 77], [111, 74], [114, 73], [118, 72], [122, 72],
  [126, 71], [130, 71], [135, 72], [140, 72], [145, 72], [150, 70],
  [155, 69], [160, 69], [162, 66], [162, 64], [158, 60], [156, 55],
  [158, 52], [160, 56], [162, 60], [170, 66], [178, 66], [178, 64],
  [173, 64], [170, 60], [163, 60], [158, 56], [156, 52], [150, 59],
  [142, 59], [141, 55], [141, 50], [140, 46], [139, 42], [137, 38],
  [135, 35], [132, 33], [130, 32], [127, 35], [126, 38], [122, 39],
  [120, 35], [122, 31], [121, 28], [120, 24], [118, 25], [114, 22],
  [110, 20], [108, 18], [106, 10], [105, 9], [103, 8], [100, 7],
  [98, 10], [97, 15], [94, 17], [92, 21], [91, 22], [89, 22], [86, 20],
  [84, 19], [82, 16], [80, 13], [80, 10], [77, 8], [75, 10], [73, 16],
  [72, 20], [70, 21], [68, 23], [66, 25], [62, 25], [60, 25], [58, 26],
  [56, 27], [54, 27], [52, 28], [50, 29], [48, 30], [50, 29],
  // Arabian Peninsula: down the Gulf coast, round to the Red Sea.
  [57, 25], [59, 23], [58, 21], [55, 17], [52, 15], [48, 14], [45, 13],
  [43, 12], [41, 16], [39, 20], [37, 24], [35, 28], [34, 28],
  // Levant and the Mediterranean, west to Iberia.
  [35, 31], [36, 36], [33, 36], [30, 36], [27, 37], [26, 38], [23, 36],
  [22, 37], [21, 39], [19, 40], [19, 42], [18, 40], [16, 39], [16, 38],
  [15, 40], [14, 41], [12, 42], [10, 44], [8, 44], [6, 43], [3, 42],
  [0, 39], [-1, 38], [0, 40], [2, 41], [3, 42], [-2, 37], [-6, 36],
];

const AUSTRALIA: LonLat[] = [
  [114, -22], [114, -30], [115, -33], [118, -35], [124, -33], [129, -32],
  [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37],
  [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11],
  [140, -17], [136, -15], [135, -12], [132, -12], [130, -13], [127, -14],
  [124, -15], [122, -17], [118, -20],
];

const UK: LonLat[] = [
  [-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51], [-3, 50],
];
const IRELAND: LonLat[] = [
  [-10, 52], [-8, 51], [-6, 52], [-6, 54], [-8, 55], [-10, 54],
];
const ICELAND: LonLat[] = [
  [-22, 64], [-18, 63], [-14, 64], [-18, 66], [-24, 66],
];
const MADAGASCAR: LonLat[] = [
  [44, -16], [47, -15], [50, -16], [49, -20], [47, -24], [44, -25], [43, -21],
];
const JAPAN: LonLat[] = [
  [130, 31], [132, 33], [135, 34], [137, 35], [139, 36], [140, 38],
  [141, 41], [143, 42], [141, 44], [140, 43], [139, 40], [137, 38],
  [135, 35], [132, 33],
];
const SUMATRA: LonLat[] = [[95, 5], [100, 0], [104, -3], [106, -6], [100, -2]];
const BORNEO: LonLat[] = [
  [109, 1], [113, 4], [117, 6], [119, 1], [117, -3], [112, -4], [109, 0],
];
const JAVA: LonLat[] = [[105, -6], [110, -7], [114, -8], [114, -7], [108, -6]];
const SULAWESI: LonLat[] = [[119, 0], [121, 1], [123, 0], [120, -3]];
const NEW_GUINEA: LonLat[] = [
  [131, -1], [136, -2], [141, -3], [146, -6], [150, -9], [146, -8],
  [141, -8], [136, -5],
];
const PHILIPPINES: LonLat[] = [
  [120, 18], [122, 18], [122, 14], [121, 11], [122, 10], [120, 13],
];
const TAIWAN: LonLat[] = [[120, 22], [121, 25], [120, 23]];
const SRI_LANKA: LonLat[] = [[80, 6], [81, 8], [80, 9], [79, 8]];
const NEW_ZEALAND: LonLat[] = [
  [167, -45], [170, -42], [174, -39], [178, -38], [175, -40], [172, -43],
];
const CUBA: LonLat[] = [[-85, 23], [-80, 23], [-75, 20], [-80, 22]];

const LAND_POLYS: LonLat[][] = [
  NORTH_AMERICA, GREENLAND, SOUTH_AMERICA, AFRICA, EURASIA, AUSTRALIA,
  UK, IRELAND, ICELAND, MADAGASCAR, JAPAN, SUMATRA, BORNEO, JAVA, SULAWESI,
  NEW_GUINEA, PHILIPPINES, TAIWAN, SRI_LANKA, NEW_ZEALAND, CUBA,
];

// Inland seas, drawn back over the land in sea colour.
const BLACK_SEA: LonLat[] = [
  [28, 41], [33, 42], [38, 42], [40, 41], [36, 44], [33, 45], [30, 46], [28, 44],
];
const CASPIAN: LonLat[] = [
  [47, 37], [50, 40], [52, 44], [50, 47], [47, 47], [47, 44],
];
const GREAT_LAKES: LonLat[] = [
  [-88, 47], [-84, 46], [-82, 43], [-79, 43], [-76, 44], [-79, 46], [-84, 46], [-88, 48],
];

const MAP = { x: 20, y: 0, w: 984, h: 128, lon0: -170, lon1: 190, latTop: 80, latBot: -58 };

function proj(lon: number, lat: number): [number, number] {
  const x = MAP.x + ((lon - MAP.lon0) / (MAP.lon1 - MAP.lon0)) * MAP.w;
  const y = MAP.y + ((MAP.latTop - lat) / (MAP.latTop - MAP.latBot)) * MAP.h;
  return [x, y];
}

function drawMap(): void {
  fillRect(MAP.x, MAP.y, MAP.w, MAP.h, SEA);
  // Graticule, every 30 degrees.
  for (let lon = -150; lon <= 180; lon += 30) {
    const [x] = proj(lon, 0);
    vline(Math.round(x), MAP.y, MAP.y + MAP.h, GRAT);
  }
  for (let lat = 60; lat >= -30; lat -= 30) {
    const [, y] = proj(0, lat);
    hline(MAP.x, MAP.x + MAP.w, Math.round(y), GRAT);
  }
  for (const polyPts of LAND_POLYS) {
    const pts = polyPts.map(([lo, la]) => proj(lo, la) as [number, number]);
    poly(pts, LAND);
    polyStroke(pts, LAND_LINE);
  }
  for (const sea of [BLACK_SEA, CASPIAN, GREAT_LAKES]) {
    const pts = sea.map(([lo, la]) => proj(lo, la) as [number, number]);
    poly(pts, SEA);
    polyStroke(pts, LAND_LINE);
  }
  // Frame.
  fillRect(MAP.x, MAP.y, MAP.w, 1, RULE);
  fillRect(MAP.x, MAP.y + MAP.h - 1, MAP.w, 1, RULE);
  fillRect(MAP.x, MAP.y, 1, MAP.h, RULE);
  fillRect(MAP.x + MAP.w - 1, MAP.y, 1, MAP.h, RULE);
}

// Pins: story number, place lon/lat, and the badge offset in px from the dot.
// Crowded places (Gulf, Levant, US east coast, Kyiv, Brussels, India) get
// leader lines: the dot marks the true place, the number sits clear of it.
type Pin = { n: number; lon: number; lat: number; dx: number; dy: number };
const PINS: Pin[] = [
  { n: 1, lon: 51, lat: 26, dx: 31, dy: -43 },
  { n: 2, lon: 30.5, lat: 50.4, dx: 0, dy: -20 },
  { n: 3, lon: 21, lat: 52.2, dx: -12, dy: 26 },
  { n: 4, lon: -107.5, lat: 25, dx: 0, dy: -15 },
  { n: 5, lon: 4.3, lat: 50.8, dx: -8, dy: -20 },
  { n: 6, lon: 39, lat: 14.5, dx: 0, dy: -14 },
  { n: 7, lon: 25, lat: 59, dx: 32, dy: -12 },
  { n: 8, lon: 12.6, lat: 55.7, dx: 11, dy: 7 },
  { n: 9, lon: 2.3, lat: 48.9, dx: -29, dy: 23 },
  { n: 10, lon: -47.9, lat: -15.8, dx: 0, dy: -14 },
  { n: 11, lon: 139.7, lat: 35.7, dx: 0, dy: -14 },
  { n: 12, lon: -3, lat: 53.4, dx: -22, dy: -17 },
  { n: 13, lon: -77, lat: 39, dx: 52, dy: -19 },
  { n: 14, lon: 51.4, lat: 35.7, dx: 33, dy: -12 },
  { n: 15, lon: 30.5, lat: 50.4, dx: -28, dy: -21 },
  { n: 16, lon: 30.5, lat: 50.4, dx: 30, dy: -4 },
  { n: 17, lon: 35.5, lat: 33.9, dx: -37, dy: -3 },
  { n: 18, lon: 46.7, lat: 24.6, dx: -12, dy: 36 },
  { n: 19, lon: 34.4, lat: 31.4, dx: -19, dy: 34 },
  { n: 20, lon: 34.8, lat: 32.1, dx: -32, dy: 17 },
  { n: 21, lon: 44.4, lat: 33.3, dx: 46, dy: 11 },
  { n: 22, lon: 47.8, lat: 30.5, dx: 25, dy: 33 },
  { n: 23, lon: -77, lat: 39, dx: 54, dy: -1 },
  { n: 24, lon: -77, lat: 39, dx: 54, dy: 17 },
  { n: 25, lon: -77, lat: 39, dx: 50, dy: 35 },
  { n: 26, lon: -77, lat: 39, dx: 38, dy: 51 },
  { n: 27, lon: 116.4, lat: 39.9, dx: 0, dy: -14 },
  { n: 28, lon: 4.3, lat: 50.8, dx: 24, dy: -20 },
  { n: 29, lon: 30.7, lat: 36.9, dx: -17, dy: -23 },
  { n: 30, lon: 85.1, lat: 25.6, dx: -23, dy: -15 },
  { n: 31, lon: 85.3, lat: 23.3, dx: 4, dy: 25 },
  { n: 32, lon: 93.9, lat: 24.8, dx: 23, dy: -14 },
  { n: 33, lon: -9.1, lat: 38.7, dx: -17, dy: 9 },
  { n: 34, lon: -6.3, lat: 53.3, dx: -31, dy: -9 },
  { n: 35, lon: -3.7, lat: 40.4, dx: 3, dy: 21 },
  { n: 36, lon: 151.2, lat: -33.9, dx: 0, dy: -14 },
  { n: 37, lon: -80.2, lat: 25.8, dx: 27, dy: 27 },
  { n: 38, lon: 105.8, lat: 21, dx: 16, dy: 14 },
  { n: 39, lon: -74, lat: 40.7, dx: 30, dy: -30 },
];

function drawPins(): void {
  const f11 = font(11, 1);
  // Leader lines first, then dots, then badges on top.
  for (const p of PINS) {
    const [x, y] = proj(p.lon, p.lat);
    if (p.dx !== 0 || p.dy !== 0) line(x, y, x + p.dx, y + p.dy, [90, 60, 50]);
  }
  for (const p of PINS) {
    const [x, y] = proj(p.lon, p.lat);
    circle(x, y, 2, RED);
    discOutline(x, y, 2, [255, 255, 255]);
  }
  for (const p of PINS) {
    const [x, y] = proj(p.lon, p.lat);
    const bx = x + p.dx, by = y + p.dy;
    const label = String(p.n);
    const r = 7;
    circle(bx, by, r, RED);
    discOutline(bx, by, r, [255, 255, 255]);
    const tw = textWidth(label, f11);
    drawText(bx - tw / 2, by + 4, label, f11, [255, 255, 255]);
  }
}

// ---------------------------------------------------------------- the news
// Every story below happened, or was first reported, on Sunday 22 November
// 2026, checked against Reuters, AP, BBC and other wire reporting of the day.
// Events from earlier in the week (Shenzhen summit, ICJ ruling, Peru quake)
// are named only in the DATE CHECK footer, as not today's news.
type Story = { n: number; head: string; deck: string; src: string };

const LEADS: Story[] = [
  {
    n: 1,
    head: 'Iran says it fired on a US jet; Washington denies it',
    deck: 'Tehran claims its forces shot at an F-16; the US says it did not happen. Bahrain reports an Iranian strike set a civilian site ablaze.',
    src: 'Reuters / AP',
  },
  {
    n: 2,
    head: "Russia's overnight barrage: 400 drones, 110 missiles",
    deck: "One of the war's biggest air attacks. Two killed and 60 wounded in Kryvyi Rih, President Zelenskyy's home city.",
    src: 'AP / Reuters',
  },
  {
    n: 3,
    head: 'Missiles cross into Poland; Finland holds Baltic curbs',
    deck: 'Warsaw calls the incursion a provocation. Helsinki keeps its Gulf of Finland limits after Saturday\'s drone attack on the Sparta II.',
    src: 'Reuters',
  },
  {
    n: 4,
    head: "Mexico captures cartel boss 'El Chapo Isidro'",
    deck: 'Troops seize the FBI most-wanted drug lord, accused of 20 years of smuggling into the US. Gunmen hit back across Sinaloa; 11 are killed.',
    src: 'AP / Reuters',
  },
];

const PICTURES: Story[] = [
  {
    n: 5,
    head: 'EU and Indonesia sign trade deal for 730m people',
    deck: 'Brussels pact cuts tariffs; EU exports seen up ~40% in 15 years.',
    src: '',
  },
  {
    n: 6,
    head: 'Troops mass on the Ethiopia–Eritrea border',
    deck: 'Both sides build up forces; 200 ex-Tigray fighters surrender.',
    src: '',
  },
  {
    n: 7,
    head: 'Estonia to shut its border with Russia',
    deck: 'Tallinn acts amid Baltic tensions; Moscow calls it a new Iron Curtain.',
    src: '',
  },
  {
    n: 8,
    head: 'Denmark says it foiled a Russian-backed murder plot',
    deck: 'Target was a US-Ukrainian artist, officials say.',
    src: '',
  },
  {
    n: 9,
    head: 'France seeks UN action over Myanmar',
    deck: 'France asks the UN to act after Myanmar rejects the ruling.',
    src: '',
  },
  {
    n: 10,
    head: 'Bolsonaro in intensive care',
    deck: "Brazil's jailed ex-president in ICU with a bowel obstruction.",
    src: '',
  },
  {
    n: 11,
    head: "Japan's economy shrinks",
    deck: 'GDP down 0.1% annualised in July–September.',
    src: '',
  },
  {
    n: 12,
    head: 'Liverpool host Manchester United tonight',
    deck: 'Anfield, 16:30 GMT. Hull v Brighton at 14:00.',
    src: '',
  },
];

// Briefs: one line each, number + headline + source.
const BRIEFS: Array<[number, string, string]> = [
  [13, "Trump calls China's nuclear build-up 'rapid and concerning'", 'Reuters'],
  [14, 'Trump: Iran deal could last 20 years', 'Times of India'],
  [15, 'Melania Trump urges more Ukraine ceasefires before Christmas', 'AP'],
  [16, 'Zelenskyy floats new peace talks at the G20 summit', 'Reuters'],
  [17, 'US and France draft UN text for a post-UNIFIL Lebanon', 'Reuters'],
  [18, 'Saudi coalition downs three Houthi missiles aimed at Riyadh', 'AP'],
  [19, 'Four Palestinians killed in Gaza ceasefire breaches, 14 hurt', 'AP'],
  [20, 'Israel in talks on defence deals worth up to $1.1bn', 'Reuters'],
  [21, 'Iraq forces deploy in an Iran-backed militia stronghold', 'Reuters'],
  [22, 'Basra power-plant fire kills four, injures 35', 'Reuters'],
  [23, 'US airlines warned of al-Qaeda-linked threat before Thanksgiving', 'AP'],
  [24, 'FBI probes hack of a key criminal-justice database', 'AP'],
  [25, 'Trump orders federal contractors to answer Congress', 'Reuters'],
  [26, 'Bessent: no new curbs needed on Nvidia chips for China', 'Reuters'],
  [27, 'US approved ~900,000 AI chip shipments to China in six months', 'AP'],
  [28, 'EU proposes a Big Tech tax; budget cuts floated for 2028–34', 'Reuters'],
  [29, 'COP31: AI pledge fails to draw big US tech firms', 'Reuters'],
  [30, 'Modi opens the Nirish Setu bridge in Bihar', 'Times of India'],
  [31, 'Cyclone Akvan: 14 flights cancelled at Ranchi', 'Times of India'],
  [32, 'Manipur: 11 die after drinking adulterated alcohol', 'Reuters'],
  [33, 'Lisbon: thousands march as living costs bite', 'Reuters'],
  [34, 'Ireland beat South Africa, who still reach the top', 'Reuters'],
  [35, 'Nadal voted onto the Real Madrid board', 'Reuters'],
  [36, 'Cummins keeps the Australia Test captaincy', 'Cricket Australia'],
  [37, 'US tipped to host the 2028 Copa America', 'Reuters'],
  [38, 'Vietnam scraps the death penalty for drug smuggling', 'AP'],
  [39, 'Gupta jailed 19 years over the Pannun murder plot', 'Reuters'],
];

const STRIP: Array<[string, string]> = [
  ['39', 'STORIES TODAY'],
  ['400', 'DRONES AT UKRAINE'],
  ['110', 'MISSILES AT UKRAINE'],
  ['730M', 'PEOPLE IN EU PACT'],
  ['11', 'KILLED IN SINALOA'],
  ['900K', 'AI CHIPS TO CHINA'],
];

const REGIONS: Array<[string, number]> = [
  ['EUROPE', 13], ['MIDDLE EAST', 8], ['ASIA', 8],
  ['AMERICAS', 8], ['AFRICA', 1], ['OCEANIA', 1],
];

const TIMELINE: Array<[string, string]> = [
  ['OVERNIGHT', "Russia's barrage"],
  ['MORNING', 'EU–Indonesia deal'],
  ['MIDDAY', 'Cartel boss caught'],
  ['AFTERNOON', 'Hull v Brighton'],
  ['EVENING', 'Liverpool v Man Utd'],
];

// ---------------------------------------------------------------- illustrations
// Every scene is drawn from primitives: gradients, layered silhouettes,
// windows, waves, smoke and sun. No image is copied in.

function starburst(cx: number, cy: number, r: number, c: RGB): void {
  // An explosion: solid core, rays, and a few sparks.
  circle(cx, cy, r * 0.55, c);
  for (let a = 0; a < 360; a += 30) {
    const t = (a * Math.PI) / 180;
    line(cx, cy, cx + Math.cos(t) * r, cy + Math.sin(t) * r, c);
  }
  circle(cx, cy, r * 0.3, [255, 220, 120]);
}

function smoke(x: number, y: number, puffs: number, c: RGB): void {
  for (let i = 0; i < puffs; i++) {
    circle(x + i * 5 - puffs * 2, y - i * 6, 4 + i, c);
  }
}

function waveRow(x: number, y: number, w: number, c: RGB): void {
  for (let xx = x + 4; xx < x + w - 4; xx += 14) {
    line(xx, y, xx + 7, y - 2, c);
    line(xx + 7, y - 2, xx + 13, y, c);
  }
}

function gulls(x: number, y: number, c: RGB): void {
  line(x, y, x + 4, y - 3, c); line(x + 4, y - 3, x + 8, y, c);
  line(x + 12, y + 4, x + 15, y + 1, c); line(x + 15, y + 1, x + 18, y + 4, c);
}

// 1 — The Gulf at dusk: tanker, jet, missile trail, low sun.
function artGulf(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, Math.round(h * 0.62), [226, 138, 74], [122, 74, 110]);
  fillRect(x, y + Math.round(h * 0.62), w, h - Math.round(h * 0.62), [32, 62, 96]);
  circle(x + w - 26, y + 26, 13, [255, 214, 130]);
  circle(x + w - 26, y + 26, 17, [255, 214, 130]);
  gulls(x + 14, y + 20, [40, 30, 40]);
  // Jet, top left, with a dashed missile trail behind it.
  poly([[x + 8, y + 34], [x + 30, y + 30], [x + 34, y + 33], [x + 12, y + 40]], [30, 28, 34]);
  for (let i = 0; i < 5; i++) line(x + 38 + i * 9, y + 34, x + 44 + i * 9, y + 34, [255, 240, 200]);
  circle(x + 84, y + 36, 3, [255, 120, 60]);
  // Tanker: dark hull, stacked containers, funnel, smoke.
  fillRect(x + 16, y + 84, w - 32, 16, [24, 26, 32]);
  poly([[x + 16, y + 84], [x + 10, y + 100], [x + w - 10, y + 100], [x + w - 16, y + 84]], [18, 20, 26]);
  fillRect(x + 24, y + 70, 18, 14, [150, 60, 40]);
  fillRect(x + 44, y + 70, 18, 14, [90, 110, 130]);
  fillRect(x + 64, y + 70, 18, 14, [190, 170, 90]);
  fillRect(x + 84, y + 62, 10, 22, [60, 60, 64]);
  smoke(x + 92, y + 56, 3, [200, 200, 205]);
  // Orange reflection under the sun on the water.
  for (let i = 0; i < 4; i++) hline(x + w - 46 + i * 3, x + w - 14 - i * 3, y + Math.round(h * 0.62) + 8 + i * 6, [255, 190, 110]);
  waveRow(x + 6, y + h - 18, w - 12, [150, 190, 220]);
  waveRow(x + 20, y + h - 8, w - 40, [120, 165, 200]);
}

// 2 — Kyiv at night: skyline, lit windows, drone bursts, smoke.
function artKyiv(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, h, [10, 16, 44], [30, 42, 84]);
  for (const [sx, sy] of [[14, 14], [34, 26], [58, 10], [80, 22], [102, 12], [118, 30], [44, 38], [92, 40]] as Array<[number, number]>) {
    circle(x + sx, y + sy, 1, [255, 255, 220]);
  }
  circle(x + w - 24, y + 20, 10, [240, 232, 200]);
  circle(x + w - 28, y + 17, 8, [10, 16, 44]);
  // Skyline with lit windows.
  const base = y + h;
  const blocks: Array<[number, number, number]> = [[0, 46, 34], [34, 34, 52], [64, 56, 30], [92, 40, 44]];
  for (const [bx, bw, bh] of blocks) {
    fillRect(x + bx, base - bh, bw, bh, [14, 18, 34]);
    for (let wy = base - bh + 6; wy < base - 6; wy += 9) {
      for (let wx = x + bx + 5; wx < x + bx + bw - 4; wx += 9) {
        if ((wx * 7 + wy * 13) % 3 !== 0) fillRect(wx, wy, 3, 4, [255, 200, 90]);
      }
    }
  }
  // Drone bursts and smoke over the city.
  starburst(x + 30, y + 30, 12, [255, 140, 50]);
  starburst(x + 88, y + 44, 9, [255, 170, 70]);
  smoke(x + 30, y + 22, 3, [90, 90, 110]);
  smoke(x + 88, y + 36, 2, [90, 90, 110]);
  // Two drone silhouettes with red lights.
  poly([[x + 58, y + 18], [x + 66, y + 16], [x + 62, y + 21]], [8, 8, 12]);
  circle(x + 62, y + 18, 1, [255, 60, 40]);
  poly([[x + 102, y + 26], [x + 109, y + 24], [x + 106, y + 29]], [8, 8, 12]);
  circle(x + 106, y + 26, 1, [255, 60, 40]);
}

// 3 — The Baltic: sanctioned cargo ship, fire on deck, drone above.
function artBaltic(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, Math.round(h * 0.55), [178, 198, 214], [220, 226, 228]);
  circle(x + 22, y + 22, 12, [245, 238, 210]);
  fillRect(x, y + Math.round(h * 0.55), w, h - Math.round(h * 0.55), [74, 112, 142]);
  // Distant coast.
  poly([[x, y + 72], [x + 30, y + 66], [x + 60, y + 71], [x + 90, y + 67], [x + w, y + 72], [x + w, y + 78], [x, y + 78]], [96, 128, 110]);
  // Quadcopter drone.
  fillRect(x + 78, y + 30, 12, 4, [30, 30, 36]);
  line(x + 72, y + 28, x + 96, y + 28, [30, 30, 36]);
  circle(x + 72, y + 28, 2, [30, 30, 36]);
  circle(x + 96, y + 28, 2, [30, 30, 36]);
  line(x + 84, y + 34, x + 84, y + 44, [30, 30, 36]);
  // Cargo ship with containers and a fire on deck.
  fillRect(x + 14, y + 92, w - 28, 14, [52, 58, 64]);
  poly([[x + 14, y + 92], [x + 8, y + 106], [x + w - 8, y + 106], [x + w - 14, y + 92]], [38, 42, 48]);
  fillRect(x + 22, y + 78, 16, 14, [140, 90, 60]);
  fillRect(x + 40, y + 78, 16, 14, [110, 130, 120]);
  fillRect(x + 58, y + 78, 16, 14, [170, 150, 90]);
  fillRect(x + 92, y + 74, 8, 18, [80, 80, 84]);
  starburst(x + 50, y + 74, 10, [255, 150, 50]);
  smoke(x + 50, y + 64, 3, [120, 120, 125]);
  waveRow(x + 6, y + h - 14, w - 12, [190, 215, 230]);
  waveRow(x + 24, y + h - 6, w - 48, [160, 195, 215]);
}

// 4 — Sinaloa desert: layered mountains, road, cactus, low sun.
function artDesert(x: number, y: number, w: number, h: number): void {
  vgrad(x, y, w, Math.round(h * 0.6), [244, 196, 120], [232, 150, 90]);
  circle(x + w - 28, y + 24, 14, [255, 236, 170]);
  for (let a = 0; a < 360; a += 30) {
    const t = (a * Math.PI) / 180;
    line(x + w - 28, y + 24, x + w - 28 + Math.cos(t) * 20, y + 24 + Math.sin(t) * 20, [255, 220, 140]);
  }
  // Far, mid and near ridges.
  poly([[x, y + 66], [x + 26, y + 44], [x + 52, y + 62], [x + 80, y + 40], [x + 104, y + 60], [x + w, y + 48], [x + w, y + 78], [x, y + 78]], [196, 150, 104]);
  poly([[x, y + 78], [x + 30, y + 56], [x + 62, y + 76], [x + 92, y + 58], [x + w, y + 74], [x + w, y + 92], [x, y + 92]], [158, 110, 72]);
  poly([[x, y + 92], [x + 34, y + 74], [x + 70, y + 90], [x + 104, y + 76], [x + w, y + 88], [x + w, y + h], [x, y + h]], [110, 74, 48]);
  // Road running to the horizon.
  poly([[x + 52, y + h], [x + 60, y + 92], [x + 68, y + 92], [x + 80, y + h]], [52, 48, 46]);
  for (let i = 0; i < 4; i++) {
    const yy = y + 96 + i * 8;
    fillRect(x + 62 + i, yy, 3, 4, [240, 220, 160]);
  }
  // Cactus and agave.
  fillRect(x + 16, y + 96, 6, 26, [64, 120, 70]);
  fillRect(x + 10, y + 104, 6, 10, [64, 120, 70]);
  fillRect(x + 22, y + 108, 6, 8, [64, 120, 70]);
  poly([[x + 100, y + 122], [x + 104, y + 108], [x + 108, y + 122]], [80, 140, 80]);
  poly([[x + 108, y + 122], [x + 114, y + 106], [x + 118, y + 122]], [70, 130, 74]);
  // Gold star badge.
  starburst(x + 22, y + 30, 9, [255, 205, 80]);
}

const LEAD_ART = [artGulf, artKyiv, artBaltic, artDesert];

// ---------------------------------------------------------------- picture icons (56x56)
function iconEU(x: number, y: number): void {
  fillRect(x, y, 56, 56, [28, 52, 120]);
  for (let a = 0; a < 360; a += 30) {
    const t = (a * Math.PI) / 180;
    circle(x + 28 + Math.cos(t) * 15, y + 24 + Math.sin(t) * 15, 2, [255, 210, 60]);
  }
  fillRect(x, y + 42, 56, 7, [200, 40, 40]);
  fillRect(x, y + 49, 56, 7, [255, 255, 255]);
}

function iconBorder(x: number, y: number): void {
  fillRect(x, y, 56, 56, [222, 226, 220]);
  for (let bx = x + 6; bx < x + 52; bx += 9) vline(bx, y + 8, y + 48, [70, 74, 80]);
  hline(x + 4, x + 52, y + 14, [70, 74, 80]);
  hline(x + 4, x + 52, y + 42, [70, 74, 80]);
  line(x + 4, y + 48, x + 52, y + 10, [178, 30, 30]);
  line(x + 4, y + 44, x + 52, y + 6, [178, 30, 30]);
  fillRect(x + 22, y + 22, 12, 12, [178, 30, 30]);
  fillRect(x + 25, y + 25, 6, 6, [255, 255, 255]);
}

function iconMountains(x: number, y: number): void {
  vgrad(x, y, 56, 56, [240, 220, 150], [220, 180, 110]);
  poly([[x, y + 40], [x + 16, y + 16], [x + 30, y + 36], [x + 44, y + 20], [x + 56, y + 40], [x + 56, y + 56], [x, y + 56]], [90, 110, 70]);
  poly([[x + 12, y + 22], [x + 16, y + 16], [x + 20, y + 22], [x + 16, y + 26]], [255, 255, 255]);
  poly([[x + 40, y + 26], [x + 44, y + 20], [x + 48, y + 26], [x + 44, y + 30]], [255, 255, 255]);
  fillRect(x, y + 46, 56, 10, [60, 90, 60]);
}

function iconSearch(x: number, y: number): void {
  fillRect(x, y, 56, 56, [226, 232, 238]);
  circle(x + 24, y + 24, 13, [40, 60, 90]);
  circle(x + 24, y + 24, 9, [226, 232, 238]);
  line(x + 33, y + 33, x + 46, y + 46, [40, 60, 90]);
  line(x + 35, y + 31, x + 48, y + 44, [40, 60, 90]);
  fillRect(x + 22, y + 16, 4, 12, [178, 30, 30]);
  circle(x + 24, y + 32, 3, [178, 30, 30]);
}

function iconUN(x: number, y: number): void {
  fillRect(x, y, 56, 56, [200, 216, 230]);
  fillRect(x + 12, y + 12, 32, 32, [40, 80, 150]);
  for (let wy = y + 16; wy < y + 40; wy += 6) hline(x + 15, x + 41, wy, [180, 205, 235]);
  vline(x + 46, y + 8, y + 48, [90, 90, 90]);
  fillRect(x + 46, y + 8, 10, 7, [120, 180, 230]);
}

function iconHospital(x: number, y: number): void {
  fillRect(x, y, 56, 56, [255, 255, 255]);
  fillRect(x + 20, y + 8, 16, 40, [200, 40, 40]);
  fillRect(x + 8, y + 20, 40, 16, [200, 40, 40]);
  fillRect(x + 8, y + 48, 40, 3, [90, 90, 90]);
}

function iconChart(x: number, y: number): void {
  fillRect(x, y, 56, 56, [238, 240, 232]);
  const bars = [34, 28, 20, 12];
  bars.forEach((bh, i) => fillRect(x + 8 + i * 11, y + 48 - bh, 8, bh, [60, 110, 90]));
  line(x + 8, y + 12, x + 48, y + 40, [178, 30, 30]);
  line(x + 48, y + 40, x + 40, y + 40, [178, 30, 30]);
  line(x + 48, y + 40, x + 48, y + 32, [178, 30, 30]);
}

function iconFootball(x: number, y: number): void {
  fillRect(x, y, 56, 56, [46, 130, 70]);
  hline(x, x + 56, y + 28, [255, 255, 255]);
  circle(x + 28, y + 28, 9, [255, 255, 255]);
  discOutline(x + 28, y + 28, 9, [255, 255, 255]);
  circle(x + 28, y + 28, 11, [255, 255, 255]);
  fillRect(x + 8, y + 6, 3, 10, [240, 240, 220]);
  fillRect(x + 45, y + 6, 3, 10, [240, 240, 220]);
}

const ICONS = [iconEU, iconMountains, iconBorder, iconSearch, iconUN, iconHospital, iconChart, iconFootball];

// ---------------------------------------------------------------- layout
const MX = 24;               // side margin
const CW = W - 2 * MX;       // content width, 976

function sectionHead(y: number, left: string, right = ''): void {
  drawText(MX, y, left, font(15, 1), INK);
  if (right) drawText(W - MX, y, right, font(11, 0), MUTED, { align: 'r' });
}

function drawStrip(y: number): void {
  const cellW = CW / STRIP.length;
  for (let i = 0; i < STRIP.length; i++) {
    const cx = MX + cellW * (i + 0.5);
    drawText(cx, y + 26, STRIP[i][0], font(30, 1), RED, { align: 'c' });
    drawText(cx, y + 42, STRIP[i][1], font(11, 1), INK, { align: 'c', tracking: 1 });
    if (i > 0) vline(Math.round(MX + cellW * i), y + 4, y + 44, [200, 190, 170]);
  }
}

function drawLead(x: number, y: number, s: Story): void {
  const artW = 128, artH = 132;
  LEAD_ART[s.n - 1](x, y, artW, artH);
  // Frame around the art, and a red number badge on its top-left corner.
  fillRect(x, y, artW, 1, RULE); fillRect(x, y + artH - 1, artW, 1, RULE);
  fillRect(x, y, 1, artH, RULE); fillRect(x + artW - 1, y, 1, artH, RULE);
  circle(x + 13, y + 13, 11, RED);
  discOutline(x + 13, y + 13, 11, [255, 255, 255]);
  drawText(x + 13, y + 17, String(s.n), font(13, 1), [255, 255, 255], { align: 'c' });
  const tx = x + artW + 12;
  const tw = 336;
  let ty = y + 26;
  for (const ln of wrapText(s.head, font(24, 1), tw)) {
    drawText(tx, ty, ln, font(24, 1), INK);
    ty += 28;
  }
  ty += 4;
  for (const ln of wrapText(s.deck, font(13, 0), tw)) {
    drawText(tx, ty, ln, font(13, 0), INK);
    ty += 16;
  }
  drawText(x + 476, y + 128, '— ' + s.src, font(11, 2), MUTED, { align: 'r' });
}

function drawPictureCard(x: number, y: number, s: Story): void {
  const w = 238, h = 66;
  fillRect(x, y, w, h, CARD);
  fillRect(x, y, w, 1, [200, 190, 170]); fillRect(x, y + h - 1, w, 1, [200, 190, 170]);
  fillRect(x, y, 1, h, [200, 190, 170]); fillRect(x + w - 1, y, 1, h, [200, 190, 170]);
  ICONS[s.n - 5](x + 6, y + 5);
  // Number badge on the icon's top-right corner.
  circle(x + 57, y + 11, 9, RED);
  discOutline(x + 57, y + 11, 9, [255, 255, 255]);
  drawText(x + 57, y + 15, String(s.n), font(11, 1), [255, 255, 255], { align: 'c' });
  const tx = x + 68, tw = w - 68 - 6;
  let ty = y + 15;
  for (const ln of wrapText(s.head, font(13, 1), tw)) {
    drawText(tx, ty, ln, font(13, 1), INK);
    ty += 16;
  }
  ty += 1;
  for (const ln of wrapText(s.deck, font(12, 0), tw)) {
    drawText(tx, ty, ln, font(12, 0), INK);
    ty += 14;
  }
}

function drawBrief(x: number, y: number, n: number, head: string, src: string): void {
  drawText(x, y, String(n), font(13, 1), RED);
  const tx = x + 24;
  const headW = textWidth(head, font(13, 0));
  drawText(tx, y, head, font(13, 0), INK);
  drawText(tx + headW, y, ' — ' + src, font(13, 0), MUTED);
}

const REGION_COLOURS: RGB[] = [
  [90, 110, 140], [164, 18, 31], [200, 120, 40],
  [60, 110, 90], [140, 110, 60], [90, 90, 160],
];

function drawRegionBar(y: number): void {
  let x = MX;
  drawText(x, y, 'REGION COUNT', font(12, 1), MUTED, { tracking: 1 });
  x += textWidth('REGION COUNT', font(12, 1), 1) + 16;
  REGIONS.forEach(([name, count], i) => {
    fillRect(x, y - 9, 8, 8, REGION_COLOURS[i]);
    x += 12;
    drawText(x, y, name, font(12, 1), INK, { tracking: 1 });
    x += textWidth(name, font(12, 1), 1) + 4;
    drawText(x, y, String(count), font(13, 1), RED);
    x += textWidth(String(count), font(13, 1)) + 14;
  });
}

function drawTimeline(y: number): void {
  let x = MX;
  drawText(x, y, 'THE DAY IN TIME (UTC)', font(11, 1), MUTED);
  x += textWidth('THE DAY IN TIME (UTC)', font(11, 1)) + 16;
  TIMELINE.forEach(([when, what], i) => {
    drawText(x, y, when, font(11, 1), RED);
    x += textWidth(when, font(11, 1)) + 5;
    drawText(x, y, what, font(11, 0), INK);
    x += textWidth(what, font(11, 0)) + (i < TIMELINE.length - 1 ? 8 : 0);
    if (i < TIMELINE.length - 1) {
      drawText(x, y, '·', font(11, 0), MUTED);
      x += textWidth('·', font(11, 0)) + 8;
    }
  });
}

function render(): void {
  loadFonts();
  fillRect(0, 0, W, H, PAPER);

  // Kicker row.
  drawText(MX, 24, 'VOL. I — No. 22', font(12, 1), INK);
  drawText(512, 24, 'THE WORLD IN ONE PAGE', font(12, 1), RED, { align: 'c', tracking: 2 });
  drawText(W - MX, 24, 'ONE DAY, ONE PAGE', font(12, 1), INK, { align: 'r' });
  hline(MX, W - MX, 30, RULE);

  // Masthead.
  drawText(512, 80, 'SUNDAY, 22 NOVEMBER 2026', font(54, 1), INK, { align: 'c' });
  drawText(512, 100, '39 stories from every region — all of them reported today', font(15, 2), MUTED, { align: 'c' });
  fillRect(MX, 108, CW, 3, RED);

  // Numbers strip.
  drawStrip(116);
  hline(MX, W - MX, 162, RULE);

  // Four illustrated leads, 2 x 2.
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = (i / 2) | 0;
    drawLead(MX + col * 488, 168 + row * 140, LEADS[i]);
  }

  // Pinned world map.
  sectionHead(452, 'THE WORLD TODAY — EVERY STORY PINNED', 'Pins 1–39 match the story numbers · dots mark the place');
  MAP.y = 460; MAP.h = 130;
  drawMap();
  drawPins();

  // Eight picture stories.
  sectionHead(602, 'IN PICTURES — EIGHT MORE STORIES');
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = (i / 4) | 0;
    drawPictureCard(MX + col * 246, 608 + row * 72, PICTURES[i]);
  }

  // Twenty-seven briefs in two columns.
  sectionHead(758, 'THE REST OF THE DAY — IN BRIEF', 'All 27 below were reported today');
  for (let i = 0; i < 14; i++) {
    const [n, head, src] = BRIEFS[i];
    drawBrief(MX, 776 + i * 13, n, head, src);
  }
  for (let i = 14; i < 27; i++) {
    const [n, head, src] = BRIEFS[i];
    drawBrief(524, 776 + (i - 14) * 13, n, head, src);
  }

  // Region count, timeline, DATE CHECK.
  drawRegionBar(960);
  drawTimeline(976);
  hline(MX, W - MX, 984, RULE);
  const foot = 'DATE CHECK — Not today: the Shenzhen summit and the ICJ Myanmar ruling (Thu) · Peru\u2019s quake (Fri) · the Sparta II strike (Sat). Not yet: Liverpool v Man United result (16:30 GMT) · COP31 final text · any US reply beyond the F-16 denial. Sources: Reuters, AP, BBC, Al Jazeera, Times of India, Yle.';
  const footLines = wrapText(foot, font(11, 0), CW);
  let fy = 998;
  for (const ln of footLines) {
    drawText(MX, fy, ln, font(11, 0), INK);
    fy += 13;
  }
  // Footer rule under the page.
  hline(MX, W - MX, 1018, RULE);
}

// ---------------------------------------------------------------- main
render();
mkdirSync(OUT_DIR, { recursive: true });
const png = encodePNG();
writeFileSync(join(OUT_DIR, 'entry.png'), png);
console.log(`wrote ${join(OUT_DIR, 'entry.png')}: ${png.length} bytes`);
