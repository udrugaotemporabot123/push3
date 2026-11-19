# Handoff: where we are (for whoever continues)

Owner: SVEBOR (Croatian; answer him in Croatian, short and clear). Read `CLAUDE.md` first, then this file,
then `docs/PROGRESS.md` (full version history and findings).

## Repository and versions
- GitHub: https://github.com/udrugaotemporabot123/push3 (public). Work on `main`.
- Every finished version is a branch `release/vX.Y.Z` (tags are blocked by the git proxy). Make one with
  `tools/release.sh X.Y.Z "Croatian one-line summary"` (runs tests, bumps package.json, CHANGELOG, pushes main + branch).
- Download link pattern for the user: `https://github.com/udrugaotemporabot123/push3/archive/refs/heads/release/vX.Y.Z.zip`
- Tests: `npm test` (node --test; ~120 tests incl. a fake Live Object Model for the Max bridge and fuzz tests).

## What the user uses NOW: only the Lite device
- `Push3UserModeLite.amxd` (built by `tools/build_device.py`, entry `p3um-lite.js` → `engine/src/app.js start({lite:true})`).
- The full device (`Push3UserMode.amxd`, templates/add-ons/display) is NOT being looked at. Change Lite only.
- His Mac: macOS 26, Live 12.4.16 Suite, Push 3 tethered. Big set (~77 % CPU already) → CPU is the top concern.
- Install: unzip into `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/`, drop Lite on Main.
  First run does `npm install` (only @julusian/midi + ws; usb is optional). Editor: device button "Editor" → browser 127.0.0.1:47391.
  Settings are stored in `~/Documents/Push3UserMode/config.json` (shared by both devices).

## His setup (confirmed)
- Each track: main rack whose name starts with `00 ALL`, inside it subracks `00 MIDI`, `00 INST`, `00 A1`, `00 A2`
  (rest of the name is irrelevant). Tracks 1–2: `PRE FX A1`, a Looper device, `00 A1`, `00 A2` (not grouped).
- Drum group track named exactly `9 - DRUM CLIPS` with 7 tracks inside; clip `first kick` must land on row 2, column 2
  of the 8x8 grid (column 1 = the group track = launches whole rows, top row = empty slots = stop).

## Lite features in use (editor → Predlošci)
- Page 1 "Rack kontrola": top 3 pad rows = rack variations 1–24 of the selected rack (index 0 = reset),
  4th row = rack picker by name (00 ALL / 00 MIDI / 00 INST / 00 A1 / 00 A2 / PRE FX A1 / Looper) + REFRESH,
  buttons under the display = tracks as Live shows them (folded groups hide their tracks), Page ◀ ▶ = bank of 8.
- Page 2 "Drum clips": 8x8 clip box (box mappings), D-pad moves it, ● = find `first kick`.
- Device buttons "Rackovi" (rescan racks + visible tracks) and "Drum" (find drum anchor). Nothing is searched otherwise.

## Hard facts learned on his hardware (do not retry)
- Push display in User Mode is impossible: Live's helper `Live.app/Contents/Helpers/Push3.app` owns it exclusively
  (claimInterface 0xe00002c5); killing that helper resets the whole Push. Editor/tablet preview only.
- Changing Live (set/call) or dropping/recreating observers inside a LiveAPI notification crashed Live (v0.51.0).
  All re-resolves from notifications go through `resolveLater`/`resolveLiveLater` (Task). Keep it that way.
- Browser `confirm/prompt` were blocked on his Mac → editor uses in-page dialogs (`dialog()`/`askConfirm()`).
- Rebuilding the editor side panel on every Live update swallowed clicks → only refresh it throttled (v0.54.2).
- A saved display-takeover setting froze Live at load; it is forced off at startup.

## Status after his test of v0.57.0 (2026-11-19 evening)
- Done in v0.57.0: Lite rack row and clip box have no Live observers (rack map sent once on "Rackovi", colours computed
  in node; clip box colours read once on "Drum" / box move). Only selected-track + selected-rack variation observers remain.
- His report on v0.57.0:
  1. Live's CPU meter is the same with and without the device → NOT an audio-CPU problem. But Live's UI/visuals on his
     MacBook get noticeably laggy while the device is in use (User Mode + playing). Suspects: anything on Live's/Max's
     main thread (Max [js] LiveAPI work, Max console posts, device status text redraws) and the editor tab in Chrome
     re-rendering on every Push input (GPU shared with Live). Ask him to test with the editor tab closed.
  2. "Selected" shows ORANGE, must be WHITE: palette index 3 is not white on his Push 3 (our DEFAULT_PALETTE assumption
     is wrong). Use the palette read from the Push: nearest index to the wanted RGB (engine `whiteIndex()`, editor
     template colours picked from S.palette by RGB).
  3. Variation pads still do not take the colour of the rack in use → add a log line with the rack in use and check
     the id matching (variations report `id`, rack map ids, selected track id).
  4. Layout wish: rack row FIRST (top row), then the 3 rows of variations under it.
- v0.58.0 answers items 2 and 4 (palette-correct white/colours, rack row on top), adds the log line for item 3 and trims
  Max-main-thread work for item 1. Next: his test, especially the UI lag with the editor tab closed vs open.
- His report on v0.58.0 (2026-11-19 night): reset pad (variation 1) looked white → must be the rack colour like the
  others; A1 = pink, A2 = orange; Live still NOTICEABLY laggy → "much more efficient", functions may be cut, Drum clips
  can go completely.
- v0.59.0 (Lite only): quiet bridge = not a single Live observer (no selected track/device/variation watchers); the
  bridge reads state only right after our own actions (variation press looks up the rack in use at that moment, track /
  rack / nav presses read once) and on entering User Mode (`refresh`). Trade-off: changes made with the MOUSE while in
  User Mode show on the Push only after the next press. Clip box / Drum clips removed from Lite (config pages stripped
  on load, Drum button and templates gone). Watch targets are not re-sent when unchanged. Editor "Prati Push" off by
  default (it rebuilt the panel on every press). [js] autowatch 0. He must re-apply template "Rack kontrola" for the
  new A1/A2 colours. Asked him to test: device on in Live Mode / User Mode with editor closed / open / variations
  clicked with the mouse without the device, to see whether the lag is ours at all.
- Open: PRE FX A1 is orange too (same as A2 now) – ask him for another colour.
- **v0.59.0 confirmed by him (2026-11-19): no lag, stable, also with the editor open.** Kept as branch
  `stable/v0.59.0` – the fallback whenever a newer version misbehaves.
- v0.60.0: Rack kontrola layout = row 1 tracks (trackSlot), row 2 rack picker, rows 3-5 variations; lower buttons
  free (his wish). Push screen: separate device `Push3Ekran.amxd` (`tools/build_screen.py`, `p3um-screen.js`) via
  `live.push` jit_matrix – research and alternatives in `docs/PUSH3-SCREEN.md`; untested on his hardware (User Mode?
  bundled Max 9.1?). Tablet player `editor/player.html` (+ LAN Player link): screen summary, tracks, racks, macros
  of the rack in use (bridge `readMacros`/`macroSet`, read only while a player is open and only after actions),
  variations recall/store/delete/randomize. His TouchOSC project (MIDI only, 2560x1600 Android-size tablet,
  pages MAIN/MACROS/SETLIST/…) can stay as is; an OSC bridge is possible later.
- Older: bass track "00 MIDI" not found because of a space → he renames it himself.
- He works with Lite only; full device is ignored.

## Where things live
- `engine/src/engine.js` core (pages, LEDs, live mappings, clip box: `moveBox`, `boxOrigin`, `findBoxAnchor`, rack/track buttons)
- `engine/src/config.js` normalisation of every mapping type; `engine/src/live.js` Live action → spec
- `p3um-live.js` Max [js] Live API bridge (ES5 only; a test enforces it): `findDeviceByNames`, `scanTrackDevices`,
  `rescanRacks`, `scanVisibleTracks`, `findAnchor`, variations (`resolve`, `selectedRack`)
- `editor/app.js` web editor (templates `rackControl`, `drumClips`, `clipBox`; `LITE_TYPES`, `LITE_TEMPLATE_GROUPS`)
- `tools/build_device.py` builds both .amxd files (Lite = no jweb, node + js bridge, buttons Rackovi/Drum)
- `engine/test/*.test.js` tests; `docs/PROGRESS.md` history; user notes also in his Google Doc "DOPUNE UPUTA" (append only).
