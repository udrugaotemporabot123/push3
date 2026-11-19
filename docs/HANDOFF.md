# Handoff: where we are (for whoever continues)

Owner: SVEBOR (Croatian; answer him in Croatian, short and clear). Read `CLAUDE.md` first, then this file,
then `docs/PROGRESS.md` (version history), `docs/PUSH3-SCREEN.md` (Push screen research) and
`docs/MAC-SCREEN-RESULTS.md` (screen test on his Mac, 2026-11-19 evening: results + where everything is on his Mac).
Last update: 2026-11-19 night, v0.62.0 + Mac screen test results (docs/MAC-SCREEN-RESULTS.md).

## Repository and versions
- GitHub: https://github.com/udrugaotemporabot123/push3 (public). Work on `main`.
- Every finished version is a branch `release/vX.Y.Z` (tags are blocked by the git proxy). Make one with
  `tools/release.sh X.Y.Z "Croatian one-line summary"` (runs tests, bumps package.json, CHANGELOG, pushes main + branch).
- Download link for the user: `https://github.com/udrugaotemporabot123/push3/archive/refs/heads/release/vX.Y.Z.zip`
- **Stable fallback: `stable/v0.59.0`** (he confirmed: no lag, stable, also with the editor open). If a newer version
  misbehaves, he goes back to https://github.com/udrugaotemporabot123/push3/archive/refs/heads/stable/v0.59.0.zip
- Tests: `npm test` (node --test, 130 tests: engine, fake Live Object Model for the Max bridge, screen script, app
  start-up incl. the Lite entry point and the player page, fuzz). Device files are generated: `python3 tools/build_device.py`
  (both .amxd) and `python3 tools/build_screen.py` (Push3Ekran.amxd). Never hand-edit .amxd/.maxpat.

## What he uses: only the Lite device (+ tablet player)
- `Push3UserModeLite.amxd` (entry `p3um-lite.js` → `engine/src/app.js start({lite:true})`) on the Main track.
  The full device (`Push3UserMode.amxd`) is NOT used; change Lite only, keep the full device building and tests green.
- His Mac: macOS 26, Live 12.4.16 Suite, Push 3 tethered, MacBook. Big set (~77 % CPU). Max: bundled 9.1.5; since
  2026-11-19 also standalone Max 9.2.1 in /Applications/Max.app, selected in Live (needed for the Push screen).
  **His User Library is `~/Desktop/MAIN - STUDIO/USER LIBRARY`** (not ~/Music/Ableton/User Library).
  No Xcode tools on his Mac: `python3`/`git`/`gh` pop up an installer dialog, do not call them (details in MAC-SCREEN-RESULTS.md). Claude on his Mac: Claude desktop app with computer use + Claude in Chrome +
  SVEBOR connector (no `claude` CLI there).
- Install: unzip into `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/`, drop Lite on Main.
  First run does `npm install` (@julusian/midi + ws). Editor: device button "Editor" → browser http://127.0.0.1:47391/.
  Settings: `~/Documents/Push3UserMode/config.json` (+ `lan.json` for tablet access).

## His set (confirmed)
- Each track: main rack whose name starts with `00 ALL`, inside it subracks `00 MIDI`, `00 INST`, `00 A1`, `00 A2`
  (rest of the name is free, e.g. "00 INST keys"). Tracks 1–2 also `PRE FX A1`, a Looper. Names match by START
  (spaces ignored, next char must not be a letter/digit).
- Track names like "1 - PERC ws", "2 - VIO + MIC L", "4 - MIC", "5 - BASS", "6 - CHORDS", "7 - LEADS", "8 - drums",
  "9 - DRUM CL…". Variations have names on the Push screen ("0 reset", "1 minima ?", "2 arp #2"…; numbered from 0).

## Lite as it is now (v0.62.0)
- **Quiet bridge** (`p3um-live.js`, quiet mode): not a single Live observer. State is read only right after our own
  actions (variation press resolves the rack at that moment; track/rack/nav presses → `refreshLater`), on entering
  User Mode (`{cmd:'refresh'}`) and on Rackovi. This is what killed the lag; keep it. Mouse changes in Live show on the
  Push only after the next press.
- Device buttons: **Rackovi** (scan racks of all tracks once → rack map; visible tracks). No Drum button (clip box
  removed from Lite in v0.59; `stripClipBox` drops such pages on load).
- Templates (editor → Predlošci → Rack varijacije):
  - **Rack kontrola**: row 1 (top) = tracks (`trackSlot`, Page ◀ ▶ = bank of 8), row 2 = rack picker 00 ALL /
    MIDI / INST / A1 (pink) / A2 (orange) / PRE FX A1 / Looper + REFRESH, rows 3–5 = 24 variations of the rack in use
    (white = active, rack colour = exists, reset same colour as the others). Lower buttons free.
  - **Trackovi + INST i ALL varijacije** (v0.62, his wish): row 1 tracks, row 2 empty, rows 3–5 = 24 variations of
    `00 INST` on the selected track, row 6 empty, rows 7–8 = 16 variations of `00 ALL` on the selected track.
    Meant for its own page (he puts it on page 2). Variation targets with a name use the rack map (Rackovi) and
    match by name start (`findRack` → `findDeviceByNames`, fallback `searchDevices` with `nameMatches`).
- **Tablet player** (`editor/player.html` + `player.js`): editor header button **Tablet** = ON/OFF (LAN on by default,
  token-protected) + one big QR. Shows a small "track · rack · variation" line, tracks, racks, 16 fixed macro slots of
  the rack in use (drag up/down), variations (names if Live gives them, 0-based like the Push), "+" in the next free
  slot (+ then a variation = overwrite = delete + store at the end, confirmed by a second tap; + then nothing 4 s =
  new), Random, Delete (double tap), instant tap feedback, fullscreen. Macros are read (`readMacros`) only while a
  player is connected and only after actions; `macroSet` sets by rack id. He says the tablet "works super".
- **Push3Ekran.amxd** (`p3um-screen.js`, jit.lcd → jit.op alpha → `live.push` "jit_matrix"): **does NOT work with the
  Max bundled in Live (9.1.5)**: `live.push` there does not know `jit_matrix`, and Max even refuses the
  jit.op/jit.matrix → live.push patch cords at load ("error connecting outlet 1 to live.push inlet 1"), so no frame
  is sent. With standalone **Max 9.2.1** selected in Live, push3-max-lab's PushVizProbe **shows red on the Push**
  (Live Mode). Push3Ekran on 9.2.1 and User Mode are not tested yet. Full results: `docs/MAC-SCREEN-RESULTS.md`.

## Hard facts learned on his hardware (do not retry)
- Our own USB screen takeover from inside Live raced Live's helper (`Live.app/Contents/Helpers/Push3.app`) and hung Live
  (v0.49). Killing the helper resets the whole Push. (Claiming the screen BEFORE Live starts is a different, known-working
  route: docs/PUSH3-SCREEN.md, route 2.)
- Changing Live (set/call) or dropping/recreating observers inside a LiveAPI notification crashed Live (v0.51.0).
  Everything triggered from Live goes through `Task` (`resolveLater`, `refreshLater`).
- Live observers + editor re-rendering made Live's UI lag in his big set (v0.57/0.58). v0.59 quiet bridge fixed it.
- Browser `confirm/prompt` are blocked on his Mac → in-page dialogs only (editor `dialog()`, player double tap).
- Palette index 3 is not white on his Push 3 → colours always via the palette read from the Push (`colorIndex`).
- Live's API cannot overwrite a variation in place and has no documented variation names
  (docs.cycling74.com/apiref/lom/rackdevice). The bridge probes `LiveAPI.info` once for a property with
  "variation"+"name" and logs "Varijacije u Liveu: …" – ask him for that line.

## Open / next
1. Push screen (see `docs/MAC-SCREEN-RESULTS.md`): bundled Max 9.1.5 cannot draw; Max 9.2.1 can (PushVizProbe red,
   Live Mode). Next: ask him to test PushVizProbe in **User Mode** + Corners/Counter, and Push3Ekran on 9.2.1, and to
   check Max → About Max = 9.2.1. Then port Push3Ekran to the v8 outlet + JitterMatrix way (no jit.op cord into
   live.push) and document "standalone Max 9.2+ selected in Live" as a requirement. If User Mode hides the picture:
   route 2 or Live Mode with our device selected.
2. Ask for the "Varijacije u Liveu: …" log line (are variation names readable?).
3. PRE FX A1 is orange like A2 – ask him for a colour.
4. Later: TouchOSC/OSC mirror (his TouchOSC project is MIDI only, 2560x1600, pages MAIN/MACROS/SETLIST/AUDIENCE/…).

## Where things live
- `engine/src/engine.js` core: pages, LEDs, live mappings, rack/track buttons, `screenState()` (summary for the
  screen device and player), `playerAction()`, `syncVariationTargets()` (sends watch only when changed; `quiet` in Lite).
- `engine/src/app.js` wiring: Max outlets (`live`, `status`, `screen`), editor server, player clients (`updatePlayers`
  → bridge `{cmd:'macros'}`), LAN.
- `engine/src/config.js` normalisation (+ `stripClipBox`); `engine/src/live.js` Live action → spec;
  `engine/src/server.js` HTTP/WS (LAN with token, `playerUrls`); `engine/src/store.js` files.
- `p3um-live.js` Max [js] bridge, ES5 only (test enforces): quiet mode, `findDeviceByNames`, `scanTrackDevices`,
  `rescanRacks`, `scanVisibleTracks`, variations (`resolve`, `selectedRack`, `variation`), `readMacros`, `macroSet`,
  `variationNames`.
- `p3um-screen.js` + `tools/build_screen.py`: Push3Ekran device. `tools/build_device.py`: Lite + full device
  (Lite route has `screen` → `[s p3um_screen]`, `[r p3um_screen_req]` → `screenRequest`).
- `editor/app.js` editor (templates `rackControl`, `instAll`, `varSelected`; `LITE_TYPES`, `LITE_TEMPLATE_GROUPS`,
  `openTablet()`), `editor/player.*` tablet player.
- He also keeps notes in his Google Doc "DOPUNE UPUTA" (append only).
