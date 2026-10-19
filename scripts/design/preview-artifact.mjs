// Wraps design/style-board.html in the same skeleton the Artifact viewer adds at
// publish time, so the page can be opened or screenshotted locally.
//
//   node scripts/design/preview-artifact.mjs   →  design/.preview/index.html

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const out = 'design/.preview';
await mkdir(out, { recursive: true });

const page = await readFile('design/style-board.html', 'utf8');
const skeleton = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${page}
</body>
</html>
`;

await writeFile(`${out}/index.html`, skeleton);
await copyFile('src/styles/tokens.css', `${out}/tokens.css`);

// Also emit the inline script on its own so it can be syntax-checked with `node --check`.
const script = page.match(/<script>([\s\S]*?)<\/script>/);
if (script) await writeFile(`${out}/board-script.js`, script[1]);

console.log(`Preview written to ${out}/index.html`);
