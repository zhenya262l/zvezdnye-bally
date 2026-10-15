// Serves dist/ the way GitHub Pages does: under /<repo>/, with 404.html for unknown paths.
// Usage: node devstack/serve-dist.mjs [port] [basePath]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const port = Number(process.argv[2] ?? 8080);
const base = (process.argv[3] ?? '/zvezdnye-bally').replace(/\/$/, '');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!url.startsWith(`${base}/`) && url !== base) {
      res.writeHead(404).end('not found');
      return;
    }
    let rel = url.slice(base.length) || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': types['.html'] });
    fs.createReadStream(path.join(root, '404.html')).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`serving dist at http://127.0.0.1:${port}${base}/`));
