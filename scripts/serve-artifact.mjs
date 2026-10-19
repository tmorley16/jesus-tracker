// Serves dist-artifact/ under a sub-path, wrapping the page in the same kind of
// skeleton the Artifact viewer adds, to check the export before publishing.
//
//   node scripts/serve-artifact.mjs   →  http://localhost:4400/review/

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist-artifact', BASE = '/review/', PORT = 4400;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html; charset=utf-8' };
const SKELETON = (page) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(BASE)) { res.writeHead(404).end(); return; }
  const rel = normalize(path.slice(BASE.length) || 'index.html');
  if (rel.startsWith('..')) { res.writeHead(400).end(); return; }
  try {
    const file = join(ROOT, rel);
    const data = await readFile(file);
    const isPage = rel === 'index.html';
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(isPage ? SKELETON(data.toString('utf8')) : data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}${BASE}`));
