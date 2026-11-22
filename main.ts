// main.ts — "The World in One Page": the world news of Sunday 22 November
// 2026, drawn as a single newspaper page. Node 22, standard library only,
// no network. Reads fonts.bin (real Liberation Serif glyphs rasterised by
// genfont.mjs in this same session) and writes /output/entry.png, 1024x1024,
// deterministic: the same bytes on every run.
//
// Layout: masthead + numbers strip, four illustrated leads, a world map with
// a numbered pin for every one of the 39 stories, eight picture stories,
// 27 briefs, a region count, a UTC timeline, and a DATE CHECK footer.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const W = 1024;
const H = 1024;
const SS = 3; // supersampling factor for the drawing buffer

// ------------------------------------------------------------- palette
const PAPER = [246, 240, 224];
const INK = [28, 26, 22];
const RED = [166, 35, 25];
const NAVY = [29, 74, 106];
const TEAL = [14, 105, 105];
const GOLD = [139, 105, 32];
const GREY = [108, 101, 90];
const RULE = [198, 189, 168];
const OCEAN = [214, 229, 231];
const LAND = [196, 203, 164];
const SKY = [238, 220, 196];
const RIVER = [140, 175, 200];
const WHITE = [255, 255, 255];
const DARKNAVY = [16, 30, 54];
const ORANGE = [214, 110, 32];
const CREAM2 = [232, 222, 198];

// ------------------------------------------------------------- canvas
// One RGB buffer at SSx resolution; everything is drawn here and box
// averaged down to 1024x1024 inside the PNG encoder.
const SW = W * SS;
const SH = H * SS;
const buf = new Uint8Array(SW * SH * 3);

function fillAll(c: number[]) {
  for (let i = 0; i < SW * SH; i++) {
    buf[i * 3] = c[0]; buf[i * 3 + 1] = c[1]; buf[i * 3 + 2] = c[2];
  }
}

function setPx(sx: number, sy: number, c: number[]) {
  if (sx < 0 || sy < 0 || sx >= SW || sy >= SH) return;
  const i = (sy * SW + sx) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}

function blendPx(sx: number, sy: number, c: number[], a: number) {
  if (sx < 0 || sy < 0 || sx >= SW || sy >= SH || a <= 0) return;
  const i = (sy * SW + sx) * 3;
  const inv = 255 - a;
  buf[i] = Math.round((a * c[0] + inv * buf[i]) / 255);
  buf[i + 1] = Math.round((a * c[1] + inv * buf[i + 1]) / 255);
  buf[i + 2] = Math.round((a * c[2] + inv * buf[i + 2]) / 255);
}

function fillRect(x: number, y: number, w: number, h: number, c: number[]) {
  const x0 = Math.max(0, Math.round(x * SS));
  const y0 = Math.max(0, Math.round(y * SS));
  const x1 = Math.min(SW, Math.round((x + w) * SS));
  const y1 = Math.min(SH, Math.round((y + h) * SS));
  for (let sy = y0; sy < y1; sy++) {
    let i = (sy * SW + x0) * 3;
    for (let sx = x0; sx < x1; sx++) {
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3;
    }
  }
}

function hline(x: number, y: number, w: number, c: number[], th = 1) {
  fillRect(x, y - th / 2, w, th, c);
}
function vline(x: number, y: number, h: number, c: number[], th = 1) {
  fillRect(x - th / 2, y, th, h, c);
}

// Scanline polygon fill (even-odd), in final-pixel coordinates.
function fillPoly(pts: number[], c: number[]) {
  const n = pts.length / 2;
  if (n < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pts[i * 2 + 1]);
    maxY = Math.max(maxY, pts[i * 2 + 1]);
  }
  const y0 = Math.max(0, Math.floor(minY * SS));
  const y1 = Math.min(SH - 1, Math.ceil(maxY * SS));
  for (let sy = y0; sy <= y1; sy++) {
    const y = (sy + 0.5) / SS;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], ay = pts[i * 2 + 1];
      const bx = pts[j * 2], by = pts[j * 2 + 1];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k] * SS));
      const xb = Math.min(SW, Math.round(xs[k + 1] * SS));
      for (let sx = xa; sx < xb; sx++) setPx(sx, sy, c);
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: number[]) {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + r) * SS));
  for (let sy = y0; sy <= y1; sy++) {
    const dy = (sy + 0.5) / SS - cy;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    const xa = Math.max(0, Math.round((cx - dx) * SS));
    const xb = Math.min(SW, Math.round((cx + dx) * SS));
    for (let sx = xa; sx < xb; sx++) setPx(sx, sy, c);
  }
}

function ring(cx: number, cy: number, r: number, th: number, c: number[]) {
  const x0 = Math.max(0, Math.floor((cx - r - th) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + r + th) * SS));
  const y0 = Math.max(0, Math.floor((cy - r - th) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + r + th) * SS));
  for (let sy = y0; sy <= y1; sy++) {
    for (let sx = x0; sx <= x1; sx++) {
      const d = Math.hypot((sx + 0.5) / SS - cx, (sy + 0.5) / SS - cy);
      if (Math.abs(d - r) <= th / 2) setPx(sx, sy, c);
    }
  }
}

// Polyline stroke: stamps discs along each segment.
const discCache = new Map<number, number[][]>();
function discOffsets(r: number) {
  const key = Math.round(r * 10);
  const hit = discCache.get(key);
  if (hit) return hit;
  const ri = Math.ceil(r);
  const offs: number[][] = [];
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
    }
  }
  discCache.set(key, offs);
  return offs;
}
function stamp(cx: number, cy: number, r: number, c: number[]) {
  const offs = discOffsets(r);
  const bx = Math.round(cx), by = Math.round(cy);
  for (const [dx, dy] of offs) setPx(bx + dx, by + dy, c);
}
function strokePath(pts: number[], widthPx: number, c: number[]) {
  const r = (widthPx * SS) / 2;
  for (let s = 0; s + 3 < pts.length + 2; s += 2) {
    const x0 = pts[s] * SS, y0 = pts[s + 1] * SS;
    const x1 = pts[s + 2] * SS, y1 = pts[s + 3] * SS;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, r * 0.8)));
    for (let i = 0; i <= steps; i++) {
      stamp(x0 + (dx * i) / steps, y0 + (dy * i) / steps, r, c);
    }
  }
}

// Starburst (explosion) at (cx, cy) with outer radius r.
function burst(cx: number, cy: number, r: number, c: number[], spikes = 12) {
  const pts: number[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i * Math.PI) / spikes - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  fillPoly(pts, c);
  fillCircle(cx, cy, r * 0.28, [255, 226, 150]);
}

// ------------------------------------------------------------- PNG out
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG() {
  // Box-average the SSx buffer down to final pixels.
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * SW + x * SS + dx) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const n = SS * SS;
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.round(r / n);
      raw[o + 1] = Math.round(g / n);
      raw[o + 2] = Math.round(b / n);
    }
  }
  // Paeth filter each row, then zlib.
  const stride = W * 3;
  const filtered = Buffer.alloc(H * (1 + stride));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const row = raw.subarray(y * (1 + stride) + 1, (y + 1) * (1 + stride));
    filtered[y * (1 + stride)] = 4; // Paeth
    const out = filtered.subarray(y * (1 + stride) + 1, (y + 1) * (1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3] : 0;
      const b = prev[i];
      const cc = i >= 3 ? prev[i - 3] : 0;
      const p = a + b - cc;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
      out[i] = (row[i] - pr) & 0xff;
    }
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const idat = deflateSync(filtered, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- fonts
// fonts.bin (NF01 container, written by genfont.mjs): magic, u16 font
// count; per font: u8 bold, u8 size px, u16 glyph count; per glyph: u32
// codepoint, i16 x-offset (tenths px, pen -> bitmap left), i16 y-offset
// (tenths px, baseline -> bitmap top), u16 w, u16 h, u16 advance (tenths),
// then w*h alpha bytes. Real Liberation Serif outlines, rasterised once
// per size — no hand-drawn letterforms anywhere on the page.
type Glyph = { xo: number; yo: number; w: number; h: number; adv: number; data: Buffer };
type Font = { bold: boolean; size: number; glyphs: Map<number, Glyph> };

function loadFonts(): Font[] {
  const raw = readFileSync(join(HERE, 'fonts.bin'));
  if (raw.toString('ascii', 0, 4) !== 'NF01') throw new Error('bad fonts.bin magic');
  let p = 4;
  const count = raw.readUInt16BE(p); p += 2;
  const fonts: Font[] = [];
  for (let f = 0; f < count; f++) {
    const bold = raw[p++] === 1;
    const size = raw[p++];
    const gcount = raw.readUInt16BE(p); p += 2;
    const glyphs = new Map<number, Glyph>();
    for (let g = 0; g < gcount; g++) {
      const code = raw.readUInt32BE(p);
      const xo = raw.readInt16BE(p + 4) / 10;
      const yo = raw.readInt16BE(p + 6) / 10;
      const w = raw.readUInt16BE(p + 8);
      const h = raw.readUInt16BE(p + 10);
      const adv = raw.readUInt16BE(p + 12) / 10;
      const data = raw.subarray(p + 16, p + 16 + w * h);
      p += 16 + w * h;
      glyphs.set(code, { xo, yo, w, h, adv, data });
    }
    fonts.push({ bold, size, glyphs });
  }
  return fonts;
}
const FONTS = loadFonts();

function fontFor(size: number, bold: boolean): Font {
  for (const f of FONTS) if (f.bold === !!bold && f.size === size) return f;
  throw new Error('no font for size ' + size + ' bold=' + bold);
}
function glyphOf(font: Font, ch: string): Glyph {
  return font.glyphs.get(ch.codePointAt(0)!) ?? font.glyphs.get(63)!;
}

function textWidth(s: string, size: number, bold: boolean, track = 0): number {
  const font = fontFor(size, bold);
  let w = 0;
  for (const ch of s) w += glyphOf(font, ch).adv + track;
  return w;
}

// Stamp one glyph bitmap at pen x (final px) and baseline y. The bitmap is
// final-pixel resolution; each of its pixels fills an SS x SS block so the
// box-average downsample keeps the exact antialiased value.
function drawGlyph(x: number, yBase: number, ch: string, size: number, bold: boolean, c: number[]): number {
  const font = fontFor(size, bold);
  const g = glyphOf(font, ch);
  if (g.w > 0 && g.h > 0) {
    const sx0 = Math.round((x + g.xo) * SS);
    const sy0 = Math.round((yBase - g.yo) * SS);
    for (let yy = 0; yy < g.h; yy++) {
      for (let xx = 0; xx < g.w; xx++) {
        const a = g.data[yy * g.w + xx];
        if (a === 0) continue;
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) {
            blendPx(sx0 + xx * SS + dx, sy0 + yy * SS + dy, c, a);
          }
        }
      }
    }
  }
  return g.adv;
}

function drawText(x: number, y: number, s: string, size: number, bold: boolean, c: number[], track = 0): number {
  let cx = x;
  for (const ch of s) cx += drawGlyph(cx, y, ch, size, bold, c) + track;
  return cx - x;
}
function drawTextCentered(cx: number, y: number, s: string, size: number, bold: boolean, c: number[], track = 0): number {
  return drawText(cx - textWidth(s, size, bold, track) / 2, y, s, size, bold, c, track);
}
function drawTextRight(rx: number, y: number, s: string, size: number, bold: boolean, c: number[], track = 0): number {
  return drawText(rx - textWidth(s, size, bold, track), y, s, size, bold, c, track);
}

// Greedy word wrap; every returned line fits maxW.
function wrap(s: string, maxW: number, size: number, bold: boolean, track = 0): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const wd of words) {
    const trial = cur ? cur + ' ' + wd : wd;
    if (textWidth(trial, size, bold, track) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawPara(x: number, y: number, s: string, maxW: number, size: number, leading: number, bold: boolean, c: number[], track = 0): number {
  const lines = wrap(s, maxW, size, bold, track);
  for (let i = 0; i < lines.length; i++) drawText(x, y + i * leading, lines[i], size, bold, c, track);
  return y + (lines.length - 1) * leading;
}

// Number badge: filled circle with a white number, centred on (cx, cy).
function drawBadge(cx: number, cy: number, r: number, num: number, color: number[]) {
  fillCircle(cx, cy, r, color);
  const s = String(num);
  drawTextCentered(cx, cy + 3.2, s, 9, true, WHITE, 0);
}

// ------------------------------------------------------------- the news
// Every story below was reported on Sunday 22 November 2026 (or happened
// overnight into that Sunday). Sources are the wire services and papers
// that carried each item that day; the foot of the page lists them all.
type Lead = { n: number; head: string; body: string; src: string; art: number };
const LEADS: Lead[] = [
  {
    n: 1,
    head: "Iran says it fired on a US jet over the Gulf; Washington denies it",
    body: "Tehran claims its forces shot at an F-16; the US says it did not happen. Bahrain reports an Iranian strike set a civilian site ablaze, and more tankers are hit off Oman.",
    src: "Reuters / AP",
    art: 1,
  },
  {
    n: 2,
    head: "Russia's overnight barrage: 400 drones, 110 missiles",
    body: "One of the war's biggest air attacks. Two killed and 60 wounded in Kryvyi Rih, President Zelenskyy's home city. Melania Trump urges more ceasefires before Christmas.",
    src: "AP / Reuters",
    art: 2,
  },
  {
    n: 3,
    head: "Missiles cross into Poland; Finland holds Baltic curbs",
    body: "Warsaw calls the incursion a provocation after a night of Russian strikes. Helsinki keeps air and sea limits in the Gulf of Finland after Saturday's drone attack on the sanctioned cargo ship Sparta II.",
    src: "Reuters",
    art: 3,
  },
  {
    n: 4,
    head: "Mexico captures 'El Chapo Isidro', an FBI most-wanted drug lord",
    body: "Troops seize the cartel boss accused of 20 years of smuggling into the US. Gunmen hit back across Sinaloa; 11 people are killed in the violence that follows.",
    src: "AP / Reuters",
    art: 4,
  },
];

type Pic = { n: number; head: string; body: string; icon: number };
const PICS: Pic[] = [
  { n: 5, head: "EU and Indonesia sign trade deal for 730m people", body: "Brussels pact cuts tariffs; EU exports seen up nearly 40% in 15 years.", icon: 5 },
  { n: 6, head: "Troops mass on the Ethiopia-Eritrea border", body: "Both sides build up forces; 200 ex-Tigray fighters surrender.", icon: 6 },
  { n: 7, head: "Estonia to shut its border with Russia", body: "Tallinn acts amid Baltic tensions; Moscow calls it a new Iron Curtain.", icon: 7 },
  { n: 8, head: "Denmark says it foiled a Russian-backed murder plot", body: "Target was a US-Ukrainian artist, officials say.", icon: 8 },
  { n: 9, head: "France seeks UN action over Myanmar", body: "Paris turns to the Security Council after Myanmar rejects the world court's ruling.", icon: 9 },
  { n: 10, head: "Bolsonaro in intensive care", body: "Brazil's jailed ex-president admitted to ICU with an acute bowel obstruction.", icon: 10 },
  { n: 11, head: "Japan's economy shrinks", body: "GDP down 0.1% annualised in July-September.", icon: 11 },
  { n: 12, head: "Liverpool host Manchester United tonight", body: "Anfield, 16:30 GMT. Hull v Brighton at 14:00; Arsenal stay top.", icon: 12 },
];

const BRIEFS: { n: number; text: string }[] = [
  { n: 13, text: "Trump calls China's nuclear build-up 'rapid and concerning' — Reuters" },
  { n: 14, text: "Trump: an Iran deal could last 20 years — Times of India" },
  { n: 15, text: "Melania Trump urges more Ukraine ceasefires before Christmas — AP" },
  { n: 16, text: "Zelenskyy floats new peace talks at the G20 summit — Reuters" },
  { n: 17, text: "US and France draft UN text for a post-UNIFIL Lebanon — Reuters" },
  { n: 18, text: "Saudi coalition downs three Houthi missiles aimed at Riyadh — AP" },
  { n: 19, text: "Four Palestinians killed in Gaza ceasefire breaches, 14 hurt — AP" },
  { n: 20, text: "Israel in talks on defence deals worth up to $1.1bn — Reuters" },
  { n: 21, text: "Iraq forces deploy in an Iran-backed militia stronghold — Reuters" },
  { n: 22, text: "Basra power-plant fire kills four, injures 35 — Reuters" },
  { n: 23, text: "US airlines warned of al-Qaeda-linked threat before Thanksgiving — AP" },
  { n: 24, text: "FBI probes hack of a key criminal-justice database — AP" },
  { n: 25, text: "Trump orders federal contractors to answer Congress — Reuters" },
  { n: 26, text: "Bessent: no new curbs needed on Nvidia chips for China — Reuters" },
  { n: 27, text: "US approved ~900,000 AI chip shipments to China in six months — AP" },
  { n: 28, text: "EU proposes a Big Tech tax; budget cuts floated for 2028-34 — Reuters" },
  { n: 29, text: "COP31: AI pledge fails to draw big US tech firms — Reuters" },
  { n: 30, text: "Modi opens the Nitish Setu bridge in Bihar — Times of India" },
  { n: 31, text: "Cyclone Akvan: 14 flights cancelled at Ranchi — Times of India" },
  { n: 32, text: "Manipur: 11 die after drinking adulterated alcohol — Reuters" },
  { n: 33, text: "Lisbon: thousands march as living costs bite — Reuters" },
  { n: 34, text: "Ireland beat South Africa, who still reach the final — Reuters" },
  { n: 35, text: "Nadal voted onto the Real Madrid board — Reuters" },
  { n: 36, text: "Cummins keeps the Australia Test captaincy — Cricket Australia" },
  { n: 37, text: "US tipped to host the 2028 Copa America — Reuters" },
  { n: 38, text: "Vietnam scraps the death penalty for drug smuggling — AP" },
  { n: 39, text: "Gupta jailed 19 years over the Pannun murder plot — Reuters" },
];

// ------------------------------------------------------------- lead art
// Every scene is drawn from code: simple bold shapes, no photos.
function drawLeadArt(kind: number, x: number, y: number, w: number, h: number) {
  if (kind === 1) {
    // Gulf: pale sky, sun, sea, tanker with smoke, jet above.
    for (let i = 0; i < 6; i++) {
      fillRect(x, y + (h * 0.55 * i) / 6, w, (h * 0.55) / 6 + 1,
        [238 - i * 3, 226 - i * 4, 200 - i * 5]);
    }
    fillCircle(x + w * 0.8, y + h * 0.16, 11, [245, 222, 160]);
    fillCircle(x + w * 0.8, y + h * 0.16, 7, [250, 236, 190]);
    // Jet silhouette with contrail.
    const jx = x + w * 0.3, jy = y + h * 0.18;
    fillPoly([jx, jy, jx + 26, jy + 4, jx + 8, jy + 6, jx + 2, jy + 10, jx - 2, jy + 5], [40, 40, 44]);
    strokePath([jx - 34, jy + 8, jx - 2, jy + 5], 1.5, [160, 160, 158]);
    // Sea.
    fillRect(x, y + h * 0.55, w, h * 0.45, [58, 96, 122]);
    fillRect(x, y + h * 0.55, w, 2, [120, 160, 185]);
    // Tanker.
    const tx = x + 12, ty = y + h * 0.62;
    fillPoly([tx, ty + 22, tx + 8, ty + 34, tx + w - 28, ty + 34, tx + w - 20, ty + 22], [38, 34, 30]);
    fillRect(tx + 10, ty + 2, w - 56, 20, [70, 60, 52]);
    fillRect(tx + 14, ty + 6, 14, 12, [166, 35, 25]);
    fillRect(tx + 32, ty + 6, 14, 12, [198, 189, 168]);
    fillRect(tx + 50, ty + 6, 14, 12, [139, 105, 32]);
    fillRect(tx + w - 46, ty - 12, 8, 14, [38, 34, 30]);
    fillCircle(tx + 30, ty - 16, 7, [120, 116, 110]);
    fillCircle(tx + 38, ty - 24, 9, [140, 136, 130]);
    fillCircle(tx + 46, ty - 16, 6, [120, 116, 110]);
    // Wake.
    strokePath([tx + 6, ty + 38, tx + 30, ty + 42, tx + 60, ty + 38], 1.5, [180, 205, 215]);
  } else if (kind === 2) {
    // Ukraine barrage: night sky, skyline, explosions, drone trails.
    fillRect(x, y, w, h, DARKNAVY);
    fillCircle(x + w * 0.82, y + h * 0.18, 9, [240, 232, 200]);
    for (let i = 0; i < 26; i++) {
      const sx = x + ((i * 47) % (w - 4)) + 2;
      const sy = y + ((i * 29) % Math.floor(h * 0.4)) + 3;
      fillRect(sx, sy, 1.5, 1.5, [220, 220, 210]);
    }
    // Skyline.
    const base = y + h * 0.82;
    const blds: [number, number][] = [[0, 30], [18, 46], [40, 26], [58, 52], [80, 34], [100, 44]];
    for (const [bx, bh] of blds) fillRect(x + bx, base - bh, 16, bh, [10, 18, 34]);
    for (const [bx, bh] of blds) {
      for (let wy = 0; wy < 3; wy++) {
        fillRect(x + bx + 3 + wy * 5, base - bh + 6 + wy * 9, 2.5, 2.5, [255, 214, 120]);
      }
    }
    // Explosions.
    burst(x + 34, y + 34, 13, ORANGE);
    burst(x + 92, y + 22, 10, [214, 110, 32]);
    burst(x + 116, y + 48, 8, [200, 80, 30]);
    // Drone trails.
    strokePath([x + 8, y + 12, x + 26, y + 20], 1, [200, 200, 200]);
    fillCircle(x + 28, y + 21, 2, [230, 230, 230]);
    strokePath([x + 60, y + 8, x + 78, y + 16], 1, [200, 200, 200]);
    fillCircle(x + 80, y + 17, 2, [230, 230, 230]);
    fillRect(x, base, w, h - (base - y), [8, 14, 28]);
  } else if (kind === 3) {
    // Baltic: pale sky, sea, sanctioned ship on waves, drone, alert band.
    for (let i = 0; i < 5; i++) {
      fillRect(x, y + (h * 0.5 * i) / 5, w, (h * 0.5) / 5 + 1, [232 - i * 4, 236 - i * 3, 238 - i * 2]);
    }
    fillCircle(x + w * 0.78, y + h * 0.14, 10, [245, 226, 170]);
    // Drone quadcopter.
    const dx = x + w * 0.3, dy = y + h * 0.2;
    fillRect(dx - 10, dy - 2, 20, 4, [40, 40, 44]);
    fillCircle(dx - 11, dy - 3, 3, [40, 40, 44]);
    fillCircle(dx + 11, dy - 3, 3, [40, 40, 44]);
    fillCircle(dx, dy + 2, 2.5, [166, 35, 25]);
    strokePath([dx - 8, dy + 8, dx - 2, dy + 26], 1, [140, 140, 138]);
    // Sea + waves.
    fillRect(x, y + h * 0.5, w, h * 0.5, [96, 140, 168]);
    strokePath([x, y + h * 0.58, x + 30, y + h * 0.54, x + 60, y + h * 0.58], 1.5, [190, 212, 222]);
    strokePath([x + 60, y + h * 0.66, x + 95, y + h * 0.62, x + 130, y + h * 0.66], 1.5, [190, 212, 222]);
    // Ship.
    const sx = x + 18, sy = y + h * 0.58;
    fillPoly([sx, sy + 14, sx + 8, sy + 26, sx + w - 44, sy + 26, sx + w - 36, sy + 14], [42, 38, 34]);
    fillRect(sx + 8, sy - 2, w - 72, 16, [88, 78, 66]);
    fillRect(sx + 12, sy + 2, 16, 8, [166, 35, 25]);
    fillRect(sx + 32, sy + 2, 16, 8, [198, 189, 168]);
    fillRect(sx + w - 58, sy - 14, 7, 16, [42, 38, 34]);
    // Smoke from the ship.
    fillCircle(sx + 30, sy - 18, 6, [130, 126, 120]);
    fillCircle(sx + 38, sy - 26, 8, [150, 146, 140]);
    // Alert chevrons at the foot.
    for (let i = 0; i < 6; i++) {
      fillPoly([x + i * 23, y + h - 8, x + i * 23 + 11, y + h - 8, x + i * 23 + 11, y + h, x + i * 23, y + h],
        i % 2 === 0 ? [166, 35, 25] : [246, 240, 224]);
    }
  } else {
    // Mexico: desert dusk, mountains, road, gold badge star.
    for (let i = 0; i < 6; i++) {
      fillRect(x, y + (h * 0.6 * i) / 6, w, (h * 0.6) / 6 + 1,
        [240 - i * 6, 214 - i * 10, 176 - i * 12]);
    }
    fillCircle(x + w * 0.76, y + h * 0.16, 11, [250, 238, 190]);
    fillPoly([x, y + h * 0.6, x + 30, y + h * 0.3, x + 60, y + h * 0.6], [96, 74, 58]);
    fillPoly([x + 52, y + h * 0.6, x + 92, y + h * 0.24, x + 132, y + h * 0.6], [76, 58, 46]);
    fillRect(x, y + h * 0.6, w, h * 0.4, [176, 138, 92]);
    // Road.
    fillPoly([x + 52, y + h, x + 62, y + h * 0.6, x + 74, y + h * 0.6, x + 84, y + h], [52, 48, 44]);
    fillRect(x + 66, y + h * 0.78, 3, 8, [246, 240, 224]);
    fillRect(x + 68, y + h * 0.9, 3, 8, [246, 240, 224]);
    // Cactus.
    fillRect(x + 108, y + h * 0.62, 5, 26, [34, 94, 52]);
    fillRect(x + 100, y + h * 0.68, 8, 4, [34, 94, 52]);
    fillRect(x + 100, y + h * 0.68, 4, 10, [34, 94, 52]);
    // Gold badge star.
    const cx = x + 34, cy = y + h * 0.42, r = 17;
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    fillPoly(pts, GOLD);
    fillCircle(cx, cy, 6, [246, 240, 224]);
    fillCircle(cx, cy, 3, GOLD);
  }
}

// ------------------------------------------------------------- pic icons
// Small square motifs for the eight picture stories, drawn in code.
function drawIcon(kind: number, x: number, y: number, w: number, h: number) {
  const bg = [233, 226, 208];
  fillRect(x, y, w, h, bg);
  if (kind === 5) {
    // Two flags: EU circle of stars + Indonesia red over white.
    fillRect(x + 6, y + 12, 20, 13, [28, 52, 110]);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      fillCircle(x + 16 + 6 * Math.cos(a), y + 18.5 + 5 * Math.sin(a), 0.9, [250, 220, 60]);
    }
    fillRect(x + 28, y + 12, 20, 13, WHITE);
    fillRect(x + 28, y + 12, 20, 6.5, [200, 30, 30]);
    vline(x + 6, y + 10, 34, INK, 1.5);
    vline(x + 48, y + 10, 34, INK, 1.5);
    fillRect(x + 4, y + 46, 46, 3, [139, 105, 32]);
  } else if (kind === 6) {
    // Mountains, sun, two flag poles.
    fillCircle(x + 38, y + 12, 6, [214, 110, 32]);
    fillPoly([x + 2, y + 40, x + 18, y + 16, x + 34, y + 40], [96, 74, 58]);
    fillPoly([x + 22, y + 40, x + 38, y + 20, x + 52, y + 40], [76, 58, 46]);
    fillPoly([x + 14, y + 22, x + 18, y + 16, x + 22, y + 22], WHITE);
    fillRect(x + 2, y + 40, 50, 10, [34, 94, 52]);
    vline(x + 8, y + 8, 14, INK, 1.5);
    fillRect(x + 8, y + 8, 9, 6, [30, 120, 60]);
    vline(x + 44, y + 8, 14, INK, 1.5);
    fillRect(x + 44, y + 8, 9, 6, [200, 30, 30]);
  } else if (kind === 7) {
    // Border fence, closed.
    for (let i = 0; i < 7; i++) vline(x + 6 + i * 7, y + 8, 34, [52, 48, 44], 2);
    hline(x + 4, y + 12, 48, [52, 48, 44], 2.5);
    hline(x + 4, y + 38, 48, [52, 48, 44], 2.5);
    fillRect(x + 8, y + 44, 38, 9, RED);
    drawText(x + 12, y + 51.5, 'SHUT', 9, true, WHITE, 0.4);
  } else if (kind === 8) {
    // Magnifier over a figure.
    fillCircle(x + 20, y + 18, 6, [52, 48, 44]);
    fillPoly([x + 12, y + 42, x + 14, y + 28, x + 26, y + 28, x + 28, y + 42], [52, 48, 44]);
    ring(x + 30, y + 26, 12, 3, NAVY);
    strokePath([x + 39, y + 35, x + 47, y + 44], 3, NAVY);
  } else if (kind === 9) {
    // UN building: blue block, globe, columns.
    fillRect(x + 10, y + 8, 32, 30, [28, 90, 140]);
    fillCircle(x + 26, y + 17, 6, [190, 215, 230]);
    fillRect(x + 12, y + 28, 28, 2, WHITE);
    for (let i = 0; i < 5; i++) vline(x + 13 + i * 6, y + 30, 8, WHITE, 1.5);
    fillRect(x + 6, y + 40, 40, 4, [28, 90, 140]);
  } else if (kind === 10) {
    // Hospital: white block, red cross.
    fillRect(x + 8, y + 12, 36, 30, WHITE);
    vline(x + 8, y + 12, 30, GREY, 1);
    vline(x + 44, y + 12, 30, GREY, 1);
    hline(x + 8, y + 12, 36, GREY, 1);
    fillRect(x + 22, y + 16, 8, 20, RED);
    fillRect(x + 16, y + 22, 20, 8, RED);
    fillRect(x + 8, y + 42, 36, 3, NAVY);
  } else if (kind === 11) {
    // Falling chart.
    for (let i = 0; i < 4; i++) fillRect(x + 8 + i * 10, y + 34 - i * 5, 6, 8 + i * 5, TEAL);
    strokePath([x + 6, y + 12, x + 20, y + 20, x + 32, y + 16, x + 46, y + 30], 2, RED);
    fillPoly([x + 46, y + 30, x + 38, y + 28, x + 44, y + 36], RED);
  } else {
    // Football on a pitch.
    fillRect(x, y, w, h, [44, 110, 62]);
    hline(x, y + 26, w, WHITE, 1.5);
    fillCircle(x + 26, y + 26, 12, WHITE);
    ring(x + 26, y + 26, 12, 1.5, WHITE);
    fillCircle(x + 26, y + 40, 8, WHITE);
    fillPoly([x + 26, y + 36, x + 30, y + 39, x + 28, y + 44, x + 24, y + 44, x + 22, y + 39], INK);
  }
}

// ------------------------------------------------------------- world map
// Schematic continents (rough lon/lat outlines, equirectangular).
const NA: number[][] = [[-168, 66], [-140, 70], [-120, 71], [-100, 72], [-85, 70], [-75, 72], [-65, 62], [-55, 52], [-60, 46], [-70, 40], [-76, 35], [-80, 31], [-81, 26], [-87, 21], [-90, 21], [-95, 19], [-97, 16], [-93, 15], [-87, 13], [-83, 9], [-80, 8], [-77, 7], [-79, 9], [-84, 11], [-88, 14], [-92, 15], [-96, 16], [-102, 18], [-106, 22], [-110, 24], [-114, 29], [-118, 33], [-122, 37], [-124, 42], [-124, 48], [-128, 52], [-135, 58], [-145, 60], [-155, 58], [-162, 58]];
const GREENLAND: number[][] = [[-58, 64], [-45, 60], [-40, 65], [-30, 68], [-20, 70], [-25, 76], [-40, 76], [-55, 74], [-58, 70]];
const SA: number[][] = [[-77, 7], [-72, 11], [-64, 10], [-60, 8], [-53, 5], [-50, 0], [-44, -3], [-38, -5], [-35, -9], [-40, -20], [-48, -27], [-55, -35], [-62, -41], [-65, -45], [-68, -52], [-70, -54], [-73, -50], [-73, -40], [-73, -30], [-70, -20], [-75, -15], [-80, -6], [-81, 0], [-80, 5]];
const AFRICA: number[][] = [[-17, 15], [-16, 21], [-11, 27], [-6, 33], [-1, 35], [5, 37], [10, 37], [11, 34], [19, 32], [25, 32], [30, 31], [32, 31], [34, 28], [36, 24], [38, 20], [40, 15], [43, 12], [46, 11], [51, 11], [48, 6], [44, 2], [41, -2], [40, -8], [38, -14], [35, -18], [32, -24], [30, -29], [27, -33], [22, -35], [18, -34], [16, -29], [13, -20], [12, -13], [12, -6], [9, 0], [9, 4], [6, 4], [-2, 5], [-8, 5], [-13, 8], [-17, 12]];
const EURASIA: number[][] = [[-9, 37], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [-1, 50], [2, 51], [4, 53], [8, 55], [8, 57], [10, 59], [6, 62], [12, 65], [18, 69], [25, 71], [30, 70], [35, 67], [40, 68], [45, 67], [50, 69], [55, 68], [60, 69], [68, 72], [75, 73], [85, 75], [95, 76], [105, 77], [115, 74], [125, 72], [135, 72], [145, 72], [155, 70], [165, 69], [175, 66], [178, 65], [178, 62], [170, 60], [162, 58], [158, 52], [155, 48], [150, 45], [145, 42], [142, 40], [140, 36], [135, 34], [130, 32], [127, 30], [126, 35], [122, 39], [120, 35], [118, 32], [115, 28], [112, 22], [110, 20], [108, 18], [106, 15], [104, 10], [103, 5], [100, 5], [98, 10], [95, 15], [92, 21], [89, 22], [86, 20], [83, 17], [80, 13], [77, 8], [76, 10], [73, 16], [72, 20], [69, 22], [66, 25], [62, 25], [58, 25], [56, 26], [57, 24], [59, 22], [58, 20], [55, 17], [52, 15], [48, 14], [45, 12], [43, 12], [40, 15], [38, 20], [36, 25], [34, 28], [33, 29], [32, 31], [30, 31], [25, 32], [20, 32], [15, 33], [11, 34], [10, 37], [5, 37], [0, 36], [-5, 35], [-9, 36]];
const AUSTRALIA: number[][] = [[113, -22], [114, -30], [115, -35], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35], [137, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]];
const UK: number[][] = [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51], [-3, 50]];
const JAPAN: number[][] = [[130, 31], [132, 33], [134, 34], [136, 35], [138, 35], [140, 36], [141, 39], [141, 42], [143, 44], [141, 45], [139, 44], [137, 41], [135, 38], [133, 36], [131, 33]];
const SUMATRA: number[][] = [[95, 5], [98, 3], [100, 0], [98, -2], [95, 2]];
const JAVA: number[][] = [[105, -6], [108, -7], [110, -7], [112, -7], [114, -8], [111, -8], [108, -7]];
const NEWGUINEA: number[][] = [[131, -1], [133, -2], [135, -3], [138, -4], [141, -3], [141, -1], [138, -1], [135, -2]];
const NZ: number[][] = [[167, -45], [170, -43], [173, -41], [175, -38], [177, -38], [174, -41], [171, -43], [168, -46]];

const MAP_X = 26, MAP_Y = 442, MAP_W = 972, MAP_H = 106;
function mapX(lon: number): number { return MAP_X + ((lon + 170) / 360) * MAP_W; }
function mapY(lat: number): number { return MAP_Y + ((75 - lat) / 130) * MAP_H; }
function drawContinent(poly: number[][]) {
  const pts: number[] = [];
  for (const [lon, lat] of poly) pts.push(mapX(lon), mapY(lat));
  fillPoly(pts, LAND);
  const closed = pts.concat([pts[0], pts[1]]);
  strokePath(closed, 0.8, [128, 136, 104]);
}

// Pins: [story number, lon, lat, badge x, badge y]. Badge positions are
// hand-spread so the crowded clusters (Europe, the Gulf, Washington)
// stay readable; a thin leader joins each badge to its true spot.
const PINS: [number, number, number, number, number][] = [
  [1, 54, 26.5, 652, 508], [2, 32, 48.5, 578, 444], [3, 19, 52, 522, 442],
  [4, -107, 25, 182, 502], [5, 4.4, 50.8, 482, 442], [6, 39, 14.5, 616, 524],
  [7, 25, 59, 548, 442], [8, 10, 56, 500, 442], [9, 96, 21, 762, 498],
  [10, -47.9, -15.8, 348, 524], [11, 139.7, 35.7, 862, 488], [12, -3, 53.4, 452, 444],
  [13, 116.4, 39.9, 806, 450], [14, -77, 38.9, 252, 448], [15, -77, 38.9, 284, 448],
  [16, 30.5, 50.4, 540, 472], [17, 35.5, 33.9, 600, 492], [18, 46.7, 24.7, 628, 508],
  [19, 34.5, 31.5, 576, 492], [20, 34.8, 32.1, 596, 510], [21, 44.4, 33.3, 620, 490],
  [22, 47.8, 30.5, 642, 492], [23, -98, 39, 214, 492], [24, -77, 38.9, 248, 478],
  [25, -77, 38.9, 280, 478], [26, -77, 38.9, 308, 478], [27, 116.4, 39.9, 824, 478],
  [28, 4.4, 50.8, 468, 480], [29, 30.7, 36.9, 552, 488], [30, 85.1, 25.6, 698, 498],
  [31, 85.3, 23.3, 714, 508], [32, 93.9, 24.8, 740, 506], [33, -9, 39, 442, 480],
  [34, -6, 53, 436, 458], [35, -3.7, 40.4, 452, 498], [36, 151.2, -33.9, 892, 520],
  [37, -95, 38, 206, 512], [38, 105.8, 21, 782, 496], [39, -74, 40.7, 312, 452],
];

function drawMap() {
  fillRect(MAP_X, MAP_Y, MAP_W, MAP_H, OCEAN);
  for (const c of [NA, GREENLAND, SA, AFRICA, EURASIA, AUSTRALIA, UK, JAPAN, SUMATRA, JAVA, NEWGUINEA, NZ]) {
    drawContinent(c);
  }
  // Frame.
  hline(MAP_X, MAP_Y, MAP_W, INK, 1);
  hline(MAP_X, MAP_Y + MAP_H, MAP_W, INK, 1);
  vline(MAP_X, MAP_Y, MAP_H, INK, 1);
  vline(MAP_X + MAP_W, MAP_Y, MAP_H, INK, 1);
  // Pins.
  for (const [n, lon, lat, bx, by] of PINS) {
    const tx = mapX(lon), ty = mapY(lat);
    if (Math.hypot(bx - tx, by - ty) > 9) {
      strokePath([tx, ty, bx, by], 0.8, [90, 84, 72]);
    }
    fillCircle(tx, ty, 2, RED);
    drawBadge(bx, by, 7, n, RED);
  }
}

// ------------------------------------------------------------- the page
function drawPage() {
  fillAll(PAPER);

  // Header.
  hline(26, 14, 972, INK, 1);
  drawText(26, 33, 'VOL. I — No. 22', 9, true, GREY, 0.4);
  drawTextCentered(512, 33, 'THE WORLD IN ONE PAGE', 11, true, RED, 1.5);
  drawTextRight(998, 33, 'ONE DAY, ONE PAGE', 9, true, GREY, 0.4);
  drawTextCentered(512, 80, 'SUNDAY, 22 NOVEMBER 2026', 40, true, INK, 0);
  drawTextCentered(512, 100, '39 stories from every region — all of them reported today', 12, false, INK, 0);
  fillRect(26, 106, 972, 3, RED);

  // Numbers strip.
  const STATS: [string, string][] = [
    ['39', 'STORIES TODAY'], ['400', 'DRONES AT UKRAINE'], ['110', 'MISSILES AT UKRAINE'],
    ['730M', 'PEOPLE IN EU PACT'], ['11', 'KILLED IN SINALOA'], ['900K', 'AI CHIPS TO CHINA'],
  ];
  for (let i = 0; i < 6; i++) {
    const x = 26 + i * 162;
    drawTextCentered(x + 81, 134, STATS[i][0], 15, true, RED, 0);
    drawTextCentered(x + 81, 146, STATS[i][1], 9, true, GREY, 0.3);
    if (i > 0) vline(x, 120, 26, RULE, 1);
  }
  hline(26, 150, 972, RULE, 1);

  // Four illustrated leads, 2 x 2.
  const leadPos: [number, number][] = [[26, 158], [520, 158], [26, 296], [520, 296]];
  for (let i = 0; i < 4; i++) {
    const [x, y] = leadPos[i];
    const L = LEADS[i];
    fillRect(x, y, 478, 130, WHITE);
    hline(x, y, 478, INK, 1);
    hline(x, y + 130, 478, INK, 1);
    vline(x, y, 130, INK, 1);
    vline(x + 478, y, 130, INK, 1);
    drawLeadArt(L.art, x + 1, y + 1, 132, 128);
    drawBadge(x + 15, y + 15, 8, L.n, RED);
    const tx = x + 141, tw = 329;
    drawPara(tx, y + 20, L.head, tw, 15, 19, true, INK);
    drawPara(tx, y + 62, L.body, tw, 11, 14, false, INK);
    drawTextRight(x + 470, y + 121, '— ' + L.src, 9, true, GREY, 0.2);
  }

  // Map.
  drawText(26, 436, 'THE WORLD TODAY — EVERY STORY PINNED', 12, true, INK, 0.3);
  drawTextRight(998, 436, 'Pins 1–39 match the story numbers', 10, false, GREY, 0);
  drawMap();

  // Eight picture stories, 2 rows x 4.
  drawText(26, 562, 'IN PICTURES — EIGHT MORE STORIES', 12, true, INK, 0.3);
  for (let i = 0; i < 8; i++) {
    const x = 26 + (i % 4) * 245;
    const y = 570 + Math.floor(i / 4) * 72;
    const P = PICS[i];
    fillRect(x, y, 237, 66, WHITE);
    hline(x, y, 237, INK, 1);
    hline(x, y + 66, 237, INK, 1);
    vline(x, y, 66, INK, 1);
    vline(x + 237, y, 66, INK, 1);
    drawIcon(P.icon, x + 1, y + 1, 52, 64);
    drawBadge(x + 228, y + 10, 7, P.n, RED);
    const tx = x + 59, tw = 162;
    drawPara(tx, y + 15, P.head, tw, 11, 13.5, true, INK);
    drawPara(tx, y + 43, P.body, tw, 10, 12.5, false, INK);
  }

  // Briefs, two columns.
  drawText(26, 722, 'THE REST OF THE DAY — IN BRIEF', 12, true, INK, 0.3);
  drawTextRight(998, 722, 'All 27 below were reported today', 10, false, GREY, 0);
  for (let i = 0; i < BRIEFS.length; i++) {
    const col = i < 14 ? 0 : 1;
    const row = i < 14 ? i : i - 14;
    const x = 26 + col * 494;
    const y = 740 + row * 15;
    const b = BRIEFS[i];
    drawText(x, y, String(b.n), 11, true, RED, 0);
    drawText(x + 24, y, b.text, 11, false, INK, 0);
  }

  // Region count.
  const REGIONS: [string, number, number[]][] = [
    ['EUROPE', 13, NAVY], ['MIDDLE EAST', 8, RED], ['ASIA', 8, GOLD],
    ['AMERICAS', 8, TEAL], ['AFRICA', 1, [120, 90, 40]], ['OCEANIA', 1, [90, 90, 140]],
  ];
  let rx = 26;
  drawText(rx, 955, 'REGION COUNT', 10, true, INK, 0.3);
  rx += textWidth('REGION COUNT', 10, true, 0.3) + 12;
  for (const [name, count, color] of REGIONS) {
    fillRect(rx, 947, 8, 8, color);
    rx += 12;
    drawText(rx, 955, name + ' ' + count, 10, true, INK, 0.2);
    rx += textWidth(name + ' ' + count, 10, true, 0.2) + 14;
  }

  // UTC timeline.
  drawText(26, 973, 'THE DAY IN TIME (UTC)', 10, true, INK, 0.3);
  drawText(26 + textWidth('THE DAY IN TIME (UTC)', 10, true, 0.3) + 10, 973,
    "OVERNIGHT Russia's barrage · MORNING EU-Indonesia deal signed · MIDDAY cartel boss captured · AFTERNOON Hull v Brighton · EVENING Liverpool v Man United",
    10, false, INK, 0);

  // DATE CHECK footer + sources.
  hline(26, 980, 972, RULE, 1);
  drawText(26, 994, "DATE CHECK — Left out: Peru's 6.9 quake (Friday), the Sparta II drone strike (Saturday), the Kuwait and Bahrain base strikes (Wednesday).", 10, false, INK, 0);
  drawText(26, 1008, 'Not yet: Liverpool v Man United result (16:30 GMT) · COP31 final text · any US reply beyond the F-16 denial.  Sources: Reuters, AP, BBC, Al Jazeera, Times of India, Yle.', 10, false, INK, 0);
  hline(26, 1014, 972, INK, 1);
}

drawPage();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.png'), encodePNG());
console.log('wrote', join(OUT, 'entry.png'));
