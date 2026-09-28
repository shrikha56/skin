// Game rules. Pure functions over a plain JSON-serialisable state object:
// no DOM, no timers, no globals. The UI calls these and plays back the
// returned "beats" (panels, dialogue lines, narration) as webtoon cinematics.
//
// Match flow:  Day (4 periods) -> Class Trial -> Night -> next Day ...
// The Trial on the last day is the Final Trial and ends the match.

import { CHARACTERS, ROLE_ORDER, ROLES, ROOMS, ITEMS, TONES, TRAIT_TEXT, PERIODS, TASKS, TASKS_PER_STUDENT } from './data.js';
import {
  rand, chance, pick, shuffle, clamp, adjacent, path, nameOf, roomName,
  active, activeIds, occupants, matchesEvidence, CHAR_BY_ID, ROOM_BY_ID,
} from './core.js';
import * as ai from './ai.js';
import { lineFor } from './lines.js';

export const MAX_PRESENTS = 2;
const INVITE_TRUST = 45;
const ROMANCE_TRUST = 85;
export const STAB_OBSESSION = 30;
const ISOLATED_ROOMS = ROOMS.filter((r) => !r.camera).map((r) => r.id);

// ---------------------------------------------------------------------------
// Setup

// playerId: null runs an all-bot match (used by the balance simulator).
// humans: every seat a person controls (multiplayer). Single-player passes just playerId.
export function createGame({ seed = Date.now(), playerId = 'hana', playerRole = null, maxDay = 3, humans = null } = {}) {
  const state = {
    seed,
    rng: seed | 0,
    day: 1,
    maxDay,
    tick: 0,
    ticksPerDay: PERIODS.length,
    phase: 'day',
    playerId,
    humans: humans ?? (playerId ? [playerId] : []),
    order: CHARACTERS.map((c) => c.id),
    chars: {},
    plot: {},
    roomItems: Object.fromEntries(ROOMS.map((r) => [r.id, r.item])),
    evidence: [],
    crimeScenes: [],
    invites: {}, // charId -> { room, from }   (accepted plans for tonight)
    offers: [], // invites made to a human: { from, room, to }
    trial: null,
    nightReport: null,
    expelled: [],
    bodies: [], // { victim, room, day, killer, found }
    alarm: null, // { room, heardBy, tick } — a scream this turn
    pendingMeeting: null,
    history: [], // { day, tick, rooms } snapshot at the end of every turn
    powerRestored: false,
    log: [],
    winners: null,
  };

  let roles = shuffle(state, ROLE_ORDER);
  if (playerRole && playerId) {
    const pi = state.order.indexOf(playerId);
    const ri = roles.indexOf(playerRole);
    [roles[pi], roles[ri]] = [roles[ri], roles[pi]];
  }

  const startRooms = shuffle(state, ROOMS.map((r) => r.id));
  state.order.forEach((id, i) => {
    state.chars[id] = {
      id,
      role: roles[i],
      alive: true,
      expelled: false,
      room: startRooms[i % startRooms.length],
      trust: {},
      suspicion: {},
      items: [],
      obsession: 0,
      sanity: 100,
      knows: {},
      notes: [],
      stalkedToday: false,
      confessed: false,
      bloody: false,
      usedBell: false,
      usedLock: false,
      barricadeDay: 0,
      researchedDay: 0,
      cleared: [],
      camSnapshot: null,
    };
  });
  for (const a of state.order) {
    for (const b of state.order) {
      if (a === b) continue;
      state.chars[a].trust[b] = 30 + Math.floor(rand(state) * 20);
      state.chars[a].suspicion[b] = Math.floor(rand(state) * 8);
    }
  }

  const byRole = (r) => state.order.find((id) => state.chars[id].role === r);
  const p = state.plot;
  p.yandere = byRole('yandere');
  p.accomplice = byRole('accomplice');
  p.detective = byRole('detective');
  p.target = byRole('target');
  p.socialite = byRole('socialite');
  p.romantic = byRole('romantic');
  p.beloved = pick(state, state.order.filter((id) => ![p.yandere, p.accomplice, p.target, p.romantic].includes(id)));
  p.crush = p.beloved;
  p.frameTarget = pick(state, state.order.filter((id) => id !== p.socialite));

  // Chores: three rooms each, never the room you start in.
  for (const id of state.order) {
    const rooms = shuffle(state, ROOMS.map((r) => r.id).filter((r) => r !== state.chars[id].room)).slice(0, TASKS_PER_STUDENT);
    state.chars[id].tasks = rooms.map((room) => ({ room, label: TASKS[room], done: false }));
  }

  // Secret knowledge.
  const Y = state.chars[p.yandere];
  Y.knows = { accomplice: p.accomplice, target: p.target, beloved: p.beloved };
  state.chars[p.accomplice].knows = { yandere: p.yandere, target: p.target, beloved: p.beloved };
  state.chars[p.romantic].knows = { crush: p.crush };
  state.chars[p.socialite].knows = { frameTarget: p.frameTarget };
  // The team trusts each other.
  state.chars[p.accomplice].trust[p.yandere] = 90;
  Y.trust[p.accomplice] = 90;

  // The Target starts with a lead: the threatening note.
  const note = addEvidence(state, {
    kind: 'note', trait: 'hair', value: CHAR_BY_ID[p.yandere].hair, strength: 12, night: 0, where: null,
    text: `A threatening note in your locker: "Stay away from ${nameOf(p.beloved)}." A strand of ${TRAIT_TEXT.hair[CHAR_BY_ID[p.yandere].hair]} was caught in the envelope.`,
  });
  learn(state, p.target, note);

  log(state, `Day 1. The storm has sealed ${'Hoshizora Academy'}. Six students remain inside.`);
  return state;
}

export function objectiveText(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  switch (c.role) {
    case 'yandere':
      return `Eliminate ${nameOf(p.target)} before the Final Trial without being expelled. ` +
        `Stay near ${nameOf(p.beloved)} to build Obsession (unlocks Stalk at 50, Silent Step at 80). ` +
        `Watching ${nameOf(p.target)} near ${nameOf(p.beloved)} drains your Sanity. At 0 you snap. ` +
        `Your Accomplice is ${nameOf(p.accomplice)}.`;
    case 'accomplice':
      return `${nameOf(p.yandere)} is the Obsessive and you win if they do: ${nameOf(p.target)} must die and ` +
        `${nameOf(p.yandere)} must not be expelled. Cover up evidence at crime scenes, lure ${nameOf(p.target)} ` +
        `into a room with only you (you never count as a witness), and steer the vote elsewhere.`;
    case 'detective':
      return 'Expose the Obsessive and get them expelled at a Class Trial. Your searches always find hidden clues. ' +
        'At night you can stake out a room and act as a hidden witness.';
    case 'target':
      return 'Survive until the end of the Final Trial. Never sleep alone with someone you don\'t trust. ' +
        'Invite people to spend the night with you. Look for the Emergency Whistle in the Courtyard.';
    case 'socialite':
      return `Get ${nameOf(p.frameTarget)} expelled at a Class Trial, and don't get expelled yourself. ` +
        'Spread rumors and present the right evidence at the right moment.';
    case 'romantic':
      return `Make ${nameOf(p.crush)} trust you (${ROMANCE_TRUST}+) and have you both alive and not expelled at the end. ` +
        'Confess when the moment is right, but someone else wants them too.';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Bookkeeping helpers

function log(state, text, to = null) {
  state.log.push({ day: state.day, phase: state.phase, text, to });
}

export function visibleLog(state, viewer) {
  return state.log.filter((e) => !e.to || e.to.includes(viewer));
}

function note(state, id, text) {
  state.chars[id].notes.push({ day: state.day, text });
}

function addEvidence(state, ev) {
  const e = { id: `ev${state.evidence.length + 1}`, public: false, destroyed: false, knownBy: [], ...ev };
  state.evidence.push(e);
  return e;
}

// A character learns a clue and updates suspicion of everyone it matches.
export function learn(state, id, ev) {
  if (ev.knownBy.includes(id)) return false;
  ev.knownBy.push(id);
  const s = state.chars[id].suspicion;
  for (const other of state.order) {
    if (other !== id && matchesEvidence(other, ev)) s[other] += ev.strength;
  }
  return true;
}

function publish(state, ev) {
  ev.public = true;
  for (const id of activeIds(state)) learn(state, id, ev);
}

export function knownEvidence(state, id) {
  return state.evidence.filter((e) => !e.destroyed && (e.public || e.knownBy.includes(id)));
}

function findable(state, room, forId) {
  return state.evidence.filter((e) => e.where === room && !e.public && !e.destroyed && !e.knownBy.includes(forId));
}

// Rooms whose occupants `viewer` can currently see: their own and adjacent ones.
export function canSeeRoom(state, viewer, roomId) {
  const r = state.chars[viewer].room;
  return r === roomId || adjacent(r, roomId);
}

const bump = (map, key, by) => { map[key] = clamp((map[key] ?? 0) + by, -50, 200); };
const trustBump = (state, who, of, by) => { state.chars[who].trust[of] = clamp(state.chars[who].trust[of] + by); };

// ---------------------------------------------------------------------------
// Beats: the UI plays these back as panels and dialogue.

const line = (speaker, expr, text) => ({ kind: 'line', speaker, expr, text });
const voiceLine = (state, id, kind, vars) => lineFor(state, () => rand(state), id, kind, vars);
const narrate = (text) => ({ kind: 'narrate', text });
const panel = (o) => ({ kind: 'panel', mood: 'neutral', cast: [], ...o });
// Animated stab cutscene and crime-scene reveal (see main.js).
const killBeat = (killer, victim, room, pov) => ({ kind: 'kill', killer, victim, room, pov });
const sceneBeat = (victim, room, caption) => ({ kind: 'scene', victim, room, caption });

// Audience helpers. A beat with `to` is only shown to those humans; without
// `to` it is shown to everyone. Beats for nobody are dropped.
export const isHuman = (state, id) => state.humans.includes(id);
const humansIn = (state, room, except = []) => state.humans.filter((h) => active(state, h) && state.chars[h].room === room && !except.includes(h));
const tell = (beats, ids, b) => { const aud = ids.filter(Boolean); if (aud.length) beats.push({ ...b, to: aud }); };
export const beatsFor = (beats, viewer) => beats.filter((b) => !b.to || b.to.includes(viewer));

// ---------------------------------------------------------------------------
// Day actions

export function talkOptions(state, speaker, listener) {
  const c = state.chars[speaker];
  const opts = [
    { id: 'chat', label: 'Chat', needs: 'tone', hint: 'Build trust. Your expression matters.' },
    { id: 'alibi', label: 'Ask about last night', needs: null, hint: 'Where were they and with whom?' },
    { id: 'suspect', label: 'Share a suspicion…', needs: 'char', hint: 'Point them at someone.' },
    { id: 'invite', label: 'Spend tonight together in…', needs: 'room', hint: `Needs ${INVITE_TRUST}+ trust. Decides where you both sleep.` },
  ];
  if (c.role === 'detective') opts.push({ id: 'interrogate', label: 'Interrogate', needs: null, hint: 'Look for tells. Costs trust.' });
  if (c.role === 'socialite') opts.push({ id: 'rumor', label: 'Whisper a rumor about…', needs: 'char', hint: 'Extra-strength suspicion. Nobody traces it back to you.' });
  if (c.role === 'romantic' && listener === state.plot.crush && !c.confessed) {
    opts.push({ id: 'confess', label: 'Confess your feelings', needs: null, hint: 'Best with 60+ trust.' });
  }
  if (c.items.includes('letter')) opts.push({ id: 'give', label: 'Give the love letter', needs: null, hint: '+25 trust.' });
  // Two people talk for real in the chat; only the mechanical options remain.
  if (isHuman(state, speaker) && isHuman(state, listener)) return opts.filter((o) => ['invite', 'interrogate', 'give'].includes(o.id));
  return opts;
}

export function playerActions(state, id = state.playerId) {
  const c = state.chars[id];
  const acts = [];
  if (!active(state, id) || state.phase !== 'day') return acts;
  const stab = stabVictim(state, id);
  if (stab) acts.push({ type: 'stab', to: stab, icon: 'knife', label: `Stab ${nameOf(stab)}`, desc: 'Nobody else is watching. Do it now.', danger: true });
  const task = c.tasks.find((t) => !t.done && t.room === c.room);
  if (task) acts.push({ type: 'task', icon: 'page', label: `Task: ${task.label}`, desc: ['yandere', 'accomplice'].includes(c.role) ? 'Fake task: it only makes you look busy.' : 'Finish all your tasks to earn a clue.', special: true });
  const ra = roomAction(state, id);
  acts.push({ type: 'room', icon: ra.icon, label: ra.label, desc: ra.desc, disabled: !ra.ok, reason: ra.reason, special: true });
  acts.push({ type: 'search', icon: 'search', label: 'Search the room', desc: 'Look for items and hidden clues.' });
  if (c.role === 'yandere' && c.obsession >= 50 && !c.stalkedToday && state.chars[state.plot.target].alive) {
    acts.push({ type: 'stalk', icon: 'eye', label: `Stalk ${nameOf(state.plot.target)}`, desc: 'Learn exactly where your target and your beloved are.' });
  }
  if ((c.role === 'yandere' || c.role === 'accomplice') && findable(state, c.room, '__nobody__').length) {
    acts.push({ type: 'coverup', icon: 'sponge', label: 'Cover up evidence', desc: 'Destroy a hidden clue in this room. Someone may notice.' });
  }
  acts.push({ type: 'wait', icon: 'hourglass', label: 'Keep watch (wait)', desc: 'Do nothing and see who comes and goes.' });
  return acts;
}

// The Obsessive can stab someone when they are alone with them (an Accomplice
// in the room doesn't count as a witness). Returns the victim id or null.
export function stabVictim(state, id) {
  const c = state.chars[id];
  if (!c || c.role !== 'yandere' || !active(state, id) || state.phase !== 'day' || c.obsession < STAB_OBSESSION) return null;
  const others = occupants(state, c.room).filter((o) => o !== id && o !== state.plot.accomplice);
  return others.length === 1 ? others[0] : null;
}

// The special action of the room `id` is standing in, and whether it's usable.
export function roomAction(state, id) {
  const c = state.chars[id];
  const r = ROOM_BY_ID[c.room];
  const a = { ...r.action, ok: true, reason: '' };
  const others = occupants(state, c.room).filter((o) => o !== id);
  // Investigation shortcuts are rationed so nobody can simply clear the class.
  if (a.id === 'research' && c.researchedDay) Object.assign(a, { ok: false, reason: 'You already used the archive this match.' });
  if (a.id === 'cameras' && c.camSnapshot?.day === state.day) Object.assign(a, { ok: false, reason: 'You already checked the cameras today.' });
  if (a.id === 'rehearse' && !others.length) Object.assign(a, { ok: false, reason: 'Nobody here to rehearse with.' });
  if (a.id === 'bell' && c.usedBell) Object.assign(a, { ok: false, reason: 'You already rang the bell this match.' });
  if (a.id === 'lock' && c.usedLock) Object.assign(a, { ok: false, reason: 'You already barricaded once this match.' });
  return a;
}

// Single-player: the player takes one action, then everyone else does.
export function playerAct(state, action) {
  return resolveTurn(state, { [state.playerId]: action });
}

// One day turn: every human's chosen action (missing = wait), then every bot's,
// then time advances. Returns beats tagged with their audience.
export function resolveTurn(state, actions = {}) {
  if (state.phase !== 'day') throw new Error(`Cannot act during ${state.phase}`);
  const beats = [];
  for (const id of state.order) {
    if (!isHuman(state, id) || !active(state, id)) continue;
    try {
      beats.push(...applyAction(state, id, actions[id] ?? { type: 'wait' }));
    } catch {
      beats.push(...applyAction(state, id, { type: 'wait' }));
    }
  }
  for (const id of state.order) {
    if (isHuman(state, id) || !active(state, id)) continue;
    beats.push(...applyAction(state, id, ai.decideDayAction(state, id)));
  }
  beats.push(...endTick(state));
  return beats;
}

export function applyAction(state, id, action) {
  const c = state.chars[id];
  const isPlayer = isHuman(state, id);
  const beats = [];
  const mine = (b) => { if (isPlayer) beats.push({ ...b, to: [id] }); };
  const watchers = () => humansIn(state, c.room, [id]);
  switch (action.type) {
    case 'move': {
      if (!adjacent(c.room, action.room)) throw new Error(`${id} cannot move ${c.room} -> ${action.room}`);
      const from = c.room;
      tell(beats, watchers(), narrate(`${nameOf(id)} leaves for the ${roomName(action.room)}.`));
      c.room = action.room;
      mine(narrate(`You walk to the ${roomName(action.room)}. ${ROOM_BY_ID[action.room].blurb}`));
      tell(beats, watchers(), narrate(`${nameOf(id)} walks in from the ${roomName(from)}.`));
      break;
    }
    case 'talk':
      beats.push(...applyTalk(state, id, action.to, action.option, action.arg));
      break;
    case 'search':
      beats.push(...applySearch(state, id));
      break;
    case 'use':
      beats.push(...applyUse(state, id, action.item, action.arg));
      break;
    case 'stab':
      beats.push(...applyStab(state, id, action.to));
      break;
    case 'room':
      beats.push(...applyRoomAction(state, id));
      break;
    case 'task':
      beats.push(...applyTask(state, id));
      break;
    case 'stalk': {
      if (c.obsession < 50 || c.stalkedToday) break;
      c.stalkedToday = true;
      const t = state.plot.target;
      const b = state.plot.beloved;
      const where = (x) => `${nameOf(x)} is in the ${roomName(state.chars[x].room)}` +
        (occupants(state, state.chars[x].room).length > 1
          ? ` with ${occupants(state, state.chars[x].room).filter((o) => o !== x).map(nameOf).join(', ')}` : ' — alone');
      const txt = `${where(t)}. ${where(b)}.${state.chars[t].items.includes('whistle') ? ` ${nameOf(t)} carries a whistle.` : ''}`;
      note(state, id, `Stalked: ${txt}`);
      mine(panel({ mood: 'crimson', sfx: 'I SEE YOU', caption: txt, cast: [{ id: t, expr: 'neutral' }] }));
      break;
    }
    case 'coverup': {
      const ev = findable(state, c.room, '__nobody__');
      if (!ev.length) { mine(narrate('There is nothing left to clean up here.')); break; }
      const e = ev[0];
      e.destroyed = true;
      mine(panel({ mood: 'dark', sfx: 'scrub scrub', caption: `You quietly destroy a clue: ${e.text}` }));
      for (const w of occupants(state, c.room)) {
        if (w === id || state.chars[w].role === 'yandere' || state.chars[w].role === 'accomplice') continue;
        if (chance(state, 0.25)) {
          bump(state.chars[w].suspicion, id, 20);
          note(state, w, `Saw ${nameOf(id)} wiping something at the ${roomName(c.room)}.`);
          tell(beats, [isHuman(state, w) && w], narrate(`You catch ${nameOf(id)} wiping something off the floor…`));
          mine(line(w, 'suspicious', `…What are you doing, ${nameOf(id)}?`));
        }
      }
      break;
    }
    case 'wait':
    default:
      mine(narrate('You keep your head down and watch who comes and goes.'));
      break;
  }
  return beats;
}

function applyTalk(state, speaker, listener, option, arg) {
  const S = state.chars[speaker];
  const L = state.chars[listener];
  const beats = [];
  if (!active(state, listener) || L.room !== S.room || speaker === listener) return beats;
  const isPlayer = isHuman(state, speaker);
  const toPlayer = isHuman(state, listener);
  const mine = (b) => { if (isPlayer) beats.push({ ...b, to: [speaker] }); };
  const seen = (b) => tell(beats, humansIn(state, S.room, [speaker, listener]), b);
  const team = (a, b) => ['yandere', 'accomplice'].includes(state.chars[a].role) && ['yandere', 'accomplice'].includes(state.chars[b].role);
  const trustOf = L.trust[speaker];
  const Sn = nameOf(speaker);
  const say = (who, expr, text) => tell(beats, [speaker, listener].filter((h) => isHuman(state, h)), line(who, expr, text));

  switch (option) {
    case 'chat': {
      const tone = TONES[arg] ? arg : 'smile';
      let delta = 8;
      let react = 'happy';
      if (tone === 'blush') { delta = trustOf >= 40 ? 14 : 2; react = trustOf >= 40 ? 'blush' : 'shocked'; }
      if (tone === 'smirk') { delta = 4; bump(L.suspicion, speaker, -4); react = 'neutral'; }
      if (tone === 'stare') { delta = -5; bump(L.suspicion, speaker, 8); react = 'shocked'; }
      // Diminishing returns: small talk only gets you so far.
      if (delta > 0) delta = Math.round(delta * Math.max(0.25, Math.min(1, (100 - trustOf) / 60)));
      trustBump(state, listener, speaker, delta);
      say(speaker, TONES[tone].expr, pick(state, {
        smile: ['Hey. Are you holding up okay?', 'This storm is unreal, huh? Stick with me.', 'You look like you could use a friend.'],
        blush: ['I-I\'m glad you\'re here. Really.', 'Um… can I sit next to you?', 'You\'re the only reason I\'m not panicking.'],
        smirk: ['Relax. I\'ve got everything under control.', 'Scared? Don\'t be. Not while I\'m around.'],
        stare: ['…', 'You smell like rain. I like it.', 'I watch you, you know. Every day.'],
      }[tone]));
      say(listener, react, voiceLine(state, listener, delta >= 5 ? 'warm' : 'cold'));
      // Friendly chats loosen tongues: they tell you something they saw.
      if (delta >= 5 && (isPlayer || toPlayer) && chance(state, 0.75)) {
        const seen = sighting(state, listener);
        if (seen) {
          say(listener, 'neutral', seen);
          if (isPlayer) note(state, speaker, `${nameOf(listener)} says: "${seen}"`);
        }
      }
      if (speaker === state.plot.yandere && listener === state.plot.beloved) { S.obsession = clamp(S.obsession + 10); S.sanity = clamp(S.sanity + 10); }
      seen(narrate(`${Sn} chats with ${nameOf(listener)}${tone === 'stare' ? ', staring without blinking' : ''}.`));
      jealousy(state, speaker, listener, 8, beats);
      break;
    }
    case 'alibi': {
      trustBump(state, listener, speaker, -2);
      const text = alibiClaim(state, listener);
      note(state, speaker, `${nameOf(listener)} claims: "${text}"`);
      say(speaker, 'neutral', 'Walk me through it. Where were you, and who were you with?');
      say(listener, 'suspicious', text);
      seen(narrate(`${Sn} questions ${nameOf(listener)} about last night.`));
      break;
    }
    case 'suspect':
    case 'rumor': {
      if (!arg || !state.chars[arg]) break;
      const mult = option === 'rumor' ? 1.5 : 1;
      if (arg === listener) {
        trustBump(state, listener, speaker, -15);
        bump(L.suspicion, speaker, 10);
        say(speaker, 'suspicious', 'I know what you\'re hiding.');
        say(listener, 'shocked', 'Excuse me?! Get away from me.');
        break;
      }
      if (!team(listener, arg)) bump(L.suspicion, arg, mult * (6 + trustOf / 10));
      if (option === 'suspect') trustBump(state, listener, speaker, -3);
      if (arg !== speaker) note(state, arg, `Rumor: someone is spreading suspicion about you.`);
      say(speaker, 'suspicious', option === 'rumor'
        ? `Don't repeat this, but I heard ${nameOf(arg)} was sneaking around after curfew…`
        : `Have you noticed how ${nameOf(arg)} acts? Something's off.`);
      say(listener, 'suspicious', voiceLine(state, listener, trustOf >= 40 ? 'agree' : 'doubt', { x: nameOf(arg) }));
      if (toPlayer) note(state, listener, `${Sn} warned you about ${nameOf(arg)}.`);
      if (option === 'suspect') seen(narrate(`You overhear ${Sn} whispering about ${nameOf(arg)}.`));
      break;
    }
    case 'invite': {
      const room = ROOM_BY_ID[arg] ? arg : S.room;
      const accepts = team(speaker, listener) || (trustOf >= INVITE_TRUST && L.suspicion[speaker] < 30);
      if (toPlayer) {
        // A person decides for themselves at nightfall.
        state.offers = state.offers.filter((o) => !(o.from === speaker && o.to === listener));
        state.offers.push({ from: speaker, room, to: listener });
        tell(beats, [listener], panel({ mood: 'pink', sfx: 'doki', caption: `${Sn}: "Spend tonight with me in the ${roomName(room)}? It's safer together."`, cast: [{ id: speaker, expr: 'blush' }] }));
        note(state, listener, `${Sn} invited you to spend the night in the ${roomName(room)}.`);
        if (isPlayer) {
          state.invites[speaker] = { room, from: speaker };
          mine(narrate(`You asked ${nameOf(listener)} to spend the night in the ${roomName(room)}. They'll decide at nightfall.`));
        }
        break;
      }
      say(speaker, 'blush', `Tonight… stay with me in the ${roomName(room)}? Nobody should be alone.`);
      if (accepts) {
        state.invites[listener] = { room, from: speaker };
        state.invites[speaker] = { room, from: speaker };
        say(listener, 'happy', `${voiceLine(state, listener, 'yes')} The ${roomName(room)} it is.`);
        if (isPlayer) note(state, speaker, `${nameOf(listener)} agreed to spend the night with you in the ${roomName(room)}.`);
      } else {
        say(listener, 'suspicious', voiceLine(state, listener, 'no'));
      }
      seen(narrate(`${Sn} asks ${nameOf(listener)} something quietly. ${accepts ? 'They nod.' : 'They shake their head.'}`));
      break;
    }
    case 'interrogate': {
      trustBump(state, listener, speaker, -10);
      say(speaker, 'suspicious', `Let's cut the act. What do you know about what's happening here?`);
      let tell = null;
      if (L.role === 'yandere' && L.obsession >= 40) tell = `${nameOf(listener)} flinched when you mentioned ${nameOf(state.plot.beloved)}. Their pupils… shrank.`;
      else if (L.role === 'accomplice' && chance(state, 0.5)) tell = `${nameOf(listener)} glanced at ${nameOf(state.plot.yandere)} before answering.`;
      if (tell) {
        const ev = addEvidence(state, { kind: 'tell', subject: L.role === 'yandere' ? listener : state.plot.yandere, strength: 25, night: state.day, where: null, text: tell });
        learn(state, speaker, ev);
        say(listener, 'shocked', voiceLine(state, listener, 'defend'));
        mine(panel({ mood: 'shock', sfx: '*TWITCH*', caption: tell, cast: [{ id: listener, expr: 'suspicious' }] }));
      } else {
        say(listener, 'shocked', voiceLine(state, listener, 'defend'));
        mine(narrate('No tells. Either they\'re innocent, or very good.'));
      }
      break;
    }
    case 'confess': {
      S.confessed = true;
      const ok = trustOf >= 60;
      trustBump(state, listener, speaker, ok ? 20 : -10);
      say(speaker, 'blush', 'I… I\'ve liked you for a long time. I had to say it, in case… in case we don\'t make it.');
      say(listener, ok ? 'blush' : 'shocked', ok ? '…Idiot. Me too.' : 'W-what? Now?! I can\'t think about that right now!');
      mine(panel({ mood: 'pink', sfx: ok ? 'DOKI DOKI' : 'CRACK', caption: ok ? 'Your heart could burst.' : 'Bad timing. Very bad timing.', cast: [{ id: listener, expr: ok ? 'blush' : 'shocked' }] }));
      jealousy(state, speaker, listener, 25, beats);
      break;
    }
    case 'give': {
      const i = S.items.indexOf('letter');
      if (i < 0) break;
      S.items.splice(i, 1);
      trustBump(state, listener, speaker, 25);
      say(speaker, 'blush', 'This is for you. Read it later. Please.');
      say(listener, 'blush', '…! Th-thank you.');
      jealousy(state, speaker, listener, 15, beats);
      break;
    }
    default:
      break;
  }
  return beats;
}

// Yandere loses sanity when someone gets close to their beloved in front of them.
function jealousy(state, speaker, listener, amount, beats) {
  const y = state.plot.yandere;
  if (listener !== state.plot.beloved || speaker === y || !active(state, y)) return;
  const Y = state.chars[y];
  if (Y.room !== state.chars[speaker].room) return;
  Y.sanity = clamp(Y.sanity - amount);
  if (isHuman(state, y)) {
    tell(beats, [y], panel({ mood: 'crimson', sfx: 'crack', caption: `${nameOf(speaker)} is getting too close to ${nameOf(listener)}. Sanity -${amount}.`, cast: [{ id: speaker, expr: 'happy' }] }));
  }
}

// What `id` claims about last night and today's turns. Innocents tell the
// truth. The Obsessive lies about the turn (or night) they killed in, and the
// Accomplice claims to have been with them then. Lies show up as
// contradictions with the timetable, cameras and other people's stories.
function alibiClaim(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  const parts = [];
  const report = state.nightReport;
  if (report && report.night === state.day - 1 && report.rooms[id]) {
    let room = report.rooms[id];
    if (id === report.attacker && report.claimedRoom) room = report.claimedRoom;
    const mates = Object.keys(report.rooms).filter((o) => o !== id && report.rooms[o] === room && state.chars[o].alive && o !== report.attacker);
    if (c.role === 'accomplice' && report.attacker) mates.push(report.attacker);
    parts.push(`Last night I slept in the ${roomName(room)}${mates.length ? ` with ${[...new Set(mates)].map(nameOf).join(' and ')}` : ', alone'}.`);
  }
  const today = state.history.filter((h) => h.day === state.day);
  const killTicks = state.bodies.filter((b) => b.killer === p.yandere && b.day === state.day && b.tick != null).map((b) => b.tick);
  const turns = today.map((h) => {
    let room = h.rooms[id];
    if (!room) return null;
    let mates = Object.keys(h.rooms).filter((o) => o !== id && h.rooms[o] === room);
    if (id === p.yandere && killTicks.includes(h.tick)) {
      room = CHAR_BY_ID[id].schedule[h.tick];
      mates = [];
    }
    if (id === p.accomplice && killTicks.includes(h.tick)) mates = [...new Set([...mates, p.yandere])];
    return `${PERIODS[h.tick]}: ${ROOM_BY_ID[room].name}${mates.length ? ` with ${mates.map(nameOf).join(', ')}` : ', alone'}`;
  }).filter(Boolean);
  if (turns.length) parts.push(`Today, ${turns.join('; ')}.`);
  if (!parts.length) return 'We only just got locked in. I\'ve been following the timetable like everyone else.';
  return parts.join(' ');
}

// Something `id` "saw". True for innocents; the Obsessive's team sometimes
// invents a sighting that puts their scapegoat at the latest murder.
function sighting(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  const team = c.role === 'yandere' || c.role === 'accomplice';
  const body = state.bodies.filter((b) => b.day === state.day && b.found).at(-1);
  if (team && body && chance(state, 0.6)) {
    const sg = ai.scapegoat(state, id).id;
    if (sg && sg !== id) return `I saw ${nameOf(sg)} near the ${roomName(body.room)} right around when it happened. Just saying.`;
  }
  const pool = state.history.filter((h) => h.rooms[id] && (h.day === state.day || h.day === state.day - 1)).slice(-6);
  const h = pick(state, pool);
  if (!h) return null;
  const room = h.rooms[id];
  const mates = Object.keys(h.rooms).filter((o) => o !== id && h.rooms[o] === room);
  const when = `${h.day === state.day ? '' : 'Yesterday '}${PERIODS[h.tick]}`.trim();
  if (!mates.length) {
    // They were alone, but may have seen who passed through next door.
    const passer = Object.keys(h.rooms).find((o) => o !== id && adjacent(h.rooms[o], room));
    return passer ? `At ${when} I was alone in the ${roomName(room)}, and I saw ${nameOf(passer)} in the ${roomName(h.rooms[passer])} next door.` : `At ${when} I was alone in the ${roomName(room)}. Didn't see a soul.`;
  }
  return `At ${when} I was in the ${roomName(room)} with ${mates.map(nameOf).join(' and ')}.`;
}

function applySearch(state, id) {
  const c = state.chars[id];
  const isPlayer = isHuman(state, id);
  const beats = [];
  const mine = (b) => { if (isPlayer) beats.push({ ...b, to: [id] }); };
  const det = c.role === 'detective';
  const clues = findable(state, c.room, id);
  const found = det ? clues : clues.length && chance(state, 0.7) ? [clues[0]] : [];
  for (const e of found) {
    learn(state, id, e);
    mine(panel({ mood: 'shock', sfx: 'CLUE!', caption: e.text }));
  }
  const item = state.roomItems[c.room];
  if (item && chance(state, det ? 0.9 : 0.6)) {
    state.roomItems[c.room] = null;
    c.items.push(item);
    mine(panel({ mood: 'neutral', sfx: 'FOUND', caption: `${ITEMS[item].name}: ${ITEMS[item].desc}`, icon: ITEMS[item].icon }));
  }
  if (isPlayer && !beats.length) mine(narrate(pick(state, ['Dust. Rain. Nothing useful.', 'You turn the room over and find nothing.', 'Nothing… or you missed it.'])));
  tell(beats, humansIn(state, c.room, [id]), narrate(`${nameOf(id)} rummages through the ${roomName(c.room)}${found.length ? ' and pockets something' : ''}.`));
  return beats;
}

function applyUse(state, id, item, arg) {
  const c = state.chars[id];
  const isPlayer = isHuman(state, id);
  const beats = [];
  const i = c.items.indexOf(item);
  if (i < 0 || !ITEMS[item].usable) return beats;
  const out = (b) => { if (isPlayer) beats.push({ ...b, to: [id] }); };
  switch (item) {
    case 'diary': {
      c.items.splice(i, 1);
      c.knows.beloved = state.plot.beloved;
      const t = `"I can't stop thinking about ${nameOf(state.plot.beloved)}. Anyone who touches them is dead to me." — the Obsessive is fixated on ${nameOf(state.plot.beloved)}.`;
      note(state, id, t);
      out(panel({ mood: 'crimson', sfx: 'shiver', caption: t, cast: [{ id: state.plot.beloved, expr: 'neutral' }] }));
      break;
    }
    case 'keycard': {
      c.items.splice(i, 1);
      const cams = state.evidence.filter((e) => e.kind === 'camera' && !e.destroyed);
      cams.forEach((e) => learn(state, id, e));
      out(panel({ mood: 'dark', sfx: 'bzzt', caption: cams.length ? cams.map((e) => e.text).join(' ') : 'Static. The cameras recorded nothing unusual.' }));
      break;
    }
    case 'mirror': {
      const t = state.chars[arg];
      if (!t || !active(state, arg) || t.room !== c.room || arg === id) return beats;
      c.items.splice(i, 1);
      const o = t.obsession;
      const txt = o >= 40
        ? `In the mirror, ${nameOf(arg)} is smiling — but their face isn't. (Obsession ${o})`
        : `${nameOf(arg)}'s reflection looks tired, scared, ordinary. (Obsession ${o})`;
      if (o >= 40) bump(c.suspicion, arg, 25);
      note(state, id, txt);
      out(panel({ mood: o >= 40 ? 'crimson' : 'neutral', sfx: o >= 40 ? 'GLINT' : 'glint', caption: txt, cast: [{ id: arg, expr: o >= 40 ? 'yandere' : 'neutral' }] }));
      break;
    }
    case 'salts': {
      c.items.splice(i, 1);
      c.sanity = clamp(c.sanity + 40);
      out(narrate('A sharp breath of ammonia. The world stops tilting. (+40 sanity)'));
      break;
    }
    default:
      break;
  }
  return beats;
}

function applyStab(state, id, victim) {
  if (stabVictim(state, id) !== victim) return [];
  const c = state.chars[id];
  const V = state.chars[victim];
  const p = state.plot;
  const room = c.room;
  const beats = [];
  tell(beats, [isHuman(state, id) && id], killBeat(id, victim, room, 'killer'));
  tell(beats, [isHuman(state, victim) && victim], killBeat(id, victim, room, 'victim'));
  V.alive = false;
  state.bodies.push({ victim, room, day: state.day, tick: state.tick, killer: id, found: false });
  state.crimeScenes.push({ day: state.day, room, victim });
  const silent = c.obsession >= 80;
  c.bloody = !silent || chance(state, 0.5);
  c.sanity = victim === p.target ? 100 : clamp(c.sanity + 30);
  const hair = CHAR_BY_ID[id].hair;
  const build = CHAR_BY_ID[id].build;
  if (!silent) {
    if (chance(state, 0.6)) addEvidence(state, { kind: 'hair', trait: 'hair', value: hair, strength: 20, night: state.day, where: room,
      text: `A strand of ${TRAIT_TEXT.hair[hair]} clutched in ${nameOf(victim)}'s hand (${roomName(room)}).` });
    if (chance(state, 0.5)) addEvidence(state, { kind: 'footprint', trait: 'build', value: build, strength: 15, night: state.day, where: room,
      text: `${build === 'tall' ? 'Large' : 'Small'} bloody footprints leading away from ${nameOf(victim)}'s body (${roomName(room)}).` });
  }
  // A scream carries to the neighbouring rooms, unless the room is soundproof.
  if (!ROOM_BY_ID[room].soundproof) {
    const heardBy = activeIds(state).filter((o) => o !== id && adjacent(state.chars[o].room, room));
    state.alarm = { room, heardBy, tick: state.tick };
    for (const h of heardBy) note(state, h, `${PERIODS[state.tick]}: heard a scream from the ${roomName(room)}.`);
    tell(beats, heardBy.filter((h) => isHuman(state, h)), panel({ mood: 'shock', sfx: 'KYAAAA—', caption: `A scream from the ${roomName(room)}! Then silence.` }));
  } else {
    tell(beats, [isHuman(state, id) && id], narrate('The soundproofed walls swallow everything. Nobody heard a thing.'));
  }
  log(state, `${nameOf(victim)} was murdered in the ${roomName(room)} (Day ${state.day}, ${PERIODS[state.tick]}).`, [id]);
  return beats;
}

export function taskProgress(state) {
  if (state.taskProgressView) return state.taskProgressView; // multiplayer view: roles are hidden
  const real = state.order.filter((id) => !['yandere', 'accomplice'].includes(state.chars[id].role) && state.chars[id].alive);
  const all = real.flatMap((id) => state.chars[id].tasks);
  return { done: all.filter((t) => t.done).length, total: all.length };
}

function applyTask(state, id) {
  const c = state.chars[id];
  const t = c.tasks.find((x) => !x.done && x.room === c.room);
  const isPlayer = isHuman(state, id);
  const beats = [];
  const mine = (b) => { if (isPlayer) beats.push({ ...b, to: [id] }); };
  if (!t) return beats;
  t.done = true;
  const fake = ['yandere', 'accomplice'].includes(c.role);
  mine(narrate(`${t.label}: done.${fake ? ' (Nobody needs to know it was pointless.)' : ''} ${c.tasks.filter((x) => x.done).length}/${c.tasks.length} tasks.`));
  if (!fake && c.tasks.every((x) => x.done)) {
    // Reward: a genuine lead on the killer.
    const y = state.plot.yandere;
    const trait = chance(state, 0.5) ? 'hair' : 'build';
    const value = CHAR_BY_ID[y][trait];
    const ev = addEvidence(state, { kind: 'lead', trait, value, strength: 15, night: state.day, where: null,
      text: `While doing chores, ${nameOf(id)} found a torn uniform button and a note: the one hunting people here has ${TRAIT_TEXT[trait][value]}.` });
    learn(state, id, ev);
    mine(panel({ mood: 'shock', sfx: '*CLUE!*', caption: `All your tasks are done. ${ev.text}`, icon: 'page' }));
  }
  const prog = taskProgress(state);
  if (!state.powerRestored && prog.total && prog.done >= prog.total) {
    state.powerRestored = true;
    const build = CHAR_BY_ID[state.plot.yandere].build;
    const ev = addEvidence(state, { kind: 'camera', trait: 'build', value: build, strength: 25, night: state.day, where: null,
      text: `Power restored! The backup camera drive shows the killer's silhouette: ${TRAIT_TEXT.build[build]}.` });
    publish(state, ev);
    beats.push(panel({ mood: 'shock', sfx: '*POWER ON*', caption: `The class finished every task. ${ev.text}`, icon: 'camera' }));
    log(state, 'All tasks finished: the power is back on.');
  }
  return beats;
}

function applyRoomAction(state, id) {
  const c = state.chars[id];
  const a = roomAction(state, id);
  const isPlayer = isHuman(state, id);
  const beats = [];
  const out = (b) => { if (isPlayer) beats.push({ ...b, to: [id] }); };
  if (!a.ok) { out(narrate(a.reason)); return beats; }
  switch (a.id) {
    case 'research': {
      c.researchedDay = state.day;
      const pool = activeIds(state).filter((o) => o !== id && o !== state.plot.yandere && !c.cleared.includes(o));
      const x = pick(state, pool);
      if (!x) { out(narrate('The archive has nothing new on anyone.')); break; }
      c.cleared.push(x);
      bump(c.suspicion, x, -40);
      note(state, id, `Archive: ${nameOf(x)} is NOT the Obsessive.`);
      out(panel({ mood: 'neutral', sfx: '*RUSTLE*', caption: `An old diary, a class photo, an alibi that checks out: ${CHAR_BY_ID[x].name} is NOT the Obsessive.`, cast: [{ id: x, expr: 'happy' }] }));
      break;
    }
    case 'cameras': {
      const rooms = Object.fromEntries(activeIds(state).map((o) => [o, state.chars[o].room]));
      c.camSnapshot = { day: state.day, tick: state.tick, rooms };
      const cams = state.evidence.filter((e) => e.kind === 'camera' && !e.destroyed);
      cams.forEach((e) => learn(state, id, e));
      const where = ROOMS.map((r) => {
        const who = Object.keys(rooms).filter((o) => rooms[o] === r.id && o !== id);
        return `${r.name}: ${who.length ? who.map(nameOf).join(', ') : '—'}`;
      }).join(' · ');
      out(panel({ mood: 'dark', sfx: '*BZZT*', caption: `Live feed — ${where}.${cams.length ? ' ' + cams.map((e) => e.text).join(' ') : ''}` }));
      break;
    }
    case 'rehearse': {
      const others = occupants(state, c.room).filter((o) => o !== id);
      others.forEach((o) => trustBump(state, o, id, 8));
      out(panel({ mood: 'pink', sfx: '*LA LA LA*', caption: `You play together until everyone is laughing. ${others.map(nameOf).join(', ')} trust you more.`, cast: others.map((o) => ({ id: o, expr: 'happy' })) }));
      break;
    }
    case 'wash': {
      const was = c.bloody;
      c.bloody = false;
      c.sanity = clamp(c.sanity + 15);
      out(narrate(was ? 'You scrub until the water runs clear. Nobody will ever know. (+15 sanity)' : 'Cold water, a quiet cot. You feel steadier. (+15 sanity)'));
      break;
    }
    case 'bell': {
      c.usedBell = true;
      state.pendingMeeting = { caller: id };
      out(panel({ mood: 'shock', sfx: '*DONG DONG DONG*', caption: 'You ring the bell. Everyone will gather for an emergency Class Trial at the end of this turn.' }));
      log(state, `${nameOf(id)} rang the emergency bell.`);
      break;
    }
    case 'lock': {
      c.usedLock = true;
      c.barricadeDay = state.day;
      out(narrate('You drag a dresser in front of your door in the Dorm Hall. Tonight you sleep here, and nobody gets in.'));
      break;
    }
    default:
      break;
  }
  return beats;
}

function endTick(state) {
  const beats = [];
  const p = state.plot;
  const Y = state.chars[p.yandere];
  if (active(state, p.yandere)) {
    const bel = state.chars[p.beloved];
    if (bel.alive) {
      if (Y.room === bel.room) { Y.obsession = clamp(Y.obsession + 12); Y.sanity = clamp(Y.sanity + 4); }
      else Y.obsession = clamp(Y.obsession - 3);
      const tgt = state.chars[p.target];
      if (tgt.alive && tgt.room === bel.room) Y.sanity = clamp(Y.sanity - (Y.room === bel.room ? 12 : 4));
      const rom = state.chars[p.romantic];
      if (active(state, p.romantic) && rom.room === bel.room && p.romantic !== p.yandere) Y.sanity = clamp(Y.sanity - 4);
    }
    // Obsession leaks: bystanders notice the staring.
    if (Y.obsession >= 70 && bel.alive && Y.room === bel.room) {
      for (const w of occupants(state, Y.room)) {
        if (w === p.yandere || w === p.accomplice || w === p.beloved) continue;
        if (chance(state, 0.5)) {
          bump(state.chars[w].suspicion, p.yandere, 4);
          tell(beats, [isHuman(state, w) && w], narrate(`${nameOf(p.yandere)} hasn't blinked once while looking at ${nameOf(p.beloved)}…`));
        }
      }
    }
  }
  // Bloodstains get noticed.
  for (const b of activeIds(state)) {
    if (!state.chars[b].bloody) continue;
    for (const w of occupants(state, state.chars[b].room)) {
      if (w === b || state.chars[w].role === 'accomplice' || state.chars[w].role === 'yandere') continue;
      if (state.evidence.some((e) => e.kind === 'blood' && e.subject === b && e.knownBy.includes(w) && e.night === state.day)) continue;
      if (!chance(state, 0.55)) continue;
      const ev = addEvidence(state, { kind: 'blood', subject: b, strength: 40, night: state.day, where: null,
        text: `${nameOf(w)} noticed dark red stains on ${nameOf(b)}'s sleeve (Day ${state.day}, ${roomName(state.chars[b].room)}).` });
      learn(state, w, ev);
      tell(beats, [isHuman(state, w) && w], panel({ mood: 'shock', sfx: '!?', caption: `Is that… blood? There are dark red stains on ${nameOf(b)}'s sleeve.`, cast: [{ id: b, expr: 'suspicious' }] }));
      tell(beats, [isHuman(state, b) && b], narrate(`${nameOf(w)}'s eyes flick to your sleeve. They saw the blood.`));
    }
  }
  if (state.alarm && state.alarm.tick < state.tick) state.alarm = null;
  state.history.push({ day: state.day, tick: state.tick, rooms: Object.fromEntries(activeIds(state).map((o) => [o, state.chars[o].room])) });
  state.tick += 1;

  // Bodies are reported by the first innocent to walk in.
  for (const body of state.bodies) {
    if (body.found) continue;
    const finders = occupants(state, body.room).filter((o) => o !== body.killer);
    if (!finders.length) continue;
    body.found = true;
    const finder = finders[0];
    const clue = findable(state, body.room, finder)[0];
    beats.push(sceneBeat(body.victim, body.room, `${nameOf(finder)} found ${CHAR_BY_ID[body.victim].name}'s body in the ${roomName(body.room)}. They were ${ROLES[state.chars[body.victim].role].name}.`));
    if (clue) { publish(state, clue); beats.push(narrate(`At the scene: ${clue.text}`)); }
    log(state, `${nameOf(finder)} found ${nameOf(body.victim)}'s body in the ${roomName(body.room)}.`);
    if (gameShouldEnd(state)) { beats.push(...endGame(state)); return beats; }
    beats.push(...beginTrial(state, { emergency: true, reason: `${nameOf(finder)} reported a body!` }));
    return beats;
  }
  if (state.pendingMeeting) {
    const caller = state.pendingMeeting.caller;
    state.pendingMeeting = null;
    beats.push(...beginTrial(state, { emergency: true, reason: `${nameOf(caller)} rang the emergency bell!` }));
    return beats;
  }
  if (state.tick >= state.ticksPerDay) beats.push(...beginTrial(state));
  return beats;
}

// ---------------------------------------------------------------------------
// Class Trial

function beginTrial(state, { emergency = false, reason = '' } = {}) {
  state.phase = 'trial';
  const final = state.day >= state.maxDay && state.tick >= state.ticksPerDay;
  state.trial = { day: state.day, final, emergency, presents: {}, accusers: [], votes: null, result: null };
  const beats = [panel({
    mood: 'trial', sfx: emergency ? 'EMERGENCY TRIAL' : final ? 'FINAL TRIAL' : 'CLASS TRIAL',
    caption: emergency ? `${reason} Everyone is dragged to the lecture hall.` : final ? 'The storm breaks at dawn. This is the last chance to name the Obsessive.' : 'Everyone gathers in the lecture hall. Nobody sits down.',
    cast: activeIds(state).map((id) => ({ id, expr: 'suspicious' })),
  })];
  for (const id of state.order) {
    if (isHuman(state, id) || !active(state, id)) continue;
    const st = ai.trialStatement(state, id);
    for (const evId of st.present) {
      const ev = state.evidence.find((e) => e.id === evId);
      if (!ev || ev.public) continue;
      publish(state, ev);
      beats.push(line(id, 'suspicious', `I found something. ${ev.text}`));
    }
    if (st.accuse) beats.push(...accusation(state, id, st.accuse));
    else if (!st.present.length) beats.push(line(id, 'sad', voiceLine(state, id, 'idle')));
  }
  return beats;
}

function accusation(state, speaker, accused) {
  const beats = [panel({ mood: 'shock', sfx: 'I ACCUSE YOU!', caption: `${nameOf(speaker)} points at ${nameOf(accused)}.`, cast: [{ id: speaker, expr: 'suspicious' }, { id: accused, expr: 'shocked' }] })];
  if (!isHuman(state, speaker)) beats.push(line(speaker, 'suspicious', voiceLine(state, speaker, 'accuse', { x: nameOf(accused) })));
  for (const l of activeIds(state)) {
    if (l === speaker || l === accused) continue;
    bump(state.chars[l].suspicion, accused, 6 * (state.chars[l].trust[speaker] / 50));
  }
  trustBump(state, accused, speaker, -15);
  if (!isHuman(state, accused)) beats.push(line(accused, 'shocked', voiceLine(state, accused, 'defend')));
  return beats;
}

// How many clues `id` may still present, and whether they may still accuse.
export function trialAllowance(state, id = state.playerId) {
  const t = state.trial;
  if (!t) return { presents: 0, accuse: false };
  return { presents: MAX_PRESENTS - (t.presents[id] ?? 0), accuse: !t.accusers.includes(id) };
}

export function presentEvidence(state, evId, by = state.playerId) {
  const t = state.trial;
  if (state.phase !== 'trial' || !t || trialAllowance(state, by).presents <= 0 || !active(state, by)) return [];
  const ev = knownEvidence(state, by).find((e) => e.id === evId);
  if (!ev || ev.public) return [];
  t.presents[by] = (t.presents[by] ?? 0) + 1;
  publish(state, ev);
  const matching = activeIds(state).filter((id) => matchesEvidence(id, ev) && id !== by);
  const beats = [panel({ mood: 'shock', sfx: 'LOOK AT THIS!', caption: `${nameOf(by)} presents: ${ev.text}`, cast: matching.map((id) => ({ id, expr: 'shocked' })) })];
  for (const id of matching) if (!isHuman(state, id)) beats.push(line(id, 'shocked', voiceLine(state, id, 'react')));
  return beats;
}

export function accuse(state, target, by = state.playerId) {
  const t = state.trial;
  if (state.phase !== 'trial' || !t || !trialAllowance(state, by).accuse || !active(state, by) || !active(state, target) || target === by) return [];
  t.accusers.push(by);
  return accusation(state, by, target);
}

// Everyone votes; plurality with at least 2 votes and more than "skip" expels.
export function castVote(state, playerChoice = null) {
  return castVotes(state, { [state.playerId]: playerChoice });
}

// humanVotes: { voterId: suspectId | null }. Bots decide their own.
export function castVotes(state, humanVotes = {}) {
  if (state.phase !== 'trial') throw new Error('No trial in progress');
  const votes = {};
  for (const id of activeIds(state)) {
    if (isHuman(state, id)) {
      const v = humanVotes[id];
      votes[id] = v && v !== id && active(state, v) ? v : null;
    } else votes[id] = ai.decideVote(state, id);
  }
  const tally = {};
  let skips = 0;
  for (const v of Object.values(votes)) {
    if (!v) skips += 1;
    else tally[v] = (tally[v] ?? 0) + 1;
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let expelled = null;
  if (ranked.length && ranked[0][1] >= 2 && ranked[0][1] > skips && !(ranked[1] && ranked[1][1] === ranked[0][1])) {
    expelled = ranked[0][0];
  }
  state.trial.votes = votes;
  state.trial.result = expelled;
  const beats = [panel({
    mood: 'trial', sfx: 'VOTE',
    caption: Object.entries(votes).map(([a, b]) => `${nameOf(a)} → ${b ? nameOf(b) : 'abstain'}`).join(' · '),
  })];
  if (expelled) {
    const E = state.chars[expelled];
    E.expelled = true;
    state.expelled.push({ id: expelled, day: state.day });
    const role = ROLES[E.role];
    beats.push(panel({
      mood: E.role === 'yandere' ? 'crimson' : 'dark', sfx: 'EXPELLED',
      caption: `${CHAR_BY_ID[expelled].name} is dragged out of the academy into the storm. They were… ${role.name}.`,
      cast: [{ id: expelled, expr: E.role === 'yandere' ? 'yandere' : 'sad' }], reveal: true,
    }));
    log(state, `${nameOf(expelled)} was expelled. They were ${role.name}.`);
  } else {
    beats.push(panel({ mood: 'dark', sfx: '……', caption: 'No majority. Nobody is expelled.' }));
    log(state, 'The trial ended without a verdict.');
  }
  if (state.chars[state.plot.yandere].expelled || state.trial.final || gameShouldEnd(state)) {
    beats.push(...endGame(state));
  } else if (state.trial.emergency && state.tick < state.ticksPerDay) {
    state.phase = 'day';
    beats.push(narrate(`Everyone drifts back to their timetable. It's ${PERIODS[state.tick]} now.`));
  } else {
    beginNight(state);
  }
  return beats;
}

// ---------------------------------------------------------------------------
// Night

function beginNight(state) {
  state.phase = 'night';
  log(state, `Night ${state.day} falls.`);
}

export function nightOptions(state, id = state.playerId) {
  const c = state.chars[id];
  const barricaded = c.barricadeDay === state.day;
  const offers = state.offers.filter((o) => o.to === id && active(state, o.from));
  const sleep = barricaded ? ['dorm'] : [c.room];
  if (!barricaded) for (const o of offers) if (!sleep.includes(o.room)) sleep.push(o.room);
  const inv = barricaded ? null : state.invites[id];
  if (inv && !sleep.includes(inv.room)) sleep.push(inv.room);
  const opts = { sleep, barricaded, defaultSleep: barricaded ? 'dorm' : inv?.room ?? c.room, offers, kill: null, stakeout: null, mustKill: false };
  if (!active(state, id)) return opts;
  if (c.role === 'yandere') {
    opts.kill = activeIds(state).filter((o) => o !== id && o !== state.plot.accomplice);
    opts.mustKill = c.sanity <= 0;
  }
  if (c.role === 'detective') opts.stakeout = ROOMS.map((r) => r.id);
  return opts;
}

// Where everyone intends to sleep, as far as `viewer` can tell (for the night UI).
export function knownNightPlans(state, viewer) {
  const out = {};
  for (const id of activeIds(state)) {
    if (id === viewer) continue;
    const c = state.chars[id];
    const inv = state.invites[id];
    if (inv && (inv.from === viewer || state.invites[viewer]?.room === inv.room)) out[id] = inv.room;
    else if (canSeeRoom(state, viewer, c.room) && !inv) out[id] = c.room;
    else out[id] = null;
  }
  return out;
}

export function resolveNight(state, choice = {}) {
  return resolveNightFor(state, { [state.playerId]: choice });
}

// choices: { humanId: { sleep, kill, stakeout } }. Bots decide their own.
export function resolveNightFor(state, choices = {}) {
  if (state.phase !== 'night') throw new Error('Not night');
  const p = state.plot;
  const choiceOf = (id) => choices[id] || {};
  const beats = [panel({ mood: 'night', sfx: 'click.', caption: `Night ${state.day}. The storm cuts the power. Every door on the corridor locks at once.` })];

  // 1. Where does everyone sleep?
  const rooms = {};
  for (const id of activeIds(state)) {
    if (isHuman(state, id)) {
      const opts = nightOptions(state, id);
      rooms[id] = opts.sleep.includes(choiceOf(id).sleep) ? choiceOf(id).sleep : opts.defaultSleep;
      // Accepting a person's invite is a promise to them too.
      const offer = opts.offers.find((o) => o.room === rooms[id]);
      if (offer) note(state, offer.from, `${nameOf(id)} accepted your invitation to the ${roomName(offer.room)}.`);
    } else {
      rooms[id] = ai.decideNightRoom(state, id);
    }
    if (state.chars[id].barricadeDay === state.day) rooms[id] = 'dorm';
  }
  // Broken promises cost trust.
  for (const [id, inv] of Object.entries(state.invites)) {
    if (!active(state, id) || !active(state, inv.from) || inv.from === id) continue;
    if (rooms[id] !== inv.room) trustBump(state, inv.from, id, -10);
  }

  // 2. Detective stake-out: they hide in another room and act as a witness there.
  const det = p.detective;
  if (active(state, det)) {
    const s = isHuman(state, det) ? choiceOf(det).stakeout : ai.decideStakeout(state, det, rooms);
    if (s && ROOM_BY_ID[s]) rooms[det] = s;
  }

  const report = { night: state.day, rooms: { ...rooms }, attacker: null, victim: null, outcome: 'quiet', claimedRoom: null };
  state.nightReport = report;

  // 3. The Obsessive makes their move.
  const y = p.yandere;
  const Y = state.chars[y];
  let victim = null;
  if (active(state, y)) {
    if (isHuman(state, y)) {
      const k = choiceOf(y).kill;
      victim = k && active(state, k) && k !== y ? k : null;
    }
    else victim = ai.decideKill(state, y, rooms);
    if (!victim && Y.sanity <= 0) {
      victim = pick(state, activeIds(state).filter((o) => o !== y && o !== p.accomplice && o !== p.beloved)) ?? null;
    }
  }

  const morning = [];
  if (victim) {
    beats.push(...attack(state, y, victim, rooms, report, morning));
  } else if (active(state, y)) {
    if (state.chars[p.target].alive) Y.sanity = clamp(Y.sanity - 8);
    tell(beats, [isHuman(state, y) && y], panel({ mood: 'night', sfx: '…', caption: 'You lie awake, listening to their breathing through the walls. Not tonight. (Sanity -8)' }));
  }
  if (!victim) beats.push(panel({ mood: 'night', sfx: 'drip… drip…', caption: 'Only the rain moves in the corridors.' }));

  // 4. Shared rooms become alibis.
  for (const a of activeIds(state)) {
    const mates = activeIds(state).filter((b) => b !== a && rooms[b] === rooms[a] && !(b === y && report.attacker === y && report.claimedRoom === rooms[a]));
    for (const b of mates) bump(state.chars[a].suspicion, b, -8);
    note(state, a, `Night ${state.day}: slept in the ${roomName(rooms[a])}${mates.length ? ` with ${mates.map(nameOf).join(', ')}` : ' alone'}.`);
  }

  // 5. Morning.
  state.day += 1;
  state.tick = 0;
  state.phase = 'day';
  for (const id of activeIds(state)) {
    state.chars[id].room = id === y && report.claimedRoom ? report.claimedRoom : rooms[id];
    state.chars[id].stalkedToday = false;
  }
  state.invites = {};
  state.offers = [];
  beats.push(panel({ mood: 'morning', sfx: 'ding dong', caption: `Day ${state.day}. ${state.day >= state.maxDay ? 'The radio says the storm breaks tonight. The Final Trial is at dusk.' : 'The morning bell rings through the empty halls.'}` }));
  beats.push(...flushMorning(state, morning));
  log(state, `Day ${state.day} begins.`);
  if (gameShouldEnd(state)) beats.push(...endGame(state));
  return beats;
}

function attack(state, y, victim, rooms, report, morning) {
  const p = state.plot;
  const Y = state.chars[y];
  const V = state.chars[victim];
  const hY = isHuman(state, y) ? y : null;
  const hV = isHuman(state, victim) ? victim : null;
  const scene = rooms[victim];
  const home = rooms[y];
  const hair = CHAR_BY_ID[y].hair;
  const build = CHAR_BY_ID[y].build;
  const silent = Y.obsession >= 80;
  const snapped = Y.sanity <= 0;
  const beats = [];
  report.attacker = y;
  report.victim = victim;
  report.claimedRoom = home;

  tell(beats, [hY], panel({ mood: 'crimson', sfx: silent ? '…' : 'tap… tap…', caption: `You slip out of the ${roomName(home)} toward the ${roomName(scene)}.${silent ? ' Your steps make no sound at all.' : ''}`, cast: [{ id: y, expr: 'yandere' }] }));
  tell(beats, [hV], panel({ mood: 'night', sfx: 'creeeak', caption: 'Your door opens. Someone is standing over you in the dark.' }));

  // Roommates may notice the Obsessive leaving.
  if (home !== scene) {
    for (const w of activeIds(state)) {
      if (w === y || w === p.accomplice || rooms[w] !== home) continue;
      if (chance(state, snapped ? 1 : silent ? 0.25 : 0.6)) {
        const ev = addEvidence(state, { kind: 'absence', subject: y, strength: 35, night: state.day, where: null,
          text: `${nameOf(w)} woke in the night: ${nameOf(y)}'s futon in the ${roomName(home)} was empty.` });
        learn(state, w, ev);
        morning.push({ publishId: ev.id });
      }
    }
  }

  // Camera footage along the route.
  const route = path(home, scene).slice(1);
  const cam = route.find((r) => ROOM_BY_ID[r].camera);
  if (cam && chance(state, 0.85)) {
    addEvidence(state, { kind: 'camera', trait: 'build', value: build, strength: 20, night: state.day, where: 'classroom',
      text: `Security feed, night ${state.day}: a ${build} silhouette crosses the ${roomName(cam)} at 2:13 AM.` });
  }

  if (V.barricadeDay === state.day && !silent) {
    Y.sanity = clamp(Y.sanity - 10);
    report.outcome = 'foiled';
    note(state, victim, `Night ${state.day}: someone tried your barricaded door for a long, long time.`);
    tell(beats, [hY], panel({ mood: 'night', sfx: '*RATTLE RATTLE*', caption: `${nameOf(victim)}'s door is barricaded. It won't budge. (Sanity -10)` }));
    tell(beats, [hV], panel({ mood: 'night', sfx: '*RATTLE RATTLE*', caption: 'The handle turns. The dresser holds. Whoever it is gives up… eventually.' }));
    tell(beats, state.humans.filter((h) => h !== hY && h !== hV), panel({ mood: 'night', sfx: '*RATTLE RATTLE*', caption: 'Somewhere, a door handle rattles.' }));
    morning.push(narrate(`${nameOf(victim)} says someone tried to break into their barricaded room last night.`));
    log(state, `Night ${state.day}: someone tried to break into ${nameOf(victim)}'s barricaded room.`);
    return beats;
  }

  const witnesses = activeIds(state).filter((w) => w !== y && w !== victim && w !== p.accomplice && rooms[w] === scene);
  const hasWhistle = V.items.includes('whistle');
  if (witnesses.length || hasWhistle) {
    if (hasWhistle && !witnesses.length) V.items.splice(V.items.indexOf('whistle'), 1);
    const ev = addEvidence(state, { kind: 'eyewitness', trait: 'hair', value: hair, strength: 30, night: state.day, where: null,
      text: witnesses.length
        ? `${witnesses.map(nameOf).join(' and ')} saw a figure with ${TRAIT_TEXT.hair[hair]} lunge at ${nameOf(victim)} in the ${roomName(scene)}, then flee.`
        : `${nameOf(victim)} blew the emergency whistle. The attacker fled — ${TRAIT_TEXT.hair[hair]} glinting in the dark.` });
    learn(state, victim, ev);
    witnesses.forEach((w) => learn(state, w, ev));
    Y.sanity = clamp(Y.sanity - 15);
    report.outcome = 'foiled';
    beats.push(panel({ mood: 'shock', sfx: witnesses.length ? 'GASP!' : 'FWEEEEE!', caption: witnesses.length ? `Someone else was in the ${roomName(scene)}. The attack fails.` : 'A shrill whistle splits the night. The attack fails.', cast: [{ id: victim, expr: 'shocked' }] }));
    morning.push(panel({ mood: 'shock', sfx: 'KYAAA!', caption: `${nameOf(victim)} survived an attack in the ${roomName(scene)} last night!`, cast: [{ id: victim, expr: 'shocked' }] }));
    morning.push({ publishId: ev.id });
    log(state, `Night ${state.day}: ${nameOf(victim)} was attacked in the ${roomName(scene)} but survived.`);
  } else {
    V.alive = false;
    report.outcome = 'killed';
    state.crimeScenes.push({ day: state.day + 1, room: scene, victim });
    state.bodies.push({ victim, room: scene, day: state.day + 1, killer: y, found: true });
    Y.bloody = !silent;
    if (victim === p.target) Y.sanity = 100; else Y.sanity = clamp(Y.sanity + 30);
    if (!silent) {
      if (snapped || chance(state, 0.65)) addEvidence(state, { kind: 'hair', trait: 'hair', value: hair, strength: 20, night: state.day, where: scene,
        text: `A strand of ${TRAIT_TEXT.hair[hair]} clutched in ${nameOf(victim)}'s hand (${roomName(scene)}).` });
      if (snapped || chance(state, 0.55)) addEvidence(state, { kind: 'footprint', trait: 'build', value: build, strength: 15, night: state.day, where: scene,
        text: `${build === 'tall' ? 'Large' : 'Small'} bloody footprints leading away from the body (${roomName(scene)}).` });
    }
    tell(beats, [hY], killBeat(y, victim, scene, 'killer'));
    tell(beats, [hV], killBeat(y, victim, scene, 'victim'));
    tell(beats, state.humans.filter((h) => h !== hY && h !== hV), panel({ mood: 'crimson', sfx: '*SHKK*', caption: 'Somewhere in the dark, something wet hits the floor.' }));
    morning.push(sceneBeat(victim, scene, `${CHAR_BY_ID[victim].name} was found dead in the ${roomName(scene)}. They were ${ROLES[V.role].name}.`));
    log(state, `Night ${state.day}: ${nameOf(victim)} was murdered in the ${roomName(scene)}.`);
  }
  return beats;
}

// Morning entries are either beats or deferred "publish this clue" markers,
// so clues only become public once the survivors wake up.
function flushMorning(state, list) {
  const out = [];
  for (const m of list) {
    if (m.publishId) {
      const ev = state.evidence.find((e) => e.id === m.publishId);
      publish(state, ev);
      out.push(narrate(ev.text));
    } else out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// End of match

function gameShouldEnd(state) {
  const p = state.plot;
  if (state.chars[p.yandere].expelled) return true;
  const others = activeIds(state).filter((id) => id !== p.yandere && id !== p.accomplice);
  return others.length <= 1;
}

export function computeWinners(state) {
  const p = state.plot;
  const c = state.chars;
  const in_ = (id) => c[id].alive && !c[id].expelled;
  const yWin = !c[p.target].alive && !c[p.yandere].expelled;
  const res = {};
  res[p.yandere] = { won: yWin, why: yWin ? `${nameOf(p.target)} is gone, and you walked free.` : c[p.yandere].expelled ? 'You were exposed and expelled.' : `${nameOf(p.target)} survived.` };
  res[p.accomplice] = { won: yWin, why: yWin ? 'Your secret — their secret — is safe.' : 'The Obsessive failed.' };
  res[p.detective] = { won: c[p.yandere].expelled, why: c[p.yandere].expelled ? 'You exposed the Obsessive.' : 'The Obsessive was never caught.' };
  res[p.target] = { won: in_(p.target), why: in_(p.target) ? 'You survived.' : c[p.target].expelled ? 'You were expelled.' : 'You were murdered.' };
  const framed = c[p.frameTarget].expelled;
  res[p.socialite] = { won: framed && !c[p.socialite].expelled, why: framed ? `${nameOf(p.frameTarget)} took the fall${c[p.socialite].expelled ? ', but so did you.' : '. Perfect.'}` : `${nameOf(p.frameTarget)} was never expelled.` };
  const love = in_(p.romantic) && in_(p.crush) && c[p.crush].trust[p.romantic] >= ROMANCE_TRUST;
  res[p.romantic] = { won: love, why: love ? `You and ${nameOf(p.crush)} walk out into the sunrise together.` : `${nameOf(p.crush)} never became yours (trust ${Math.round(c[p.crush].trust[p.romantic])}).` };
  return res;
}

function endGame(state) {
  state.phase = 'over';
  state.winners = computeWinners(state);
  return state.humans.map((h) => {
    const me = state.winners[h];
    return { ...panel({ mood: me.won ? 'pink' : 'crimson', sfx: me.won ? 'VICTORY' : 'DEFEAT', caption: me.why, cast: [{ id: state.plot.yandere, expr: 'yandere' }] }), to: [h] };
  });
}

// Run the rest of the match with the player as a spectator (after death/expulsion).
export function autoplayStep(state) {
  if (state.phase === 'day') return playerAct(state, { type: 'wait' });
  if (state.phase === 'trial') return castVote(state, null);
  if (state.phase === 'night') return resolveNight(state, {});
  return [];
}

// ---------------------------------------------------------------------------
// Player guidance: the start-of-match briefing and per-turn suggestions.

export function briefing(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  const n = nameOf;
  const common = {
    yandere: () => ({
      goal: `Kill ${n(p.target)} and don't get voted out.`,
      steps: [
        `First build Obsession to ${STAB_OBSESSION} by staying near ${n(p.beloved)}, your beloved.`,
        `Then get ${n(p.target)} alone. When you're in a room with only them (your Accomplice ${n(p.accomplice)} doesn't count), a red STAB button appears.`,
        'Check the timetable in your Notebook. After School, everyone goes to their club room, and most of them are alone there.',
        'Stabbing leaves you bloody. Anyone who meets you might notice. Go to the Infirmary and Wash Up.',
        'Screams carry to neighbouring rooms, except from the soundproof Music Room.',
        'Or strike at night: anyone who ends the day in a room by themselves is exposed.',
        `More Obsession unlocks Stalk at 50 and Silent Step at 80. Seeing ${n(p.target)} near ${n(p.beloved)} drains your Sanity, and at 0 you snap.`,
        'At trials, blend in: accuse someone else and vote with the crowd.',
      ],
      lose: 'You lose if you are voted out, or if the Final Trial ends with your target still alive.',
    }),
    accomplice: () => ({
      goal: `Help ${n(p.yandere)} kill ${n(p.target)} without ${n(p.yandere)} getting voted out.`,
      steps: [
        `${n(p.yandere)} is the Obsessive. You win or lose together.`,
        `You never count as a witness. Lead ${n(p.target)} into a quiet room where ${n(p.yandere)} can find you both, or invite them to spend the night with you.`,
        'After a murder, go to the crime scene and Cover Up clues before the Detective finds them.',
        `At trials, blame someone else and never vote for ${n(p.yandere)}.`,
      ],
      lose: `You lose if ${n(p.yandere)} is voted out or ${n(p.target)} survives.`,
    }),
    detective: () => ({
      goal: 'Work out who the Obsessive is and get them voted out at a trial.',
      steps: [
        'Every clue points at hair colour or build. Each fits two students, and two different clues point at exactly one.',
        'Search crime scenes: you always find the hidden clues there.',
        'Library: the gossip archive clears one innocent, but only once per match. Classroom: the cameras show where everyone is, once per day.',
        'Watch for blood on people\'s sleeves, and for anyone who claims an alibi nobody else confirms.',
        'At night you can stake out a room. Any attack there fails and you see the attacker.',
        'Courtyard: ring the bell to call a trial early. At trials, present your clues, accuse, and vote.',
      ],
      lose: 'You lose if the Obsessive is never voted out.',
    }),
    target: () => ({
      goal: 'Stay alive until the end of the Final Trial on Day 3.',
      steps: [
        'Someone wants you dead. They can only strike when nobody else is in the room with you.',
        'So never be alone. After School your timetable sends you to your club room alone, so think twice about going.',
        'Before night, invite someone you trust to sleep in the same room, or Barricade yourself in the Dorm Hall once.',
        'Search the Courtyard for the Emergency Whistle. It stops one attack.',
        'The note in your locker hints at the killer\'s hair colour. Help vote them out.',
      ],
      lose: 'You lose if you are killed or voted out.',
    }),
    socialite: () => ({
      goal: `Get ${n(p.frameTarget)} voted out at a trial, whoever the real killer is.`,
      steps: [
        `Whisper rumors about ${n(p.frameTarget)} to everyone you meet. Rumors hit harder than normal gossip.`,
        `Present clues that happen to match ${n(p.frameTarget)}'s hair or build, and accuse them.`,
        'When suspicion is high, ring the bell in the Courtyard to call a trial right away.',
        'Don\'t get voted out yourself.',
      ],
      lose: `You lose if ${n(p.frameTarget)} is never voted out, or if you are.`,
    }),
    romantic: () => ({
      goal: `Get ${n(p.crush)} to trust you to ${ROMANCE_TRUST}, with both of you still alive at the end.`,
      steps: [
        `Follow ${n(p.crush)}'s timetable and talk to them. Chat with Blush once their trust is 40 or more.`,
        'Rehearse together in the Music Room. Find the love letter in the Dorm Hall and give it to them.',
        'Confess once their trust is 60 or more.',
        `Someone else is obsessed with ${n(p.crush)}. Flirting in front of them could make you the next victim.`,
        `Spending nights together keeps ${n(p.crush)} safe too.`,
      ],
      lose: `You lose if either of you dies or is voted out, or ${n(p.crush)}'s trust is below ${ROMANCE_TRUST}.`,
    }),
  }[c.role]();
  return { role: c.role, ...common };
}

export function hints(state, id) {
  const c = state.chars[id];
  const p = state.plot;
  const out = [];
  if (!active(state, id) || state.phase !== 'day') return out;
  const here = occupants(state, c.room).filter((o) => o !== id);
  const next = PERIODS[state.tick];
  const sched = (o) => CHAR_BY_ID[o].schedule[state.tick];
  if (c.role === 'yandere') {
    const v = stabVictim(state, id);
    if (v) out.push(`You are alone with ${nameOf(v)}. Stab now, or wait for ${nameOf(p.target)}.`);
    if (c.obsession < STAB_OBSESSION && active(state, p.beloved)) out.push(`Obsession ${c.obsession}/${STAB_OBSESSION}: stay near ${nameOf(p.beloved)} (now in the ${roomName(state.chars[p.beloved].room)}) to unlock Stab.`);
    if (c.bloody) out.push('You have blood on you. Get to the Infirmary and Wash Up before anyone notices.');
    if (state.chars[p.target].alive) {
      const tr = state.chars[p.target].room;
      const alone = occupants(state, tr).filter((o) => o !== p.target && o !== p.accomplice).length === 0;
      if (canSeeRoom(state, id, tr)) out.push(`${nameOf(p.target)} is in the ${roomName(tr)}${alone ? ', alone' : ''}.`);
      else out.push(`Timetable: ${nameOf(p.target)} should be heading to the ${roomName(sched(p.target))} (${next}).`);
    }
    if (c.sanity < 35) out.push('Your Sanity is cracking. Spend time near your beloved, or kill.');
  }
  if (c.role === 'target') {
    if (!here.length) out.push('You are alone. That is exactly what the killer wants. Find people.');
    if (state.tick >= 2 && !state.invites[id] && c.barricadeDay !== state.day) out.push('Night is coming. Invite someone you trust, or Barricade in the Dorm Hall.');
  }
  if (c.role === 'detective' || c.role === 'target' || c.role === 'romantic') {
    const scene = state.crimeScenes.find((s) => s.day === state.day && findable(state, s.room, id).length);
    if (scene) out.push(`There may still be clues at the crime scene in the ${roomName(scene.room)}. Search it.`);
  }
  if (c.role === 'accomplice') {
    const scene = state.crimeScenes.find((s) => s.day === state.day && findable(state, s.room, '__nobody__').length);
    if (scene) out.push(`Clues are still lying around the ${roomName(scene.room)}. Get there and Cover Up.`);
    if (state.chars[p.target].alive && here.includes(p.target)) out.push(`${nameOf(p.target)} is here. Keep them busy until ${nameOf(p.yandere)} arrives.`);
  }
  if (c.role === 'romantic' && active(state, p.crush)) {
    out.push(here.includes(p.crush) ? `${nameOf(p.crush)} is right here. Talk to them.` : `${nameOf(p.crush)} should be at the ${roomName(sched(p.crush))} (${next}).`);
  }
  if (c.role === 'socialite' && active(state, p.frameTarget) && here.length) out.push(`Whisper a rumor about ${nameOf(p.frameTarget)}.`);
  const task = c.tasks.find((t) => !t.done);
  if (task && out.length < 3) out.push(c.tasks.some((t) => !t.done && t.room === c.room) ? 'One of your tasks is in this room.' : `Next task: ${task.label} (${roomName(task.room)}).`);
  const ra = roomAction(state, id);
  if (ra.ok) out.push(`This room's special action: ${ra.label}.`);
  if (!out.length) out.push('Move to a neighbouring room, or talk to someone here.');
  return out.slice(0, 3);
}

export { ISOLATED_ROOMS, INVITE_TRUST };
