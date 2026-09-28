# Crimson Confession: Design Notes

## 1. Core concept

This is not a plain "find the imposter" game. It leans into visual-novel and yandere themes: obsession, secret motives, dialogue choices and high-stakes social deduction. Students are trapped in an isolated setting, a storm-locked boarding school. Each player secretly draws an **archetype** with its own win condition. Some players want to kill, some want to protect, some want to frame someone, and some just want to confess.

### Loop

1. **Day: VN strategy and relationship building.** Move around the academy map, talk through dialogue choices, collect items, form alliances, and stalk or shadow people. Trust between each pair of characters is a first-class stat.
2. **Night: murder and sabotage.** The Obsessive must find a victim who is sleeping without witnesses. Leaving your room risks roommates noticing. Crossing camera rooms risks footage. Attacking leaves physical traces.
3. **Class Trial: webtoon social deduction.** Dramatic panels, screen shakes and character reactions. Players present evidence, accuse and vote.

## 2. Signature mechanics

### The Yandere engine (implemented)
- **Obsession** rises while the Obsessive shares a room with their beloved, and from chatting with them. It unlocks **Stalk** at 50, which reveals the Target's and the beloved's positions. At 80 it unlocks **Silent Step**: kills leave no physical evidence and roommates rarely notice the absence.
- **Sanity** drains when the Target, or anyone flirting, gets close to the beloved. Nights without a kill also drain it. At 0 the Obsessive **snaps**: a forced kill that leaves every possible clue.
- **Tells:** high Obsession makes bystanders notice the staring. Detectives can interrogate for tells, and the Pocket Mirror reveals Obsession directly.
- **Interface distortion:** below 60 Sanity the stage colour-shifts. Below 35 it jitters, shows chromatic aberration and whispers ("mine", "they're lying"). Below 15 the whole UI shakes. Obsession 50+ adds a pulsing heart vignette.

### Webtoon presentation (implemented)
- Dramatic moments (role reveal, murders, accusations, votes, expulsions) play as **comic panels**. Each character gets a slanted sub-panel with speed lines, a big SFX word in an oval bubble (`*SHATTER*`, `SLASH`, `KYAAA!`), a cream label box and a caption. The Obsessive's panels add vertical Japanese speech bubbles.
- **Dynamic dialogue:** instead of free-text chat, players pick a line type plus an **expression** (Smile / Blush / Smirk / Stare). Each expression has different mechanical effects.
- Character art is procedural SVG in the style of the reference character sheet: ink outlines, flat pastel fills, a distinct outfit per student, and 7 expressions (neutral, happy, blush, shocked, suspicious, sad, yandere).

### Hidden objectives (implemented)
The Socialite wants a specific person framed. The Romantic wants a confession to land. The Accomplice wants the Obsessive to win. Several players can win in the same match.

## 3. Balance snapshot (bots only, `npm run simulate -- 1000`)

| Role | Win % |
|---|---|
| Obsessive / Accomplice | ~39% |
| Target | ~39% |
| Detective | ~30% |
| Socialite | ~54% |
| Romantic | ~63% |

Murders per match are about 0.6, and the Obsessive is exposed in about 30% of matches. The solo roles are currently the easiest, so they are the first thing to tune once humans playtest. Bots play the Romantic almost perfectly because they never leave their crush's side.

## 4. Roadmap

| Step | Status |
|---|---|
| 1. Prototype the core loop in 2D with bots | ✅ this repo |
| 2. One murder scenario end to end (kill, evidence, trial) | ✅ |
| 3. Draft the cast and expressions | ✅ procedural placeholders, 6 students x 7 expressions |
| 4. Webtoon flair: panel cuts, SFX, screen shake, distortion | ✅ first pass |
| 5. Human playtests; tune role balance | ⏭ next |
| 6. Multiplayer | ⏭ |
| 7. Final art | ⏭ |

### Toward multiplayer
`src/engine.js` is already shaped like an authoritative server:
- The whole match is one serialisable object, including RNG state, so it can be snapshotted, replayed and tested.
- Player input is a small set of action objects (`move`, `talk`, `search`, `use`, `stalk`, `coverup`, and the night and trial choices).
- The engine emits **beats**, and the client only renders them. Per-viewer visibility is already modelled (`visibleLog`, `knownEvidence`, `canSeeRoom`, `knownNightPlans`).

Recommended path: first run the engine in a Node room server such as Colyseus, or in a Nakama authoritative match handler, which is also JavaScript. Replace the "player acts, then all bots act" tick with "collect every human's action (bots fill empty seats and timeouts), then resolve". Send each client only its filtered view.

### Toward an engine port
If you move to **Godot 4**, port `engine.js` to GDScript as-is, since it is plain data and functions. Use **Dialogic** for dialogue and portraits, and Nakama or Godot's high-level multiplayer for networking. In **Unity**, the equivalents are Naninovel and Photon Fusion. Keep the rules and presentation separation either way.

### Art pipeline
The procedural portraits are placeholders sized for replacement. Each character needs **7 expression sprites** matching the keys in `EXPRESSIONS` (`src/data.js`). Draw them in Clip Studio Paint, and use Spine 2D for idle breathing and hair sway. Match the reference sheet: clean line art, soft cel shading, one prop "sticker" per character, and SFX in oval bubbles.
