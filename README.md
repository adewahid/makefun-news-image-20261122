[![make.fun](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/bounty/news-image-20261122)
[![Rank](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/rank.svg)](https://make.fun/bounty/news-image-20261122)
[![Reward](https://make.fun/badge/news-image-20261122/adewahid/makefun-news-image-20261122/reward.svg)](https://make.fun/bounty/news-image-20261122)

Referral: `zsgcm8j7` — https://make.fun/r/zsgcm8j7

# news-image-20261122 — "The World in One Page"

The world news of **Sunday 22 November 2026**, drawn as a single newspaper
page (1024x1024 PNG). 39 stories, all reported on that day: 4 illustrated
leads, 8 picture stories, 27 briefs, a world map with a numbered pin for
every story, a numbers strip, a region count, a UTC timeline, and a
DATE CHECK footer naming what was deliberately left out (events from
earlier in the week) and what had not happened yet.

## Build

- `genfont.mjs` — parses the system Liberation Serif TTFs and rasterises
  their outlines into `fonts.bin` (real serif glyphs, no hand-drawn type).
- `main.ts` — Node 22, stdlib only, no network. Reads `fonts.bin`, draws
  the page on a 3x supersampled canvas, writes `$MAKEFUN_OUTPUT_DIR/entry.png`.
- Run: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` (~1.2 s).

## The 39 stories (all reported 22 Nov 2026)

Leads: 1. Iran says it fired on a US F-16 over the Gulf; US denies it
(Reuters/AP). 2. Russia's overnight barrage: 400 drones, 110 missiles;
2 killed, 60 wounded in Kryvyi Rih (AP/Reuters). 3. Russian missiles cross
into Poland; Finland holds Baltic curbs after the Sparta II drone strike
(Reuters). 4. Mexico captures 'El Chapo Isidro', FBI most-wanted drug
lord; 11 killed in Sinaloa violence (AP/Reuters).

Picture stories: 5. EU-Indonesia trade deal, 730m people. 6. Troops mass
on the Ethiopia-Eritrea border. 7. Estonia to shut its border with Russia.
8. Denmark says it foiled a Russian-backed murder plot. 9. France seeks
UN action over Myanmar. 10. Bolsonaro in intensive care. 11. Japan's
economy shrinks 0.1%. 12. Liverpool host Manchester United tonight.

Briefs 13-39: Trump on China's nuclear build-up; Trump on a 20-year Iran
deal; Melania Trump urges more Ukraine ceasefires; Zelenskyy floats G20
peace talks; US-France UN text for post-UNIFIL Lebanon; Saudi coalition
downs three Houthi missiles; four Palestinians killed in Gaza breaches;
Israel defence deals up to $1.1bn; Iraq forces in militia stronghold;
Basra power-plant fire (4 dead, 35 hurt); US airlines warned of
al-Qaeda-linked threat; FBI probes criminal-justice database hack; Trump
orders federal contractors to answer Congress; Bessent on Nvidia chips
for China; ~900,000 AI chip shipments to China approved; EU Big Tech tax;
COP31 AI pledge fails to draw US tech; Modi opens Nitish Setu bridge;
Cyclone Akvan cancels 14 Ranchi flights; Manipur: 11 die from
adulterated alcohol; Lisbon march over living costs; Ireland beat South
Africa (who still reach the final); Nadal joins Real Madrid board;
Cummins keeps Australia captaincy; US tipped to host Copa America 2028;
Vietnam scraps death penalty for drug smuggling; Gupta jailed 19 years
over the Pannun plot.

Sources: Reuters, AP, BBC, Al Jazeera, The Times of India, Yle.
