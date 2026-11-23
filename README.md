# Sunday 22 November 2026 — The World in One Day (v5)

[![news-image-20261122](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/rank.svg)](https://make.fun/c/news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/reward.svg)](https://make.fun/c/news-image-20261122)
[![entries](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/entries.svg)](https://make.fun/c/news-image-20261122)

Referral code: `zsgcm8j7` — https://make.fun/r/zsgcm8j7

A single self-contained Node 22 program (`main.ts`, standard library only)
that draws a 1024×1024 newspaper front page summing up **Sunday 22 November
2026** in one image — and nothing else. No external image libraries: it ships
its own PNG encoder, its own raster canvas (with clipping, so the map inset
reuses the real coastline data), and its own bitmap font engine. The glyphs
in `fonts.json` are real **Liberation Serif** (Regular / Bold / Italic),
baked from the system TTFs by `gen-fonts.py` (PIL/FreeType), never a
hand-drawn font.

## What's on the page

- **35 stories, all numbered 1–35, all dated Sunday 22 November 2026:**
  3 illustrated leads, 12 picture stories, 20 briefs.
- **Leads:** COP31 ends with no deal — the final text, which never names
  fossil fuels, is rejected (the first COP to close with no deal since
  2000); Russia fires 186 drones at Ukraine and a Kyiv-region block is
  destroyed; Iran claims two US radars hit in Bahrain, Bahrain denies it.
- **12th picture story (new in v5):** the Pope's lunch — 1,300 poor guests
  in the Paul VI Hall, with a new drawn "lunch" scene.
- **Picture-story art is ~95px tall** (v4's was ~50px), funded by
  compressing the lead art to 88px and the map to ~150px.
- **Every story carries a status tag** — CONFIRMED / CLAIM / REPORTED /
  PENDING — with a "HOW SURE ARE WE?" legend as a thin inline strip.
- **Numbers strip, coloured region bar, and "THE DAY IN UTC" timeline near
  the top**; press time 23:00 UTC. Regions: Europe 10 · Middle East 5 ·
  Asia-Pacific 8 · Americas 4 · Africa 5 · Oceania 3 (= 35).
- **World map** with all 15 lead/picture stories pinned by number,
  declustered with leader lines, plus a **"EUROPE & MIDDLE EAST —
  ENLARGED" inset** on the map's empty Pacific area so pins 1, 2, 3, 7, 8,
  9 and 15 are readable.
- **DATE CHECK footer (red box):** the Friday stories left out on purpose —
  'El Chapo Isidro' captured (Fri 21 Nov), Peru quake (Fri 20 Nov),
  Russia's 400-drone barrage (19–20 Nov), Shenzhen summit (19 Nov), ICJ
  Rohingya verdict (Thu 19 Nov), Kryvyi Rih double-tap (Fri 20–21 Nov) —
  plus what is NOT YET known (the ATP Finals title match, Liverpool v Man
  Utd, the Dymer rescue toll).
- **Sources line** naming the outlets behind the figures. All stories were
  verified against live reporting (Reuters · AP · AFP · BBC and the wires)
  on 23 November 2026.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Output is deterministic: two runs produce byte-identical `entry.png`
(335,955 bytes, sha256
`e09d02fb0bf34b35e5a822bf8b8c3af0b842f120430edf9ad9c46ed143ee3f18`).

To regenerate the font data after editing the glyph set:

```sh
python3 gen-fonts.py fonts.json
```

## Sources

Reuters · BBC · AP · AFP · Al Jazeera · The Guardian · ESPN · Cricbuzz ·
Vatican News · Korea JoongAng Daily · Nepal MFA. All figures as reported
22 November 2026.
