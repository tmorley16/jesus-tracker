# Pinned data sources

Raw downloads live in `data/raw/` (git-ignored). Each entry records where the file came from and its SHA-256, so a fresh download can be checked against what the site was built from.

| File | Source | Licence | Downloaded | SHA-256 |
|---|---|---|---|---|
| `raw/bsb/bsb.txt` | https://bereanbible.com/bsb.txt | Public domain (dedicated 30 Apr 2023) | 2026-10-18 | `2AC3AF1DE52D4E68261CBA91D85C320B7EADC6560E830D99E591767B8FF5CA96` |
| `raw/bsb/bsb_usj.zip` (unzipped to `usj/bsb_usj/*.usj`) | https://bereanbible.com/bsb_usj.zip | Public domain | 2026-10-19 | `062785C0621E0976E7BF3D5A0C32D3D38C5E9D8F71215217C5D33BE03BDFAEDE` |
| `raw/geonames/cities15000.zip` (unzipped to `cities15000.txt`) | https://download.geonames.org/export/dump/cities15000.zip | CC BY 4.0 (GeoNames) | 2026-10-19 | `7D1C80D5BE04850227384C1F6F9163B56401DC46270BE1012E1A2DE0A5BF4A70` |
| `raw/commons/files.json` and `raw/commons/thumbs/*.jpg` (35 place photos, 500 px) | Wikimedia Commons API (`imageinfo` with `extmetadata`) for the files OpenBible.info's place data names, or chosen in `sections.meta.json`; written by `scripts/lib/commons.mjs` | Each file's own licence (CC BY / CC BY-SA / public domain), recorded per photo in `places.json` and shown with its author in the popup | 2026-10-19 | `2F709F76A3174374D1E8BB490105A113239AFFC7553F91B4D6E43C6551AD78B8` (files.json) |
| `raw/wikidata/entities.json` | Wikidata API (`wbgetentities`) for the IDs in `sections.meta.json` (places, peaks); written by `scripts/lib/wikidata.mjs` | CC0 | 2026-10-19 | `798278BCE918F5226C25DA8885AACF15A65A36041F497B3E0BB3333D29CB8B79` |
| `raw/terrain/11/{x}/{y}.png` (198 tiles: the peaks' windows and the region from Phoenicia to Judea, 34.55–36.35° E, 31.15–33.65° N) | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/{x}/{y}.png (AWS Terrain Tiles, Terrarium encoding) | SRTM and GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1, U.S. NOAA (attribution as in tilezen/joerd `docs/attribution.md`) | 2026-10-19 | `661F5530BDAA252C14BB89DF089C94E09E087D596E60C21D9568297B4F1663EE` (of `sha256sum` over the sorted tile list) |
| `raw/terrain/8/{x}/{y}.png` (9 tiles: Egypt, 29.6–33.0° E, 28.7–31.6° N) | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/{x}/{y}.png (AWS Terrain Tiles) | as above | 2026-10-19 | `95DF6E0C16BC4E3AF58137F0860B6BFBCE18A4CFB717B01E7E9065E9533FC3C9` (of `sha256sum` over the sorted tile list) |
| `raw/terrain/12/{x}/{y}.png` (29 tiles: Jerusalem's detail zone, 35.07–35.33° E, 31.65–31.86° N; Capernaum's and the Sea of Galilee's shore, 35.42–35.77° E, 32.63–33.00° N) | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/{x}/{y}.png (AWS Terrain Tiles) | as above | 2026-10-20 | `1F5DBC3416DB69527110FAD1A4D86F23C8E733E79FA7621BFE49F4DBA114FECB` (of `sha256sum` over the sorted tile list) |

Notes:
- The terrain, Wikidata and Commons downloads are cached: `scripts/build-terrain.mjs` and `scripts/build-places.mjs` fetch only what's missing, so `npm run data` works offline once they're in place.
- `bsb.txt` has no footnotes; they come from the USJ files. The verse text stays `bsb.txt`'s (the USJ differs only in typography: spaces round dashes at line breaks, editorial `[’’]` marks, and an extra “. . .” in Jn 21:7), and each note is placed at the same point in it.
