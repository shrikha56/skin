// Browser front-end: renders the game state, turns clicks into engine calls,
// and plays back engine "beats" as webtoon panels and visual-novel dialogue.

import {
  createGame, objectiveText, playerAct, playerActions, talkOptions, knownEvidence,
  visibleLog, canSeeRoom, presentEvidence, accuse, castVote, nightOptions,
  knownNightPlans, resolveNight, autoplayStep, MAX_PRESENTS, briefing, hints, taskProgress,
} from './engine.js';
import { CHARACTERS, ROOMS, ROLES, ROLE_ORDER, ITEMS, TONES, TRAIT_TEXT, PERIODS, TITLE, SETTING } from './data.js';
import { CHAR_BY_ID, ROOM_BY_ID, adjacent, active, activeIds, occupants, nameOf, roomName, matchesEvidence } from './core.js';
import { portraitSVG } from './portraits.js';
import { icon } from './icons.js';
import { spotArt } from './spotart.js';
import * as voice from './voice.js';

const app = document.getElementById('app');
const cinema = document.getElementById('cinema');

let G = null;
const setup = { char: 'hana', role: null };
const ui = { tab: 'actions', talk: null, busy: false, skip: false, marks: {}, mirror: false, night: {}, brief: false };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const me = () => G.chars[G.playerId];
const role = (id) => ROLES[G.chars[id].role];

// ---------------------------------------------------------------------------
// Beat playback

let resolver = null;
const wait = () => new Promise((r) => { resolver = r; });
function advance() { if (resolver) { const r = resolver; resolver = null; r(); } }

document.addEventListener('keydown', (e) => {
  if (!ui.busy) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
  if (e.key === 'Escape') { ui.skip = true; advance(); }
});

async function playBeats(beats, { skipLabel = 'skip' } = {}) {
  if (!beats.length) return;
  ui.skipLabel = skipLabel;
  ui.busy = true;
  document.body.classList.add('busy');
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (ui.skip) break;
    voice.prefetch(beats[i + 1], G);
    if (b.kind === 'panel') await showPanel(b);
    else if (b.kind === 'kill') await showKill(b);
    else if (b.kind === 'scene') await showScene(b);
    else await showLine(b);
    voice.stop();
  }
  cinema.hidden = true;
  cinema.innerHTML = '';
  ui.skip = false;
  ui.busy = false;
  document.body.classList.remove('busy');
}

function showLine(b) {
  const box = document.getElementById('dialogue');
  if (!box) return Promise.resolve();
  if (b.kind === 'line') {
    const c = CHAR_BY_ID[b.speaker];
    const slot = document.querySelector(`[data-portrait="${b.speaker}"] .portrait-frame`);
    if (slot) slot.innerHTML = portraitSVG(b.speaker, b.expr);
    document.querySelectorAll('.cast-row .actor').forEach((el) => el.classList.toggle('speaking', el.dataset.portrait === b.speaker));
    box.innerHTML = `
      <div class="bubble expr-${esc(b.expr)} ${b.speaker === G.playerId ? 'mine' : ''}">
        <div class="nameplate" style="--hair:${c.hairHex}">${esc(c.name)}${b.speaker === G.playerId ? ' <small>(you)</small>' : ''}</div>
        <div class="mini-portrait">${portraitSVG(b.speaker, b.expr)}</div>
        <p class="speech">${typewriter(b.text)}</p>
      </div>
      ${continueHint()}`;
  } else {
    box.innerHTML = `<p class="narration">${typewriter(b.text)}</p>${continueHint()}`;
  }
  box.classList.add('waiting');
  voice.speak(b, G);
  return wait().then(() => {
    box.classList.remove('waiting');
    document.querySelectorAll('.cast-row .actor.speaking').forEach((el) => el.classList.remove('speaking'));
  });
}

const typewriter = (text) => esc(text).split(' ').map((w, i) => `<span class="tw" style="animation-delay:${Math.min(i * 22, 900)}ms">${w}</span>`).join(' ');
const continueHint = () => `<div class="continue">${icon('caret')} <span>click · space</span> <button class="skip-btn ${ui.skipLabel !== 'skip' ? 'big' : ''}" data-skip>${esc(ui.skipLabel || 'skip')}</button></div>`;

function showPanel(b) {
  const cast = b.cast || [];
  const panels = cast.length
    ? cast.map((c, i) => `
      <div class="subpanel" style="--i:${i};--hair:${CHAR_BY_ID[c.id].hairHex}">
        <div class="speedlines"></div>
        ${portraitSVG(c.id, c.expr, { dead: c.expr === 'dead' })}
        <span class="subname">${esc(CHAR_BY_ID[c.id].short)}</span>
      </div>`).join('')
    : '';
  const art = b.art || (!cast.length ? (b.icon ? ICON_ART[ITEMS[b.icon]?.icon ?? b.icon] : null) ?? PANEL_ART[b.mood] ?? 'star' : null);
  const artPanel = art ? `<div class="subpanel art"><div class="speedlines"></div>${spotArt(art)}</div>` : '';
  cinema.innerHTML = `
    <div class="webtoon mood-${esc(b.mood)} cast-${Math.min(cast.length + (art ? 1 : 0), 6)} ${b.story ? 'story' : ''}" style="${b.color ? `--role:${b.color}` : ''}">
      ${b.story ? `<div class="story-count">${b.story}</div>` : ''}
      <div class="panel-grid">${artPanel}${panels}</div>
      ${b.sfx ? `<div class="sfx">${esc(b.sfx)}</div>` : ''}
      ${whisperFor(b) ? `<div class="vbubble" lang="ja">${esc(whisperFor(b))}</div>` : ''}
      ${b.label ? `<div class="label-box panel-label">${esc(b.label.title)}<small>${esc(b.label.sub)}</small></div>` : ''}
      ${b.caption ? `<div class="caption">${esc(b.caption)}</div>` : ''}
      ${continueHint()}
    </div>`;
  cinema.hidden = false;
  if (b.caption) voice.speak({ kind: 'narrate', text: b.caption }, G);
  if (['shock', 'crimson', 'trial'].includes(b.mood)) {
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
  }
  return wait();
}

// Big panel illustrations stay emoji: they read as painted spot art at this size.
// Comic spot art for panels without a character in them.
const PANEL_ART = { night: 'moon', dark: 'candle', morning: 'sun', shock: 'alert', crimson: 'rose', trial: 'scales', pink: 'heart', neutral: 'star', role: 'key' };
const ICON_ART = { page: 'book', card: 'camera', camera: 'camera', book: 'book', bell: 'bell', lock: 'lock', note: 'heart', search: 'magnifier' };

// Pick spot art for a line of the intro from what it talks about.
function artFor(text) {
  const t = text.toLowerCase();
  if (/stab|kill|strike|murder/.test(t)) return 'knife';
  if (/timetable|task|chore/.test(t)) return 'clipboard';
  if (/blood|wash|infirmary/.test(t)) return 'candle';
  if (/scream|bell|trial early/.test(t)) return 'bell';
  if (/night|sleep|barricade/.test(t)) return 'moon';
  if (/clue|search|evidence|hair|camera/.test(t)) return 'magnifier';
  if (/archive|library/.test(t)) return 'book';
  if (/trial|vote|accuse|blame/.test(t)) return 'scales';
  if (/love|confess|crush|trust|flirt|beloved|obsession/.test(t)) return 'heart';
  if (/rumor|whisper/.test(t)) return 'rose';
  if (/alone|never be/.test(t)) return 'alert';
  return 'star';
}

// The whole briefing as a webtoon: one panel per click, skippable.
function introStory({ full = true } = {}) {
  const b = briefing(G, G.playerId);
  const r = role(G.playerId);
  const pid = G.playerId;
  const p = G.plot;
  const mentioned = (text) => G.order.filter((id) => id !== pid && new RegExp(`\\b${nameOf(id)}\\b`).test(text)).slice(0, 2)
    .map((id) => ({ id, expr: id === p.target && me().role === 'yandere' ? 'neutral' : id === p.beloved && me().role === 'yandere' ? 'happy' : 'neutral' }));
  const beats = [];
  if (full) {
    beats.push({ kind: 'panel', mood: 'night', art: 'storm', sfx: '*CRACK-BOOM*', caption: `A storm has sealed ${SETTING}. The gates won't open for three days.` });
    beats.push({ kind: 'panel', mood: 'neutral', sfx: '*SIX STUDENTS*', caption: 'Six students are trapped inside. One of them is in love. Someone else is in the way.', cast: G.order.map((id) => ({ id, expr: 'suspicious' })) });
  }
  beats.push({ kind: 'panel', mood: 'role', color: r.color, sfx: r.sfx, caption: `${r.pitch} Only you know this.`, label: { title: r.name, sub: r.stat }, whisper: r.whisper, cast: [{ id: pid, expr: me().role === 'yandere' ? 'yandere' : 'suspicious' }] });
  beats.push({ kind: 'panel', mood: 'pink', art: { yandere: 'knife', accomplice: 'key', detective: 'magnifier', target: 'lock', socialite: 'rose', romantic: 'heart' }[me().role], sfx: '*HOW YOU WIN*', caption: b.goal, cast: mentioned(b.goal) });
  b.steps.forEach((st) => beats.push({ kind: 'panel', mood: 'neutral', art: artFor(st), caption: st, cast: mentioned(st) }));
  if (me().role === 'target') beats.push({ kind: 'panel', mood: 'shock', art: 'alert', sfx: '*GASP*', caption: knownEvidence(G, pid)[0].text });
  beats.push({ kind: 'panel', mood: 'dark', art: 'alert', sfx: '*CAREFUL*', caption: b.lose });
  if (full) {
    beats.push({ kind: 'panel', mood: 'morning', art: 'school', sfx: '*4 TURNS*', caption: 'Each day has 4 turns: Morning, Lunch, After School, Dusk. Each turn you do ONE thing: move to a room next door, talk to someone, search, do a task, or use the room\'s special action.' });
    beats.push({ kind: 'panel', mood: 'neutral', art: 'clipboard', sfx: '*TASKS*', caption: ['yandere', 'accomplice'].includes(me().role)
      ? 'Everyone has 3 chores around the school. Yours are fake, but doing them makes you look innocent.'
      : 'You have 3 chores around the school. Finish them for a clue about the killer. If the whole class finishes, the cameras reveal the killer\'s build.' });
    beats.push({ kind: 'panel', mood: 'trial', art: 'scales', sfx: '*CLASS TRIAL*', caption: 'At the end of each day: a Class Trial. Present clues, accuse someone, and vote. The most votes gets someone expelled into the storm.' });
    beats.push({ kind: 'panel', mood: 'night', art: 'moon', sfx: '*LIGHTS OUT*', caption: 'Then night falls. You sleep wherever you ended the day. Anyone sleeping alone is in danger.' });
    beats.push({ kind: 'panel', mood: 'pink', art: 'heart', sfx: '*GOOD LUCK*', caption: 'Stuck? The Actions tab always has a "Next step" tip. Click your role badge to watch this again.' });
  }
  beats.forEach((bt, i) => { bt.story = `${i + 1} / ${beats.length}`; });
  return beats;
}

// Animated stab: the killer lunges, the knife swings, a slash tears across the
// panel, blood splatters, and the victim crumples. Cartoon webtoon style.
function showKill(b) {
  const pov = b.pov;
  const room = ROOM_BY_ID[b.room];
  const splats = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = 26 + (i % 3) * 10;
    return `<i style="--x:${50 + Math.cos(a) * r}%;--y:${48 + Math.sin(a) * r * 0.8}%;--s:${0.5 + (i % 4) * 0.25};--d:${0.95 + i * 0.03}s"></i>`;
  }).join('');
  cinema.innerHTML = `
    <div class="webtoon kill-scene pov-${pov}">
      <div class="kill-stage room-${room.id}">
        <div class="kill-bg"></div>
        <div class="kill-victim">
          <div class="alive">${portraitSVG(b.victim, 'shocked')}</div>
          <div class="dead">${portraitSVG(b.victim, 'dead', { dead: true })}</div>
        </div>
        <div class="kill-killer ${pov === 'victim' ? 'silhouette' : ''}">${portraitSVG(b.killer, 'yandere')}</div>
        <div class="kill-knife">${icon('knife')}</div>
        <div class="kill-slash"></div>
        <div class="kill-flash"></div>
        <div class="kill-splats">${splats}</div>
        <div class="sfx kill-sfx">*SLASH*</div>
      </div>
      <div class="caption">${esc(pov === 'killer'
        ? `The ${room.name}. Just the two of you. ${nameOf(b.victim)} never saw it coming.`
        : pov === 'victim' ? 'A shape in the doorway. A glint of steel. Everything goes red, then black.'
        : `${nameOf(b.victim)} is attacked in the ${room.name}!`)}</div>
      ${continueHint()}
    </div>`;
  cinema.hidden = false;
  setTimeout(() => { document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake'); }, 900);
  return wait();
}

// Crime scene: the body under police tape, with a pool of blood.
function showScene(b) {
  cinema.innerHTML = `
    <div class="webtoon crime-scene">
      <div class="scene-stage room-${esc(b.room)}">
        <div class="kill-bg"></div>
        <div class="pool"></div>
        <div class="body">${portraitSVG(b.victim, 'dead', { dead: true })}</div>
        <div class="knife-drop">${icon('knife')}</div>
        <div class="tape t1">KEEP OUT · KEEP OUT · KEEP OUT · KEEP OUT · KEEP OUT · KEEP OUT</div>
        <div class="tape t2">KEEP OUT · KEEP OUT · KEEP OUT · KEEP OUT · KEEP OUT · KEEP OUT</div>
        <div class="sfx">*KYAAAA!*</div>
      </div>
      <div class="caption">${esc(b.caption)}</div>
      ${continueHint()}
    </div>`;
  cinema.hidden = false;
  document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake');
  voice.speak({ kind: 'narrate', text: b.caption }, G);
  return wait();
}

// Vertical manga speech bubbles for the Obsessive's most unhinged moments.
const YANDERE_LINES = ['アナタだけを見てるよ。', '絶対ボクから離さない。', 'ずっと一緒だよ。'];
function whisperFor(b) {
  if (b.whisper) return b.whisper;
  if (b.mood !== 'crimson' || !(b.cast || []).some((c) => c.expr === 'yandere')) return null;
  return YANDERE_LINES[(b.caption || '').length % YANDERE_LINES.length];
}

document.addEventListener('click', (e) => {
  if (!ui.busy) return;
  if (e.target.closest('[data-skip]')) { ui.skip = true; advance(); return; }
  if (e.target.closest('#cinema') || e.target.closest('#dialogue')) advance();
});

// ---------------------------------------------------------------------------
// Title / setup

function titleScreen() {
  G = null;
  document.body.className = '';
  app.innerHTML = `
  <div class="title-screen">
    <div class="logo">
      <span class="logo-top">${esc(SETTING)} · a storm-locked murder mystery</span>
      <h1><span>Crimson</span><span>Confession</span></h1>
      <p class="tag">Six students. One of them is in love. Someone is in the way.</p>
    </div>
    <section class="setup card">
      <h2>Choose your student</h2>
      <div class="cast-grid">
        ${CHARACTERS.map((c) => `
          <button class="cast-card ${setup.char === c.id ? 'on' : ''}" data-char="${c.id}" style="--hair:${c.hairHex}">
            <span class="sticker">${icon(c.sticker)}</span>
            <div class="portrait-frame">${portraitSVG(c.id, setup.char === c.id ? 'happy' : 'neutral')}</div>
            <span class="sfx-oval">${esc(c.sfx)}</span>
            <b>${esc(c.name)}</b>
            <small>${esc(c.bio)}</small>
            <span class="traits"><i class="chip hair-${c.hair}">${c.hair} hair</i><i class="chip">${c.build}</i></span>
            <span class="club">${esc(c.club)}</span>
          </button>`).join('')}
      </div>
      <div class="shuffle-note">${icon('dice')}<p><b>Roles are shuffled every match.</b> Any student can be the Obsessive, the Detective or the Target, including you. Faces, voices and outfits never give it away. Only evidence and lies do.</p></div>
      <details class="practice" ${setup.role ? 'open' : ''}>
        <summary>Practice a specific role</summary>
        <div class="role-chips">
          <button class="chip-btn ${setup.role === null ? 'on' : ''}" data-role="">${icon('dice')} Random (recommended)</button>
          ${ROLE_ORDER.map((r) => `<button class="chip-btn ${setup.role === r ? 'on' : ''}" data-role="${r}" style="--role:${ROLES[r].color}">${esc(ROLES[r].name)}</button>`).join('')}
        </div>
        ${setup.role ? `<p class="role-pitch">${esc(ROLES[setup.role].pitch)}</p>` : ''}
      </details>
      <div class="row">
        <button class="btn primary big" id="start">Enter the Academy</button>
        ${voiceToggle()}
      </div>
      <details class="howto">
        <summary>How to play</summary>
        <ul>
          <li><b>Day</b> has four turns (Morning, Lunch, After School, Dusk). Each turn you take ONE action: move to a neighbouring room, talk to someone in your room, search, or use the room's special action. Everyone else acts at the same time.</li>
          <li><b>Rooms matter.</b> Each has its own special action: cameras, gossip archive, emergency bell, door barricade, and more. Everyone follows a public timetable, so you can predict who will be alone, and where.</li>
          <li><b>Murder</b> happens when the Obsessive gets someone alone: in daytime with a Stab, or at night. Bodies trigger an emergency trial.</li>
          <li><b>Tasks</b> send everyone around the school. Finish yours for a clue. If the whole class finishes, the power returns and the cameras expose the killer's build.</li>
          <li><b>Talk</b> to people. They tell you who they saw and where. Ask for alibis and compare them with the timetable. The killer lies.</li>
          <li><b>Talk</b> by clicking a student on stage. Chat (pick your expression) to build trust, ask for alibis, spread suspicion, or invite someone to spend the night with you.</li>
          <li><b>Class Trial</b> closes each day. Present evidence, accuse, and vote. A plurality with at least two votes expels someone into the storm.</li>
          <li><b>Night</b>: everyone sleeps where they ended the day, or where they agreed to meet. Anyone who sleeps with no witnesses around is fair game.</li>
          <li><b>Evidence</b> points at <i>hair colour</i> or <i>build</i>. Each trait alone fits two or three students; together they point at one.</li>
          <li>The <b>Obsessive</b> gains Obsession near their beloved (Stalk at 50, Silent Step at 80) and loses Sanity when rivals get close. At 0 Sanity, they snap.</li>
        </ul>
      </details>
    </section>
  </div>`;
  app.querySelectorAll('[data-char]').forEach((b) => b.addEventListener('click', () => { setup.char = b.dataset.char; titleScreen(); }));
  app.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => { setup.role = b.dataset.role || null; titleScreen(); }));
  app.querySelector('#start').addEventListener('click', startGame);
  bindVoiceToggle(app);
}

function voiceToggle() {
  if (!voice.available()) return '';
  return `<button class="btn ghost voice-toggle ${voice.enabled() ? 'on' : ''}" data-voice>${icon('note')} Voices ${voice.enabled() ? 'on' : 'off'}</button>`;
}
function bindVoiceToggle(root) {
  root.querySelectorAll('[data-voice]').forEach((b) => b.addEventListener('click', () => { voice.setEnabled(!voice.enabled()); G ? render() : titleScreen(); }));
}

async function startGame() {
  G = createGame({ seed: (Date.now() % 2147483647) | 0, playerId: setup.char, playerRole: setup.role });
  Object.assign(ui, { tab: 'actions', talk: null, marks: {}, mirror: false, night: {} });
  render();
  await playBeats(introStory(), { skipLabel: 'Skip intro' });
  render();
}

// ---------------------------------------------------------------------------
// Main render

function render() {
  if (!G) return titleScreen();
  if (G.phase === 'over') return resultsScreen();
  applyDistortion();
  const p = me();
  const alive = active(G, G.playerId);
  const period = G.phase === 'day' ? PERIODS[Math.min(G.tick, PERIODS.length - 1)] : G.phase === 'trial' ? (G.trial?.final ? 'Final Trial' : 'Class Trial') : 'Night';
  const room = ROOM_BY_ID[p.room];
  const onStage = G.phase === 'trial' ? activeIds(G) : occupants(G, p.room).filter((id) => id !== G.playerId || true);

  app.innerHTML = `
  <div class="game phase-${G.phase}">
    <header class="hud">
      <div class="hud-time">
        <b>Day ${G.day}</b><span class="sep">/</span>${G.maxDay} · <span class="period">${esc(period)}</span>
      </div>
      ${phaseTracker()}
      <button class="role-badge" id="roleBadge" style="--role:${role(G.playerId).color}" title="Show objective">
        ${portraitSVG(G.playerId, p.role === 'yandere' && p.sanity < 35 ? 'yandere' : 'neutral')}
        <span><small>${esc(CHAR_BY_ID[G.playerId].short)} ·</small> ${esc(role(G.playerId).name)}</span>
      </button>
      ${p.role === 'yandere' ? `
      <div class="meters">
        ${meter('Obsession', p.obsession, 'obs', p.obsession >= 80 ? 'Silent Step' : p.obsession >= 50 ? 'Stalk ready' : '')}
        ${meter('Sanity', p.sanity, 'san', p.sanity <= 0 ? 'SNAPPED' : p.sanity < 35 ? 'unstable' : '')}
      </div>` : ''}
      ${taskMeter()}
      ${voiceToggle()}
    </header>
    ${!alive ? `<div class="spectator">${p.alive ? 'You were expelled.' : 'You are dead.'} The story continues without you. <button class="btn" id="specStep">Continue</button> <button class="btn ghost" id="specEnd">Skip to the end</button></div>` : ''}
    <main class="layout">
      <aside class="map-panel card">
        <h3>Academy Map</h3>
        <div class="map">${ROOMS.map((r) => mapTile(r)).join('')}</div>
        <p class="hint">${G.phase === 'day' && alive ? 'Click a neighbouring room to move there (uses your action).' : 'You can see your room and the rooms next to it.'}</p>
      </aside>
      <section class="stage room-${room.id}">
        <div class="stage-bg"></div>
        <div class="whispers" aria-hidden="true"></div>
        <div class="stage-title">
          <h2>${G.phase === 'trial' ? (G.trial.emergency ? 'Emergency Trial' : G.trial.final ? 'Final Trial' : 'Class Trial') + ' · Lecture Hall' : esc(room.name)}</h2>
          <small>${G.phase === 'trial' ? (G.trial.emergency ? 'An emergency trial. Someone here knows exactly what happened.' : 'Everyone is watching everyone.') : `${esc(room.blurb)} <span class="room-special">${icon(room.action.icon)} ${esc(room.action.label)}</span>`}</small>
        </div>
        <div class="cast-row count-${onStage.length}">
          ${onStage.map((id) => actor(id)).join('')}
        </div>
        <div class="dialogue" id="dialogue">${dialogueIdle()}</div>
      </section>
      <aside class="side card">${G.phase === 'trial' ? trialPanel() : sidePanel()}</aside>
    </main>
    ${G.phase === 'night' && !ui.busy ? nightModal() : ''}
  </div>`;
  bind();
  spawnWhispers();
}

function taskMeter() {
  const t = taskProgress(G);
  const pct = t.total ? Math.round((100 * t.done) / t.total) : 0;
  return `<div class="meter tasks" title="When the class finishes every task, the power comes back and the cameras reveal the killer's build."><span>${icon('page')} Class tasks <b>${t.done}/${t.total}</b>${G.powerRestored ? ' <em>power on</em>' : ''}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
}

// Day turn 1-4 -> Trial -> Night, with the current step highlighted.
function phaseTracker() {
  const steps = [...PERIODS.map((p, i) => ({ key: `t${i}`, label: p, sub: `Turn ${i + 1}` })), { key: 'trial', label: 'Trial', sub: 'Vote' }, { key: 'night', label: 'Night', sub: 'Sleep' }];
  const cur = G.phase === 'day' ? `t${Math.min(G.tick, 3)}` : G.phase;
  const idx = steps.findIndex((s) => s.key === cur);
  return `<ol class="tracker" aria-label="Today">${steps.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><b>${esc(s.label)}</b><small>${esc(s.sub)}</small></li>`).join('')}</ol>`;
}

function meter(label, v, cls, tag) {
  return `<div class="meter ${cls}"><span>${label} <b>${Math.round(v)}</b>${tag ? ` <em>${tag}</em>` : ''}</span><div class="bar"><i style="width:${v}%"></i></div></div>`;
}

function mapTile(r) {
  const p = me();
  const mine = p.room === r.id;
  const visible = canSeeRoom(G, G.playerId, r.id);
  const canMove = G.phase === 'day' && active(G, G.playerId) && adjacent(p.room, r.id);
  const who = visible ? occupants(G, r.id).filter((id) => id !== G.playerId) : null;
  const bodies = G.bodies.filter((b) => b.room === r.id && (b.found || b.killer === G.playerId));
  const snap = me().camSnapshot;
  const camView = !visible && snap && snap.day === G.day && snap.tick === G.tick - 1 ? Object.keys(snap.rooms).filter((id) => snap.rooms[id] === r.id && id !== G.playerId) : null;
  return `
    <button class="tile ${mine ? 'here' : ''} ${canMove ? 'movable' : ''} ${visible ? '' : 'fog'}" data-move="${canMove ? r.id : ''}" ${canMove ? '' : 'tabindex="-1"'}
      style="grid-column:${r.x + 1};grid-row:${r.y + 1}">
      <span class="tile-name">${esc(r.name)}</span>
      <span class="tile-icons">${icon(r.action.icon)}${r.camera ? `<span title="Security camera">${icon('camera', 'cam')}</span>` : ''}${bodies.length ? `<span title="Crime scene" class="blood">${icon('skull')}</span>` : ''}</span>
      <span class="tile-who">
        ${mine ? `<span class="dot you" style="--hair:${CHAR_BY_ID[G.playerId].hairHex}" title="You">${icon('star')}</span>` : ''}
        ${who === null ? (camView ? camView.map((id) => `<span class="dot cam" style="--hair:${CHAR_BY_ID[id].hairHex}" title="${esc(nameOf(id))} (camera)">${esc(nameOf(id)[0])}</span>`).join('') || '<span class="unknown">empty</span>' : '<span class="unknown">?</span>') : who.map((id) => `<span class="dot" style="--hair:${CHAR_BY_ID[id].hairHex}" title="${esc(nameOf(id))}">${esc(nameOf(id)[0])}</span>`).join('')}
      </span>
      ${canMove ? `<span class="go" aria-label="move here">${icon('arrow')}</span>` : ''}
    </button>`;
}

function actor(id) {
  const c = CHAR_BY_ID[id];
  const s = G.chars[id];
  const isMe = id === G.playerId;
  const clickable = !isMe && G.phase === 'day' && active(G, G.playerId);
  const mark = ui.marks[id];
  let expr = 'neutral';
  if (G.phase === 'trial') expr = 'suspicious';
  if (isMe && s.role === 'yandere' && s.sanity < 35) expr = 'yandere';
  const trust = isMe ? null : Math.round(s.trust[G.playerId]);
  return `
    <button class="actor ${isMe ? 'me' : ''} ${ui.talk?.to === id ? 'selected' : ''} ${clickable ? 'talkable' : ''}" data-portrait="${id}" ${clickable ? `data-talk="${id}"` : 'tabindex="-1"'} style="--hair:${c.hairHex}">
      <div class="portrait-frame">${portraitSVG(id, expr)}</div>
      <span class="actor-name">${esc(c.short)}${isMe ? ' (you)' : ''}${mark ? ` <i class="mark mark-${mark}">${icon(mark === 'sus' ? 'alert' : 'heart')}</i>` : ''}</span>
      ${trust !== null ? `<span class="trust" title="How much ${esc(c.short)} trusts you"><i style="width:${trust}%"></i></span>` : ''}
    </button>`;
}

function dialogueIdle() {
  if (G.phase === 'trial') return `<p class="narration">The class stares at each other. ${active(G, G.playerId) ? 'Present evidence, point a finger, then vote.' : 'You can only watch.'}</p>`;
  if (G.phase === 'night') return '<p class="narration">Night is falling…</p>';
  if (!active(G, G.playerId)) return '<p class="narration">You drift through the halls like a ghost.</p>';
  if (ui.talk) return talkMenu();
  const here = occupants(G, me().room).filter((id) => id !== G.playerId);
  return `<p class="narration">${PERIODS[G.tick]}. ${here.length ? `${here.map(nameOf).join(', ')} ${here.length > 1 ? 'are' : 'is'} here. Click someone to talk.` : 'You are alone here. That is either safe or very, very stupid.'}</p>`;
}

function talkMenu() {
  const t = ui.talk;
  const c = CHAR_BY_ID[t.to];
  const opts = talkOptions(G, G.playerId, t.to);
  const unhinged = me().role === 'yandere' && me().sanity < 35;
  let body;
  if (!t.option) {
    body = `<div class="choices">${opts.map((o) => `<button class="choice" data-opt="${o.id}"><b>${esc(o.label)}</b><small>${esc(o.hint)}</small></button>`).join('')}</div>`;
  } else {
    const o = opts.find((x) => x.id === t.option);
    let chips = '';
    if (o.needs === 'tone') {
      chips = Object.entries(TONES).map(([k, v]) => `<button class="chip-btn" data-arg="${k}">${icon(v.icon)} ${v.label}</button>`).join('');
    } else if (o.needs === 'char') {
      chips = activeIds(G).filter((id) => id !== G.playerId).map((id) => `<button class="chip-btn" data-arg="${id}" style="--role:${CHAR_BY_ID[id].hairHex}">${esc(nameOf(id))}</button>`).join('');
    } else if (o.needs === 'room') {
      chips = ROOMS.map((r) => `<button class="chip-btn" data-arg="${r.id}">${esc(r.name)}${r.camera ? ` ${icon('camera')}` : ''}</button>`).join('');
    }
    body = `<p class="sub">${esc(o.label)}</p><div class="chip-row">${chips}</div>`;
  }
  return `
    <div class="talk-menu">
      <div class="talk-head">
        <div class="mini-portrait">${portraitSVG(t.to, 'neutral')}</div>
        <div><b>${esc(c.name)}</b><small>Trust ${Math.round(G.chars[t.to].trust[G.playerId])}${unhinged ? ' · <span class="glitch" data-text="they know">they know</span>' : ''}</small></div>
        <button class="btn ghost small" data-cancel>${t.option ? `${icon('back')} Back` : icon('close')}</button>
      </div>
      ${body}
    </div>`;
}

// ---------------------------------------------------------------------------
// Side panel

function sidePanel() {
  const tabs = [['actions', 'Actions'], ['notes', 'Notebook'], ['log', 'Log']];
  return `
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <div class="tab-body">${ui.tab === 'actions' ? actionsTab() : ui.tab === 'notes' ? notesTab() : logTab()}</div>`;
}

function actionsTab() {
  const p = me();
  if (!active(G, G.playerId)) return '<p class="muted">No actions available.</p>';
  const acts = playerActions(G);
  const here = occupants(G, p.room).filter((id) => id !== G.playerId);
  const plans = [];
  const inv = G.invites[G.playerId];
  if (inv) plans.push(`You plan to sleep in the <b>${esc(roomName(inv.room))}</b>.`);
  for (const [id, v] of Object.entries(G.invites)) if (v.from === G.playerId && id !== G.playerId) plans.push(`${esc(nameOf(id))} will meet you in the ${esc(roomName(v.room))}.`);
  for (const o of G.offers) plans.push(`${esc(nameOf(o.from))} invited you to the ${esc(roomName(o.room))}.`);
  const tips = hints(G, G.playerId);
  const fake = ['yandere', 'accomplice'].includes(p.role);
  const doneCount = p.tasks.filter((t) => t.done).length;
  return `
    <div class="next-step">
      <span class="label-box">Next step</span>
      <p>${esc(tips[0])}</p>
      ${tips.length > 1 ? `<details><summary>More tips</summary><ul>${tips.slice(1).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>` : ''}
    </div>
    <div class="action-list compact">
      ${acts.map((a) => `<button class="act ${a.danger ? 'danger' : ''} ${a.special ? 'special' : ''}" data-act="${a.type}" ${a.to ? `data-to="${a.to}"` : ''} ${a.disabled ? 'disabled' : ''} title="${esc(a.disabled ? a.reason : a.desc)}">
        ${icon(a.icon)}<span>${esc(a.label)}${a.disabled ? `<small>${esc(a.reason)}</small>` : a.danger ? `<small>${esc(a.desc)}</small>` : ''}</span></button>`).join('')}
    </div>
    <p class="turn-note">Or click a student to talk, or a room on the map to move.</p>
    <div class="mini-section">
      <h4>Tasks <b class="count">${doneCount}/${p.tasks.length}</b> ${fake ? '<small>fake</small>' : '<small>all 3 = a clue</small>'}</h4>
      <ul class="task-list">${p.tasks.map((t) => `<li class="${t.done ? 'done' : ''} ${t.room === p.room && !t.done ? 'here' : ''}"><i class="tick">${t.done ? icon('star') : ''}</i>${esc(t.label)} <small>${esc(roomName(t.room))}</small></li>`).join('')}</ul>
    </div>
    ${p.items.length ? `<h4>Inventory</h4><ul class="items">${p.items.map((it) => `
      <li><span class="item-icon">${icon(ITEMS[it].icon)}</span><div><b>${esc(ITEMS[it].name)}</b><small>${esc(ITEMS[it].desc)}</small>
        ${ITEMS[it].usable ? (ITEMS[it].needsTarget
          ? (ui.mirror ? `<div class="chip-row">${here.map((id) => `<button class="chip-btn" data-use="${it}" data-arg="${id}">${esc(nameOf(id))}</button>`).join('') || '<small>Nobody here.</small>'}</div>` : `<button class="btn small" data-pick-mirror>Use on…</button>`)
          : `<button class="btn small" data-use="${it}">Use</button>`) : ''}
      </div></li>`).join('')}</ul>` : ''}
    ${plans.length || G.tick >= 2 ? `<h4>Tonight</h4>${plans.length ? `<ul class="plain">${plans.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="muted small">No plans yet. You'll sleep in the ${esc(roomName(p.room))}.</p>`}` : ''}`;
}

function notesTab() {
  const ev = knownEvidence(G, G.playerId);
  const notes = me().notes.slice().reverse();
  return `
    <div class="objective"><h4>Objective</h4><p>${esc(objectiveText(G, G.playerId))}</p></div>
    <h4>Timetable <small class="muted">where everyone is supposed to be</small></h4>
    ${timetable()}
    <h4>Suspect board <small class="muted">click to mark</small></h4>
    <div class="board">${G.order.map((id) => boardCard(id)).join('')}</div>
    <h4>Evidence (${ev.length})</h4>
    ${ev.length ? ev.map((e) => evidenceCard(e)).join('') : '<p class="muted">No clues yet.</p>'}
    <h4>Notes</h4>
    ${notes.length ? `<ul class="plain notes">${notes.map((n) => `<li><small>Day ${n.day}</small> ${esc(n.text)}</li>`).join('')}</ul>` : '<p class="muted">Ask people about last night to fill this in.</p>'}`;
}

function timetable() {
  const cur = G.phase === 'day' ? G.tick : -1;
  return `<div class="timetable-wrap"><table class="timetable">
    <thead><tr><th></th>${PERIODS.map((p, i) => `<th class="${i === cur ? 'now' : ''}">${esc(p)}</th>`).join('')}</tr></thead>
    <tbody>${G.order.filter((id) => G.chars[id].alive && !G.chars[id].expelled).map((id) => `<tr class="${id === G.playerId ? 'me' : ''}"><th>${esc(nameOf(id))}</th>${CHAR_BY_ID[id].schedule.map((r, i) => `<td class="${i === cur ? 'now' : ''}">${esc(ROOM_BY_ID[r].name.replace('Classroom 2-B', 'Class 2-B').replace(' Room', '').replace(' Hall', ''))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function boardCard(id) {
  const c = CHAR_BY_ID[id];
  const s = G.chars[id];
  const status = !s.alive ? 'dead' : s.expelled ? 'expelled' : '';
  const ev = knownEvidence(G, G.playerId).filter((e) => e.kind !== 'note' || me().role === 'target');
  const hits = ev.filter((e) => matchesEvidence(id, e)).length;
  return `
    <button class="board-card ${status} mark-${ui.marks[id] || 'none'}" data-mark="${id}" ${id === G.playerId ? 'disabled' : ''}>
      <div class="portrait-frame">${portraitSVG(id, 'neutral', { dead: !s.alive })}</div>
      <b>${esc(c.short)}${id === G.playerId ? ' (you)' : ''}</b>
      <span class="traits"><i class="chip hair-${c.hair}">${c.hair}</i><i class="chip">${c.build}</i></span>
      ${status ? `<em>${status}${s.expelled || !s.alive ? ` · ${esc(ROLES[s.role].tag)}` : ''}</em>` : hits && id !== G.playerId ? `<em class="hits">${hits} clue${hits > 1 ? 's' : ''} match</em>` : ''}
    </button>`;
}

function evidenceCard(e) {
  const traitChip = e.trait ? `<i class="chip ${e.trait === 'hair' ? `hair-${e.value}` : ''}">${esc(TRAIT_TEXT[e.trait][e.value])}</i>` : e.subject ? `<i class="chip">points at ${esc(nameOf(e.subject))}</i>` : '';
  return `<div class="evidence ${e.public ? 'public' : 'private'}"><div class="ev-head"><b>${esc(e.kind)}</b>${traitChip}<span class="ev-vis">${e.public ? 'public' : 'only you know'}</span></div><p>${esc(e.text)}</p></div>`;
}

function logTab() {
  const entries = visibleLog(G, G.playerId).slice().reverse();
  return `<ul class="plain log">${entries.map((e) => `<li><small>D${e.day}</small> ${esc(e.text)}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Trial & night

function trialPanel() {
  const t = G.trial;
  if (!active(G, G.playerId)) {
    return `<h3>Class Trial</h3><p class="muted">You can only watch.</p><button class="btn primary" data-vote="">Watch the vote</button>`;
  }
  const presentable = knownEvidence(G, G.playerId).filter((e) => !e.public);
  const others = activeIds(G).filter((id) => id !== G.playerId);
  return `
    <h3>${t.emergency ? 'Emergency Trial' : t.final ? 'Final Trial' : 'Class Trial'}</h3>
    <p class="muted small">Present clues, accuse someone, then vote. The most votes (at least 2, and more than abstentions) gets someone expelled.</p>
    <h4>Present evidence <small class="muted">${MAX_PRESENTS - t.presented} left</small></h4>
    ${presentable.length && t.presented < MAX_PRESENTS
      ? presentable.map((e) => `<button class="evidence-btn" data-present="${e.id}">${evidenceCard(e)}</button>`).join('')
      : '<p class="muted">Nothing new to present.</p>'}
    <h4>Accuse</h4>
    ${t.accused ? '<p class="muted">You have made your accusation.</p>'
      : `<div class="chip-row">${others.map((id) => `<button class="chip-btn danger" data-accuse="${id}">${esc(nameOf(id))}</button>`).join('')}</div>`}
    <h4>Vote to expel</h4>
    <div class="chip-row">${others.map((id) => `<button class="chip-btn vote" data-vote="${id}">${esc(nameOf(id))}</button>`).join('')}
      <button class="chip-btn" data-vote="">Abstain</button></div>
    <p class="muted small">Plurality with at least two votes, and more votes than abstentions, expels.</p>
    <details><summary>Public evidence</summary>${G.evidence.filter((e) => e.public && !e.destroyed).map(evidenceCard).join('') || '<p class="muted">None.</p>'}</details>`;
}

function nightModal() {
  const o = nightOptions(G);
  const alive = active(G, G.playerId);
  if (!alive) {
    return `<div class="modal night"><div class="modal-card"><h2>Night ${G.day}</h2><p>The dead do not sleep.</p><button class="btn primary" id="sleep">Continue</button></div></div>`;
  }
  const plans = knownNightPlans(G, G.playerId);
  ui.night.sleep = ui.night.sleep && o.sleep.includes(ui.night.sleep) ? ui.night.sleep : o.defaultSleep;
  if (o.mustKill && !ui.night.kill) ui.night.kill = o.kill[0];
  const offerFor = (room) => o.offers.filter((x) => x.room === room).map((x) => nameOf(x.from));
  return `
  <div class="modal night">
    <div class="modal-card">
      <h2>Night ${G.day}</h2>
      <p class="muted">The doors lock at midnight. Choose carefully.</p>
      ${o.barricaded ? `<p class="barricade">${icon('lock')} Your door in the Dorm Hall is barricaded tonight.</p>` : ''}
      <h4>Where will you sleep?</h4>
      <div class="chip-row">${o.sleep.map((r) => `<button class="chip-btn ${ui.night.sleep === r ? 'on' : ''}" data-sleep="${r}">${esc(roomName(r))}${offerFor(r).length ? ` <small>(${esc(offerFor(r).join(', '))} invited you)</small>` : ''}</button>`).join('')}</div>
      <h4>What you know about tonight</h4>
      <ul class="plain plans">${Object.entries(plans).map(([id, r]) => `<li><b>${esc(nameOf(id))}</b>: ${r ? esc(roomName(r)) : '<span class="muted">unknown</span>'}</li>`).join('')}</ul>
      ${o.kill ? `
        <h4 class="crimson">${o.mustKill ? 'You have snapped. Someone dies tonight.' : 'Who dies tonight?'}</h4>
        <div class="chip-row">
          ${o.mustKill ? '' : `<button class="chip-btn ${!ui.night.kill ? 'on' : ''}" data-kill="">Nobody. Not yet.</button>`}
          ${o.kill.map((id) => `<button class="chip-btn danger ${ui.night.kill === id ? 'on' : ''}" data-kill="${id}">${esc(nameOf(id))}${id === G.plot.target ? ` ${icon('target')}` : ''}${id === G.plot.beloved ? ` ${icon('heart')}` : ''}</button>`).join('')}
        </div>
        <p class="muted small">Anyone else sleeping in the victim's room (except your Accomplice) foils the attack and sees your hair. Roommates may notice you leave. Cameras on your route record your build.</p>` : ''}
      ${o.stakeout ? `
        <h4>Stake out a room?</h4>
        <div class="chip-row">
          <button class="chip-btn ${!ui.night.stakeout ? 'on' : ''}" data-stake="">No, just sleep</button>
          ${o.stakeout.map((r) => `<button class="chip-btn ${ui.night.stakeout === r ? 'on' : ''}" data-stake="${r}">${esc(roomName(r))}</button>`).join('')}
        </div>
        <p class="muted small">You hide in that room instead of sleeping. Any attack there fails and you see the attacker.</p>` : ''}
      <button class="btn primary big" id="sleep">Close your eyes…</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Results

function resultsScreen() {
  document.body.className = '';
  const w = G.winners;
  const mine = w[G.playerId];
  const p = G.plot;
  app.innerHTML = `
  <div class="results">
    <header class="results-head ${mine.won ? 'win' : 'lose'}">
      <span class="sfx-big">${mine.won ? 'VICTORY' : 'DEFEAT'}</span>
      <p>${esc(mine.why)}</p>
    </header>
    <section class="card">
      <h3>The truth</h3>
      <p><b>${esc(CHAR_BY_ID[p.yandere].name)}</b> was the Obsessive, fixated on <b>${esc(nameOf(p.beloved))}</b> and hunting <b>${esc(nameOf(p.target))}</b>.
      ${esc(nameOf(p.accomplice))} was their Accomplice. ${esc(nameOf(p.socialite))} wanted ${esc(nameOf(p.frameTarget))} framed. ${esc(nameOf(p.romantic))} was in love with ${esc(nameOf(p.crush))}.</p>
      <div class="result-grid">
        ${G.order.map((id) => {
          const s = G.chars[id];
          return `<div class="result-card ${w[id].won ? 'won' : 'lost'} ${id === G.playerId ? 'me' : ''}" style="--role:${ROLES[s.role].color}">
            <div class="portrait-frame">${portraitSVG(id, s.role === 'yandere' ? 'yandere' : w[id].won ? 'happy' : 'sad', { dead: !s.alive })}</div>
            <b>${esc(CHAR_BY_ID[id].name)}${id === G.playerId ? ' (you)' : ''}</b>
            <span class="role-tag">${esc(ROLES[s.role].name)}</span>
            <em>${w[id].won ? 'WON' : 'LOST'}</em>
            <small>${esc(w[id].why)}${!s.alive ? ` ${icon('skull')}` : s.expelled ? ` ${icon('door')}` : ''}</small>
          </div>`;
        }).join('')}
      </div>
      <h3>Timeline</h3>
      <ul class="plain log">${G.log.filter((e) => !e.to).map((e) => `<li><small>D${e.day}</small> ${esc(e.text)}</li>`).join('')}</ul>
      <div class="row"><button class="btn primary big" id="again">Play again</button><button class="btn ghost" id="toTitle">Change student / role</button></div>
    </section>
  </div>`;
  app.querySelector('#again').addEventListener('click', startGame);
  app.querySelector('#toTitle').addEventListener('click', titleScreen);
}

// ---------------------------------------------------------------------------
// Input wiring

async function act(action) {
  if (ui.busy) return;
  ui.talk = null;
  ui.mirror = false;
  const beats = playerAct(G, action);
  preRender();
  await playBeats(beats);
  render();
}

// Show the new state (minus any modal) underneath the cinematics about to play.
function preRender() {
  if (G.phase === 'over') return;
  ui.busy = true;
  render();
  ui.busy = false;
}

async function run(fn) {
  if (ui.busy) return;
  const beats = fn();
  preRender();
  await playBeats(beats);
  render();
}

function bind() {
  const $$ = (sel, fn) => app.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => { if (!ui.busy) fn(el, e); }));
  $$('[data-move]', (el) => el.dataset.move && act({ type: 'move', room: el.dataset.move }));
  $$('[data-talk]', (el) => { ui.talk = { to: el.dataset.talk, option: null }; render(); });
  $$('[data-cancel]', () => { ui.talk = ui.talk?.option ? { ...ui.talk, option: null } : null; render(); });
  $$('[data-opt]', (el) => {
    const opt = talkOptions(G, G.playerId, ui.talk.to).find((o) => o.id === el.dataset.opt);
    if (!opt.needs) act({ type: 'talk', to: ui.talk.to, option: opt.id });
    else { ui.talk.option = opt.id; render(); }
  });
  $$('.talk-menu [data-arg]', (el) => act({ type: 'talk', to: ui.talk.to, option: ui.talk.option, arg: el.dataset.arg }));
  $$('[data-tab]', (el) => { ui.tab = el.dataset.tab; render(); });
  $$('[data-act]', (el) => { if (!el.disabled) act({ type: el.dataset.act, to: el.dataset.to }); });
  bindVoiceToggle(app);
  $$('[data-pick-mirror]', () => { ui.mirror = true; render(); });
  $$('[data-use]', (el) => act({ type: 'use', item: el.dataset.use, arg: el.dataset.arg }));
  $$('[data-mark]', (el) => {
    const id = el.dataset.mark;
    ui.marks[id] = { undefined: 'sus', sus: 'trust', trust: undefined }[ui.marks[id]];
    render();
  });
  $$('#roleBadge', async () => { await playBeats(introStory({ full: false }), { skipLabel: 'Close' }); render(); });
  // Trial
  $$('[data-present]', (el) => run(() => presentEvidence(G, el.dataset.present)));
  $$('[data-accuse]', (el) => run(() => accuse(G, el.dataset.accuse)));
  $$('[data-vote]', (el) => { ui.night = {}; run(() => castVote(G, el.dataset.vote || null)); });
  // Night
  $$('[data-sleep]', (el) => { ui.night.sleep = el.dataset.sleep; render(); });
  $$('[data-kill]', (el) => { ui.night.kill = el.dataset.kill || null; render(); });
  $$('[data-stake]', (el) => { ui.night.stakeout = el.dataset.stake || null; render(); });
  $$('#sleep', () => { const choice = { ...ui.night }; ui.night = {}; run(() => resolveNight(G, choice)); });
  // Spectator
  $$('#specStep', () => run(() => autoplayStep(G)));
  $$('#specEnd', () => run(() => { const all = []; let guard = 0; while (G.phase !== 'over' && guard++ < 200) all.push(...autoplayStep(G).filter((b) => b.kind === 'panel')); return all; }));
}

// ---------------------------------------------------------------------------
// Yandere interface distortion

function applyDistortion() {
  const p = me();
  const cls = [];
  if (p.role === 'yandere' && active(G, G.playerId)) {
    if (p.sanity < 60) cls.push('unease');
    if (p.sanity < 35) cls.push('unstable');
    if (p.sanity < 15) cls.push('breaking');
    if (p.obsession >= 50) cls.push('obsessed');
  }
  if (G.phase === 'night') cls.push('is-night');
  document.body.className = cls.join(' ');
}

const WHISPERS = ['they\'re lying', 'mine', 'only mine', 'look at them looking at you', 'don\'t let them touch', 'tonight', 'smile', 'nobody will know'];
function spawnWhispers() {
  const box = app.querySelector('.whispers');
  if (!box || !document.body.classList.contains('unstable')) return;
  const n = document.body.classList.contains('breaking') ? 7 : 3;
  box.innerHTML = Array.from({ length: n }, (_, i) => {
    const w = WHISPERS[(G.tick * 3 + i * 5 + G.day) % WHISPERS.length];
    return `<span style="left:${(i * 37 + G.tick * 11) % 85}%;top:${(i * 23 + G.day * 17) % 70}%;animation-delay:${i * 0.7}s">${w}</span>`;
  }).join('');
}

titleScreen();

// Handy for debugging from the console.
window.__game = () => G;
export { TITLE };
