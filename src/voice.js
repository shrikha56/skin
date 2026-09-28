// Browser side of character voices. Lines are fetched from the local server
// (/api/tts), which holds the ElevenLabs key and caches the audio. If the
// server has no key, or the request fails, the game silently stays text-only.

import { CHAR_BY_ID } from './core.js';

let isAvailable = false;
let audio = null;
const readyListeners = [];
const warmed = new Set();

const pref = () => { try { return localStorage.getItem('cc-voices') !== 'off'; } catch { return true; } };

fetch('/api/tts/status')
  .then((r) => (r.ok ? r.json() : { enabled: false }))
  .then((s) => { isAvailable = Boolean(s.enabled); readyListeners.forEach((f) => f()); })
  .catch(() => {});

export const available = () => isAvailable;
export const enabled = () => isAvailable && pref();
export const onReady = (f) => readyListeners.push(f);
export function setEnabled(on) {
  try { localStorage.setItem('cc-voices', on ? 'on' : 'off'); } catch { /* private mode */ }
  if (!on) stop();
}

// Strip stage directions like "(Sanity -8)" and trailing UI hints before speaking.
const speakable = (text) => String(text || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

function urlFor(beat) {
  if (!beat) return null;
  if (beat.kind === 'line' && CHAR_BY_ID[beat.speaker]) {
    const t = speakable(beat.text);
    return t && t !== '…' ? `/api/tts?v=${beat.speaker}&e=${encodeURIComponent(beat.expr || 'neutral')}&t=${encodeURIComponent(t)}` : null;
  }
  if (beat.kind === 'narrate' || ((beat.kind === 'panel' || beat.kind === 'scene') && beat.caption)) {
    const t = speakable(beat.text ?? beat.caption);
    return t ? `/api/tts?v=narrator&e=narration&t=${encodeURIComponent(t)}` : null;
  }
  return null;
}

export function speak(beat) {
  if (!enabled()) return;
  const url = urlFor(beat);
  if (!url) return;
  stop();
  audio = new Audio(url);
  audio.play().catch(() => {});
}

// Warm the server cache for the next line so it plays without a delay.
export function prefetch(beat) {
  if (!enabled()) return;
  const url = urlFor(beat);
  if (!url || warmed.has(url)) return;
  warmed.add(url);
  fetch(url).catch(() => {});
}

export function stop() {
  if (audio) { audio.pause(); audio = null; }
}
