# Crimson Confession

A yandere visual-novel social-deduction game. This repo holds a playable **browser prototype** of the core loop: day, class trial, night, repeat. You play one seat and bots play the other five. It is step 1 of the roadmap in [`docs/DESIGN.md`](docs/DESIGN.md): prove the loop is fun before investing in art, an engine port and networking.

> Six students are trapped in Hoshizora Academy by a storm. One of them is in love. Someone else is in the way.

## Run it

No build step and no dependencies. It is plain ES modules, so it needs to be served over HTTP:

```bash
npm start            # zero-dependency Node server (tools/serve.js)
# open http://localhost:8000
```

If port 8000 is taken, the server moves to the next free port and prints the URL. Any static server works (`npx serve`, VS Code Live Server, …).

## Voices (ElevenLabs)

Every student has a different voice, plus a narrator. The browser never sees your key: the local server calls ElevenLabs and caches each line in `.cache/tts/`, so repeated lines are free.

```bash
cp .env.example .env      # then paste your key after ELEVENLABS_API_KEY=
npm start                 # prints "Voices: ON"
```

| Character | ElevenLabs voice | Why |
|---|---|---|
| Hana | Jessica | bright, playful, bubbly idol energy |
| Reina | Alice | crisp, confident British heiress |
| Kaito | Liam | quick, articulate puzzle-solver |
| Momo | Sarah | soft, gentle, a little nervous |
| Ren | Callum | low, husky, says very little |
| Yuki | River | calm, even, deadpan |
| Narrator | George | warm storyteller |

Delivery changes with each line's expression. The yandere face, for example, gets a less stable and more dramatic read. To swap a voice, set `VOICE_<NAME>=<voice id>` in `.env`, or edit `src/voices.js`. Use the Voices button in the top bar to turn them off. The server only listens on localhost because it spends your credits.

## Test it

```bash
npm test                    # rules-engine unit tests (node:test, no deps)
npm run simulate -- 2000    # bot-only matches -> win rate per role
```

## How a match plays

**Roles are shuffled every match.** Any student can be anything, and faces, voices and reactions never give it away. At the start you get a briefing that explains exactly how to win with the role you drew. You can reopen it from your role badge.

| Phase | What happens |
|---|---|
| **Day** (4 turns: Morning, Lunch, After School, Dusk) | Each turn you take one action: move to a neighbouring room, talk to someone in your room, search, do a task, or use the room's special action. Everyone else acts at the same time. You can only see your own room and the rooms next to it. A progress bar at the top shows where you are in the day. |
| **Rooms** | Library: the gossip archive clears one innocent (once per match). Classroom: the security monitor shows where everyone is (once per day). Music Room: rehearse to build trust; it's soundproof. Infirmary: wash off blood and rest. Courtyard: ring the emergency bell to call a trial. Dorm Hall: barricade your door for one night. |
| **Timetable & tasks** | Everyone follows a public timetable (in the Notebook) and has 3 tasks in other rooms. After School, most people are alone in their clubs, which is when the killer strikes. Finishing your tasks earns a clue. If the whole class finishes, the cameras reveal the killer's build to everyone. |
| **Murder** | The Obsessive can **stab** anyone they're alone with once they have 30 Obsession (an animated cutscene), or strike at night. Killing leaves them bloody until they wash, and screams carry to neighbouring rooms. A found body triggers an **emergency trial**. |
| **Talk** | These are visual-novel dialogue choices. *Chat* (pick an expression: Smile, Blush, Smirk or Stare) builds trust. You can also ask about last night, share a suspicion, or invite someone to spend the night with you, which decides where you both sleep. |
| **Class Trial** | Everyone gives a statement, bots included. You can present up to two clues, accuse one person, then vote. A plurality with at least two votes, and more votes than abstentions, expels someone into the storm. |
| **Night** | Everyone sleeps where they ended the day or where they agreed to meet. The Obsessive can slip out and strike anyone who is sleeping without witnesses. The Detective can stake out a room. |

The match lasts 3 days and 2 nights. The trial on day 3 is the **Final Trial**.

### Secret archetypes

| Role | Wins if… | Toolkit |
|---|---|---|
| **The Obsessive** (Yandere) | their Target dies and they are never expelled | Obsession builds near their beloved and unlocks **Stalk** at 50 and **Silent Step** (no physical evidence) at 80. Sanity drains when rivals get close to the beloved. At 0 Sanity they **snap**: they must kill that night and leave every clue. The UI distorts as Sanity drops. |
| **The Accomplice** | the Obsessive wins | Knows everything. Never counts as a witness. Can **cover up** evidence at crime scenes. |
| **The Detective** | the Obsessive is expelled | Searches always find hidden clues. Can **interrogate** (look for tells) and **stake out** a room at night. |
| **The Target** | they survive | Starts with a lead from a threatening note. Should never sleep alone. |
| **The Manipulative Socialite** | their chosen scapegoat is expelled | **Rumors** hit harder than normal suspicion. |
| **The Hopeless Romantic** | their crush trusts them 85+ at the end and both are still in | **Confess** (best at 60+ trust). Their crush is the Obsessive's beloved. |

### Deduction

Every clue points at a trait: **hair colour** (pink, black or golden) or **build** (petite or tall). Each trait alone fits two students. Combined, they identify exactly one. The clue types are:

- Hair strands and footprints at the crime scene. These are hidden until someone searches.
- Security footage from camera rooms on the attacker's route. You find it by searching the Classroom or using the Keycard.
- Eyewitnesses when an attack is foiled.
- Roommates who noticed someone's futon was empty.

Testimony is the other half of the puzzle. Friendly chats get people telling you who they saw and where. Ask for an alibi and they walk through last night and every turn today. Innocents tell the truth. The Obsessive lies about the turn they killed in, and the Accomplice claims to have been with them. Compare the stories with the timetable, the cameras and each other.

## Code map

```
index.html, style.css     page shell + webtoon / character-sheet styling
src/data.js               cast, rooms, roles, items (pure data)
src/core.js               seeded RNG, map geometry, lookups
src/engine.js             rules: state machine, actions, trial, night, win conditions
src/ai.js                 role-driven bot heuristics
src/portraits.js          procedural SVG anime portraits (6 students x 7 expressions)
src/icons.js              hand-drawn style line icons (no emoji)
src/lines.js              per-character dialogue (same pools for guilty and innocent)
src/voices.js, voice.js   ElevenLabs casting + browser playback
tools/serve.js            local server + ElevenLabs relay (key stays server-side)
src/main.js               UI: rendering, input, beat playback (panels + dialogue)
tests/engine.test.js      rules tests
tools/simulate.js         balance harness
```

The engine is pure and deterministic. The whole match is one JSON-serialisable object, and the seeded RNG lives inside it. Engine calls return **beats**, which are panels, dialogue lines and narration that the UI plays back. That separation is what lets the rules move onto an authoritative server for multiplayer, or be re-implemented in Godot, without touching them. See the roadmap in the design doc.
