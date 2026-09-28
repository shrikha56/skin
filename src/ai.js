// Bot brains. Each decision is a small, role-driven heuristic that reads the
// shared state and returns an action object for the engine to apply.
// Bots only use what their character plausibly knows, plus room positions.

import { ROOMS, TONES } from './data.js';
import {
  rand, chance, pick, stepToward, neighbours, active, activeIds, occupants,
  matchesEvidence, topSuspect, CHAR_BY_ID,
} from './core.js';

const QUIET_ROOMS = ROOMS.filter((r) => !r.camera).map((r) => r.id);
const TEAM = ['yandere', 'accomplice'];

const talk = (to, option, arg) => ({ type: 'talk', to, option, arg });
const move = (state, id, goal) => {
  const from = state.chars[id].room;
  const next = stepToward(from, goal);
  return next === from ? null : { type: 'move', room: next };
};
const wander = (state, id) => ({ type: 'move', room: pick(state, neighbours(state.chars[id].room)) });

// Where the public timetable says `id` should be this period.
function scheduled(state, id, tick = state.tick) {
  const s = CHAR_BY_ID[id].schedule;
  return s[Math.min(tick, s.length - 1)];
}
const followSchedule = (state, id) => move(state, id, scheduled(state, id));
const roomAct = { type: 'room' };

function others(state, id) {
  return occupants(state, state.chars[id].room).filter((o) => o !== id);
}

function hasFindable(state, room, id, anyone = false) {
  return state.evidence.some((e) => e.where === room && !e.public && !e.destroyed && (anyone || !e.knownBy.includes(id)));
}

function latestScene(state) {
  const s = state.crimeScenes[state.crimeScenes.length - 1];
  return s && s.day === state.day ? s : null;
}

function mostTrusted(state, id, pool) {
  const t = state.chars[id].trust;
  const s = state.chars[id].suspicion;
  return pool.slice().sort((a, b) => (t[b] - s[b]) - (t[a] - s[a]))[0];
}

function busiestNeighbour(state, id) {
  const opts = neighbours(state.chars[id].room);
  return opts.sort((a, b) => occupants(state, b).length - occupants(state, a).length)[0];
}

// Who the team wants blamed: whoever the rest of the class already suspects most.
export function scapegoat(state, forId) {
  const p = state.plot;
  const exclude = [p.yandere, p.accomplice];
  if (forId === p.yandere) exclude.push(p.beloved);
  let best = null;
  let bestScore = -Infinity;
  for (const s of activeIds(state)) {
    if (exclude.includes(s)) continue;
    let score = 0;
    for (const o of activeIds(state)) if (o !== s && !exclude.includes(o)) score += state.chars[o].suspicion[s];
    if (score > bestScore) { bestScore = score; best = s; }
  }
  const n = Math.max(1, activeIds(state).length - 2);
  return { id: best, avg: bestScore / n };
}

// ---------------------------------------------------------------------------
// Day

export function decideDayAction(state, id) {
  const c = state.chars[id];
  const handler = {
    yandere: yandereDay, accomplice: accompliceDay, detective: detectiveDay,
    target: targetDay, socialite: socialiteDay, romantic: romanticDay,
  }[c.role];
  // Innocents run toward a scream they heard.
  const a = state.alarm;
  if (a && a.heardBy.includes(id) && !TEAM.includes(c.role) && chance(state, c.role === 'detective' ? 1 : 0.7)) {
    const m = move(state, id, a.room);
    if (m) return m;
  }
  // Everyone (killers too, to blend in) does a task when standing in its room.
  if (c.tasks?.some((t) => !t.done && t.room === c.room) && chance(state, TEAM.includes(c.role) ? 0.3 : 0.55)) return { type: 'task' };
  return handler(state, id) ?? fallback(state, id);
}

function fallback(state, id) {
  const here = others(state, id);
  if (here.length && chance(state, 0.35)) return talk(pick(state, here), 'chat', 'smile');
  const next = state.chars[id].tasks?.find((t) => !t.done);
  const m = next && chance(state, 0.4) ? move(state, id, next.room) : chance(state, 0.8) ? followSchedule(state, id) : wander(state, id);
  if (m) return m;
  return chance(state, 0.4) ? { type: 'search' } : { type: 'wait' };
}

function useItems(state, id) {
  const c = state.chars[id];
  if (c.items.includes('keycard')) return { type: 'use', item: 'keycard' };
  if (c.items.includes('diary')) return { type: 'use', item: 'diary' };
  if (c.items.includes('salts') && c.sanity < 50) return { type: 'use', item: 'salts' };
  if (c.items.includes('mirror')) {
    const t = topSuspect(state, id);
    if (t && state.chars[t].room === c.room) return { type: 'use', item: 'mirror', arg: t };
  }
  return null;
}

function yandereDay(state, id) {
  const c = state.chars[id];
  const { target, beloved } = state.plot;
  const here = others(state, id);
  const late = state.tick >= state.ticksPerDay - 2;
  const alone = here.filter((h) => h !== state.plot.accomplice);
  if (alone.length === 1) {
    const v = alone[0];
    if (v === target && chance(state, 0.6)) return { type: 'stab', to: v };
    if (v !== beloved && c.sanity < 30 && chance(state, 0.5)) return { type: 'stab', to: v };
  }
  if (c.bloody) return c.room === 'infirmary' ? roomAct : move(state, id, 'infirmary');
  if (hasFindable(state, c.room, id, true) && chance(state, 0.85)) return { type: 'coverup' };
  if (c.items.includes('salts') && c.sanity < 50) return { type: 'use', item: 'salts' };
  if (!state.chars[target].alive) {
    if (here.includes(beloved) && chance(state, 0.5)) return talk(beloved, 'chat', 'smile');
    if (here.length && chance(state, 0.3)) return talk(pick(state, here.filter((h) => h !== state.plot.accomplice)) ?? here[0], 'suspect', scapegoat(state, id).id);
    return move(state, id, state.chars[beloved].room);
  }
  if (here.includes(target)) {
    const inv = state.invites[target];
    if (late && (!inv || inv.from !== id) && state.chars[target].trust[id] >= 45 && state.chars[target].suspicion[id] < 30) {
      const room = QUIET_ROOMS.includes(c.room) ? c.room : pick(state, QUIET_ROOMS);
      return talk(target, 'invite', room);
    }
    if (chance(state, 0.6)) return talk(target, 'chat', 'smile');
  }
  if (c.obsession >= 50 && !c.stalkedToday && chance(state, 0.35)) return { type: 'stalk' };
  if (here.includes(beloved) && chance(state, 0.45)) return talk(beloved, 'chat', c.sanity < 35 ? 'stare' : 'smile');
  const gossip = here.filter((h) => h !== state.plot.accomplice && h !== beloved);
  if (gossip.length && chance(state, 0.25)) {
    const sg = scapegoat(state, id).id;
    const to = pick(state, gossip.filter((g) => g !== sg));
    if (to && sg) return talk(to, 'suspect', sg);
  }
  // Hunt using the timetable: go where the target is supposed to be.
  const goal = chance(state, 0.5) ? scheduled(state, target) : late || chance(state, 0.4) ? state.chars[target].room : state.chars[beloved].room;
  return move(state, id, goal);
}

function accompliceDay(state, id) {
  const c = state.chars[id];
  const { target, yandere } = state.plot;
  const here = others(state, id);
  const late = state.tick >= state.ticksPerDay - 2;
  if (hasFindable(state, c.room, id, true) && chance(state, 0.9)) return { type: 'coverup' };
  const scene = latestScene(state);
  if (scene && hasFindable(state, scene.room, id, true) && scene.room !== c.room) return move(state, id, scene.room);
  if (state.chars[target].alive && here.includes(target) && late && !state.invites[target] && chance(state, 0.6)) {
    // Lure the Target somewhere quiet where the only "company" is the accomplice.
    return talk(target, 'invite', QUIET_ROOMS.includes(c.room) ? c.room : pick(state, QUIET_ROOMS));
  }
  const gossip = here.filter((h) => h !== yandere);
  if (gossip.length && chance(state, 0.5)) {
    const sg = scapegoat(state, id).id;
    const to = pick(state, gossip.filter((g) => g !== sg));
    if (to && sg) return talk(to, 'suspect', sg);
  }
  if (gossip.length && chance(state, 0.4)) return talk(pick(state, gossip), 'chat', 'smile');
  if (state.chars[target].alive && chance(state, 0.4)) return move(state, id, state.chars[target].room);
  return followSchedule(state, id);
}

function detectiveDay(state, id) {
  const c = state.chars[id];
  const here = others(state, id);
  const item = useItems(state, id);
  if (item) return item;
  if (hasFindable(state, c.room, id)) return { type: 'search' };
  const scene = latestScene(state);
  if (scene && hasFindable(state, scene.room, id)) return move(state, id, scene.room);
  if (c.room === 'library' && !c.researchedDay) return roomAct;
  if (c.room === 'classroom' && c.camSnapshot?.day !== state.day && chance(state, 0.5)) return roomAct;
  if (state.day > 1 && hasFindable(state, 'classroom', id)) return move(state, id, 'classroom') ?? { type: 'search' };
  const top = topSuspect(state, id);
  if (top && c.room === 'courtyard' && !c.usedBell && c.suspicion[top] >= 70) return roomAct;
  if (top && here.includes(top) && c.suspicion[top] >= 20 && chance(state, 0.5)) return talk(top, 'interrogate');
  if (state.tick === state.ticksPerDay - 1 && here.length) {
    const buddy = mostTrusted(state, id, here);
    if (buddy && !state.invites[buddy]) return talk(buddy, 'invite', c.room);
  }
  if (here.length && chance(state, 0.4)) {
    const who = pick(state, here);
    return state.day > 1 && chance(state, 0.5) ? talk(who, 'alibi') : talk(who, 'suspect', top);
  }
  if (state.roomItems[c.room] && chance(state, 0.5)) return { type: 'search' };
  if (top && chance(state, 0.3)) return move(state, id, state.chars[top].room);
  return followSchedule(state, id);
}

function targetDay(state, id) {
  const c = state.chars[id];
  const here = others(state, id);
  const late = state.tick >= state.ticksPerDay - 2;
  const item = useItems(state, id);
  if (item) return item;
  if (state.roomItems[c.room] === 'whistle') return { type: 'search' };
  if (c.room === 'dorm' && !c.usedLock && state.tick === state.ticksPerDay - 1 && !state.invites[id] && chance(state, 0.6)) return roomAct;
  if (late && here.length && (!state.invites[id] || chance(state, 0.3))) {
    const safe = here.filter((h) => c.suspicion[h] < 25);
    const buddy = mostTrusted(state, id, safe.length ? safe : here);
    return talk(buddy, 'invite', c.room);
  }
  if (here.length && chance(state, 0.55)) {
    const top = topSuspect(state, id);
    const listener = mostTrusted(state, id, here);
    if (top && c.suspicion[top] >= 20 && top !== listener && chance(state, 0.4)) return talk(listener, 'suspect', top);
    return talk(listener, 'chat', 'smile');
  }
  // Alone, or alone with one person they don't fully trust: find a crowd.
  const risky = here.length <= 1;
  if (risky || chance(state, 0.3)) {
    const busiest = busiestNeighbour(state, id);
    if (occupants(state, busiest).length > here.length) return { type: 'move', room: busiest };
    if (here.length === 1) return wander(state, id);
  }
  // Skips the lonely After School club slot; otherwise keeps to the timetable.
  if (state.tick !== 2 && chance(state, 0.6)) { const m = followSchedule(state, id); if (m) return m; }
  return chance(state, 0.3) ? { type: 'search' } : null;
}

function socialiteDay(state, id) {
  const { frameTarget } = state.plot;
  const here = others(state, id);
  const item = useItems(state, id);
  if (item && item.item !== 'mirror') return item;
  if (active(state, frameTarget)) {
    const audience = here.filter((h) => h !== frameTarget);
    if (audience.length && chance(state, 0.6)) return talk(pick(state, audience), 'rumor', frameTarget);
  }
  if (state.chars[id].room === 'courtyard' && !state.chars[id].usedBell && active(state, frameTarget)) {
    const crowd = activeIds(state).filter((o) => o !== id && o !== frameTarget);
    const lean = crowd.reduce((sum, o) => sum + state.chars[o].suspicion[frameTarget], 0) / Math.max(1, crowd.length);
    if (lean >= 25) return roomAct;
  }
  if (here.length && chance(state, 0.5)) return talk(pick(state, here), 'chat', 'smile');
  if (state.tick === state.ticksPerDay - 1 && here.length) return talk(mostTrusted(state, id, here), 'invite', state.chars[id].room);
  if (chance(state, 0.6)) return followSchedule(state, id);
  const busiest = busiestNeighbour(state, id);
  return busiest ? { type: 'move', room: busiest } : null;
}

function romanticDay(state, id) {
  const c = state.chars[id];
  const { crush } = state.plot;
  const here = others(state, id);
  if (!active(state, crush)) return null;
  if (here.includes(crush)) {
    const t = state.chars[crush].trust[id];
    if (c.items.includes('letter')) return talk(crush, 'give');
    if (c.room === 'music' && chance(state, 0.3)) return roomAct;
    if (!c.confessed && t >= 60) return talk(crush, 'confess');
    if (state.tick >= state.ticksPerDay - 2 && t >= 45 && state.invites[crush]?.from !== id) return talk(crush, 'invite', c.room);
    return talk(crush, 'chat', t >= 40 ? 'blush' : 'smile');
  }
  if (state.roomItems[c.room] === 'letter') return { type: 'search' };
  return move(state, id, state.chars[crush].room);
}

// ---------------------------------------------------------------------------
// Trial

export function trialStatement(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  const known = state.evidence.filter((e) => !e.public && !e.destroyed && e.knownBy.includes(id) && e.kind !== 'note');
  let present = [];
  let accuse = null;
  if (TEAM.includes(c.role)) {
    present = known.filter((e) => !matchesEvidence(p.yandere, e) && !matchesEvidence(p.accomplice, e)).map((e) => e.id);
    const sg = scapegoat(state, id);
    if (sg.id && (sg.avg >= 12 || state.day >= state.maxDay)) accuse = sg.id;
  } else if (c.role === 'socialite') {
    present = known.filter((e) => matchesEvidence(p.frameTarget, e)).map((e) => e.id);
    const others = activeIds(state).filter((o) => o !== id && o !== p.frameTarget);
    const lean = others.reduce((sum, o) => sum + state.chars[o].suspicion[p.frameTarget], 0) / Math.max(1, others.length);
    if (active(state, p.frameTarget) && p.frameTarget !== id && (lean >= 10 || state.day >= state.maxDay)) accuse = p.frameTarget;
  } else {
    present = known.map((e) => e.id);
    const exclude = c.role === 'romantic' ? [p.crush] : [];
    const top = topSuspect(state, id, exclude);
    if (top && c.suspicion[top] >= 25) accuse = top;
  }
  if (accuse === id) accuse = null;
  return { present, accuse };
}

export function decideVote(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  const final = state.day >= state.maxDay;
  if (TEAM.includes(c.role)) {
    const sg = scapegoat(state, p.yandere);
    return sg.id && (sg.avg >= 15 || final) ? sg.id : null;
  }
  if (c.role === 'socialite' && active(state, p.frameTarget) && p.frameTarget !== id) {
    const others = activeIds(state).filter((o) => o !== id && o !== p.frameTarget);
    const lean = others.reduce((sum, o) => sum + state.chars[o].suspicion[p.frameTarget], 0) / Math.max(1, others.length);
    if (lean >= 15 || final) return p.frameTarget;
  }
  const exclude = c.role === 'romantic' ? [p.crush] : [];
  const top = topSuspect(state, id, exclude);
  return top && c.suspicion[top] >= (final ? 20 : 30) ? top : null;
}

// ---------------------------------------------------------------------------
// Night

export function decideNightRoom(state, id) {
  return state.invites[id]?.room ?? state.chars[id].room;
}

export function decideStakeout(state, id, rooms) {
  // Guard the most trusted person who would otherwise sleep alone.
  const c = state.chars[id];
  const alone = activeIds(state).filter((o) => o !== id && Object.keys(rooms).filter((x) => rooms[x] === rooms[o]).length === 1);
  if (!alone.length || chance(state, 0.3)) return null;
  const pickOne = alone.sort((a, b) => c.suspicion[a] - c.suspicion[b])[0];
  return rooms[pickOne];
}

export function decideKill(state, id, rooms) {
  const c = state.chars[id];
  const p = state.plot;
  const isolated = (v) => (state.chars[v].barricadeDay !== state.day || c.obsession >= 80)
    && activeIds(state).every((o) => o === v || o === id || o === p.accomplice || rooms[o] !== rooms[v]);
  const pool = activeIds(state).filter((v) => v !== id && v !== p.accomplice && v !== p.beloved);
  if (active(state, p.target) && isolated(p.target)) return p.target;
  if (c.sanity <= 0) return pool.find(isolated) ?? (active(state, p.target) ? p.target : pick(state, pool)) ?? null;
  // A love rival who keeps hovering around the beloved is next in line.
  const rival = p.romantic;
  if (rival !== id && active(state, rival) && isolated(rival) && state.chars[p.beloved].trust[rival] >= 60 && chance(state, 0.6)) return rival;
  // Silence whoever is closest to the truth, if they are alone.
  const threat = pool.filter(isolated).sort((a, b) => state.chars[b].suspicion[id] - state.chars[a].suspicion[id])[0];
  if (threat && state.chars[threat].suspicion[id] >= 30 && chance(state, 0.6)) return threat;
  if (!active(state, p.target) && threat && chance(state, 0.25)) return threat;
  return null;
}

export { rand };
