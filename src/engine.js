// Game rules. Pure functions over a plain JSON-serialisable state object:
// no DOM, no timers, no globals. The UI calls these and plays back the
// returned "beats" (panels, dialogue lines, narration) as webtoon cinematics.
//
// Match flow:  Day (4 periods) -> Class Trial -> Night -> next Day ...
// The Trial on the last day is the Final Trial and ends the match.

import { CHARACTERS, ROLE_ORDER, ROLES, ROOMS, ITEMS, TONES, TRAIT_TEXT, PERIODS } from './data.js';
import {
  rand, chance, pick, shuffle, clamp, adjacent, path, nameOf, roomName,
  active, activeIds, occupants, matchesEvidence, CHAR_BY_ID, ROOM_BY_ID,
} from './core.js';
import * as ai from './ai.js';

export const MAX_PRESENTS = 2;
const INVITE_TRUST = 45;
const ROMANCE_TRUST = 85;
const ISOLATED_ROOMS = ROOMS.filter((r) => !r.camera).map((r) => r.id);

// ---------------------------------------------------------------------------
// Setup

// playerId: null runs an all-bot match (used by the balance simulator).
export function createGame({ seed = Date.now(), playerId = 'hana', playerRole = null, maxDay = 3 } = {}) {
  const state = {
    seed,
    rng: seed | 0,
    day: 1,
    maxDay,
    tick: 0,
    ticksPerDay: PERIODS.length,
    phase: 'day',
    playerId,
    order: CHARACTERS.map((c) => c.id),
    chars: {},
    plot: {},
    roomItems: Object.fromEntries(ROOMS.map((r) => [r.id, r.item])),
    evidence: [],
    crimeScenes: [],
    invites: {}, // charId -> { room, from }   (accepted plans for tonight)
    offers: [], // invites made *to the player* by bots: { from, room }
    trial: null,
    nightReport: null,
    expelled: [],
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
  p.beloved = pick(state, state.order.filter((id) => ![p.yandere, p.target, p.romantic].includes(id)));
  p.crush = p.beloved;
  p.frameTarget = pick(state, state.order.filter((id) => id !== p.socialite));

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
const narrate = (text) => ({ kind: 'narrate', text });
const panel = (o) => ({ kind: 'panel', mood: 'neutral', cast: [], ...o });

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
  return opts;
}

export function playerActions(state) {
  const id = state.playerId;
  const c = state.chars[id];
  const acts = [];
  if (!active(state, id) || state.phase !== 'day') return acts;
  acts.push({ type: 'search', label: 'Search the room' });
  if (c.role === 'yandere' && c.obsession >= 50 && !c.stalkedToday && state.chars[state.plot.target].alive) {
    acts.push({ type: 'stalk', label: `Stalk ${nameOf(state.plot.target)}` });
  }
  if ((c.role === 'yandere' || c.role === 'accomplice') && findable(state, c.room, '__nobody__').length) {
    acts.push({ type: 'coverup', label: 'Cover up evidence' });
  }
  acts.push({ type: 'wait', label: 'Keep watch (wait)' });
  return acts;
}

// The player takes one action; every bot then takes one; then time advances.
export function playerAct(state, action) {
  if (state.phase !== 'day') throw new Error(`Cannot act during ${state.phase}`);
  const pid = state.playerId;
  const beats = [];
  if (active(state, pid)) beats.push(...applyAction(state, pid, action));
  for (const id of state.order) {
    if (id === pid || !active(state, id)) continue;
    beats.push(...applyAction(state, id, ai.decideDayAction(state, id)));
  }
  beats.push(...endTick(state));
  return beats;
}

export function applyAction(state, id, action) {
  const c = state.chars[id];
  const isPlayer = id === state.playerId;
  const playerHere = () => active(state, state.playerId) && state.chars[state.playerId].room === c.room;
  const beats = [];
  switch (action.type) {
    case 'move': {
      if (!adjacent(c.room, action.room)) throw new Error(`${id} cannot move ${c.room} -> ${action.room}`);
      const from = c.room;
      if (!isPlayer && playerHere()) beats.push(narrate(`${nameOf(id)} leaves for the ${roomName(action.room)}.`));
      c.room = action.room;
      if (isPlayer) beats.push(narrate(`You walk to the ${roomName(action.room)}. ${ROOM_BY_ID[action.room].blurb}`));
      else if (playerHere()) beats.push(narrate(`${nameOf(id)} walks in from the ${roomName(from)}.`));
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
      if (isPlayer) {
        beats.push(panel({ mood: 'crimson', sfx: 'I SEE YOU', caption: txt, cast: [{ id: t, expr: 'neutral' }] }));
      }
      break;
    }
    case 'coverup': {
      const ev = findable(state, c.room, '__nobody__');
      if (!ev.length) { if (isPlayer) beats.push(narrate('There is nothing left to clean up here.')); break; }
      const e = ev[0];
      e.destroyed = true;
      if (isPlayer) beats.push(panel({ mood: 'dark', sfx: 'scrub scrub', caption: `You quietly destroy a clue: ${e.text}` }));
      for (const w of occupants(state, c.room)) {
        if (w === id || state.chars[w].role === 'yandere' || state.chars[w].role === 'accomplice') continue;
        if (chance(state, 0.25)) {
          bump(state.chars[w].suspicion, id, 20);
          note(state, w, `Saw ${nameOf(id)} wiping something at the ${roomName(c.room)}.`);
          if (w === state.playerId) beats.push(narrate(`You catch ${nameOf(id)} wiping something off the floor…`));
          else if (isPlayer) beats.push(line(w, 'suspicious', `…What are you doing, ${nameOf(id)}?`));
        }
      }
      break;
    }
    case 'wait':
    default:
      if (isPlayer) beats.push(narrate('You keep your head down and watch who comes and goes.'));
      break;
  }
  return beats;
}

function applyTalk(state, speaker, listener, option, arg) {
  const S = state.chars[speaker];
  const L = state.chars[listener];
  const beats = [];
  if (!active(state, listener) || L.room !== S.room || speaker === listener) return beats;
  const isPlayer = speaker === state.playerId;
  const toPlayer = listener === state.playerId;
  const witness = active(state, state.playerId) && state.chars[state.playerId].room === S.room && !isPlayer && !toPlayer;
  const team = (a, b) => ['yandere', 'accomplice'].includes(state.chars[a].role) && ['yandere', 'accomplice'].includes(state.chars[b].role);
  const trustOf = L.trust[speaker];
  const Sn = nameOf(speaker);
  const say = (who, expr, text) => { if (isPlayer || toPlayer) beats.push(line(who, expr, text)); };

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
      say(listener, react, delta >= 5 ? pick(state, ['Thanks… that actually helps.', 'Heh. You\'re not so bad.', 'Stay close, okay?'])
        : delta > 0 ? 'Uh… okay?' : 'Why are you looking at me like that…?');
      if (speaker === state.plot.yandere && listener === state.plot.beloved) { S.obsession = clamp(S.obsession + 10); S.sanity = clamp(S.sanity + 10); }
      if (witness) beats.push(narrate(`${Sn} chats with ${nameOf(listener)}${tone === 'stare' ? ', staring without blinking' : ''}.`));
      jealousy(state, speaker, listener, 8, beats);
      break;
    }
    case 'alibi': {
      trustBump(state, listener, speaker, -2);
      const text = alibiClaim(state, listener);
      note(state, speaker, `${nameOf(listener)} claims: "${text}"`);
      say(speaker, 'neutral', 'Where were you last night? Be honest.');
      say(listener, 'suspicious', text);
      if (witness) beats.push(narrate(`${Sn} questions ${nameOf(listener)} about last night.`));
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
      if (arg === state.playerId && !isPlayer) note(state, state.playerId, `Rumor: someone is spreading suspicion about you.`);
      say(speaker, 'suspicious', option === 'rumor'
        ? `Don't repeat this, but I heard ${nameOf(arg)} was sneaking around after curfew…`
        : `Have you noticed how ${nameOf(arg)} acts? Something's off.`);
      say(listener, 'suspicious', trustOf >= 40 ? `…Now that you mention it. I'll keep an eye on ${nameOf(arg)}.` : 'Why should I believe you?');
      if (toPlayer) note(state, state.playerId, `${Sn} warned you about ${nameOf(arg)}.`);
      if (witness && option === 'suspect') beats.push(narrate(`You overhear ${Sn} whispering about ${nameOf(arg)}.`));
      break;
    }
    case 'invite': {
      const room = ROOM_BY_ID[arg] ? arg : S.room;
      const accepts = team(speaker, listener) || (trustOf >= INVITE_TRUST && L.suspicion[speaker] < 30);
      if (toPlayer) {
        state.offers.push({ from: speaker, room });
        beats.push(panel({ mood: 'pink', sfx: 'doki', caption: `${Sn}: "Spend tonight with me in the ${roomName(room)}? It's safer together."`, cast: [{ id: speaker, expr: 'blush' }] }));
        note(state, state.playerId, `${Sn} invited you to spend the night in the ${roomName(room)}.`);
        break;
      }
      say(speaker, 'blush', `Tonight… stay with me in the ${roomName(room)}? Nobody should be alone.`);
      if (accepts) {
        state.invites[listener] = { room, from: speaker };
        state.invites[speaker] = { room, from: speaker };
        say(listener, 'happy', `Okay. The ${roomName(room)}. I'll be there.`);
        if (isPlayer) note(state, speaker, `${nameOf(listener)} agreed to spend the night with you in the ${roomName(room)}.`);
      } else {
        say(listener, 'suspicious', 'I… don\'t think so. Sorry.');
      }
      if (witness) beats.push(narrate(`${Sn} asks ${nameOf(listener)} something quietly. ${accepts ? 'They nod.' : 'They shake their head.'}`));
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
        say(listener, L.role === 'yandere' ? 'yandere' : 'shocked', L.role === 'yandere' ? '…Why would you bring them up? Hm? Why?' : 'I-I don\'t know anything!');
        if (isPlayer) beats.push(panel({ mood: 'shock', sfx: 'TWITCH', caption: tell, cast: [{ id: listener, expr: 'yandere' }] }));
      } else {
        say(listener, 'neutral', 'I\'m as scared as you are. Leave me alone.');
        if (isPlayer) beats.push(narrate('No tells. Either they\'re innocent, or very good.'));
      }
      break;
    }
    case 'confess': {
      S.confessed = true;
      const ok = trustOf >= 60;
      trustBump(state, listener, speaker, ok ? 20 : -10);
      say(speaker, 'blush', 'I… I\'ve liked you for a long time. I had to say it, in case… in case we don\'t make it.');
      say(listener, ok ? 'blush' : 'shocked', ok ? '…Idiot. Me too.' : 'W-what? Now?! I can\'t think about that right now!');
      if (isPlayer) beats.push(panel({ mood: 'pink', sfx: ok ? 'DOKI DOKI' : 'CRACK', caption: ok ? 'Your heart could burst.' : 'Bad timing. Very bad timing.', cast: [{ id: listener, expr: ok ? 'blush' : 'shocked' }] }));
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
  if (y === state.playerId) {
    beats.push(panel({ mood: 'crimson', sfx: 'crack', caption: `${nameOf(speaker)} is getting too close to ${nameOf(listener)}. Sanity -${amount}.`, cast: [{ id: speaker, expr: 'happy' }] }));
  }
}

function alibiClaim(state, id) {
  const report = state.nightReport;
  if (!report) return 'Last night? We only got locked in today. I was in class like everyone else.';
  const c = state.chars[id];
  const liar = c.role === 'yandere' || c.role === 'accomplice';
  const actual = report.rooms[id];
  if (!actual) return 'I… don\'t want to talk about it.';
  if (liar && report.attacker === id) {
    return `I slept in the ${roomName(report.claimedRoom ?? actual)}. Didn't leave once. Ask anyone.`;
  }
  const withWho = Object.keys(report.rooms).filter((o) => o !== id && report.rooms[o] === actual && state.chars[o].alive);
  return `I was in the ${roomName(actual)} all night${withWho.length ? ` with ${withWho.map(nameOf).join(' and ')}` : ', alone'}.`;
}

function applySearch(state, id) {
  const c = state.chars[id];
  const isPlayer = id === state.playerId;
  const beats = [];
  const det = c.role === 'detective';
  const clues = findable(state, c.room, id);
  const found = det ? clues : clues.length && chance(state, 0.7) ? [clues[0]] : [];
  for (const e of found) {
    learn(state, id, e);
    if (isPlayer) beats.push(panel({ mood: 'shock', sfx: 'CLUE!', caption: e.text }));
  }
  const item = state.roomItems[c.room];
  if (item && chance(state, det ? 0.9 : 0.6)) {
    state.roomItems[c.room] = null;
    c.items.push(item);
    if (isPlayer) beats.push(panel({ mood: 'neutral', sfx: 'FOUND', caption: `${ITEMS[item].icon} ${ITEMS[item].name}: ${ITEMS[item].desc}` }));
  }
  if (isPlayer && !beats.length) beats.push(narrate(pick(state, ['Dust. Rain. Nothing useful.', 'You turn the room over and find nothing.', 'Nothing… or you missed it.'])));
  if (!isPlayer && active(state, state.playerId) && state.chars[state.playerId].room === c.room) {
    beats.push(narrate(`${nameOf(id)} rummages through the ${roomName(c.room)}${found.length ? ' and pockets something' : ''}.`));
  }
  return beats;
}

function applyUse(state, id, item, arg) {
  const c = state.chars[id];
  const isPlayer = id === state.playerId;
  const beats = [];
  const i = c.items.indexOf(item);
  if (i < 0 || !ITEMS[item].usable) return beats;
  const out = (b) => { if (isPlayer) beats.push(b); };
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
          if (w === state.playerId) beats.push(narrate(`${nameOf(p.yandere)} hasn't blinked once while looking at ${nameOf(p.beloved)}…`));
        }
      }
    }
  }
  state.tick += 1;
  if (state.tick >= state.ticksPerDay) beats.push(...beginTrial(state));
  return beats;
}

// ---------------------------------------------------------------------------
// Class Trial

function beginTrial(state) {
  state.phase = 'trial';
  const final = state.day >= state.maxDay;
  state.trial = { day: state.day, final, presented: 0, accused: false, votes: null, result: null };
  const beats = [panel({
    mood: 'trial', sfx: final ? 'FINAL TRIAL' : 'CLASS TRIAL',
    caption: final ? 'The storm breaks at dawn. This is the last chance to name the Obsessive.' : 'Everyone gathers in the lecture hall. Nobody sits down.',
    cast: activeIds(state).map((id) => ({ id, expr: 'suspicious' })),
  })];
  for (const id of state.order) {
    if (id === state.playerId || !active(state, id)) continue;
    const st = ai.trialStatement(state, id);
    for (const evId of st.present) {
      const ev = state.evidence.find((e) => e.id === evId);
      if (!ev || ev.public) continue;
      publish(state, ev);
      beats.push(line(id, 'suspicious', `I found something. ${ev.text}`));
    }
    if (st.accuse) beats.push(...accusation(state, id, st.accuse));
    else if (!st.present.length) beats.push(line(id, 'sad', pick(state, ['I don\'t know who to trust anymore…', 'I have nothing. I just want to go home.', 'Let\'s not do anything we\'ll regret.'])));
  }
  return beats;
}

function accusation(state, speaker, accused) {
  const beats = [panel({ mood: 'shock', sfx: 'I ACCUSE YOU!', caption: `${nameOf(speaker)} points at ${nameOf(accused)}.`, cast: [{ id: speaker, expr: 'suspicious' }, { id: accused, expr: 'shocked' }] })];
  for (const l of activeIds(state)) {
    if (l === speaker || l === accused) continue;
    bump(state.chars[l].suspicion, accused, 6 * (state.chars[l].trust[speaker] / 50));
  }
  trustBump(state, accused, speaker, -15);
  if (accused !== state.playerId) {
    const guilty = state.chars[accused].role === 'yandere';
    beats.push(line(accused, guilty ? 'yandere' : 'shocked', guilty
      ? pick(state, ['Me? Ahaha… why would I ever hurt anyone?', 'You\'re wasting everyone\'s time.'])
      : pick(state, ['That\'s insane! I was nowhere near there!', 'You\'re just trying to save yourself!'])));
  }
  return beats;
}

export function presentEvidence(state, evId) {
  const t = state.trial;
  if (state.phase !== 'trial' || !t || t.presented >= MAX_PRESENTS || !active(state, state.playerId)) return [];
  const ev = knownEvidence(state, state.playerId).find((e) => e.id === evId);
  if (!ev || ev.public) return [];
  t.presented += 1;
  publish(state, ev);
  const matching = activeIds(state).filter((id) => matchesEvidence(id, ev) && id !== state.playerId);
  const beats = [panel({ mood: 'shock', sfx: 'LOOK AT THIS!', caption: ev.text, cast: matching.map((id) => ({ id, expr: 'shocked' })) })];
  for (const id of matching) {
    beats.push(line(id, state.chars[id].role === 'yandere' ? 'yandere' : 'shocked',
      state.chars[id].role === 'yandere' ? 'Hm. Plenty of people fit that description.' : 'That doesn\'t prove anything!'));
  }
  return beats;
}

export function accuse(state, target) {
  const t = state.trial;
  if (state.phase !== 'trial' || !t || t.accused || !active(state, state.playerId) || !active(state, target)) return [];
  t.accused = true;
  return accusation(state, state.playerId, target);
}

// Everyone votes; plurality with at least 2 votes and more than "skip" expels.
export function castVote(state, playerChoice = null) {
  if (state.phase !== 'trial') throw new Error('No trial in progress');
  const votes = {};
  for (const id of activeIds(state)) {
    votes[id] = id === state.playerId ? playerChoice : ai.decideVote(state, id);
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
      cast: [{ id: expelled, expr: E.role === 'yandere' ? 'yandere' : 'sad' }],
    }));
    log(state, `${nameOf(expelled)} was expelled. They were ${role.name}.`);
  } else {
    beats.push(panel({ mood: 'dark', sfx: '……', caption: 'No majority. Nobody is expelled. Night falls.' }));
    log(state, 'The trial ended without a verdict.');
  }
  if (state.chars[state.plot.yandere].expelled || state.trial.final || gameShouldEnd(state)) {
    beats.push(...endGame(state));
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

export function nightOptions(state) {
  const id = state.playerId;
  const c = state.chars[id];
  const sleep = [c.room];
  for (const o of state.offers) if (!sleep.includes(o.room)) sleep.push(o.room);
  const inv = state.invites[id];
  if (inv && !sleep.includes(inv.room)) sleep.push(inv.room);
  const opts = { sleep, defaultSleep: inv?.room ?? c.room, offers: state.offers.slice(), kill: null, stakeout: null, mustKill: false };
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
  if (state.phase !== 'night') throw new Error('Not night');
  const p = state.plot;
  const pid = state.playerId;
  const beats = [panel({ mood: 'night', sfx: 'click.', caption: `Night ${state.day}. The storm cuts the power. Every door on the corridor locks at once.` })];

  // 1. Where does everyone sleep?
  const rooms = {};
  for (const id of activeIds(state)) {
    if (id === pid) {
      const opts = nightOptions(state);
      rooms[id] = opts.sleep.includes(choice.sleep) ? choice.sleep : opts.defaultSleep;
    } else {
      rooms[id] = ai.decideNightRoom(state, id);
    }
  }
  // Broken promises cost trust.
  for (const [id, inv] of Object.entries(state.invites)) {
    if (!active(state, id) || !active(state, inv.from) || inv.from === id) continue;
    if (rooms[id] !== inv.room) trustBump(state, inv.from, id, -10);
  }

  // 2. Detective stake-out: they hide in another room and act as a witness there.
  const det = p.detective;
  if (active(state, det)) {
    const s = det === pid ? choice.stakeout : ai.decideStakeout(state, det, rooms);
    if (s && ROOM_BY_ID[s]) rooms[det] = s;
  }

  const report = { night: state.day, rooms: { ...rooms }, attacker: null, victim: null, outcome: 'quiet', claimedRoom: null };
  state.nightReport = report;

  // 3. The Obsessive makes their move.
  const y = p.yandere;
  const Y = state.chars[y];
  let victim = null;
  if (active(state, y)) {
    if (y === pid) victim = choice.kill && active(state, choice.kill) && choice.kill !== y ? choice.kill : null;
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
    if (y === pid) beats.push(panel({ mood: 'night', sfx: '…', caption: 'You lie awake, listening to their breathing through the walls. Not tonight. (Sanity -8)' }));
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
  const pid = state.playerId;
  const Y = state.chars[y];
  const V = state.chars[victim];
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

  if (y === pid) beats.push(panel({ mood: 'crimson', sfx: silent ? '…' : 'tap… tap…', caption: `You slip out of the ${roomName(home)} toward the ${roomName(scene)}.${silent ? ' Your steps make no sound at all.' : ''}`, cast: [{ id: y, expr: 'yandere' }] }));
  if (victim === pid) beats.push(panel({ mood: 'night', sfx: 'creeeak', caption: 'Your door opens. Someone is standing over you in the dark.' }));

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
    state.crimeScenes.push({ night: state.day, room: scene, victim });
    if (victim === p.target) Y.sanity = 100; else Y.sanity = clamp(Y.sanity + 30);
    if (!silent) {
      if (snapped || chance(state, 0.65)) addEvidence(state, { kind: 'hair', trait: 'hair', value: hair, strength: 20, night: state.day, where: scene,
        text: `A strand of ${TRAIT_TEXT.hair[hair]} clutched in ${nameOf(victim)}'s hand (${roomName(scene)}).` });
      if (snapped || chance(state, 0.55)) addEvidence(state, { kind: 'footprint', trait: 'build', value: build, strength: 15, night: state.day, where: scene,
        text: `${build === 'tall' ? 'Large' : 'Small'} bloody footprints leading away from the body (${roomName(scene)}).` });
    }
    beats.push(panel({ mood: 'crimson', sfx: 'SLASH', caption: victim === pid ? 'Everything goes red, then black.' : '', cast: [{ id: victim, expr: 'shocked' }] }));
    morning.push(panel({ mood: 'shock', sfx: 'KYAAAAA!', caption: `${CHAR_BY_ID[victim].name} was found dead in the ${roomName(scene)}. They were ${ROLES[V.role].name}.`, cast: [{ id: victim, expr: 'dead' }] }));
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
  const me = state.winners[state.playerId];
  if (!me) return [];
  return [panel({
    mood: me.won ? 'pink' : 'crimson', sfx: me.won ? 'VICTORY' : 'DEFEAT',
    caption: me.won ? me.why : `${me.why}`,
    cast: [{ id: state.plot.yandere, expr: 'yandere' }],
  })];
}

// Run the rest of the match with the player as a spectator (after death/expulsion).
export function autoplayStep(state) {
  if (state.phase === 'day') return playerAct(state, { type: 'wait' });
  if (state.phase === 'trial') return castVote(state, null);
  if (state.phase === 'night') return resolveNight(state, {});
  return [];
}

export { ISOLATED_ROOMS, INVITE_TRUST };
