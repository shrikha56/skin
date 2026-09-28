// Balance harness: plays N bot-only matches and reports win rates per role.
// Usage: node tools/simulate.js [matches=500]
import { createGame, autoplayStep } from '../src/engine.js';
import { ROLES } from '../src/data.js';

const n = Number(process.argv[2] || 500);
const wins = {};
let exposed = 0;
let murders = 0;
let foiled = 0;

for (let seed = 1; seed <= n; seed++) {
  const g = createGame({ seed, playerId: null });
  let guard = 0;
  while (g.phase !== 'over' && guard++ < 300) autoplayStep(g);
  for (const [id, r] of Object.entries(g.winners)) {
    const role = g.chars[id].role;
    wins[role] ??= { won: 0, played: 0 };
    wins[role].won += r.won ? 1 : 0;
    wins[role].played += 1;
  }
  if (g.chars[g.plot.yandere].expelled) exposed += 1;
  murders += g.crimeScenes.length;
  foiled += g.evidence.filter((e) => e.kind === 'eyewitness').length;
}

console.log(`${n} bot matches`);
for (const [role, { won, played }] of Object.entries(wins)) {
  console.log(`  ${ROLES[role].name.padEnd(28)} ${(100 * won / played).toFixed(1).padStart(5)}% win  (${played} games)`);
}
console.log(`  murders/match ${(murders / n).toFixed(2)} · foiled attacks/match ${(foiled / n).toFixed(2)} · Obsessive exposed ${(100 * exposed / n).toFixed(1)}%`);
