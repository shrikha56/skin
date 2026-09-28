// Multiplayer client: one Server-Sent Events stream in, JSON POSTs out.
// The server owns the game; this module just relays what it says.

const SAVE_KEY = 'cc-mp';
let source = null;
let session = null; // { code, token }
const handlers = {};

export const active = () => Boolean(session);
export const token = () => session?.token ?? null;
export const code = () => session?.code ?? null;
export const on = (event, fn) => { handlers[event] = fn; };

export function saved() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
}

async function call(path, body) {
  const res = await fetch(`/api/mp/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: session?.token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const post = (path, body = {}) => call(path, body);

export async function create(name, char) {
  const r = await call('create', { name, char });
  connect(r);
}

export async function join(roomCode, name, char) {
  const r = await call('join', { code: roomCode, name, char });
  connect(r);
}

export function resume(s) { connect(s); }

function connect(s) {
  session = { code: s.code, token: s.token };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(session)); } catch { /* private mode */ }
  source?.close();
  source = new EventSource(`/api/mp/stream?token=${encodeURIComponent(s.token)}`);
  for (const ev of ['lobby', 'view', 'beats', 'chat']) {
    source.addEventListener(ev, (e) => handlers[ev]?.(JSON.parse(e.data)));
  }
  source.onerror = () => handlers.status?.('reconnecting');
  source.onopen = () => handlers.status?.('connected');
}

export function leave() {
  source?.close();
  source = null;
  session = null;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
