// Zero-dependency local server: serves the game and relays voice lines to
// ElevenLabs so the API key stays on this machine (never sent to the browser).
// Usage: node tools/serve.js [port=8000]   (or: npm start)
//
// Voices: put ELEVENLABS_API_KEY=... in a .env file next to package.json.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { VOICES, EXPRESSION_SETTINGS, DEFAULT_MODEL, MAX_TTS_CHARS } from '../src/voices.js';
import { handleMultiplayer, isPlayerToken } from '../server/rooms.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Minimal .env loader (KEY=value lines; real environment variables win).
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Ignore anything that isn't a valid port (e.g. a pasted "# comment" in zsh).
const validPort = (v) => (/^\d+$/.test(String(v ?? '')) && Number(v) > 0 && Number(v) < 65536 ? Number(v) : null);
const port = validPort(process.argv[2]) ?? validPort(process.env.PORT) ?? 8000;
// Localhost only by default. `npm run host` (HOST=0.0.0.0) lets friends on your
// network join multiplayer rooms.
const host = process.env.HOST || '127.0.0.1';
const apiKey = process.env.ELEVENLABS_API_KEY || '';
const apiBase = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
const model = process.env.ELEVENLABS_MODEL || DEFAULT_MODEL;
const cacheDir = join(root, '.cache', 'tts');
const voiceId = (key) => process.env[`VOICE_${key.toUpperCase()}`] || VOICES[key]?.id;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8',
};

// Which commit is being served, so it's easy to confirm an update landed.
function version() {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? head.slice(5) : null;
    const sha = ref ? readFileSync(join(root, '.git', ref), 'utf8').trim() : head;
    return `version ${sha.slice(0, 7)}${ref ? ` on ${ref.replace('refs/heads/', '')}` : ''}`;
  } catch {
    return 'version unknown';
  }
}

const inflight = new Map();
let warnedTts = false;

async function synthesize(voice, expr, text) {
  const settings = EXPRESSION_SETTINGS[expr] ?? EXPRESSION_SETTINGS.neutral;
  const id = voiceId(voice);
  const key = createHash('sha1').update(JSON.stringify([id, model, settings, text])).digest('hex');
  const file = join(cacheDir, `${key}.mp3`);
  try { return await readFile(file); } catch { /* not cached yet */ }
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const res = await fetch(`${apiBase}/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { ...settings, use_speaker_boost: true } }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`ElevenLabs ${res.status} for voice ${voice} (${id}): ${detail.slice(0, 200)}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, audio);
    return audio;
  })();
  inflight.set(key, job);
  try { return await job; } finally { inflight.delete(key); }
}

// Voices spend the host's ElevenLabs credits, so only the host's own machine
// and players who are in one of this server's rooms may use them.
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function handleTts(url, res, req) {
  if (url.pathname === '/api/tts/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled: Boolean(apiKey), voices: Object.fromEntries(Object.entries(VOICES).map(([k, v]) => [k, v.name])) }));
    return;
  }
  const v = url.searchParams.get('v') || '';
  const e = url.searchParams.get('e') || 'neutral';
  const t = (url.searchParams.get('t') || '').trim();
  if (!apiKey) { res.writeHead(503).end('Voices are off: no ELEVENLABS_API_KEY in .env'); return; }
  if (!isLoopback(req) && !isPlayerToken(url.searchParams.get('k'))) { res.writeHead(403).end('Voices are for players in a room'); return; }
  if (!VOICES[v] || !t || t.length > MAX_TTS_CHARS) { res.writeHead(400).end('Bad voice request'); return; }
  try {
    const audio = await synthesize(v, e, t);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'max-age=86400' });
    res.end(audio);
  } catch (err) {
    if (!warnedTts) { console.warn(`[voices] ${err.message}`); warnedTts = true; }
    res.writeHead(502).end('Voice generation failed');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/tts')) { await handleTts(url, res, req); return; }
  if (url.pathname.startsWith('/api/mp/')) { await handleMultiplayer(req, res, url); return; }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  // Never serve secrets, caches or git internals.
  if (!file.startsWith(root) || /[\\/]\.(env|git|cache)([\\/]|$)/.test(file.slice(root.length))) { res.writeHead(403).end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
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
  server.listen(p, host);
}
server.once('listening', () => {
  console.log(`\nCrimson Confession (${version()}) is running at http://localhost:${server.address().port}`);
  console.log(apiKey ? `Voices: ON (ElevenLabs, model ${model})` : 'Voices: off (add ELEVENLABS_API_KEY=... to a .env file to turn them on)');
  if (host === '0.0.0.0' || host === '::') {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`Friends on your Wi-Fi can join at  http://${ip}:${server.address().port}`);
  } else {
    console.log('Multiplayer: only this computer can join. Use `npm run host` to let friends on your Wi-Fi in.');
  }
  console.log('(press Ctrl+C to stop)');
});
listen(port);
