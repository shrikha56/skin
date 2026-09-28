// Zero-dependency static file server for local play.
// Usage: node tools/serve.js [port=8000]   (or: npm start)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Ignore anything that isn't a valid port (e.g. a pasted "# comment" in zsh).
const validPort = (v) => (/^\d+$/.test(String(v ?? '')) && Number(v) > 0 && Number(v) < 65536 ? Number(v) : null);
const port = validPort(process.argv[2]) ?? validPort(process.env.PORT) ?? 8000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

// If the port is taken (another dev server, a FastAPI app, …), try the next one.
function listen(p, attemptsLeft = 20) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${p} is busy, trying ${p + 1}…`);
      listen(p + 1, attemptsLeft - 1);
    } else {
      throw err;
    }
  });
  server.listen(p);
}
server.once('listening', () => {
  console.log(`\nCrimson Confession is running at http://localhost:${server.address().port}\n(press Ctrl+C to stop)`);
});
listen(port);
