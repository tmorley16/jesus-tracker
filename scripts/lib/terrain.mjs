// Shared by the terrain builds: AWS Terrain Tiles (Terrarium encoding), cached in data/raw/terrain, decoded to metres.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const TILE_URL = (x, y, z) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// ---- a minimal PNG decoder (8-bit RGB/RGBA, not interlaced: what Terrarium tiles are) ----
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colour = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  const bpp = colour === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { width, height, bpp, data: out };
}

/** Fetch a file, with a time limit and a few tries. */
export async function download(url, what, tries = 4) {
  for (let n = 1; ; n++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (n >= tries) throw err;
      console.warn(`${what}: ${err.message}; trying again`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
    }
  }
}

export async function terrariumTile(x, y, z) {
  const path = `data/raw/terrain/${z}/${x}/${y}.png`;
  let buf;
  try { buf = await readFile(path); } catch {
    buf = await download(TILE_URL(x, y, z), `terrain tile ${z}/${x}/${y}`);
    await mkdir(`data/raw/terrain/${z}/${x}`, { recursive: true });
    await writeFile(path, buf);
  }
  const png = decodePng(buf);
  const elev = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) { const o = i * png.bpp; elev[i] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768; }
  return elev;
}
