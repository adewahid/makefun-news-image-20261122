// main.ts — news-image-20261122 v3: "22 November 2026 in one image".
// A self-contained Node 22 (stdlib only) renderer: own PNG encoder, own
// raster canvas, own bitmap font engine reading fonts.json (real Liberation
// Serif glyphs baked by gen-fonts.mjs, my own TTF parser/rasterizer).
// Deterministic: no clock, no randomness, no network. Run twice -> same bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1024, H = 1024;

// ---------- palette ----------
const PAPER = [246, 239, 220];
const PAPER2 = [238, 229, 203];
const INK = [28, 23, 16];
const RED = [168, 35, 24];
const RED_D = [128, 22, 14];
const BLUE = [30, 74, 115];
const BLUE_L = [58, 110, 158];
const GOLD = [176, 128, 28];
const GREY = [107, 98, 82];
const LINE = [120, 108, 82];
const LAND = [226, 212, 172];
const LAND_L = [214, 198, 152];
const TEAL = [32, 96, 92];
const NAVY = [24, 42, 68];
const SKY = [168, 196, 214];

// ---------- fonts (bitmap, from fonts.json) ----------
const FONTS = JSON.parse(readFileSync(join(HERE, 'fonts.json'), 'utf8'));
const glyphCache = new Map();
function glyph(face, size, ch) {
  const key = face + '|' + size + '|' + ch;
  let g = glyphCache.get(key);
  if (g) return g;
  const table = FONTS.faces[face]?.[size];
  let raw = table?.[ch];
  if (!raw) raw = FONTS.faces[face]?.[size]?.['?'] ?? { a: size * 0.6, w: 0, h: 0, x: 0, y: 0, d: '' };
  const buf = raw.d ? Buffer.from(raw.d, 'base64') : null;
  let alpha = null;
  if (buf && raw.w > 0 && raw.h > 0) {
    alpha = new Uint8Array(raw.w * raw.h);
    for (let i = 0; i < raw.w * raw.h; i++) {
      const byte = buf[Math.floor(i / 4)];
      const v = (byte >> ((3 - (i % 4)) * 2)) & 3;
      alpha[i] = v * 85;
    }
  }
  g = { a: raw.a, w: raw.w, h: raw.h, x: raw.x, y: raw.y, alpha };
  glyphCache.set(key, g);
  return g;
}
function textWidth(s, face, size, tracking = 0) {
  let w = 0;
  for (const ch of s) w += glyph(face, size, ch).a + tracking;
  return w - (s.length ? tracking : 0);
}

// ---------- canvas ----------
class Canvas {
  buf = new Uint8Array(W * H * 3);
  constructor() { this.fillRect(0, 0, W, H, PAPER); }
  px(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    this.buf[o] = c[0]; this.buf[o + 1] = c[1]; this.buf[o + 2] = c[2];
  }
  blend(x, y, c, a) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const o = (y * W + x) * 3;
    const ia = 255 - a;
    this.buf[o] = (c[0] * a + this.buf[o] * ia) >> 8;
    this.buf[o + 1] = (c[1] * a + this.buf[o + 1] * ia) >> 8;
    this.buf[o + 2] = (c[2] * a + this.buf[o + 2] * ia) >> 8;
  }
  fillRect(x, y, w, h, c) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let o = (yy * W + x0) * 3;
      for (let xx = x0; xx < x1; xx++) { this.buf[o] = c[0]; this.buf[o + 1] = c[1]; this.buf[o + 2] = c[2]; o += 3; }
    }
  }
  hline(x0, x1, y, c) { this.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), 1, c); }
  vline(x, y0, y1, c) { this.fillRect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0), c); }
  rect(x, y, w, h, c, t = 1) {
    this.fillRect(x, y, w, t, c); this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c); this.fillRect(x + w - t, y, t, h, c);
  }
  // thick line via stamped discs
  line(x0, y0, x1, y1, c, w = 1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + dx * t, y0 + dy * t, w / 2, c);
    }
  }
  disc(cx, cy, r, c) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.px(x, y, c);
      }
    }
  }
  ring(cx, cy, r, c, t = 1) {
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      for (let k = 0; k < t; k++) this.px(cx + (r - k) * Math.cos(rad), cy + (r - k) * Math.sin(rad), c);
    }
  }
  fillPoly(pts, c) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y + 0.5 >= Math.min(y1, y2)) && (y + 0.5 < Math.max(y1, y2))) {
          xs.push(x1 + (y + 0.5 - y1) * (x2 - x1) / (y2 - y1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]), 1, c);
      }
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const t = (y - cy) / ry;
      if (Math.abs(t) > 1) continue;
      const dx = rx * Math.sqrt(1 - t * t);
      this.fillRect(Math.ceil(cx - dx), y, Math.floor(cx + dx) - Math.ceil(cx - dx), 1, c);
    }
  }
  // text: y is the baseline
  text(s, x, y, face, size, c, tracking = 0) {
    let cx = x;
    for (const ch of s) {
      const g = glyph(face, size, ch);
      if (g.alpha) {
        for (let yy = 0; yy < g.h; yy++) {
          for (let xx = 0; xx < g.w; xx++) {
            const a = g.alpha[yy * g.w + xx];
            if (a) this.blend(cx + g.x + xx, y - g.y + yy, c, a);
          }
        }
      }
      cx += g.a + tracking;
    }
    return cx;
  }
  textC(s, cx, y, face, size, c, tracking = 0) {
    return this.text(s, cx - textWidth(s, face, size, tracking) / 2, y, face, size, c, tracking);
  }
  textR(s, x, y, face, size, c, tracking = 0) {
    return this.text(s, x - textWidth(s, face, size, tracking), y, face, size, c, tracking);
  }
  wrap(s, face, size, maxW) {
    const words = s.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (textWidth(t, face, size) <= maxW) cur = t;
      else {
        if (cur) lines.push(cur);
        // break a too-long word
        let rest = w;
        while (textWidth(rest, face, size) > maxW) {
          let cut = rest.length;
          while (cut > 1 && textWidth(rest.slice(0, cut), face, size) > maxW) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        cur = rest;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  para(s, x, y, face, size, c, maxW, lh) {
    const lines = this.wrap(s, face, size, maxW);
    lines.forEach((ln, i) => this.text(ln, x, y + i * lh, face, size, c));
    return lines.length;
  }
}

// ---------- PNG encoder (own; zlib via stdlib) ----------
function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function encodePNG(cv) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter None
    raw.set(cv.buf.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- the day's news: 40 stories, all reported 22 Nov 2026 ----------
// kind: lead (illustrated) / pic (picture story) / brief
// regions: ME Middle East, EU Europe, AP Asia-Pacific, AF Africa, AM Americas,
// MT Markets & Tech, SC Sport & Culture
const STORIES = [
  { n: 1, kind: 'lead', reg: 'EU', lat: 36.90, lon: 30.71, kicker: 'CLIMATE · ANTALYA', head: 'COP31 COLLAPSES: NO DEAL ON FOSSIL FUELS', deck: 'After a record two weeks in overtime, nearly 200 nations leave Antalya with no pact. The EU walks out over a text that never names coal, oil or gas.', src: 'CNN · NPR · WRI' },
  { n: 2, kind: 'lead', reg: 'ME', lat: 26.23, lon: 50.59, kicker: 'GULF · MISSILE STRIKES', head: 'IRAN STRIKES U.S. BASES IN BAHRAIN', deck: 'Missiles and drones hit American bases and tankers near Hormuz. Bahrain says a civilian plant was hit; Iran claims two Patriot radars destroyed.', src: 'Reuters · AFP · Al Jazeera' },
  { n: 3, kind: 'lead', reg: 'EU', lat: 50.78, lon: 30.31, kicker: 'WAR · KYIV REGION', head: 'DRONE FLATTENS FLAT BLOCK AS 186 FLY IN', deck: 'A five-storey block collapses in Dymer; 11 are missing, two of them children. In Kryvyi Rih a missile kills a boy, 7, and a woman, 20.', src: 'AP · Euromaidan Press' },
  { n: 4, kind: 'lead', reg: 'AM', lat: 25.57, lon: -108.47, kicker: 'SINALOA · CARTEL RAID', head: '‘EL CHAPO ISIDRO’ CAPTURED IN BLOODY RAID', deck: 'Elite troops seize FBI most-wanted Fausto Isidro Meza Flores in Guasave. Eleven die in the firefight, including four soldiers.', src: 'AP · NYT · Al Jazeera' },
  { n: 5, kind: 'pic', reg: 'ME', lat: 31.50, lon: 34.47, kicker: 'GAZA', head: 'AID VAN HIT IN GAZA CITY', deck: 'Israeli strike kills three men in a food van; Israel says militants were targeted.', src: 'Al Jazeera' },
  { n: 6, kind: 'pic', reg: 'ME', lat: 31.95, lon: 35.20, kicker: 'WEST BANK', head: 'SETTLER ARSON CALLED ‘TERRORISM’', deck: 'Opposition leader Eisenkot condemns arson on Palestinian homes and cars.', src: 'AP' },
  { n: 7, kind: 'pic', reg: 'ME', lat: 24.45, lon: 54.38, kicker: 'ABU DHABI', head: 'UKRAINE TALKS MOVE TO MOSCOW, DUBLIN', deck: 'U.S. envoys head on after Abu Dhabi; Russia repeats its 1997 NATO demand.', src: 'Nexus Europa' },
  { n: 8, kind: 'pic', reg: 'EU', lat: 52.00, lon: 19.40, kicker: 'POLAND', head: 'RUSSIAN MISSILES LAND IN POLAND', deck: 'NATO calls the strikes a violation as drills run nearby.', src: 'AP' },
  { n: 9, kind: 'pic', reg: 'AP', lat: 23.70, lon: 121.00, kicker: 'TAIWAN', head: 'CHINA RESUMES PATROLS OFF TAIWAN', deck: '21 sorties, 15 crossing the median line, with warships in tow.', src: 'Wire reports' },
  { n: 10, kind: 'pic', reg: 'AP', lat: -6.35, lon: 106.25, kicker: 'INDONESIA', head: 'FACTORY FIRE: 3 DEAD, 36 MISSING', deck: 'Blaze rips through a candy plant in Cikande, Banten; rescuers dig on.', src: 'AP · Reuters' },
  { n: 11, kind: 'pic', reg: 'AF', lat: 4.90, lon: 6.30, kicker: 'NIGERIA', head: 'BOAT OF MOURNERS CAPSIZES: 24 DEAD', deck: 'Funeral-bound boat sinks in Bayelsa; 24 more are rescued.', src: 'AP' },
  { n: 12, kind: 'pic', reg: 'AP', lat: 26.21, lon: 127.68, kicker: 'OKINAWA', head: 'SHURI CASTLE RISES AGAIN', deck: 'Restored hall opens seven years after the fire that gutted it.', src: 'AP' },
  { n: 13, kind: 'pic', reg: 'EU', lat: 48.86, lon: 2.35, kicker: 'FRANCE', head: 'SIXTH SATURDAY OF STREET PROTESTS', deck: 'Crowds march over living costs; 80,000 by police count, 150,000 by organisers.', src: 'Wire reports' },
  { n: 14, kind: 'pic', reg: 'MT', lat: 40.71, lon: -74.00, kicker: 'MARKETS', head: 'STOCKS TUMBLE INTO CORRECTION', deck: 'S&P 500 −3.7%, Nasdaq −5.3% on Friday as the AI sell-off goes global.', src: 'AP' },
  { n: 15, kind: 'brief', reg: 'EU', lat: 50.85, lon: 4.35, kicker: 'TRADE', head: 'EU–INDONESIA INK LANDMARK TRADE DEAL', deck: 'Nearly 10 years of talks end; tariffs scrapped on up to 98.5% of goods.', src: 'Reuters' },
  { n: 16, kind: 'brief', reg: 'EU', lat: 50.85, lon: 4.35, kicker: 'BRUSSELS', head: 'BRITAIN, EU SIGN THREE POST-BREXIT DEALS', deck: 'Food exports, carbon trading and a youth scheme — PM Burnham in Brussels.', src: 'OneTurn' },
  { n: 17, kind: 'brief', reg: 'EU', lat: 40.42, lon: -3.70, kicker: 'SPAIN', head: 'SPAIN HEADS TO SNAP ELECTION, 29 NOV', deck: 'Political uncertainty deepens a week before the vote.', src: 'Gardner' },
  { n: 18, kind: 'brief', reg: 'EU', lat: 48.86, lon: 2.35, kicker: 'FRANCE', head: 'FIVE RIVALS CLASH IN FRENCH TV DEBATE', deck: '2027 contenders spar over tax, spending and housing on TF1.', src: 'Nexus Europa' },
  { n: 19, kind: 'brief', reg: 'EU', lat: 38.72, lon: -9.14, kicker: 'PORTUGAL', head: 'PORTUGAL STORM EASES AS ALERTS DROP', deck: 'Crews restore power after days of severe weather.', src: 'Nexus Europa' },
  { n: 20, kind: 'brief', reg: 'ME', lat: 30.50, lon: 47.78, kicker: 'IRAQ', head: 'FIRE AT BASRA POWER STATION KILLS 4', deck: 'Blaze at Hartha plant injures 35; cause unknown.', src: 'Iraqi state media' },
  { n: 21, kind: 'brief', reg: 'AP', lat: 24.66, lon: 93.91, kicker: 'INDIA', head: 'TOXIC LIQUOR KILLS 11 IN MANIPUR', deck: 'More than 180 in hospital, the chief minister says.', src: 'Wire reports' },
  { n: 22, kind: 'brief', reg: 'AM', lat: 28.39, lon: -80.74, kicker: 'FLORIDA', head: 'FLORIDA RIVER BREAKS 73-YEAR RECORD', deck: 'St Johns floods towns from Miami to Brevard after days of rain.', src: 'Wire reports' },
  { n: 23, kind: 'brief', reg: 'AM', lat: -12.05, lon: -77.04, kicker: 'PERU', head: 'PERU QUAKE: 1 DEAD, 16 HURT, 152 HOMES RUINED', deck: 'Friday’s tremor leaves 853 people needing help.', src: 'Wire reports' },
  { n: 24, kind: 'brief', reg: 'AF', lat: -2.90, lon: 23.66, kicker: 'DR CONGO', head: 'EBOLA EMERGENCY HOLDS IN DR CONGO', deck: 'WHO reaffirms the emergency: 11,613 cases, 5,678 dead.', src: 'WHO' },
  { n: 25, kind: 'brief', reg: 'AF', lat: -26.20, lon: 28.05, kicker: 'SOUTH AFRICA', head: 'JOBLESS RATE HITS 33.7% IN S. AFRICA', deck: '8.6 million out of work — the highest since 2022.', src: 'Wire reports' },
  { n: 26, kind: 'brief', reg: 'MT', lat: 1.35, lon: 103.82, kicker: 'CRYPTO', head: 'BITCOIN SLIPS BELOW $60,000', deck: 'Briefly $55,130, its lowest since 2024, then steadies above $58,000.', src: 'Wire reports' },
  { n: 27, kind: 'brief', reg: 'MT', lat: 37.77, lon: -122.42, kicker: 'TECH', head: 'ANTHROPIC IPO STUMBLES AFTER DEBUT', deck: 'Shares open near $112, slide to about $85 in Friday’s rout.', src: 'Invest News' },
  { n: 28, kind: 'brief', reg: 'MT', lat: 47.61, lon: -122.33, kicker: 'TECH', head: 'AMAZON NEARS $7.5BN AI DEAL', deck: 'Israeli startup Decart would boost its Trainium chips.', src: 'Crypto Briefing' },
  { n: 29, kind: 'brief', reg: 'MT', lat: 41.13, lon: -73.71, kicker: 'TECH', head: 'IBM UNVEILS 520-QUBIT ‘NIGHTHAWK’', deck: 'Chip aims at real workloads; a 1,040-qubit link is planned for 2027.', src: 'Dev.to' },
  { n: 30, kind: 'brief', reg: 'ME', lat: 31.50, lon: 34.47, kicker: 'GAZA', head: 'STORMS FLOOD GAZA’S TENTED SHELTERS', deck: 'Rain and cold leave over a million displaced people exposed.', src: 'Nexus Europa' },
  { n: 31, kind: 'brief', reg: 'EU', lat: 45.36, lon: 36.47, kicker: 'CRIMEA', head: 'UKRAINE HITS KERCH BRIDGE AGAIN', deck: 'Rail span to occupied Crimea struck for the third time.', src: 'Euromaidan Press' },
  { n: 32, kind: 'brief', reg: 'EU', lat: 59.90, lon: 25.50, kicker: 'BALTIC', head: 'DRONES SET RUSSIAN SHIP ABLAZE', deck: 'Russia-bound Sparta II burns in the Gulf of Finland.', src: 'AP' },
  { n: 33, kind: 'brief', reg: 'ME', lat: 24.71, lon: 46.68, kicker: 'RIYADH', head: 'SAUDIS INTERCEPT HOUTHI MISSILES', deck: 'Three ballistic missiles aimed at Riyadh shot down; Hodeidah struck back.', src: 'Wire reports' },
  { n: 34, kind: 'brief', reg: 'AM', lat: 38.90, lon: -77.04, kicker: 'WASHINGTON', head: 'FBI DATABASE BREACH DRAWS TRUMP COMMENT', deck: 'President sees a ‘positive spin’ after the breach.', src: 'IQMIA' },
  { n: 35, kind: 'brief', reg: 'SC', lat: 51.50, lon: -0.13, kicker: 'FOOTBALL', head: 'LEEDS STUN CHELSEA 4–1 AT THE BRIDGE', deck: 'First Leeds win at Stamford Bridge since 1999.', src: 'Sky Sports' },
  { n: 36, kind: 'brief', reg: 'SC', lat: 51.50, lon: -0.13, kicker: 'RUGBY', head: 'ENGLAND BEAT NEW ZEALAND 37–12', deck: 'Nations Championship win at Allianz Stadium.', src: 'BBC Sport' },
  { n: 37, kind: 'brief', reg: 'SC', lat: 38.90, lon: -77.04, kicker: 'NWSL', head: 'KANSAS CITY CURRENT WIN FIRST TITLE', deck: '2–1 over Washington Spirit at Audi Field.', src: 'AllSports' },
  { n: 38, kind: 'brief', reg: 'SC', lat: 10.97, lon: -74.80, kicker: 'FOOTBALL', head: 'BOCA WIN RECORD THIRD SUDAMERICANA', deck: '2–0 over Atlético Mineiro in Barranquilla.', src: 'AllSports' },
  { n: 39, kind: 'brief', reg: 'SC', lat: 34.05, lon: -118.24, kicker: 'CINEMA', head: '‘HUNGER GAMES’ OPENS TO $56 MILLION', deck: 'Sunrise on the Reaping leads the Friday box office.', src: 'Variety' },
  { n: 40, kind: 'brief', reg: 'SC', lat: 25.29, lon: 51.53, kicker: 'UFC', head: 'ALBAZI SUBMITS COSTA AT UFC QATAR', deck: 'Win comes after a point deduction in Doha.', src: 'IQMIA' },
];
const REGIONS = [
  { k: 'ME', name: 'MIDDLE EAST', c: [168, 35, 24] },
  { k: 'EU', name: 'EUROPE', c: [30, 74, 115] },
  { k: 'AP', name: 'ASIA-PACIFIC', c: [32, 96, 92] },
  { k: 'AF', name: 'AFRICA', c: [176, 128, 28] },
  { k: 'AM', name: 'AMERICAS', c: [96, 96, 96] },
  { k: 'MT', name: 'MARKETS & TECH', c: [90, 60, 130] },
  { k: 'SC', name: 'SPORT & CULTURE', c: [40, 120, 60] },
];

// ---------- continent outlines (lon, lat), coarse but recognisable ----------
const LAND_POLYS = [
  [[-168, 66], [-158, 58], [-152, 60], [-140, 60], [-135, 57], [-130, 54], [-125, 49], [-124, 42], [-120, 34], [-114, 29], [-110, 24], [-105, 20], [-97, 16], [-92, 15], [-86, 12], [-83, 9], [-79, 9], [-80, 13], [-84, 16], [-87, 21], [-90, 21], [-91, 19], [-96, 19], [-97, 26], [-93, 30], [-89, 30], [-84, 30], [-81, 25], [-80, 32], [-76, 35], [-74, 40], [-70, 42], [-68, 44], [-65, 44], [-60, 47], [-65, 50], [-60, 52], [-64, 58], [-68, 58], [-72, 62], [-78, 62], [-85, 66], [-90, 69], [-95, 69], [-110, 68], [-125, 70], [-140, 70], [-155, 71], [-165, 68]],
  [[-58, 64], [-52, 60], [-43, 60], [-40, 64], [-32, 68], [-22, 70], [-20, 74], [-25, 78], [-35, 80], [-55, 80], [-60, 76], [-62, 70]],
  [[-79, 9], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -18], [-70, -23], [-70, -30], [-73, -37], [-73, -44], [-74, -50], [-70, -54], [-66, -55], [-65, -50], [-62, -45], [-58, -38], [-52, -33], [-48, -28], [-41, -23], [-39, -17], [-35, -9], [-35, -6], [-40, -3], [-44, -2], [-50, 0], [-53, 4], [-58, 6], [-62, 9], [-68, 11], [-72, 12], [-77, 8]],
  [[-17, 15], [-17, 21], [-15, 27], [-10, 31], [-5, 35], [0, 36], [10, 37], [11, 34], [20, 32], [30, 31], [32, 31], [35, 28], [37, 22], [39, 18], [43, 12], [48, 11], [51, 10], [46, 5], [42, 0], [40, -5], [40, -10], [36, -18], [33, -26], [28, -33], [20, -35], [17, -32], [15, -27], [13, -18], [12, -12], [13, -5], [9, 4], [4, 6], [-8, 5], [-13, 8], [-17, 12]],
  [[-10, 36], [-9, 38], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [-2, 50], [0, 51], [3, 53], [8, 55], [8, 57], [10, 59], [5, 60], [5, 62], [10, 64], [12, 66], [18, 69], [25, 71], [30, 70], [35, 68], [40, 68], [50, 69], [60, 69], [70, 72], [80, 73], [90, 75], [100, 77], [110, 74], [120, 73], [130, 72], [140, 72], [150, 70], [160, 70], [170, 67], [178, 65], [170, 60], [162, 56], [158, 52], [156, 50], [150, 59], [142, 59], [142, 54], [140, 46], [135, 43], [130, 42], [127, 40], [122, 38], [120, 32], [115, 23], [110, 20], [108, 18], [105, 10], [103, 8], [100, 8], [98, 10], [95, 16], [92, 21], [89, 22], [86, 20], [80, 13], [77, 8], [75, 12], [72, 20], [66, 25], [62, 25], [58, 26], [56, 27], [52, 26], [50, 29], [48, 30], [44, 29], [42, 27], [39, 21], [39, 18], [35, 18], [34, 28], [36, 36], [33, 36], [30, 36], [27, 37], [23, 36], [19, 40], [15, 44], [12, 44], [8, 44], [3, 43], [0, 40], [-2, 37], [-6, 36]],
  [[113, -22], [114, -30], [115, -35], [120, -34], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
  [[130, 31], [132, 33], [134, 34], [136, 35], [138, 35], [140, 36], [141, 39], [141, 42], [142, 44], [144, 44], [142, 42], [140, 38], [137, 37], [133, 35], [131, 33]],
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51]],
  [[95, 5], [98, 3], [100, 0], [104, -3], [106, -6], [110, -7], [114, -8], [118, -9], [120, -10], [122, -9], [119, -5], [116, -2], [112, 0], [108, 2], [104, 4], [100, 5]],
  [[109, 1], [113, 4], [117, 6], [119, 1], [117, -3], [113, -3], [110, -1]],
  [[131, -1], [136, -2], [141, -3], [141, -8], [137, -8], [133, -4]],
  [[44, -16], [47, -15], [50, -16], [49, -20], [47, -24], [44, -25], [43, -20]],
  [[167, -45], [170, -42], [174, -38], [176, -38], [178, -37], [175, -40], [172, -43], [168, -46]],
  [[-22, 64], [-18, 63], [-15, 64], [-14, 66], [-18, 67], [-22, 66]],
  [[80, 6], [81, 7], [81, 9], [80, 9]],
  [[120, 14], [121, 16], [122, 18], [122, 14], [121, 12], [120, 10], [122, 9], [124, 10], [126, 8], [124, 6], [122, 7]],
  [[-84, 22], [-80, 23], [-77, 21], [-74, 20]],
];

// ---------- vector art ----------
// starburst helper (explosion / sun)
function burst(cv, cx, cy, r, c, spikes = 8) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i * Math.PI) / spikes;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  cv.fillPoly(pts, c);
}
function flag(cv, x, y, w, h, colors) {
  const n = colors.length;
  for (let i = 0; i < n; i++) cv.fillRect(x, y + (h / n) * i, w, h / n + 1, colors[i]);
  cv.fillRect(x, y, 2, h + 14, INK);
}

function leadArt(cv, n, x, y, w, h) {
  if (n === 1) { // COP31 — summit hall, cracked globe, empty podium
    cv.fillRect(x, y, w, h, TEAL);
    cv.fillRect(x, y + h - 26, w, 26, [22, 66, 62]);
    // flags row
    const fc = [[[200, 40, 40], [255, 255, 255], [40, 60, 160]], [[255, 255, 255], [200, 40, 40]], [[255, 215, 0], [0, 0, 0], [200, 40, 40]], [[40, 120, 60], [255, 255, 255], [200, 40, 40]]];
    fc.forEach((f, i) => flag(cv, x + 14 + i * 52, y + 10, 34, 18, f));
    // globe
    const gx = x + w / 2, gy = y + 58, gr = 26;
    cv.disc(gx, gy, gr, [58, 110, 158]);
    cv.ellipse(gx - 8, gy - 8, 10, 7, [70, 150, 90]);
    cv.ellipse(gx + 9, gy + 8, 8, 6, [70, 150, 90]);
    cv.ellipse(gx + 6, gy - 12, 6, 4, [70, 150, 90]);
    cv.ring(gx, gy, gr, [220, 230, 235], 2);
    // crack
    cv.line(gx - 18, gy - 20, gx - 6, gy - 4, RED_D, 3);
    cv.line(gx - 6, gy - 4, gx - 12, gy + 10, RED_D, 3);
    cv.line(gx - 12, gy + 10, gx + 4, gy + 22, RED_D, 3);
    // podium + gavel
    cv.fillRect(x + w / 2 - 30, y + h - 46, 60, 20, [120, 88, 50]);
    cv.fillRect(x + w / 2 - 34, y + h - 50, 68, 5, [90, 64, 34]);
    cv.text('COP31', x + w / 2 - 30, y + h - 32, 'bold', 11, [255, 255, 255]);
    // scattered papers
    cv.fillRect(x + 12, y + h - 34, 16, 10, [240, 236, 220]);
    cv.fillRect(x + w - 30, y + h - 32, 15, 9, [240, 236, 220]);
    cv.text('NO DEAL', x + w - 66, y + 16, 'bold', 12, [255, 220, 60]);
  } else if (n === 2) { // Bahrain — night Gulf, tanker, missile arcs
    cv.fillRect(x, y, w, h, NAVY);
    for (let i = 0; i < 14; i++) cv.disc(x + 12 + i * 17, y + 8 + (i % 3) * 4, 1, [220, 220, 200]);
    // sea
    cv.fillRect(x, y + 58, w, h - 58, [16, 52, 84]);
    cv.line(x, y + 62, x + w, y + 60, [60, 110, 160], 2);
    cv.line(x, y + 74, x + w, y + 72, [60, 110, 160], 1);
    // island + base
    cv.fillPoly([[x + 150, y + 58], [x + 190, y + 50], [x + 210, y + 58]], [150, 140, 100]);
    cv.fillRect(x + 168, y + 40, 4, 12, [220, 220, 220]);
    cv.disc(x + 170, y + 38, 3, RED);
    // tanker
    cv.fillRect(x + 22, y + 66, 96, 12, [30, 30, 34]);
    cv.fillRect(x + 30, y + 54, 18, 12, [200, 60, 40]);
    cv.fillRect(x + 52, y + 58, 10, 8, [230, 200, 60]);
    cv.fillRect(x + 66, y + 58, 10, 8, [60, 160, 90]);
    cv.fillRect(x + 80, y + 58, 10, 8, [230, 200, 60]);
    cv.fillRect(x + 100, y + 56, 8, 10, [220, 220, 220]);
    // missile arcs
    cv.line(x + 30, y + 18, x + 70, y + 44, [255, 180, 60], 2);
    cv.line(x + 70, y + 44, x + 110, y + 62, [255, 180, 60], 2);
    cv.line(x + 210, y + 12, x + 180, y + 38, [255, 180, 60], 2);
    cv.line(x + 180, y + 38, x + 150, y + 56, [255, 180, 60], 2);
    burst(cv, x + 30, y + 18, 7, [255, 220, 90]);
    burst(cv, x + 210, y + 12, 7, [255, 220, 90]);
    burst(cv, x + 118, y + 62, 9, [255, 120, 40]);
    burst(cv, x + 150, y + 56, 8, [255, 120, 40]);
    cv.text('HORMUZ', x + 12, y + h - 8, 'bold', 10, [200, 220, 240]);
  } else if (n === 3) { // Kyiv — dusk, apartment block, collapsed corner, drone
    cv.fillRect(x, y, w, h, [58, 52, 84]);
    cv.fillRect(x, y + 66, w, h - 66, [38, 34, 52]);
    cv.disc(x + w - 26, y + 18, 12, [255, 190, 90]);
    // block
    const bx = x + 30, by = y + 22, bw = 110, bh = 62;
    cv.fillRect(bx, by, bw, bh, [120, 108, 92]);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      const lit = (r + c) % 3 !== 0;
      cv.fillRect(bx + 8 + c * 17, by + 7 + r * 14, 10, 9, lit ? [255, 214, 120] : [40, 38, 44]);
    }
    // collapsed corner (rubble)
    cv.fillPoly([[bx + bw - 34, by + 30], [bx + bw, by + 30], [bx + bw, by + bh], [bx + bw - 44, by + bh]], [70, 64, 54]);
    cv.fillPoly([[bx + bw - 44, by + bh], [bx + bw, by + bh], [bx + bw + 6, y + h - 8], [bx + bw - 52, y + h - 8]], [88, 80, 66]);
    cv.fillRect(bx + bw - 20, by + 34, 8, 6, [200, 60, 40]);
    // drone + trail
    cv.fillRect(x + 12, y + 12, 22, 4, [20, 20, 24]);
    cv.line(x + 12, y + 14, x + 2, y + 30, RED, 2);
    cv.line(x + 2, y + 30, x + 30, y + 44, RED, 2);
    // searchlight
    cv.fillPoly([[x + 180, y + h - 4], [x + 200, y + h - 4], [x + 228, y + 20]], [255, 240, 180]);
    cv.fillRect(x + 176, y + h - 12, 28, 8, [60, 58, 52]);
    cv.text('DYMER · KYIV REGION', x + 10, y + h - 8, 'bold', 9, [230, 225, 210]);
  } else { // Sinaloa — desert dusk, helicopter, convoy
    cv.fillRect(x, y, w, h, [196, 130, 74]);
    cv.disc(x + w - 30, y + 20, 13, [255, 214, 140]);
    cv.fillPoly([[x, y + 52], [x + 60, y + 22], [x + 120, y + 52]], [150, 96, 52]);
    cv.fillPoly([[x + 90, y + 52], [x + 160, y + 18], [x + 230, y + 52]], [134, 84, 46]);
    cv.fillRect(x, y + 52, w, h - 52, [176, 122, 66]);
    // cactus
    cv.fillRect(x + 14, y + 66, 6, 26, [50, 110, 60]);
    cv.fillRect(x + 8, y + 74, 6, 10, [50, 110, 60]);
    cv.fillRect(x + 20, y + 78, 6, 8, [50, 110, 60]);
    // helicopter
    const hx = x + 96, hy = y + 30;
    cv.fillRect(hx - 26, hy, 52, 12, [40, 44, 52]);
    cv.fillRect(hx + 22, hy + 3, 26, 5, [40, 44, 52]);
    cv.line(hx - 34, hy - 2, hx + 34, hy - 2, [30, 32, 38], 3);
    cv.line(hx - 8, hy - 2, hx - 8, hy - 12, [30, 32, 38], 2);
    cv.disc(hx + 44, hy + 5, 4, [200, 40, 40]);
    cv.fillPoly([[hx - 10, hy + 12], [hx + 10, hy + 12], [hx + 26, y + 52]], [255, 240, 160]);
    // convoy + headlights
    for (let i = 0; i < 3; i++) {
      const vx = x + 120 + i * 34;
      cv.fillRect(vx, y + 74, 26, 12, [30, 34, 40]);
      cv.disc(vx + 4, y + 88, 3, INK); cv.disc(vx + 22, y + 88, 3, INK);
      cv.disc(vx + 2, y + 79, 2, [255, 240, 150]);
    }
    cv.text('GUASAVE · SINALOA', x + 10, y + h - 8, 'bold', 9, [255, 245, 220]);
  }
}

function picArt(cv, n, x, y, w, h) {
  const bg = [232, 222, 196];
  cv.fillRect(x, y, w, h, bg);
  if (n === 5) { // aid van + smoke
    cv.fillRect(x, y + h - 18, w, 18, [120, 110, 90]);
    cv.fillRect(x + 30, y + 16, 60, 16, [240, 240, 235]);
    cv.fillRect(x + 84, y + 20, 22, 12, [200, 60, 40]);
    cv.disc(x + 44, y + 34, 5, INK); cv.disc(x + 88, y + 34, 5, INK);
    cv.disc(x + 130, y + 14, 7, [120, 120, 120]); cv.disc(x + 142, y + 8, 9, [140, 140, 140]);
    cv.fillRect(x + 120, y + 26, 12, 8, [176, 128, 28]); cv.fillRect(x + 136, y + 26, 12, 8, [176, 128, 28]);
  } else if (n === 6) { // house + flame
    cv.fillRect(x + 60, y + 16, 60, 22, [180, 150, 110]);
    cv.fillPoly([[x + 56, y + 16], [x + 90, y + 4], [x + 124, y + 16]], RED_D);
    burst(cv, x + 90, y + 12, 8, [255, 160, 40]);
    cv.fillRect(x + 30, y + 28, 20, 8, [40, 44, 52]);
    cv.line(x + 120, y + 30, x + 150, y + 34, [120, 110, 90], 2);
  } else if (n === 7) { // talks table + flags
    cv.fillRect(x, y + 26, w, 6, [120, 88, 50]);
    flag(cv, x + 24, y + 6, 26, 13, [[200, 40, 40], [255, 255, 255], [40, 60, 160]]);
    flag(cv, x + 84, y + 6, 26, 13, [[40, 60, 160], [255, 255, 255], [200, 40, 40]]);
    flag(cv, x + 144, y + 6, 26, 13, [[255, 215, 0], [200, 40, 40]]);
    cv.fillRect(x + 78, y + 20, 34, 6, [255, 255, 255]);
    cv.disc(x + 60, y + 22, 4, [220, 180, 120]); cv.disc(x + 130, y + 22, 4, [220, 180, 120]);
  } else if (n === 8) { // missile + NATO star
    cv.line(x + 10, y + 30, x + 120, y + 8, [255, 120, 40], 3);
    cv.fillPoly([[x + 118, y + 4], [x + 132, y + 8], [x + 118, y + 12]], [60, 60, 64]);
    burst(cv, x + 150, y + 20, 9, [30, 74, 115]);
    cv.text('NATO', x + 138, y + 36, 'bold', 9, BLUE);
  } else if (n === 9) { // jets over strait
    cv.fillRect(x, y + 24, w, h - 24, [58, 110, 158]);
    cv.fillPoly([[x + 60, y + 10], [x + 74, y + 24], [x + 88, y + 24], [x + 80, y + 34]], [40, 110, 60]);
    for (let i = 0; i < 3; i++) {
      const jx = x + 110 + i * 22;
      cv.fillPoly([[jx, y + 8], [jx + 14, y + 12], [jx, y + 16]], [40, 44, 52]);
    }
    cv.fillRect(x + 30, y + 28, 40, 6, [60, 60, 64]);
  } else if (n === 10) { // factory fire
    cv.fillRect(x + 50, y + 14, 90, 24, [140, 130, 110]);
    cv.fillRect(x + 60, y + 6, 8, 10, [90, 84, 74]); cv.fillRect(x + 120, y + 6, 8, 10, [90, 84, 74]);
    burst(cv, x + 95, y + 12, 10, [255, 160, 40]);
    burst(cv, x + 120, y + 16, 7, [255, 120, 40]);
    cv.disc(x + 95, y + 4, 6, [120, 120, 120]); cv.disc(x + 108, y + 2, 8, [140, 140, 140]);
  } else if (n === 11) { // boat + waves
    cv.fillRect(x, y + 22, w, h - 22, [58, 110, 158]);
    cv.line(x, y + 26, x + w, y + 24, [255, 255, 255], 2);
    cv.line(x, y + 32, x + w, y + 30, [255, 255, 255], 1);
    cv.fillPoly([[x + 60, y + 18], [x + 130, y + 18], [x + 120, y + 28], [x + 70, y + 28]], [120, 88, 50]);
    cv.fillRect(x + 88, y + 8, 4, 12, [90, 64, 34]);
    cv.ring(x + 150, y + 14, 7, RED, 3);
  } else if (n === 12) { // Shuri Castle
    cv.disc(x + 160, y + 12, 9, [255, 190, 90]);
    cv.fillRect(x + 60, y + 26, 70, 12, [180, 60, 50]);
    cv.fillRect(x + 66, y + 16, 58, 12, [200, 70, 55]);
    cv.fillRect(x + 72, y + 8, 46, 10, [220, 80, 60]);
    cv.fillPoly([[x + 56, y + 26], [x + 95, y + 18], [x + 134, y + 26]], [140, 40, 34]);
    cv.fillRect(x + 60, y + 26, 70, 4, [120, 90, 60]);
  } else if (n === 13) { // protest crowd + placards
    for (let i = 0; i < 8; i++) {
      const px = x + 14 + i * 22;
      cv.disc(px, y + 22, 5, [60, 60, 64]);
      cv.fillRect(px - 6, y + 28, 12, 10, i % 2 ? BLUE : RED);
    }
    cv.fillRect(x + 40, y + 6, 34, 12, [255, 255, 255]); cv.rect(x + 40, y + 6, 34, 12, INK, 1);
    cv.fillRect(x + 120, y + 4, 34, 12, [255, 220, 60]); cv.rect(x + 120, y + 4, 34, 12, INK, 1);
  } else { // markets — plunging chart
    cv.fillRect(x, y, w, h, [24, 42, 68]);
    for (let i = 0; i < 8; i++) {
      const bh = 8 + ((i * 7) % 18);
      cv.fillRect(x + 14 + i * 22, y + h - 8 - bh, 12, bh, i > 4 ? [200, 60, 40] : [70, 150, 90]);
    }
    cv.line(x + 10, y + 10, x + 60, y + 16, [255, 120, 60], 3);
    cv.line(x + 60, y + 16, x + 120, y + 24, [255, 120, 60], 3);
    cv.line(x + 120, y + 24, x + 180, y + 36, [255, 120, 60], 3);
    cv.text('−5.3%', x + 140, y + 14, 'bold', 11, [255, 120, 60]);
  }
}
function numBadge(cv, n, x, y) {
  cv.fillRect(x, y, 20, 20, RED);
  const s = String(n);
  cv.text(s, x + 10 - textWidth(s, 'bold', 11) / 2, y + 15, 'bold', 11, [255, 255, 255]);
}

// ---------- map with declustered pins ----------
function renderMap(cv, mx, my, mw, mh) {
  cv.fillRect(mx, my, mw, mh, [224, 234, 240]);
  cv.rect(mx, my, mw, mh, INK, 1);
  const px = (lon) => mx + ((lon + 180) / 360) * mw;
  const py = (lat) => my + ((84 - lat) / (84 + 58)) * mh;
  // graticule
  for (let lon = -150; lon <= 150; lon += 30) cv.vline(px(lon), my, my + mh, [200, 210, 218]);
  for (let lat = 60; lat >= -40; lat -= 20) cv.hline(mx, mx + mw, py(lat), [200, 210, 218]);
  // land
  for (const poly of LAND_POLYS) {
    const pts = poly.map(([lo, la]) => [px(lo), py(la)]);
    cv.fillPoly(pts, LAND);
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      cv.line(x1, y1, x2, y2, [150, 136, 100], 1);
    }
  }
  // ocean labels
  cv.text('ATLANTIC', px(-38), py(28), 'italic', 9, [90, 110, 130]);
  cv.text('PACIFIC', px(-140), py(8), 'italic', 9, [90, 110, 130]);
  cv.text('PACIFIC', px(168), py(-8), 'italic', 9, [90, 110, 130]);
  cv.text('INDIAN OCEAN', px(84), py(-28), 'italic', 9, [90, 110, 130]);
  cv.text('ARCTIC OCEAN', px(-120), py(78), 'italic', 9, [90, 110, 130]);
  // pins: anchor = true position, badge = relaxed position
  const pins = STORIES.map((s) => ({ n: s.n, ax: px(s.lon), ay: py(s.lat), x: px(s.lon), y: py(s.lat) }));
  const MIN = 19;
  for (let it = 0; it < 120; it++) {
    let moved = false;
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < MIN && d > 0.01) {
          const push = (MIN - d) / 2;
          dx /= d; dy /= d;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
          moved = true;
        }
      }
    }
    for (const p of pins) {
      p.x = Math.max(mx + 10, Math.min(mx + mw - 10, p.x));
      p.y = Math.max(my + 10, Math.min(my + mh - 10, p.y));
    }
    if (!moved) break;
  }
  // collision measurement (badge centres closer than 16px)
  let minD = Infinity, collisions = 0;
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const d = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y);
      if (d < minD) minD = d;
      if (d < 16) collisions++;
    }
  }
  // leader lines + true-point dots, then badges
  for (const p of pins) {
    cv.disc(p.ax, p.ay, 2, RED_D);
    if (Math.hypot(p.x - p.ax, p.y - p.ay) > 3) cv.line(p.ax, p.ay, p.x, p.y, [90, 80, 60], 1);
  }
  for (const p of pins) {
    cv.disc(p.x, p.y, 8, RED);
    cv.ring(p.x, p.y, 8, [255, 255, 255], 1);
    const s = String(p.n);
    cv.text(s, p.x - textWidth(s, 'bold', 9) / 2, p.y + 3, 'bold', 9, [255, 255, 255]);
  }
  return { minDist: Math.round(minD * 10) / 10, collisions, pins: pins.length };
}

// ---------- layout ----------
function trunc(s, face, size, maxW) {
  if (textWidth(s, face, size) <= maxW) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + '…', face, size) > maxW) out = out.slice(0, -1);
  return out + '…';
}

function build() {
  const cv = new Canvas();
  const MX = 14, MW = 996;
  // border
  cv.rect(8, 8, 1008, 1008, INK, 2);
  cv.rect(12, 12, 1000, 1000, LINE, 1);
  // masthead
  cv.textC('THE WORLD IN ONE PAGE — SUNDAY', 512, 32, 'bold', 13, RED, 3);
  cv.textC('22 NOVEMBER 2026', 512, 86, 'bold', 60, INK);
  cv.textC('SUNDAY’S WORLD NEWS  ·  40 STORIES  ·  7 REGIONS  ·  EVERY STORY NUMBERED  ·  REPORTED 22 NOVEMBER 2026', 512, 104, 'regular', 11, GREY);
  cv.fillRect(MX, 110, MW, 2, INK);
  cv.fillRect(MX, 113, MW, 1, INK);
  // numbers strip
  const nums = [
    ['40', 'STORIES IN THIS ISSUE'], ['7', 'REGIONS COVERED'], ['190+', 'NATIONS AT COP31'],
    ['186', 'DRONES OVER UKRAINE'], ['24', 'DEAD IN NIGERIA BOAT'], ['−3.7%', 'S&P 500 ON FRIDAY'],
  ];
  nums.forEach(([v, l], i) => {
    const cx = MX + (i + 0.5) * (MW / 6);
    if (i > 0) cv.vline(MX + i * (MW / 6), 120, 146, LINE);
    cv.textC(v, cx, 134, 'bold', 16, RED);
    cv.textC(l, cx, 146, 'regular', 9, GREY);
  });
  cv.fillRect(MX, 150, MW, 1, LINE);
  // leads
  const leads = STORIES.filter((s) => s.kind === 'lead');
  const lw = (MW - 3 * 8) / 4;
  leads.forEach((s, i) => {
    const x = MX + i * (lw + 8);
    leadArt(cv, s.n, x, 156, lw, 102);
    numBadge(cv, s.n, x, 156);
    cv.rect(x, 156, lw, 102, INK, 1);
    cv.text(trunc(s.kicker, 'bold', 9, lw), x, 274, 'bold', 9, RED, 1);
    const headLines = cv.wrap(s.head, 'bold', 13, lw).slice(0, 2);
    headLines.forEach((ln, k) => cv.text(ln, x, 290 + k * 15, 'bold', 13, INK));
    const deckLines = cv.wrap(s.deck, 'regular', 11, lw).slice(0, 3);
    deckLines.forEach((ln, k) => cv.text(ln, x, 322 + k * 13, 'regular', 11, INK));
    cv.text('Source: ' + s.src, x, 366, 'italic', 9, GREY);
    if (i > 0) cv.vline(x - 4, 156, 366, LINE);
  });
  cv.fillRect(MX, 372, MW, 1, LINE);
  // picture stories
  cv.text('MORE OF THE DAY — IN PICTURES', MX, 388, 'bold', 12, INK, 1);
  cv.text('EVERY PICTURE IS NUMBERED — FIND IT ON THE MAP BELOW', 1010, 388, 'regular', 9, GREY);
  const pics = STORIES.filter((s) => s.kind === 'pic');
  const pw = (MW - 4 * 8) / 5;
  pics.forEach((s, i) => {
    const row = Math.floor(i / 5), col = i % 5;
    const x = MX + col * (pw + 8);
    const y = 394 + row * 94;
    picArt(cv, s.n, x, y, pw, 40);
    numBadge(cv, s.n, x, y);
    cv.rect(x, y, pw, 40, INK, 1);
    const hl = cv.wrap(s.head, 'bold', 11, pw).slice(0, 2);
    hl.forEach((ln, k) => cv.text(ln, x, y + 54 + k * 13, 'bold', 11, INK));
    const dl = cv.wrap(s.deck, 'regular', 10, pw).slice(0, 2);
    dl.forEach((ln, k) => cv.text(ln, x, y + 80 + k * 12, 'regular', 10, INK));
  });
  cv.fillRect(MX, 588, MW, 1, LINE);
  // map
  cv.text('WHERE IT HAPPENED — EVERY STORY NUMBERED ON THE MAP', MX, 604, 'bold', 12, INK, 1);
  cv.text('RED DOTS MARK THE TRUE PLACE · NUMBERS ARE SPREAD SO NONE OVERLAP', 1010, 604, 'regular', 9, GREY);
  const mapStats = renderMap(cv, MX, 610, MW, 124);
  // briefs
  const briefs = STORIES.filter((s) => s.kind === 'brief');
  const bw = (MW - 2 * 10) / 3;
  const cols = [briefs.slice(0, 9), briefs.slice(9, 18), briefs.slice(18, 26)];
  cols.forEach((col, ci) => {
    const x = MX + ci * (bw + 10);
    col.forEach((s, ri) => {
      const y = 742 + ri * 21;
      cv.text(String(s.n) + '.', x, y + 11, 'bold', 11, RED);
      const hx = x + 24;
      cv.text(trunc(s.head, 'bold', 11, bw - 24), hx, y + 11, 'bold', 11, INK);
      cv.text(trunc(s.deck, 'regular', 10, bw - 24), hx, y + 21, 'regular', 10, [60, 54, 44]);
    });
    if (ci > 0) cv.vline(x - 5, 742, 930, LINE);
  });
  // region bar
  const counts = {};
  for (const s of STORIES) counts[s.reg] = (counts[s.reg] || 0) + 1;
  let rx = MX;
  for (const r of REGIONS) {
    const w = (MW * counts[r.k]) / STORIES.length;
    cv.fillRect(rx, 938, w, 16, r.c);
    const label = r.name + ' · ' + counts[r.k];
    if (textWidth(label, 'bold', 9) < w - 6) cv.textC(label, rx + w / 2, 950, 'bold', 9, [255, 255, 255]);
    rx += w;
  }
  // UTC timeline
  cv.text('22 NOV · UTC', MX, 968, 'bold', 9, RED);
  const tx0 = 110, tx1 = 1010;
  cv.line(tx0, 964, tx1, 964, LINE, 1);
  const events = [
    [3.0, '03:00'], [7.22, '07:13'], [10.73, '10:44'], [15.0, '15:00'],
  ];
  for (const [h, t] of events) {
    const ex = tx0 + (h / 24) * (tx1 - tx0);
    cv.disc(ex, 964, 3, RED);
    cv.textC(t, ex, 960, 'bold', 9, INK);
  }
  cv.text('03:00 Kyiv drones  ·  07:13 Shuri Castle opens  ·  09:20 COP31 breaks down  ·  09:42 Cikande fire  ·  10:44 Eisenkot condemns  ·  15:00 ‘No deal’ confirmed', 512, 978, 'regular', 9, GREY);
  // footer: DATE CHECK + sources
  cv.fillRect(MX, 982, MW, 1, LINE);
  const dc = 'DATE CHECK — Only 21–22 Nov events, first reported Sun 22 Nov. NOT TODAY: Thu 19 Nov — ICJ Rohingya verdict (9–6) · 19–20 Nov — Shenzhen summit · Fri 20 Nov — Russia’s biggest barrage. NOT YET: COP31 follow-up · Moscow/Dublin briefings · Spain 29 Nov · G20 Miami.';
  const dcLines = cv.wrap(dc, 'regular', 9, MW);
  dcLines.forEach((ln, i) => {
    if (i === 0) {
      cv.text('DATE CHECK — ', MX, 992, 'bold', 9, RED);
      cv.text(ln.replace(/^DATE CHECK — /, ''), MX + textWidth('DATE CHECK — ', 'bold', 9), 992, 'regular', 9, INK);
    } else cv.text(ln, MX, 992 + i * 10, 'regular', 9, INK);
  });
  const srcY = 992 + dcLines.length * 10;
  cv.text('Sources: AP · Reuters · AFP · CNN · BBC · Al Jazeera · NPR · WRI · The Times · Euromaidan Press · Sky Sports · Variety. Figures as reported 22 Nov 2026.', MX, Math.min(srcY, 1009), 'italic', 9, GREY);
  return { cv, mapStats, regionCounts: counts, dcLines: dcLines.length };
}

// ---------- main ----------
const { cv, mapStats, regionCounts, dcLines } = build();
const png = encodePNG(cv);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
const sha = createHash('sha256').update(png).digest('hex');
const layers = {
  leads: STORIES.filter((s) => s.kind === 'lead').length,
  pictures: STORIES.filter((s) => s.kind === 'pic').length,
  briefs: STORIES.filter((s) => s.kind === 'brief').length,
};
console.log(JSON.stringify({
  stories: STORIES.length, layers, regions: regionCounts,
  mapPins: mapStats.pins, mapMinDistPx: mapStats.minDist, mapCollisions: mapStats.collisions,
  dateCheckLines: dcLines, width: W, height: H, bytes: png.length, sha256: sha,
}, null, 2));
