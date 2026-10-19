// Turns the static build (dist/) into a multi-file Artifact for review: the page
// becomes a fragment (the Artifact viewer adds its own <html>/<head>/<body>), asset
// links become relative, and the scripts, styles and data files are copied alongside.
//
//   npm run build && node scripts/export-artifact.mjs   →  dist-artifact/

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const OUT = 'dist-artifact';
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const html = await readFile('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? '';
const keepHead = head
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '');
const page = `${keepHead}\n${body}`
  .replace(/(["'(])\/assets\//g, '$1assets/')
  .replace(/(["'(])\/data\//g, '$1data/');
if (!/<title>/.test(page)) throw new Error('The page lost its <title>');
if (/["'(]\/(assets|data)\//.test(page)) throw new Error('An absolute asset path is left in the page');
await writeFile(join(OUT, 'index.html'), page);

await cp('dist/assets', join(OUT, 'assets'), { recursive: true });
await cp('dist/data', join(OUT, 'data'), { recursive: true });

const files = [];
async function walk(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) await walk(p);
    else if (name !== 'index.html' || dir !== OUT) files.push(relative(OUT, p).replaceAll('\\', '/'));
  }
}
await walk(OUT);
await writeFile(join(OUT, 'files.json'), JSON.stringify(files.map((path) => ({ path })), null, 1));
let total = 0;
for (const f of files) total += (await stat(join(OUT, f))).size;
console.log(`${files.length} supporting files, ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}/ (list in ${OUT}/files.json)`);
