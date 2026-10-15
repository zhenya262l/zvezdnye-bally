// Finishes the web build in dist/ for GitHub Pages:
//   * puts the site base path into index.html and manifest.json,
//   * builds the service worker and its precache list (Workbox),
//   * copies index.html to 404.html so in-app addresses open the app,
//   * adds .nojekyll so GitHub Pages serves the "_expo" folder.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { injectManifest } from 'workbox-build';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const base = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');

// 1. Base path in index.html
const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replaceAll('__BASE__', base);
fs.writeFileSync(indexPath, html);

// 2. Web app manifest
const manifest = {
  id: `${base}/`,
  name: 'Звёздные баллы',
  short_name: 'Звёзды',
  description: 'Дневник звёздных баллов для семьи',
  lang: 'ru',
  dir: 'ltr',
  start_url: `${base}/`,
  scope: `${base}/`,
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#FFFCF5',
  theme_color: '#12B3C4',
  icons: [
    { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: `${base}/icons/apple-touch-icon.png`, sizes: '180x180', type: 'image/png', purpose: 'any' },
  ],
};
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 3. Service worker
const swPath = path.join(dist, 'sw.js');
await build({
  entryPoints: [path.join(root, 'sw/sw.ts')],
  outfile: swPath,
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'safari16',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// 4. SPA fallback + no Jekyll (before precache so 404.html is excluded explicitly)
fs.copyFileSync(indexPath, path.join(dist, '404.html'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

const { count, size, warnings } = await injectManifest({
  swSrc: swPath,
  swDest: swPath,
  globDirectory: dist,
  globPatterns: ['**/*.{html,js,css,json,png,ico,svg,ttf,otf,woff,woff2}'],
  globIgnores: ['sw.js', '404.html'],
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
});
if (warnings.length) console.warn(warnings.join('\n'));
console.log(`postexport: base="${base || '/'}", precached ${count} files (${(size / 1024).toFixed(0)} KB)`);
