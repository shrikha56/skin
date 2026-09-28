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

## Test it

```bash
npm test                    # rules-engine unit tests (node:test, no deps)
npm run simulate -- 2000    # bot-only matches -> win rate per role
```

## How a match plays

| Phase | What happens |
|---|---|
| **Day** (4 periods) | Each period you take one action: move to a neighbouring room, talk to someone in your room, search, use an item or a role ability. Everyone else acts at the same time. You can only see your own room and the rooms next to it. |
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

Alibis, collected by asking people about last night, are the other half of the puzzle.

## Code map

```
index.html, style.css     page shell + webtoon / character-sheet styling
src/data.js               cast, rooms, roles, items (pure data)
src/core.js               seeded RNG, map geometry, lookups
src/engine.js             rules: state machine, actions, trial, night, win conditions
src/ai.js                 role-driven bot heuristics
src/portraits.js          procedural SVG anime portraits (6 students x 7 expressions)
src/main.js               UI: rendering, input, beat playback (panels + dialogue)
tests/engine.test.js      rules tests
tools/simulate.js         balance harness
```

The engine is pure and deterministic. The whole match is one JSON-serialisable object, and the seeded RNG lives inside it. Engine calls return **beats**, which are panels, dialogue lines and narration that the UI plays back. That separation is what lets the rules move onto an authoritative server for multiplayer, or be re-implemented in Godot, without touching them. See the roadmap in the design doc.
