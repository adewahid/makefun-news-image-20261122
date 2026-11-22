# Sunday 22 November 2026 — The World in One Day (v4)

[![make.fun · news-image-20261122](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/bounty/news-image-20261122?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261122)
[![rank](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/rank.svg)](https://make.fun/bounty/news-image-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/reward.svg)](https://make.fun/bounty/news-image-20261122?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261122)

Referral code: `zsgcm8j7` — https://make.fun/r/zsgcm8j7

A single self-contained Node 22 program (`main.ts`, standard library only)
that draws a 1024×1024 newspaper front page summing up **Sunday 22 November
2026** in one image — and nothing else. No external image libraries: it ships
its own PNG encoder, its own raster canvas, and its own bitmap font engine.
The glyphs in `fonts.json` are real **Liberation Serif** (Regular / Bold /
Italic), baked from the system TTFs by `gen-fonts.py` (PIL/FreeType), never a
hand-drawn font.

## What's on the page

- **35 stories, all numbered 1–35, all dated Sunday 22 November 2026:**
  3 illustrated leads, 11 picture stories, 21 briefs.
- **Leads:** COP31's final text lands at dawn with no mention of fossil
  fuels; Russia fires 186 drones at Ukraine and a Kyiv-region block is
  destroyed; Iran claims two US radars hit in Bahrain, Bahrain denies it.
- **Every story carries a status tag** — CONFIRMED / CLAIM / REPORTED /
  PENDING — with a "HOW SURE ARE WE?" legend.
- **Numbers strip, coloured region bar, and "THE DAY IN UTC" timeline near
  the top**; press time 23:00 UTC. Regions: Europe 10 · Middle East 5 ·
  Asia-Pacific 8 · Americas 4 · Africa 5 · Oceania 3 (= 35).
- **World map** with the 14 lead/picture stories pinned by number; the
  Europe/Middle East cluster is declustered with leader lines.
- **DATE CHECK footer (red box):** the Friday stories left out on purpose —
  'El Chapo Isidro' captured (Fri 21 Nov), Peru quake (Fri 20 Nov), Russia's
  400-drone barrage (19–20 Nov), Shenzhen summit (19 Nov), ICJ Rohingya
  verdict (Thu 19 Nov), Kryvyi Rih double-tap (Fri 20–21 Nov) — plus what is
  NOT YET known (the COP31 final vote, the ATP Finals title match,
  Liverpool v Man Utd).
- **Sources line** naming the outlets behind the figures.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Output is deterministic: two runs produce byte-identical `entry.png`
(324,737 bytes, sha256
`4f1571304cd2e77cf52abfba58deaf4feb581903f4ef55e03771b651db9449ac`).

To regenerate the font data after editing the glyph set:

```sh
python3 gen-fonts.py fonts.json
```

## Sources

Reuters · BBC · AP · AFP · Al Jazeera · The Guardian · ESPN · Cricbuzz ·
Vatican News · Korea JoongAng Daily · Nepal MFA. All figures as reported
22 November 2026.
