# Push 3 User Mode – working rules

Owner: SVEBOR (live sampling / live processing of recorded sound is his main thing; Push 3 tethered to a Mac, Live 12 Suite, TouchOSC on a tablet, Nektar Pacer). User-facing text (README, editor UI) in Croatian; code and comments in English.

## Goal
Turn Push 3 User Mode into the best general-purpose MIDI controller ("zvijer"), later shared with the community.
- **Core** = general MIDI controller (mapping, pages, LEDs, feedback, display). Stability and speed come first: entering User Mode must work instantly and never break normal Push mode.
- **Add-ons** = optional modules (live sampling workflows, sequencers, drum-rack capture…). They must be switchable off and must not destabilise the core. Location: `addons/`.

## Autonomous loop (when working unattended)
1. Read `docs/PROGRESS.md` (status, roadmap, open questions).
2. Pick the next goal, implement it with tests (`npm test` must pass).
3. Commit to `main`, push. For each finished version: bump `package.json` version, add a line to `CHANGELOG.md`, push branch `release/vX.Y.Z` (tags are blocked by the git proxy; branches are the downloadable versions).
4. Update `docs/PROGRESS.md`, then set yourself the next goal (more powerful, more useful, smarter) and continue.
5. Never rewrite history on `main` or on release branches.

## Hardware facts (confirmed on the user's Push 3, 2026-10-22)
- User Port name on macOS: "Ableton Push 3 … User Port" (user's unit: "Ableton Push 3 novi  User Port").
- Mode sysex reply `F0 00 21 1D 01 01 0A 0x F7` arrives on the User Port: detection works.
- Touch notes: 8 volume enc, 10 tempo enc, 11 jog wheel, 12 touch strip, 13 D-pad area.
- See `engine/src/push3.js` for the full map; `verify: true` marks unconfirmed numbers.
