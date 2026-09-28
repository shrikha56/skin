// ElevenLabs voice casting. Shared by the local server (tools/serve.js), which
// makes the API calls, and the browser, which only ever asks the server for a
// line by character id. Voice IDs are ElevenLabs default library voices; any
// of them can be overridden from .env, e.g. VOICE_HANA=<voice id>.

export const VOICES = {
  hana: { name: 'Jessica', id: 'cgSgspJ2msm6clMCkdW9', why: 'bright, playful, bubbly idol energy' },
  reina: { name: 'Alice', id: 'Xb7hH8MSUJpSbSDYk0k2', why: 'crisp, confident British heiress' },
  kaito: { name: 'Liam', id: 'TX3LPaxmHKxFdv7VOQHJ', why: 'quick, articulate young puzzle-solver' },
  momo: { name: 'Sarah', id: 'EXAVITQu4vr4xnSDxMaL', why: 'soft, gentle, a little nervous' },
  ren: { name: 'Callum', id: 'N2lVS1w4EtoT3dr4eOWO', why: 'low, husky, says very little' },
  yuki: { name: 'River', id: 'SAz9YHcvj6GT2YYXdXww', why: 'calm, even, deadpan' },
  narrator: { name: 'George', id: 'JBFqnCBsd6RMkjVDRZzb', why: 'warm storyteller for narration and panels' },
};

// Delivery per expression: lower stability = more dramatic, higher style = more acted.
export const EXPRESSION_SETTINGS = {
  neutral: { stability: 0.5, similarity_boost: 0.75, style: 0.25 },
  happy: { stability: 0.4, similarity_boost: 0.75, style: 0.5 },
  blush: { stability: 0.45, similarity_boost: 0.75, style: 0.45 },
  shocked: { stability: 0.3, similarity_boost: 0.75, style: 0.6 },
  suspicious: { stability: 0.5, similarity_boost: 0.75, style: 0.4 },
  sad: { stability: 0.45, similarity_boost: 0.75, style: 0.5 },
  yandere: { stability: 0.25, similarity_boost: 0.8, style: 0.85 },
  narration: { stability: 0.6, similarity_boost: 0.75, style: 0.3 },
};

export const DEFAULT_MODEL = 'eleven_multilingual_v2';
export const MAX_TTS_CHARS = 600;
