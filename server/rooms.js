// Multiplayer rooms. The server owns the real game state and runs the rules
// engine; each player only ever receives a filtered "view" of it (their own
// role, what their character can see, clues they know) plus the story beats
// meant for them. Bots fill every seat without a person in it.
//
// Transport: Server-Sent Events for server -> client, JSON POSTs for
// client -> server. No dependencies, works through tunnels and proxies.

import { randomBytes } from 'node:crypto';
import {
  createGame, resolveTurn, castVotes, resolveNightFor, presentEvidence, accuse, beatsFor,
  taskProgress, visibleLog, knownEvidence, nightOptions, isHuman,
} from '../src/engine.js';
import { CHARACTERS } from '../src/data.js';
import { active, CHAR_BY_ID } from '../src/core.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = CHARACTERS.length; // 6 seats; bots fill the rest
export const TIMERS = { day: 60, trial: 180, night: 45 }; // seconds

const rooms = new Map(); // code -> room
const byToken = new Map(); // token -> { room, player }

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    const code = Array.from(randomBytes(4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    if (!rooms.has(code)) return code;
  }
}
const newToken = () => randomBytes(16).toString('hex');
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Player';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------------------------------------------------------------------------
// Room lifecycle

function makeRoom() {
  const room = {
    code: newCode(), players: [], state: null, pending: {}, deadline: null, timer: null,
    chat: [], nextMsg: 1, createdAt: Date.now(), timers: { ...TIMERS },
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, name, char) {
  if (room.state) fail(409, 'That match has already started.');
  if (room.players.length >= MAX_PLAYERS) fail(409, 'That room is full.');
  const taken = new Set(room.players.map((p) => p.char));
  if (!CHAR_BY_ID[char] || taken.has(char)) char = CHARACTERS.find((c) => !taken.has(c.id)).id;
  const player = { token: newToken(), name: cleanName(name), char, host: room.players.length === 0, clients: new Set(), lastChat: 0 };
  room.players.push(player);
  byToken.set(player.token, { room, player });
  return player;
}

export function createRoom({ name, char }) {
  const room = makeRoom();
  const player = addPlayer(room, name, char);
  broadcastLobby(room);
  return { code: room.code, token: player.token };
}

export function joinRoom({ code, name, char }) {
  const room = rooms.get(String(code ?? '').toUpperCase().trim());
  if (!room) fail(404, 'No room with that code.');
  const player = addPlayer(room, name, char);
  broadcastLobby(room);
  return { code: room.code, token: player.token };
}

function auth(token) {
  const found = byToken.get(String(token ?? ''));
  if (!found) fail(401, 'Unknown player. Rejoin the room.');
  return found;
}
export const isPlayerToken = (token) => byToken.has(String(token ?? ''));

export function pickCharacter({ token, char }) {
  const { room, player } = auth(token);
  if (room.state) fail(409, 'The match already started.');
  if (!CHAR_BY_ID[char]) fail(400, 'Unknown student.');
  if (room.players.some((p) => p !== player && p.char === char)) fail(409, 'Someone already picked that student.');
  player.char = char;
  broadcastLobby(room);
  return { ok: true };
}

export function startMatch({ token, timers }) {
  const { room, player } = auth(token);
  if (!player.host) fail(403, 'Only the host can start.');
  if (room.state && room.state.phase !== 'over') fail(409, 'Already running.');
  if (room.players.length < MIN_PLAYERS) fail(409, `Need at least ${MIN_PLAYERS} players.`);
  if (timers && typeof timers === 'object') {
    for (const k of Object.keys(TIMERS)) {
      const v = Number(timers[k]);
      if (Number.isFinite(v) && v >= 5 && v <= 600) room.timers[k] = Math.round(v);
    }
  }
  room.state = createGame({ seed: randomBytes(4).readInt32LE(0), playerId: null, humans: room.players.map((p) => p.char) });
  room.chat = [];
  room.pending = {};
  sendSystem(room, 'The match has begun. Empty seats are played by bots.');
  enterPhase(room, []);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Turn collection

const humansWaitingOn = (room) => {
  const s = room.state;
  if (!s || s.phase === 'over') return [];
  return room.players.filter((p) => active(s, p.char) && !(p.char in room.pending)).map((p) => p.char);
};

function enterPhase(room, beats) {
  clearTimeout(room.timer);
  room.pending = {};
  const s = room.state;
  if (s.phase === 'over') {
    room.deadline = null;
    publish(room, beats);
    return;
  }
  const secs = room.timers[s.phase] ?? 60;
  room.deadline = Date.now() + secs * 1000;
  room.timer = setTimeout(() => resolvePhase(room), secs * 1000);
  room.timer.unref?.(); // never keep the process alive just for a turn timer
  publish(room, beats);
  // Nobody left to wait for (everyone dead or expelled): let the bots play on.
  if (!humansWaitingOn(room).length) {
    clearTimeout(room.timer);
    room.deadline = Date.now() + 2500;
    room.timer = setTimeout(() => resolvePhase(room), 2500);
    room.timer.unref?.();
  }
}

function resolvePhase(room) {
  const s = room.state;
  if (!s || s.phase === 'over') return;
  let beats = [];
  try {
    if (s.phase === 'day') beats = resolveTurn(s, room.pending);
    else if (s.phase === 'trial') beats = castVotes(s, room.pending);
    else if (s.phase === 'night') beats = resolveNightFor(s, room.pending);
  } catch (err) {
    console.error(`[room ${room.code}]`, err);
  }
  enterPhase(room, beats);
}

function submit(room, player, value) {
  const s = room.state;
  if (!s || s.phase === 'over') fail(409, 'No match in progress.');
  if (!active(s, player.char)) fail(409, 'You are out of the game. You can still watch.');
  room.pending[player.char] = value;
  if (!humansWaitingOn(room).length) resolvePhase(room);
  else broadcastViews(room);
}

export function dayAction({ token, action }) {
  const { room, player } = auth(token);
  if (room.state?.phase !== 'day') fail(409, 'It is not daytime.');
  if (!action || typeof action.type !== 'string') fail(400, 'Bad action.');
  submit(room, player, action);
  return { ok: true };
}

export function trialMove({ token, present, accuse: target, vote }) {
  const { room, player } = auth(token);
  const s = room.state;
  if (s?.phase !== 'trial') fail(409, 'There is no trial right now.');
  if (!active(s, player.char)) fail(409, 'You are out of the game.');
  if (present) { publish(room, presentEvidence(s, present, player.char)); return { ok: true }; }
  if (target) { publish(room, accuse(s, target, player.char)); return { ok: true }; }
  if (vote !== undefined) { submit(room, player, vote || null); return { ok: true }; }
  fail(400, 'Nothing to do.');
}

export function nightChoice({ token, choice }) {
  const { room, player } = auth(token);
  if (room.state?.phase !== 'night') fail(409, 'It is not night.');
  const c = choice && typeof choice === 'object' ? choice : {};
  submit(room, player, { sleep: c.sleep, kill: c.kill, stakeout: c.stakeout });
  return { ok: true };
}

export function hurry({ token }) {
  const { room, player } = auth(token);
  if (!player.host) fail(403, 'Only the host can skip the timer.');
  if (room.state && room.state.phase !== 'over') resolvePhase(room);
  return { ok: true };
}

export function backToLobby({ token }) {
  const { room, player } = auth(token);
  if (!player.host) fail(403, 'Only the host can do that.');
  clearTimeout(room.timer);
  room.state = null;
  room.deadline = null;
  broadcastLobby(room);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Chat. Who hears you depends on the moment:
//   lobby / trial / game over -> everyone
//   day                       -> only people in the same room (a whisper)
//   night                     -> nobody is awake… except the dead
//   dead or expelled          -> the ghost channel, heard only by other ghosts

function chatChannel(room, player) {
  const s = room.state;
  if (!s) return { id: 'all', label: 'Lobby' };
  if (s.phase === 'over') return { id: 'all', label: 'Everyone' };
  if (!active(s, player.char)) return { id: 'ghost', label: 'Ghosts only' };
  if (s.phase === 'trial') return { id: 'all', label: 'Class Trial: everyone hears you' };
  if (s.phase === 'night') return { id: 'none', label: 'Night: everyone is asleep' };
  return { id: `room:${s.chars[player.char].room}`, label: `Whisper: only people in the ${roomLabel(s.chars[player.char].room)} hear you` };
}
const roomLabel = (id) => ({ library: 'Library', classroom: 'Classroom 2-B', music: 'Music Room', infirmary: 'Infirmary', courtyard: 'Courtyard', dorm: 'Dorm Hall' }[id] ?? id);

function canRead(room, player, msg) {
  if (msg.channel === 'all' || msg.channel === 'system') return true;
  const s = room.state;
  if (msg.channel === 'ghost') return !s || !active(s, player.char) || s.phase === 'over';
  if (msg.channel.startsWith('room:')) {
    if (!s || s.phase === 'over') return true;
    return msg.hear.includes(player.char) || !active(s, player.char);
  }
  return false;
}

export function sendChat({ token, text }) {
  const { room, player } = auth(token);
  const body = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 280);
  if (!body) fail(400, 'Empty message.');
  if (Date.now() - player.lastChat < 700) fail(429, 'Slow down.');
  player.lastChat = Date.now();
  const ch = chatChannel(room, player);
  if (ch.id === 'none') fail(409, 'Everyone is asleep. Save it for the morning.');
  const s = room.state;
  const hear = ch.id.startsWith('room:')
    ? room.players.filter((p) => active(s, p.char) && s.chars[p.char].room === s.chars[player.char].room).map((p) => p.char)
    : [];
  const msg = { id: room.nextMsg++, from: player.char, name: player.name, text: body, channel: ch.id, hear, day: s?.day ?? 0, phase: s?.phase ?? 'lobby', at: Date.now() };
  room.chat.push(msg);
  if (room.chat.length > 400) room.chat.shift();
  for (const p of room.players) if (canRead(room, p, msg)) send(p, 'chat', [publicMsg(msg)]);
  return { ok: true };
}
const publicMsg = ({ hear, ...m }) => m;

function sendSystem(room, text) {
  const msg = { id: room.nextMsg++, from: null, name: 'Academy', text, channel: 'system', hear: [], day: room.state?.day ?? 0, phase: room.state?.phase ?? 'lobby', at: Date.now() };
  room.chat.push(msg);
  for (const p of room.players) send(p, 'chat', [publicMsg(msg)]);
}

// ---------------------------------------------------------------------------
// Views: what one player is allowed to know.

export function viewFor(room, player) {
  const s = room.state;
  const me = player.char;
  const over = s.phase === 'over';
  const v = structuredClone(s);
  v.playerId = me;
  v.rng = 0;
  v.seed = 0;
  const myRole = s.chars[me].role;
  const team = myRole === 'yandere' || myRole === 'accomplice';
  if (!over) {
    for (const id of v.order) {
      if (id === me) continue;
      const c = v.chars[id];
      const revealed = !c.alive || c.expelled || (team && ['yandere', 'accomplice'].includes(s.chars[id].role));
      if (!revealed) c.role = 'unknown';
      c.suspicion = {};
      c.notes = [];
      c.knows = {};
      c.items = [];
      c.tasks = [];
      c.obsession = 0;
      c.sanity = 100;
      c.bloody = false;
      c.camSnapshot = null;
      c.cleared = [];
      c.trust = { [me]: s.chars[id].trust[me] };
    }
    const p = s.plot;
    const known = { yandere: { yandere: me, accomplice: p.accomplice, target: p.target, beloved: p.beloved },
      accomplice: { yandere: p.yandere, accomplice: me, target: p.target, beloved: p.beloved },
      detective: { detective: me }, target: { target: me },
      socialite: { socialite: me, frameTarget: p.frameTarget }, romantic: { romantic: me, crush: p.crush } }[myRole];
    v.plot = known;
    v.evidence = knownEvidence(s, me).map((e) => ({ ...e, knownBy: [me] }));
    v.bodies = s.bodies.filter((b) => b.found || b.killer === me);
    v.crimeScenes = s.crimeScenes.filter((cs) => v.bodies.some((b) => b.victim === cs.victim));
    v.history = [];
    v.nightReport = null;
    v.invites = Object.fromEntries(Object.entries(s.invites).filter(([k, x]) => k === me || x.from === me));
    v.offers = s.offers.filter((o) => o.to === me);
    v.roomItems = {};
    v.alarm = null;
    v.pendingMeeting = null;
    v.log = visibleLog(s, me);
    if (v.trial) v.trial.votes = s.trial.result !== null ? s.trial.votes : null;
  }
  v.taskProgressView = taskProgress(s);
  const names = Object.fromEntries(room.players.map((p) => [p.char, p.name]));
  v.mp = {
    code: room.code,
    you: { name: player.name, char: me, host: player.host },
    humans: names,
    deadline: room.deadline,
    submitted: me in room.pending,
    waitingOn: humansWaitingOn(room),
    channel: chatChannel(room, player),
    timers: room.timers,
  };
  if (s.phase === 'night' && active(s, me)) v.mp.night = nightOptions(s, me);
  return v;
}

function lobbyInfo(room, player) {
  return {
    code: room.code,
    you: { name: player.name, char: player.char, host: player.host },
    players: room.players.map((p) => ({ name: p.name, char: p.char, host: p.host, online: p.clients.size > 0 })),
    min: MIN_PLAYERS, max: MAX_PLAYERS, timers: room.timers,
    phase: room.state ? room.state.phase : 'lobby',
  };
}

// ---------------------------------------------------------------------------
// Streaming

function send(player, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of player.clients) res.write(payload);
}

function broadcastLobby(room) {
  for (const p of room.players) send(p, 'lobby', lobbyInfo(room, p));
}

function broadcastViews(room) {
  if (!room.state) return broadcastLobby(room);
  for (const p of room.players) send(p, 'view', viewFor(room, p));
}

// Beats first (each player gets only theirs), then the new views.
function publish(room, beats) {
  if (!room.state) return;
  for (const p of room.players) {
    const mine = beatsFor(beats, p.char).map(({ to, ...b }) => b);
    if (mine.length) send(p, 'beats', mine);
  }
  broadcastViews(room);
}

export function openStream(token, res) {
  const { room, player } = auth(token);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  player.clients.add(res);
  send(player, 'lobby', lobbyInfo(room, player));
  if (room.state) send(player, 'view', viewFor(room, player));
  const history = room.chat.filter((m) => canRead(room, player, m)).map(publicMsg);
  if (history.length) send(player, 'chat', history);
  broadcastLobby(room);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  ping.unref?.();
  res.on('close', () => {
    clearInterval(ping);
    player.clients.delete(res);
    broadcastLobby(room);
  });
}

// Drop rooms nobody has touched for a long time.
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff && room.players.every((p) => p.clients.size === 0)) {
      clearTimeout(room.timer);
      room.players.forEach((p) => byToken.delete(p.token));
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// HTTP routing (called from tools/serve.js)

const ROUTES = {
  '/api/mp/create': createRoom,
  '/api/mp/join': joinRoom,
  '/api/mp/pick': pickCharacter,
  '/api/mp/start': startMatch,
  '/api/mp/act': dayAction,
  '/api/mp/trial': trialMove,
  '/api/mp/night': nightChoice,
  '/api/mp/chat': sendChat,
  '/api/mp/hurry': hurry,
  '/api/mp/lobby': backToLobby,
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) fail(413, 'Too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail(400, 'Bad JSON.'); }
}

export async function handleMultiplayer(req, res, url) {
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname === '/api/mp/stream' && req.method === 'GET') return openStream(url.searchParams.get('token'), res);
    const route = ROUTES[url.pathname];
    if (!route) fail(404, 'Not found.');
    if (req.method !== 'POST') fail(405, 'Use POST.');
    json(200, route(await readJson(req)));
  } catch (err) {
    if (err instanceof HttpError) json(err.status, { error: err.message });
    else { console.error(err); json(500, { error: 'Server error.' }); }
  }
}

export { isHuman };
