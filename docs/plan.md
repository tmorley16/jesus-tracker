# Jesus Tracker — design & build plan

## Direction change (19 October 2026) — this section wins where the plan below conflicts

After style board 1, the core of the main page changed:

- **The four gospels in full, side by side.** Rows follow Robertson's harmony (1922): 185 sections, with the Sermon on the Mount and the lakeside parables split into sub-sections. Every verse of all four gospels appears.
  - Each gospel can be shown or hidden. Rows a hidden gospel would leave empty collapse, so one account reads straight through.
  - Where the harmony order departs from a gospel's own order, the cell says so.
- **A responsive horizontal scrubber at the top**, Artemis-style.
  - **Navigation:** drag or click to scroll the text smoothly; scrolling the text moves the playhead. Wheel or pinch zooms; zooming reveals chapter:verse labels and event titles. Hovering shows the event, its references in each gospel, the place and any feast.
  - **Spacing:** by length of text by default, so the scrubber works like a minimap; "one step per event" is the alternative.
- **Map panel (revised 19 Oct, second round):** the map is a chip like the gospels; any gospels stay open beside it, with a draggable divider. Its default width is 1.5× a gospel column, at most half the screen. Past 80% either way, one side takes the whole screen and the other chips switch off. There's a scale bar. The route line follows only Jesus, fades with age and shows direction. Where no place is named, the map shows a likely area instead of a point; scenes without Jesus get a plain marker and no line. The timeline also has chronological spacing (AD 30 / AD 33 reckonings, optional compression of the hidden years). Details: `docs/backlog.md` → Done.
- **Map view (first round):** the map takes half the screen and the text narrows to one selectable account.
  - The traveller light marks the place, competing site identifications show with their OpenBible scores, and the selected gospel's route is drawn.
  - When the gospels name different places (Gadara, Gerasa), the map follows the account being read.
- **Light is a hidden easter egg.** The page takes on faint tints only where the time of day is stated or the inference is widely agreed. A settings menu offers Dynamic / Light / Dark for accessibility; a dark device setting starts in Dark.
- **Type:** Field Notes (Fraunces, Newsreader, Courier Prime, Figtree). **Gospel colours:** as validated.
- **No art for now.** The user will find local imagery or appropriate historical art in a separate project later.
- **Shoutouts (history, archaeology) are parked**; a different presentation will be explored later.
- **Go to:** search by reference ("Mk 6:30") or event title. Keys: 1–4 gospels, M map, / search.

**Status:**
- Reader prototype 1: https://claude.ai/artifact/6xEy7QUdCDMk8PerSHd6Pd
- Style board 1: https://claude.ai/artifact/CA3aGEkHFYaGGwsdfVsByD

Next: the user's feedback on the reader.

## Context

**Goal:** a website that helps people see, understand and explore the life, ministry and teachings of Jesus. It:
- lines up the four gospel accounts,
- places them on a map across the key phases of his life,
- adds cited "shoutouts" from history, archaeology and the rest of the Bible.

It should be credible to sceptics, deep enough for Christians, and usable by churches and small groups.

**Decisions so far (from you):**
- **Explorer first.** It must read as an *objective tool*, not a layer of interpretation.
- **Visuals carry the story without words.** Journeying is how people move around, not a guided narrative.
- **Look:** Illustrated parchment combined with Dusk→Dawn lighting.
- **Bible text:** the BSB (Berean Standard Bible) built in.
- **Audience:** churches and small groups, Christians wanting depth, and curious sceptics.
- **People in the art:** either no figures, or faceless stylised figures. Jesus is never drawn in either; he is always the traveller light. To be decided by trying both.
- **Way of working:** "try, see and test". Wherever there's a real design choice, the prototypes show the options side by side or behind a switch, rather than us deciding in the abstract.

**Starting point:** the project folder is empty. Node.js and Git aren't installed; winget and VS Code are.

**What the research showed:**
- **artemistimeline.com** has no framework (one HTML file plus a data file, built with Claude Code). A single "current moment" drives everything: the photo, the playhead, the readouts, and a trajectory where the part already travelled glows.
  - The timeline snaps as you scrub, zooms with wheel or pinch, and responds to arrow keys. Every item has its own link.
  - On mobile the panel becomes a bottom sheet with snap points.
  - It has almost no decorative animation. The satisfaction comes from direct control and readouts that update together.
- **dappled.com.au:** the scene's light tints the page's cards, with moving dashed routes and pulsing markers.
- **eddy-naboulet.dev:** a Ctrl/⌘K command palette and a timeline that snaps as you drag it.
- **BibleProject:** the artwork is "personal, non-commercial" and derivatives are banned. So the art is **original**, made in a similar spirit (paper, marker line work, typewriter type for Scripture).
- **Gap in what exists today:** no free site combines all of these:
  - verse-level gospel alignment using public-domain text,
  - a site-level map that shows confidence and competing locations,
  - the AD 30 and AD 33 chronologies,
  - history, archaeology and Old Testament layers.

  The closest (harmony.darrenrowse.com) shows no Bible text and maps only by region.

## Design principles

1. **The text speaks; the tool doesn't preach.** Show the BSB text side by side. Titles describe *what the texts narrate*, not historical verdicts. No devotional commentary.
2. **Every judgement call is visible and switchable.**
   - **Event order:** labelled "Order: Robertson 1922 §n", with a way to view each gospel's own order.
   - **"Same event or two?":** linked events and neutral notes.
   - **Site identifications:** the default is the highest *cited* OpenBible score, labelled as the default, and one tap switches it.
   - **Chronology:** AD 30 and AD 33 shown side by side.
   - **Textual variants:** the BSB footnotes are shown.
3. **Don't invent data.**
   - The lighting changes only where the text states or clearly implies a time.
   - Each route is labelled stated, implied or reconstructed.
   - Distances are given per leg as "~"; there is no "total km walked" figure.
4. **One playhead drives everything** (the Artemis pattern): map, route, marker, light, timeline and panel.
5. **Journeying is how people navigate.**
   - Each step draws the next route segment, and an abstract traveller light walks along it.
   - **▶ Walk** plays through the events automatically.
6. **Efficient first, delightful second.**
   - Keyboard, search and deep links throughout.
   - Restrained motion that follows the reduce-motion setting.
   - Phones get a first-class layout.

## The experience

### Desktop explorer
```
┌────────────────────────────────────────────────────────────────────────┐
│ ✦ Jesus Tracker   Map · Harmony · Teachings · Places · Evidence   ⌘K   │
├─────────────────────────┬──────────────────────────────────────────────┤
│ ◀  14 / 186  ▶   ▶ Walk │        Chorazin ·                            │
│ FEEDING OF THE 5,000    │   Capernaum ●━━━━━━━◉ Bethsaida              │
│ near Bethsaida          │        (route so far; traveller light)       │
│ [et-Tell ●] [el-Araj ○] │                                              │
│ Galilee · Herod Antipas │              Sea of Galilee                  │
│ AD 29 | AD 32 · Passover│                                              │
│ evening · Mt 14:15      │                                              │
│ ~8 km by boat · Mk 6:32 │                                  Layers ▾    │
│ order: Robertson 1922   │                                              │
│ ─────────────────────── │                                              │
│ [Mt] [Mk] [Lk] [Jn]  4/4│                                              │
│ BSB text + footnotes    │                                              │
│ ─ Shoutouts ─────────── │                                              │
│ ◆ Geography  ◆ Language │                                              │
├─────────────────────────┴──────────────────────────────────────────────┤
│ Birth │Prep│Early Judea│      Galilee      │Later Judea│Passion │Risen │
│ Mt ·●·      ·    ·· ·   · ·· ●  · ··        ·   ·   ▐█████▌  · ·     │
│ Mk          ·    ·  ·   · ·  ●  · ·             ·   ▐█████▌  ·       │
│ Lk ··  ·    ·       · · ·  · ●    ·   ·· ·· ·  ··   ▐█████▌  · ··    │
│ Jn     ·  ·· ··· ···         ●       ·· ··· ··  ·   ▐█████▌  · ·     │
│ ◇Passover       ◇Passover    ┃ ◇Passover                    ◇        │
└────────────────────────────────────────────────────────────────────────┘
```
- **Timeline:**
  - phase bands across the top;
  - **four gospel lanes** (a dot wherever that gospel records the event), plus an "Other NT" lane for Acts 1 and 1 Cor 15. You can see at once where all four accounts converge and what is unique to each;
  - markers for the feasts;
  - a playhead that snaps to events as you drag;
  - wheel or pinch zoom.
- **Axis modes:**
  - **Sequence:** events evenly spaced (the default).
  - **Time:** spacing follows the dates under AD 30 or AD 33, and the dots animate when you switch. The hidden years would otherwise fill about 90% of this axis, so it has a break there. Passion Week zooms to days and hours.
- **Event panel:**
  - **Readouts:**
    - **site candidate chips:** they move the pin and recalculate distances;
    - the region, and who ruled it at the time;
    - **dates under both chronologies;**
    - the feast;
    - the time of day, with the verse that gives it;
    - distance and climb from the previous place;
    - where the event's position in the order comes from.
  - **Gospel tabs** with markers showing which gospels record the event, plus a **Compare** button that widens the panel to four columns.
  - **Shoutout cards.**
- **Navigation:**
  - ← → keys, buttons and swipe.
  - Ctrl/⌘K search across events, places, people and passages ("Mk 6:30").
  - Filter chips: gospel, type, and "in all four".
  - A permanent link for every event (`/explore/feeding-of-the-5000/`). The gospel tab, chronology and chosen site go in the link too.
- **Map layers** (phase 3): regions and rulers by period · later Roman roads · candidate sites · archaeology · 3D terrain.

### Mobile
```
┌──────────────────────┐
│ ✦             ⌘K  ☰  │
│        MAP           │
│   ●━━━━◉ Bethsaida   │
├──────────────────────┤ ← drag: peek / half / full
│ ▔Galilee▔▔▔▔▔▔▔▔▔▔▔  │   slim timeline + phase band
│ ·· · ·●· ·  ·        │
│ ◀ FEEDING OF 5,000 ▶ │   swipe ⇆ to step between events
│ [Mt][Mk][Lk][Jn] 4/4 │
│ BSB text…            │
└──────────────────────┘
```
On a phone, Compare becomes four columns you swipe between. Without WebGL2 the site falls back to a static map plus a list.

### Light system: Dusk → Dawn, driven only by the text

| Light | When the text says… | Feel |
|---|---|---|
| Not stated (the default) | most events | neutral warm parchment |
| Pre-dawn | Mk 1:35 "still dark" · Mt 14:25 "fourth watch" · Jn 20:1 | cool blue-grey |
| Dawn / early morning | Mk 16:2 "just after sunrise" · Jn 18:28 · Jn 21:4 | rose-gold |
| Day (a stated daylight hour; added during setup) | Mk 15:25 "the third hour" · Mk 15:34 "the ninth hour" | crisp, sunlit |
| Midday | Jn 4:6 "about the sixth hour" (how hours were counted is debated, so it gets a note) | bleached, high contrast |
| Evening | Mk 1:32 "after sunset" · Mk 4:35 · Lk 24:29 | amber |
| Night | Lk 2:8 · Jn 3:2 · Jn 13:30 "went out into the night" · Gethsemane (implied by the torches, Jn 18:3) | indigo ink, lamp-gold |
| Darkness | Mt 27:45 / Mk 15:33 / Lk 23:44, sixth to ninth hour | near-black at midday, drained of colour |

- **The light follows the gospel tab you're reading.** At the empty tomb, John says "still dark" and Mark "just after sunrise". The darkness at the crucifixion appears only in the Synoptics, so John's tab stays light. The Passion arc emerges on its own, because those chapters are full of time cues.
- **How it works:**
  - Each state is a set of design tokens.
  - In CSS, the light variables are registered with `@property` so they animate smoothly. Text colours are fixed for each state and pass WCAG AA.
  - On the map the sun stays fixed in the north-west. Time of day comes from a "veil" layer, the hillshade colours, and a cross-fade between two elevation-tint ramps. These are the only map properties that animate.
  - A switch offers: follow the text / always day / always night.

### Visual language: illustrated parchment
- **Material and colour:** warm paper with grain, ink line work, and a few accents: olive, terracotta, lake teal, ochre-gold, and ember red used sparingly.
- **Map:**
  - MapLibre's built-in `color-relief` elevation tint plus warm hillshade;
  - **ink contour lines** from the maplibre-contour plugin (BSD-3). Its v6 compatibility gets checked in the slice; if it fails, the contours get generated at build time instead;
  - flat teal water with hand-drawn style shorelines;
  - paper grain built into the map style, not CSS blend modes laid over the map (too slow on phones);
  - **no modern borders or country names**.
- **Labels:**
  - Place names use MapLibre symbol layers with our own fonts (MapLibre's font-maker).
  - HTML overlays only for the 15 or so "story" labels and chips: the active, previous and next places, and site candidates.
- **Type** (final choice on the style board): a characterful display serif for titles, a very readable serif for Scripture, a mono for readouts (the Artemis "telemetry" feel), and a sans for the interface.
- **Gospels:** each has a colour and a monogram. Jerome's emblems (Matthew man, Mark lion, Luke ox, John eagle) are an option. Ancient writers assigned them differently, which makes a nice shoutout.
- **Shoutout card kinds**, each with its own icon. Every card carries citations, and a "consensus / majority / debated" standing where it applies.
  - **Archaeology**
  - **Outside the Bible**
  - **Old Testament quotations:** only those the gospel itself marks ("to fulfil", "it is written"). Allusions come only from a cited index and are labelled "proposed".
  - **Geography**
  - **Culture & custom**
  - **Language:** Aramaic words preserved in the text, e.g. "Talitha koum", Mk 5:41.
  - **Textual note:** e.g. Mk 16:9–20, Jn 7:53–8:11.
  - **Comparing the accounts**

### Ways to slice the story (views)
| View | What it shows |
|---|---|
| **Map explorer** | the main view: time and place together |
| **Harmony matrix** | events × gospels, the "gospel DNA" overview |
| **Braid** | each gospel in its own narrative order, with lines joining the parallels. Where lines cross, the gospels order events differently |
| **Teachings** | parables and discourses, with topic tags drawn from the text's own words, where and when they were given, and which gospels record them |
| **Places** | every site, with the evidence and candidate sites |
| **People** | who appears where |
| **Evidence** | archaeology and ancient sources |

## Architecture

- **Stack:**
  - **Astro 7, building a static site** (the plan said Astro 6; 7 was current at setup): content collections with Zod schemas, and one prerendered page per event at `/explore/<id>/`. The id never changes, so links stay permanent.
  - **Each page mounts the Explorer with `client:only="react"`** and shows a static fallback of the same event panel. Search engines can read the fallback, and it avoids the mismatches you get when a page built on the server takes over in the browser.
  - **React + TypeScript** for the panels only.
  - **One continuous playhead `t`** (event index plus fraction) in a plain Zustand store. Small adapters drive MapLibre and the timeline from `t` directly.
  - **One animation clock:** the browser's animation frames, MapLibre's `easeTo` and CSS transitions. No GSAP and no react-map-gl.
  - **MapLibre GL JS v6** (ES modules only, requires WebGL2):
    - routes animate with `line-gradient`, never by re-sending data every frame;
    - the screen pixel ratio is capped at 2;
    - 3D terrain is off by default.
  - **History:** `replaceState` while scrubbing or walking, `pushState` when you settle on an event.
  - **Search:** a MiniSearch index built at build time, plus a scripture-reference parser.
  - **Hosting later:** Cloudflare Pages, with the terrain file on R2 (Pages caps files at 25 MiB).
- **Key files:**
  ```
  CLAUDE.md                  # principles, data invariants, neutral-language rules, commands
  astro.config.mjs · .gitattributes (LF) · .node-version
  data/raw/<source>/         # pinned downloads + SOURCES.md (url, version, sha256)
  scripts/                   # fetch-sources · build-text (USJ → verses + footnotes) · import-places · build-geo · validate
  public/text/{MAT,MRK,LUK,JHN,ACT}.json
  src/content.config.ts      # Zod schemas mirroring src/lib/types.ts
  src/content/               # events/*.yaml · phases.yaml · places.json · tidbits/*.md
  src/geo/                   # water, rulers by period, routes (.geojson, clipped with mapshaper)
  src/lib/                   # types.ts · refs.ts · light.ts · chronology.ts · geo.ts
  src/explorer/              # Explorer.tsx · store.ts · map/ (adapters, style, labels) · timeline/ · panel/ · sheet/ · palette/
  src/styles/tokens.css      # light-state tokens (@property)
  src/pages/                 # explore/[id].astro · method · attributions · style-board
  tests/                     # Vitest units + Playwright explorer.spec.ts
  ```
- **Data model (outline, in `src/lib/types.ts`):**
  ```ts
  type Gospel = 'MAT'|'MRK'|'LUK'|'JHN';
  type Light = 'unstated'|'predawn'|'dawn'|'midday'|'evening'|'night'|'darkness';
  type Review = { status: 'ai-draft'|'checked'|'expert'; by?: string; date?: string };
  interface Event {
    id: string; title: string; phaseId: string;            // id = permanent slug
    order: number; orderSource: string;                     // "Robertson 1922 §n"
    gospelOrder: Partial<Record<Gospel, number>>;           // each gospel's own sequence
    refs: Partial<Record<Gospel, string[]>>; otherRefs?: string[];   // "MRK 6:30-44"
    placeId?: string;
    route?: { from: string; basis: 'stated'|'implied'|'reconstructed'; ref?: string };
    time?: { gospel: Gospel; ref: string; quote: string; light: Light; basis: 'stated'|'implied' }[];
    feast?: { name: string; ref: string };
    dates: Record<'ad30'|'ad33', { from: string; to: string; basis: string }>;
    related?: { eventId: string; relation: 'possibly-same-as' }[];
    review: Review;
  }
  interface Place { id: string; name: string; kind: 'site'|'region'|'water';
    candidates: { id: string; label: string; lonLat?: [number, number]; areaId?: string;
                  score?: number; source: string }[] }      // [0] = default, by cited score
  interface Tidbit { id: string; kind: 'archaeology'|'ancient-source'|'ot-quotation'|'geography'
      |'culture'|'language'|'textual-note'|'harmony-note';
    title: string; body: string; eventIds: string[]; placeIds?: string[];
    citations: { work: string; locator: string; url?: string }[];   // ≥ 1
    standing?: 'consensus'|'majority'|'debated'; review: Review }
  ```
- **Data sources and licences:**

  | Data | Source | Licence | Notes |
  |---|---|---|---|
  | Bible text | BSB, from the pinned USJ files (not bsb.txt) | Public domain since 30 Apr 2023 | The footnotes matter: some verses, such as Mt 17:21, exist only as footnotes |
  | Event skeleton | Robertson's *Harmony of the Gospels* (1922), Project Gutenberg #36264 | Public domain | About 184 sections. Titles get rewritten neutrally, because his 1922 headings carry his framing |
  | Places | OpenBible.info Geocoding | CC BY 4.0 | Supplies scores and competing candidates |
  | Later Roman roads | Itiner-e | CC BY 4.0 | Dated c. AD 150, so labelled "later" |
  | Coastlines | Natural Earth | Public domain | |
  | Detailed water | OpenStreetMap | ODbL | |
  | Terrain | AWS Terrain Tiles or Mapterhorn while prototyping; before launch, a regional extract made with `pmtiles extract --bbox` | Credit as each source requires | The extract is capped at about zoom 11, which also hides a modern-border seam in the source elevation data |

  Theographic (CC BY-SA) is used only for cross-checking.

### Content governance (what keeps it objective)
- **Review states:** `ai-draft` → `checked` → `expert`. The production build leaves out `ai-draft`; in development, drafts show a DRAFT badge.
- **The validate script also flags loaded words** in titles and cards: clearly, obviously, contradiction, error, proves, resolves.
- **Template for notes comparing the accounts:** "Matthew says…; Mark says…; proposed explanations (harmonising and source-critical), each cited." No verdict.
- **Archaeology:** keep "is the object genuine?" separate from "is it the gospel's person or place?". Give exact references, with Josephus cited in both the Whiston and Niese numbering systems.
- **Disputed sites:** a written naming policy for sites whose modern location is disputed.
- **Method page:**
  - how the order, sites and dates were chosen;
  - that titles describe what the texts narrate;
  - a "suggest a correction" link on every card;
  - a public changelog.

## Build phases (with feedback gates)

**0 · Setup.**
- Install Node LTS and Git with winget (expect a Windows admin prompt).
- Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` so npm works in *your* PowerShell. Afterwards restart VS Code and your terminals; I can refresh PATH inside my own shell.
- Scaffold Astro 7 + React + TypeScript 6 in this folder, then `git init`, `.gitattributes`, `.node-version` and `CLAUDE.md`.
- If any tool trips on the space in "Jesus Tracker", move the project to a path without spaces.

**1a · Style board (first feedback loop).**
- Built as `/style-board` from the real `tokens.css`, so the design only gets made once. Exported as a self-contained page and published as a **private Artifact link** you can open on desktop or phone and comment on.
- **It shows:**
  - a mini-explorer mock-up (a static SVG of Galilee) with controls that sweep through all eight light states;
  - 2–3 type pairings;
  - gospel colours, monograms and emblems;
  - every shoutout card kind;
  - place icons and the traveller-light marker;
  - timeline lane styling;
  - **both art approaches side by side** on the same vignette (e.g. Feeding of the 5,000 by the lake): no figures, and faceless stylised figures.

We iterate until the visual language is agreed.

**1b · Interactive vertical slice: 24 real events.** It runs locally and includes:
- the real map style (hillshade, water, and boundaries for at least two ruler periods);
- the timeline: lanes plus the Other NT lane, snapping, arrow keys, Sequence and Time modes, the broken axis, Passion Week zoom, and the AD 30/33 switch;
- the panel, with site candidate chips;
- light that follows the active gospel;
- route drawing and ▶ Walk;
- deep links with a working Back button;
- the mobile bottom sheet and a minimal ⌘K search;
- an attribution footer;
- **a "Design lab" panel** (development only, press `D`) for flipping live between the remaining alternatives on the real explorer:
  - type pairing;
  - palette variants;
  - art approach;
  - label style;
  - light "follow the text" vs "always day";
  - timeline density.

  You test the real thing rather than mock-ups.

Real BSB text, real OpenBible candidates, all 24 events passing validation, and about 6 human-checked cards, one per kind (the rest are drafts).

The 24 events:
1. **Birth and shepherds:** night; date range; note on Herod's death vs Quirinius's census.
2. **Magi and flight to Egypt:** "by night", Mt 2:14; Egypt as a region; long route; ruler change to Archelaus (Mt 2:22); "He will be called a Nazarene".
3. **Baptism:** candidate sites on both banks of the Jordan; the "Bethabara" variant; Lk 3:1 as a date anchor; Josephus on John the Baptist.
4. **Wedding at Cana:** competing sites (scores 685 vs 120).
5. **Temple cleansing in John 2:** Passover; "46 years" (Jn 2:20) as a date clue; linked to #16 as possibly the same event.
6. **Nicodemus:** night.
7. **Samaritan woman:** "sixth hour"; route through Samaria stated in the text (Jn 4:4).
8. **Calling of the fishermen:** Capernaum; the Galilee boat.
9. **Sermon on the Mount / Plain:** same sermon or two?
10. **The demoniac(s):** Gadarenes vs Gerasenes, two men vs one; Kursi, Gadara or Gerasa.
11. **Feeding of the 5,000:** in all four; Bethsaida candidates; Passover near; evening.
12. **Walking on water:** fourth watch of the night; the destinations differ.
13. **Caesarea Philippi:** the far-north route; Philip's territory.
14. **Raising of Lazarus:** Bethany.
15. **Entry into Jerusalem:** day-level zoom begins; Zech 9:9.
16. **Temple cleansing in the Synoptics:** Mark places it on the next day.
17. **Last Supper:** evening (Mk 14:17), then "went out into the night" (Jn 13:30); note on the Passover dating; John 13–17 tests long text.
18. **Gethsemane and arrest:** night, implied by the torches.
19. **Caiaphas and Peter's denials:** the rooster crows once vs twice; candidate sites for Caiaphas's house; the ossuary, with its scholarly standing.
20. **Before Pilate:** early morning; the Pilate Stone; Tacitus; candidate sites for the praetorium; third hour (Mk 15:25) vs sixth hour (Jn 19:14).
21. **Crucifixion and burial:** darkness only in the Synoptics; Golgotha candidates; Ps 22:18 (Jn 19:24); the Testimonium Flavianum marked as debated.
22. **Empty tomb:** "still dark" vs "just after sunrise"; Mark ending at 16:8 in early manuscripts.
23. **Emmaus:** "nearly evening"; three candidate sites; the 60 vs 160 stadia variant beside the live distances.
24. **Ascension:** the Acts lane; Bethany vs the Mount of Olives.

**Left out of the slice:** the full Robertson import, the matrix and braid views, Greek, 3D terrain, Roman roads, the People and Places pages, share images, review screens and deployment.

**→ Feedback gate:** you try it on desktop and on a real phone. We refine before scaling up the content.

**2 · Data foundation:**
- the full harmony (about 184 events) from Robertson, mapped to BSB references, with each gospel's own order and neutral titles;
- all places from OpenBible;
- dates under both chronologies;
- a complete `validate` script.

**3 · Full explorer:**
- filters and all map layers;
- the "each gospel's own order" switch on the timeline;
- place and person cards;
- full search.

**4 · Views:**
- the harmony matrix (charts follow the dataviz skill);
- the synopsis, with shared wording highlighted (English first, then matching Greek words through the BSB's interlinear tables);
- the braid view;
- the Teachings lens;
- the Method page.

**5 · Shoutout content at scale:** about 60+ cited cards through the review workflow, plus the Evidence index.

**6 · Launch polish:**
- the self-hosted terrain extract;
- accessibility: a list alternative to the map, focus states, contrast checked in every light state;
- SEO and share cards;
- a page crediting every data source and licence;
- hosting and a domain, only with your go-ahead.

## Verification

- `npm run build` and `astro check` pass.
- `npm run validate` confirms that:
  - every reference parses and exists in the BSB data (gaps like Mt 17:21 included),
  - every place resolves,
  - every card has at least one citation,
  - every time of day cites its verse,
  - no loaded words appear.
- **Vitest unit tests:**
  - the reference parser,
  - timeline scales (the broken axis and the Passion hour zoom),
  - light blending,
  - distance calculations.
- **Playwright, against `astro preview`:**
  - Launched with `--use-angle=swiftshader --enable-unsafe-swiftshader`, because Chrome no longer falls back to software rendering for WebGL on its own.
  - Screenshots taken after the map's `idle` event, at 1440×900, 1024×768 and 390×844, across the light states.
  - Scripted checks:
    - ← → move between events and update the URL,
    - the back button restores the previous event,
    - a deep link opens the right event,
    - reduce-motion mode works,
    - the no-WebGL2 fallback works.
- **A real mid-range phone** via `astro dev --host` on Wi-Fi.
- Lighthouse scores of 90+ for mobile performance and accessibility on the slice.

## Open decisions (defaults in brackets)

- **Name.** ["Jesus Tracker" for now; ideas: *The Way* (Acts 9:2), *Footsteps*, *Four Witnesses*.]
- **Illustration budget.** [Our own SVG icons and textures first; a commissioned illustrator for vignettes later.]
- **Who reviews cards.** [You first; ideally a pastor or scholar for `expert` status.]
- **Licence for publishing the dataset.**
