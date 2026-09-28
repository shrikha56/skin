// Small shared helpers: seeded RNG, map geometry, character lookups.
// The RNG state lives inside the game state so a whole match is reproducible
// from its seed (useful for tests, replays and a future authoritative server).

import { ROOMS, CHARACTERS } from './data.js';

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
export const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

// mulberry32, with its 32-bit state stored on `state.rng`.
export function rand(state) {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function chance(state, p) {
  return rand(state) < p;
}

export function pick(state, list) {
  return list.length ? list[Math.floor(rand(state) * list.length)] : undefined;
}

export function shuffle(state, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function adjacent(a, b) {
  const ra = ROOM_BY_ID[a];
  const rb = ROOM_BY_ID[b];
  return Math.abs(ra.x - rb.x) + Math.abs(ra.y - rb.y) === 1;
}

export function neighbours(roomId) {
  return ROOMS.filter((r) => adjacent(roomId, r.id)).map((r) => r.id);
}

// Shortest path (inclusive of both ends) over the room grid.
export function path(from, to) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of neighbours(cur)) {
      if (n in prev) continue;
      prev[n] = cur;
      if (n === to) {
        const out = [to];
        let p = cur;
        while (p) { out.unshift(p); p = prev[p]; }
        return out;
      }
      queue.push(n);
    }
  }
  return [from];
}

export function stepToward(from, to) {
  const p = path(from, to);
  return p.length > 1 ? p[1] : from;
}

export const nameOf = (id) => CHAR_BY_ID[id].short;
export const roomName = (id) => ROOM_BY_ID[id].name;

export function active(state, id) {
  const c = state.chars[id];
  return Boolean(c) && c.alive && !c.expelled;
}

export function activeIds(state) {
  return state.order.filter((id) => active(state, id));
}

export function occupants(state, roomId) {
  return activeIds(state).filter((id) => state.chars[id].room === roomId);
}

export function matchesEvidence(charId, ev) {
  if (ev.subject) return ev.subject === charId;
  const c = CHAR_BY_ID[charId];
  return c[ev.trait] === ev.value;
}

// Highest-suspicion active character from `observer`'s point of view.
export function topSuspect(state, observer, exclude = []) {
  const s = state.chars[observer].suspicion;
  let best = null;
  for (const id of activeIds(state)) {
    if (id === observer || exclude.includes(id)) continue;
    if (best === null || s[id] > s[best]) best = id;
  }
  return best;
}
