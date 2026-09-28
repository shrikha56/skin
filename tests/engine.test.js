import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame, autoplayStep, castVote, resolveNight, playerAct, applyAction, learn, computeWinners, nightOptions,
  stabVictim, accuse, STAB_OBSESSION,
} from '../src/engine.js';
import { CHARACTERS, ROLE_ORDER, ROOMS } from '../src/data.js';
import { path, matchesEvidence } from '../src/core.js';

function playOut(g) {
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 300) autoplayStep(g);
  return g;
}

// A match where the player is the Obsessive, with the Detective sidelined so
// their night stake-out can't interfere with hand-built night scenarios.
function nightScenario(seed = 7) {
  const g = createGame({ seed, playerId: 'hana', playerRole: 'yandere' });
  g.chars[g.plot.detective].expelled = true;
  g.phase = 'night';
  g.invites = {};
  g.offers = [];
  for (const id of g.order) g.chars[id].room = 'dorm';
  g.chars.hana.room = 'library';
  return g;
}

test('every student is uniquely identified by hair + build', () => {
  const keys = CHARACTERS.map((c) => `${c.hair}/${c.build}`);
  assert.equal(new Set(keys).size, CHARACTERS.length);
  for (const c of CHARACTERS) {
    assert.ok(CHARACTERS.filter((o) => o.hair === c.hair).length >= 2, `${c.id} hair alone should not identify them`);
  }
});

test('createGame deals every role exactly once and honours the chosen role', () => {
  for (const role of ROLE_ORDER) {
    const g = createGame({ seed: 42, playerId: 'ren', playerRole: role });
    assert.equal(g.chars.ren.role, role);
    assert.deepEqual(g.order.map((id) => g.chars[id].role).sort(), [...ROLE_ORDER].sort());
    assert.notEqual(g.plot.beloved, g.plot.yandere);
    assert.notEqual(g.plot.beloved, g.plot.target);
  }
});

test('matches are deterministic for a given seed', () => {
  const a = createGame({ seed: 1234 });
  const b = createGame({ seed: 1234 });
  a.chars[a.playerId].alive = false;
  b.chars[b.playerId].alive = false;
  playOut(a);
  playOut(b);
  assert.deepEqual(a.winners, b.winners);
  assert.deepEqual(a.log, b.log);
});

test('bot-only matches always terminate with a result for everyone', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const g = createGame({ seed });
    g.chars[g.playerId].expelled = true; // spectate
    playOut(g);
    assert.equal(g.phase, 'over', `seed ${seed} did not finish`);
    assert.equal(Object.keys(g.winners).length, CHARACTERS.length);
    assert.equal(g.winners[g.plot.accomplice].won, g.winners[g.plot.yandere].won);
  }
});

test('an isolated victim is killed and leaves a crime scene', () => {
  const g = nightScenario();
  const victim = g.order.find((id) => ![g.plot.yandere, g.plot.accomplice, g.plot.detective].includes(id));
  g.chars[victim].room = 'music';
  resolveNight(g, { sleep: 'library', kill: victim });
  assert.equal(g.chars[victim].alive, false);
  assert.equal(g.crimeScenes.length, 1);
  assert.equal(g.crimeScenes[0].room, 'music');
  assert.equal(g.phase, 'day');
  assert.equal(g.day, 2);
});

test('a witness in the room foils the attack and sees the attacker\'s hair', () => {
  const g = nightScenario();
  const [victim, witness] = g.order.filter((id) => ![g.plot.yandere, g.plot.accomplice, g.plot.detective].includes(id));
  g.chars[victim].room = 'music';
  g.chars[witness].room = 'music';
  resolveNight(g, { sleep: 'library', kill: victim });
  assert.equal(g.chars[victim].alive, true);
  const ev = g.evidence.find((e) => e.kind === 'eyewitness');
  assert.ok(ev, 'eyewitness evidence created');
  assert.equal(ev.public, true);
  assert.ok(matchesEvidence('hana', ev));
});

test('the accomplice never counts as a witness', () => {
  const g = nightScenario();
  const victim = g.order.find((id) => ![g.plot.yandere, g.plot.accomplice, g.plot.detective].includes(id));
  g.chars[victim].room = 'music';
  g.chars[g.plot.accomplice].room = 'music';
  resolveNight(g, { sleep: 'library', kill: victim });
  assert.equal(g.chars[victim].alive, false);
});

test('the emergency whistle foils an otherwise clean attack', () => {
  const g = nightScenario();
  const victim = g.order.find((id) => ![g.plot.yandere, g.plot.accomplice, g.plot.detective].includes(id));
  g.chars[victim].room = 'music';
  g.chars[victim].items.push('whistle');
  resolveNight(g, { sleep: 'library', kill: victim });
  assert.equal(g.chars[victim].alive, true);
  assert.ok(!g.chars[victim].items.includes('whistle'));
});

test('the player cannot pick their own accomplice as a victim', () => {
  const g = nightScenario();
  assert.ok(!nightOptions(g).kill.includes(g.plot.accomplice));
});

test('camera rooms on the route record the attacker\'s build', () => {
  assert.deepEqual(path('library', 'dorm'), ['library', 'classroom', 'music', 'dorm']);
  let recorded = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const g = nightScenario(seed);
    const victim = g.order.find((id) => ![g.plot.yandere, g.plot.accomplice, g.plot.detective].includes(id));
    for (const id of g.order) if (id !== 'hana') g.chars[id].room = 'infirmary';
    g.chars[victim].room = 'dorm';
    resolveNight(g, { sleep: 'library', kill: victim });
    const cam = g.evidence.find((e) => e.kind === 'camera');
    if (cam) { recorded++; assert.equal(cam.value, 'petite'); assert.equal(cam.where, 'classroom'); }
  }
  assert.ok(recorded >= 12, `camera should usually record (${recorded}/20)`);
});

test('learning a clue raises suspicion only of matching students', () => {
  const g = createGame({ seed: 3, playerId: 'hana' });
  const before = { ...g.chars.hana.suspicion };
  const ev = { id: 'x', kind: 'hair', trait: 'hair', value: 'black', strength: 20, knownBy: [] };
  learn(g, 'hana', ev);
  for (const c of CHARACTERS) {
    if (c.id === 'hana') continue;
    const delta = g.chars.hana.suspicion[c.id] - before[c.id];
    assert.equal(delta, c.hair === 'black' ? 20 : 0, c.id);
  }
  assert.equal(learn(g, 'hana', ev), false, 'no double counting');
});

test('votes: plurality of two or more expels, ties do not', () => {
  const g = createGame({ seed: 5, playerId: 'hana', playerRole: 'detective' });
  g.phase = 'trial';
  g.trial = { day: 1, final: false, presented: 0, accused: false };
  // Everyone deeply suspects the Obsessive.
  for (const id of g.order) if (id !== g.plot.yandere) g.chars[id].suspicion[g.plot.yandere] = 100;
  castVote(g, g.plot.yandere);
  assert.equal(g.trial.result, g.plot.yandere);
  assert.equal(g.chars[g.plot.yandere].expelled, true);
  assert.equal(g.phase, 'over');
  assert.equal(computeWinners(g)[g.plot.detective].won, true);

  const t = createGame({ seed: 6, playerId: 'hana' });
  t.phase = 'trial';
  t.trial = { day: 1, final: false, presented: 0, accused: false };
  for (const id of t.order) for (const o of t.order) if (id !== o) t.chars[id].suspicion[o] = 0;
  castVote(t, null);
  assert.equal(t.trial.result, null);
  assert.equal(t.phase, 'night');
});

test('an accepted invite decides where both students sleep', () => {
  const g = createGame({ seed: 11, playerId: 'hana', playerRole: 'target' });
  const buddy = g.order.find((id) => id !== 'hana' && g.chars[id].role !== 'yandere' && g.chars[id].role !== 'accomplice');
  g.chars[buddy].room = g.chars.hana.room;
  g.chars[buddy].trust.hana = 80;
  g.chars[buddy].suspicion.hana = 0;
  playerAct(g, { type: 'talk', to: buddy, option: 'invite', arg: 'infirmary' });
  assert.equal(g.invites.hana.room, 'infirmary');
  // The buddy may accept other invites later in the day; the player's plan stands.
  assert.ok(nightOptions(g).sleep.includes('infirmary'));
});

test('chatting with the beloved feeds the Obsessive; rivals nearby drain sanity', () => {
  const g = createGame({ seed: 9, playerId: 'hana', playerRole: 'yandere' });
  const bel = g.plot.beloved;
  for (const id of g.order) g.chars[id].room = 'courtyard';
  g.chars.hana.sanity = 50;
  applyAction(g, 'hana', { type: 'talk', to: bel, option: 'chat', arg: 'smile' });
  assert.equal(g.chars.hana.obsession, 10);
  assert.equal(g.chars.hana.sanity, 60);
  applyAction(g, g.plot.target, { type: 'talk', to: bel, option: 'chat', arg: 'smile' });
  assert.equal(g.chars.hana.sanity, 52, 'jealousy costs sanity');
});

// ---------------------------------------------------------------------------
// Stabbing, bodies, alibis, tasks

function dayScenario(seed = 21) {
  const g = createGame({ seed, playerId: 'hana', playerRole: 'yandere' });
  const victim = g.order.find((id) => ![g.plot.yandere, g.plot.accomplice].includes(id));
  for (const id of g.order) g.chars[id].room = 'dorm';
  g.chars.hana.room = 'music';
  g.chars[victim].room = 'music';
  return { g, victim };
}

test('the beloved is never the Obsessive\'s own accomplice', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = createGame({ seed, playerId: null });
    assert.notEqual(g.plot.beloved, g.plot.accomplice, `seed ${seed}`);
  }
});

test('Stab needs enough Obsession and no witnesses', () => {
  const { g, victim } = dayScenario();
  g.chars.hana.obsession = STAB_OBSESSION - 1;
  assert.equal(stabVictim(g, 'hana'), null, 'not obsessed enough yet');
  g.chars.hana.obsession = STAB_OBSESSION;
  assert.equal(stabVictim(g, 'hana'), victim);
  const witness = g.order.find((id) => ![g.plot.yandere, g.plot.accomplice, victim].includes(id));
  g.chars[witness].room = 'music';
  assert.equal(stabVictim(g, 'hana'), null, 'a witness blocks it');
});

test('a stab kills, leaves the killer bloody, and a found body calls an emergency trial', () => {
  const { g, victim } = dayScenario();
  g.chars.hana.obsession = 40;
  const beats = applyAction(g, 'hana', { type: 'stab', to: victim });
  assert.ok(beats.some((b) => b.kind === 'kill' && b.pov === 'killer'));
  assert.equal(g.chars[victim].alive, false);
  assert.equal(g.chars.hana.bloody, true);
  const body = g.bodies.at(-1);
  assert.equal(body.found, false);
  // Someone walks in; at the end of the turn they report it.
  const finder = g.order.find((id) => id !== 'hana' && g.chars[id].alive);
  g.chars.hana.room = 'dorm';
  g.chars[finder].room = 'music';
  playerAct(g, { type: 'wait' });
  if (g.phase !== 'over') {
    assert.ok(body.found, 'body reported');
    assert.equal(g.phase, 'trial');
    assert.equal(g.trial.emergency, true);
  }
});

test('the Obsessive lies about where they were when they killed', () => {
  const { g, victim } = dayScenario(33);
  g.chars.hana.obsession = 40;
  applyAction(g, 'hana', { type: 'stab', to: victim });
  g.history.push({ day: g.day, tick: g.tick, rooms: { hana: 'music' } });
  const claimed = CHARACTERS.find((c) => c.id === 'hana').schedule[g.tick];
  g.tick += 1;
  const listener = g.order.find((id) => id !== 'hana' && g.chars[id].alive);
  g.chars[listener].room = g.chars.hana.room;
  applyAction(g, listener, { type: 'talk', to: 'hana', option: 'alibi' });
  const claim = g.chars[listener].notes.at(-1).text;
  assert.match(claim, new RegExp(`Morning: ${ROOMS.find((r) => r.id === claimed).name}, alone`));
  assert.doesNotMatch(claim, /Morning: Music Room/);
});

test('guilty and innocent students react to accusations the same way', () => {
  const g = createGame({ seed: 8, playerId: 'hana', playerRole: 'detective' });
  g.phase = 'trial';
  g.trial = { day: 1, final: false, presented: 0, accused: false };
  const beats = accuse(g, g.plot.yandere);
  const reply = beats.find((b) => b.kind === 'line' && b.speaker === g.plot.yandere);
  assert.equal(reply.expr, 'shocked');
});

test('finishing all your tasks earns a real clue about the killer', () => {
  const g = createGame({ seed: 12, playerId: 'hana', playerRole: 'detective' });
  for (const t of g.chars.hana.tasks) {
    g.chars.hana.room = t.room;
    applyAction(g, 'hana', { type: 'task' });
  }
  assert.ok(g.chars.hana.tasks.every((t) => t.done));
  const lead = g.evidence.find((e) => e.kind === 'lead');
  assert.ok(lead && lead.knownBy.includes('hana'));
  assert.ok(matchesEvidence(g.plot.yandere, lead));
});
