import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoom, joinRoom, startMatch, dayAction, trialMove, nightChoice, sendChat, openStream, pickCharacter,
} from '../server/rooms.js';
import { createGame, resolveTurn, beatsFor } from '../src/engine.js';

// A fake SSE response that records every event it receives.
function fakeClient() {
  const events = [];
  return {
    events,
    writeHead() {},
    write(chunk) {
      const m = /^event: (\w+)\ndata: (.*)\n\n$/s.exec(chunk);
      if (m) events.push({ event: m[1], data: JSON.parse(m[2]) });
    },
    on() {},
    last(event) { return [...events].reverse().find((e) => e.event === event)?.data; },
  };
}

function twoPlayerRoom() {
  const a = createRoom({ name: 'Ann', char: 'hana' });
  const b = joinRoom({ code: a.code, name: 'Bo', char: 'ren' });
  const ca = fakeClient();
  const cb = fakeClient();
  openStream(a.token, ca);
  openStream(b.token, cb);
  return { a, b, ca, cb };
}

test('engine: two humans act in the same turn and each only sees their own beats', () => {
  const g = createGame({ seed: 5, playerId: null, humans: ['hana', 'ren'] });
  for (const id of g.order) g.chars[id].room = 'dorm';
  g.chars.hana.room = 'library';
  g.chars.ren.room = 'music';
  const beats = resolveTurn(g, { hana: { type: 'move', room: 'classroom' }, ren: { type: 'wait' } });
  const forHana = beatsFor(beats, 'hana').map((b) => b.text ?? b.caption ?? '');
  const forRen = beatsFor(beats, 'ren').map((b) => b.text ?? b.caption ?? '');
  assert.ok(forHana.some((t) => t.startsWith('You walk to the Classroom')));
  assert.ok(!forRen.some((t) => t.startsWith('You walk to the Classroom')));
  assert.ok(forRen.some((t) => t.startsWith('You keep your head down')));
  assert.equal(g.tick, 1);
});

test('rooms: lobby, unique students, and the 2-player minimum', () => {
  const a = createRoom({ name: 'Ann', char: 'hana' });
  assert.throws(() => startMatch({ token: a.token }), /at least 2/);
  const b = joinRoom({ code: a.code, name: 'Bo', char: 'hana' });
  const cb = fakeClient();
  openStream(b.token, cb);
  const lobby = cb.last('lobby');
  assert.equal(lobby.players.length, 2);
  assert.notEqual(lobby.players[0].char, lobby.players[1].char, 'duplicate pick gets reassigned');
  assert.throws(() => pickCharacter({ token: b.token, char: 'hana' }), /already picked/);
  assert.throws(() => startMatch({ token: b.token }), /Only the host/);
  assert.throws(() => joinRoom({ code: 'ZZZZ', name: 'x' }), /No room/);
});

test('rooms: views never leak other players\' roles or secrets', () => {
  const { a, ca, cb } = twoPlayerRoom();
  startMatch({ token: a.token });
  const va = ca.last('view');
  const vb = cb.last('view');
  assert.equal(va.playerId, 'hana');
  assert.equal(vb.playerId, 'ren');
  const team = ['yandere', 'accomplice'];
  for (const [v, me] of [[va, 'hana'], [vb, 'ren']]) {
    assert.notEqual(v.chars[me].role, 'unknown');
    for (const id of v.order) {
      if (id === me) continue;
      const shown = v.chars[id].role;
      const teammates = team.includes(v.chars[me].role) && shown !== 'unknown' && team.includes(shown);
      assert.ok(shown === 'unknown' || teammates, `${me} can see ${id}'s role (${shown})`);
      assert.deepEqual(v.chars[id].tasks, []);
    }
    assert.equal(v.rng, 0);
    assert.equal(v.history.length, 0);
    assert.ok(v.evidence.every((e) => e.public || e.knownBy.includes(me)));
  }
});

test('rooms: a turn resolves once every living human has chosen', () => {
  const { a, b, ca, cb } = twoPlayerRoom();
  startMatch({ token: a.token });
  dayAction({ token: a.token, action: { type: 'wait' } });
  assert.equal(ca.last('view').tick, 0, 'still waiting on the second player');
  assert.deepEqual(ca.last('view').mp.waitingOn, ['ren']);
  dayAction({ token: b.token, action: { type: 'wait' } });
  const view = cb.last('view');
  assert.ok(view.tick === 1 || view.phase !== 'day', 'turn advanced');
});

test('rooms: a whole match can be played to the end by two humans', () => {
  const { a, b, ca } = twoPlayerRoom();
  startMatch({ token: a.token });
  for (let i = 0; i < 80; i++) {
    const v = ca.last('view');
    if (v.phase === 'over') break;
    for (const t of [a.token, b.token]) {
      try {
        if (v.phase === 'day') dayAction({ token: t, action: { type: 'wait' } });
        else if (v.phase === 'trial') trialMove({ token: t, vote: null });
        else if (v.phase === 'night') nightChoice({ token: t, choice: {} });
      } catch (e) {
        if (!/out of the game|not daytime|no trial|not night/i.test(e.message)) throw e;
      }
    }
  }
  const end = ca.last('view');
  assert.equal(end.phase, 'over');
  assert.ok(end.winners.hana && end.winners.ren);
  assert.ok(end.order.every((id) => end.chars[id].role !== 'unknown'), 'full reveal at the end');
});

test('rooms: whispers only reach people in the same room', () => {
  const { a, b, ca, cb } = twoPlayerRoom();
  const c = joinRoom({ code: ca.last('lobby').code, name: 'Cy', char: 'yuki' });
  const cc = fakeClient();
  openStream(c.token, cc);
  startMatch({ token: a.token });
  const before = { a: ca.events.length, b: cb.events.length, c: cc.events.length };
  sendChat({ token: a.token, text: 'meet me after class' });
  const got = (cl, from) => cl.events.slice(from).some((e) => e.event === 'chat' && e.data.some((m) => m.text === 'meet me after class'));
  const va = ca.last('view');
  const sameRoom = (id) => va.chars[id].room === va.chars.hana.room;
  assert.ok(got(ca, before.a), 'sender sees their own whisper');
  assert.equal(got(cb, before.b), sameRoom('ren'));
  assert.equal(got(cc, before.c), sameRoom('yuki'));
});
