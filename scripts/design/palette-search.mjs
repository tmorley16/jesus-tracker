// Searches OKLCH space for four gospel lane colours (Matthew, Mark, Luke, John)
// that stay distinguishable for colour-blind readers and keep 3:1 contrast on
// every light-state surface of one mode. Final picks are re-checked with the
// dataviz skill's validate_palette.js; this script only proposes candidates.
//
//   node scripts/design/palette-search.mjs light
//   node scripts/design/palette-search.mjs dark

const MODE = process.argv[2] === 'dark' ? 'dark' : 'light';
const SAMPLES = 400_000;

// Surfaces each mode must work on (paper of each light state, from tokens.css).
const SURFACES = {
  light: ['#E9DFC6', '#CDD3D9', '#F0DCCB', '#EFE5CB', '#F6F1E4', '#E8CDA0'],
  dark: ['#171B2B', '#121212'],
};
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };

// Hue windows (OKLCH degrees) per gospel; Mark is tried as ochre or as murex purple.
const HUES = {
  ochre: [[22, 40], [62, 98], [145, 185], [240, 272]],
  murex: [[22, 40], [300, 345], [145, 185], [228, 262]],
};

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
};

const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hexToLin = (h) => [0, 2, 4].map((i) => s2lin(parseInt(h.slice(1 + i, 3 + i), 16) / 255));
const relLum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (y1, y2) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklchToLin(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((c) => c >= 0 && c <= 1) ? rgb : null;
}

// Round-trip through 8-bit hex so scores match what ships.
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(lin2s(c) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const simulate = (rgb, M) => M.map((row) => Math.max(0, Math.min(1, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
const dE = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

const surfaceLums = SURFACES[MODE].map((h) => relLum(hexToLin(h)));
const [lo, hi] = BAND[MODE];
const rand = (a, b) => a + Math.random() * (b - a);

function candidate([h0, h1]) {
  for (let tries = 0; tries < 50; tries++) {
    const lin = oklchToLin(rand(lo + 0.01, hi - 0.01), rand(0.105, 0.2), rand(h0, h1));
    if (!lin) continue;
    const hex = toHex(lin);
    const exact = hexToLin(hex);
    const y = relLum(exact);
    if (surfaceLums.some((s) => contrast(y, s) < 3)) continue;
    return {
      hex,
      ok: oklab(exact),
      protan: oklab(simulate(exact, MACHADO.protan)),
      deutan: oklab(simulate(exact, MACHADO.deutan)),
    };
  }
  return null;
}

function score(set) {
  let cvd = Infinity, normal = Infinity;
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      cvd = Math.min(cvd, dE(set[i].protan, set[j].protan), dE(set[i].deutan, set[j].deutan));
      normal = Math.min(normal, dE(set[i].ok, set[j].ok));
    }
  }
  return { cvd, normal };
}

for (const [variant, windows] of Object.entries(HUES)) {
  let best = null;
  for (let n = 0; n < SAMPLES; n++) {
    const set = windows.map(candidate);
    if (set.some((c) => !c)) continue;
    const s = score(set);
    if (s.normal < 18) continue; // comfortable margin over the hard floor of 15
    if (!best || s.cvd > best.s.cvd) best = { set, s };
  }
  if (!best) { console.log(`${MODE} ${variant}: no passing set`); continue; }
  console.log(`${MODE} ${variant}: ${best.set.map((c) => c.hex).join(',')}  worst CVD ΔE ${best.s.cvd.toFixed(1)} · normal ΔE ${best.s.normal.toFixed(1)}`);
}
