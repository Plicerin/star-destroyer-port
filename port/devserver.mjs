// A static server for the port, with caching off.
//
// Not part of the game. It exists because the obvious alternatives cache: a browser will
// happily keep an ES module from a previous edit, and an hour was lost to a fix that was on
// disk, served correctly when fetched by hand, and still wrong on the page - because the
// module graph had been resolved once and the page never asked again.
//
// No dependencies, so there is nothing to install and nothing to go stale.
//
//     node port/devserver.mjs [port]
//
// then open http://localhost:8124/port/index.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 8124);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.dsk': 'application/octet-stream',
};

http.createServer((req, res) => {
  let url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // A directory is its index, the way every static host serves one. Without this the page at
  // the root of the repository could only be opened by its full filename.
  if (url.endsWith('/')) url += 'index.html';
  const file = path.join(ROOT, url);
  // Nothing outside the repository, whatever the URL says.
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(`not found: ${url}`); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      // The whole reason this file exists.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT} with caching off`);
  console.log(`  http://localhost:${PORT}/port/index.html`);
});
