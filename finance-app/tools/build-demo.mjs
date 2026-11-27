// Builds the one-file demo page (example data, nothing leaves the browser) that is
// published as a claude.ai artifact. Run: node tools/build-demo.mjs  ->  dist/demo.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = await build({
  entryPoints: [root + 'app/js/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
  define: { 'globalThis.__BELANJA_DEMO_BUILD__': 'true' },
  logLevel: 'error',
});
const js = out.outputFiles[0].text;
const css = readFileSync(root + 'app/css/app.css', 'utf8');
const html = readFileSync(root + 'app/index.html', 'utf8');
const shell = html.split('<!-- shell:start -->')[1].split('<!-- shell:end -->')[0];
const page = `<title>Belanja</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
${shell}
<script>window.BELANJA_DEMO = true;</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/demo.html', page);
console.log('dist/demo.html', Math.round(page.length / 1024) + ' KB');
