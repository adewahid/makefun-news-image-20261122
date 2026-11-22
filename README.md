# 22 November 2026 — The World in One Page

[![news-image-20261122](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/c/news-image-20261122)
[![rank](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/rank.svg)](https://make.fun/c/news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/reward.svg)](https://make.fun/c/news-image-20261122)

Referral code: `zsgcm8j7` — https://make.fun/r/zsgcm8j7

A single self-contained Node 22 program (`main.ts`, standard library only)
that draws a 1024×1024 newspaper front page summing up **Sunday 22 November
2026** in one image — and nothing else. No external image libraries: it ships
its own PNG encoder, its own raster canvas, and its own bitmap font engine.
The glyphs in `fonts.json` are real **Liberation Serif** (Regular / Bold /
Italic / Bold Italic), baked from the system TTFs by `gen-fonts.mjs`, my own
TTF parser and rasterizer — no hand-drawn font anywhere.

## What's on the page

- **40 stories in 3 layers, all numbered 1–40:** 4 illustrated leads, 10
  picture stories, 26 briefs.
- **Leads (the day's biggest real stories, as reported 22 Nov 2026):**
  COP31 collapses in Antalya with no deal on fossil fuels; Iran strikes U.S.
  bases in Bahrain and tankers near Hormuz; a Russian drone flattens a
  five-storey flat block in Dymer as 186 drones fly in overnight; elite
  troops capture cartel boss ‘El Chapo Isidro’ in Sinaloa.
- **World map** with all 40 stories pinned by number; dense spots
  (New York, Washington, Paris, Brussels, London, Bahrain, Gaza) are
  declustered with leader lines to their true places — **0 badge collisions**.
- **Date as giant serif masthead** with red kicker and story-count line,
  a numbers strip, a UTC timeline, a 7-region count bar, per-story sources,
  and a **DATE CHECK** footer that names what was deliberately left out
  (Thu 19 Nov ICJ Rohingya verdict, 19–20 Nov Shenzhen summit, Fri 20 Nov
  Russia's biggest barrage) and what is not yet known.
- **Regions:** Europe 11 · Middle East 7 · Sport & Culture 6 · Markets &
  Tech 5 · Americas 4 · Asia-Pacific 4 · Africa 3.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Output is deterministic: two runs produce byte-identical `entry.png`
(83,421 bytes, sha256
`3520ce1fce9ab859634682dd3d4ece52a64555a04f7178a2e66c21bfc20e724f`).

To regenerate the font data after editing the glyph set:

```sh
node gen-fonts.mjs fonts.json
```

## Sources

AP · Reuters · AFP · CNN · BBC · Al Jazeera · NPR · WRI · The Times ·
Euromaidan Press · Sky Sports · Variety. All figures as reported
22 November 2026.
