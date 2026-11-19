# Mac screen test: results (2026-11-19 evening, Claude on Svebor's Mac)

Ran `docs/MAC-SCREEN-TEST.md` on his MacBook (macOS 26, Live 12.4.16 Suite, Push 3 tethered), on an empty
"Untitled" set. His real set was not touched.

## Short answer
- **With the Max bundled in Live (9.1.5) the Push screen cannot be drawn on.** `live.push` in 9.1.5 does not know
  the `jit_matrix` message at all.
- **With standalone Max 9.2.1 selected in Live, PushVizProbe's red picture DOES show on the Push** (seen by
  Svebor at ~21:45 after he switched Live to /Applications/Max.app and restarted Live).
- Still open: User Mode, Corners/Counter, and Push3Ekran under Max 9.2.1 (see "Open" below).

## Report table
| Item | Result |
|---|---|
| Live version / Max used by Live / exact Max version | Live 12.4.16 Suite. Before: Settings → File & Folder said "You are using the bundled version of Max", bundled Max **9.1.5 (3db35fa476d)**. After: standalone Max **9.2.1 (b6a40ee953d)** in `/Applications/Max.app`, selected by Svebor in the same setting |
| PushVizProbe, Live Mode, Red, bundled Max 9.1.5 | **Nothing** on the Push (normal device view). Red, 960x160, ARGB, Alpha 255, Rate 5, Send on, device selected, Device button pressed |
| PushVizProbe preview in the device | Red (preview works with both Max versions) |
| Max Console (PushVizProbe, 9.1.5) | Once per frame: `PushVizProbe.amxd • live.push • doesn't understand "jit_matrix"` |
| PushVizProbe, Live Mode, Red, **Max 9.2.1** | **Red shows on the Push** (Svebor) |
| PushVizProbe Corners / Counter | Not tested yet (skipped on 9.1.5 because every frame failed) |
| PushVizProbe in User Mode | **Not tested yet**. This is the key question for our Lite device |
| Push3Ekran Test (v0.62.0), 9.1.5: Push / preview | Push: nothing. Preview: "PUSH 3 EKRAN TEST", "okvir 49 (nema podataka od Lite devicea)", red/green/blue squares |
| Max Console (Push3Ekran, 9.1.5) | On load: `Push3Ekran.amxd • jit.op • error connecting outlet 1 to live.push inlet 1` and the same for `jit.matrix` (Max numbers from 1; the .amxd wires outlet 0 → inlet 0, which is correct) |
| Push3Ekran on Max 9.2.1 | Not tested yet |
| Push3.log | Nothing written during the test (last entry 18:42). Earlier: 17:06 `USB transmission failure ... LIBUSB_ERROR_PIPE` → "resetting USB device"; at every start an Ableton-internal `ValueError` in `version_info._split_version_string`. Firmware: PMC 1.20.0, APC 1.9.0, XY sensor 0.13.0 |

Conclusion: **radi samo s Maxom 9.2 (u Live Modeu); User Mode i Push3Ekran na 9.2.1 još nisu testirani.**

## What it means for the code
- Root cause on the bundled Max: `live.push` 9.1.5 has no `jit_matrix` method. Two symptoms:
  PushVizProbe (untyped v8 outlet → live.push) gets "doesn't understand" per frame; Push3Ekran (jit.op / jit.matrix
  outlets → live.push) fails earlier: Max refuses the patch cords at load because the inlet does not take matrices,
  so not one frame leaves the device.
- Push3Ekran should send through a v8/js outlet (like PushVizProbe: `outlet(0, "jit_matrix", name)`) instead of
  cording jit.op straight into live.push. Then it loads cleanly on any Max and the console shows the real reason.
- Requirement to document for users: standalone **Max 9.2 or newer** must be installed and selected in Live →
  Settings → File & Folder → Max Application. Bundled Max 9.1.5 cannot do it.
- Check after a Live update: if a future Live bundles Max 9.2+, the standalone Max is no longer needed.

## Open (next tests on his Mac, with Max 9.2.1)
1. PushVizProbe: Corners and Counter (colour order, frame rate) and **User Mode** (press User: picture stays / goes?).
2. Push3Ekran v0.62.0 with Test on: Push screen? Max Console errors?
3. Confirm in a Max for Live device: Max menu → About Max says 9.2.1. (Note: at 21:45 `ps` still showed only the
   bundled Max process `.../App-Resources/Max/Max.app ... --mfl`, started 19:36, while Live was restarted at 21:42.
   So it is not yet proven which Max produced the red picture. Check About Max once.)

## Where things are on his Mac
- **His real User Library is `~/Desktop/MAIN - STUDIO/USER LIBRARY`** (not `~/Music/Ableton/User Library`).
  Install instructions must say this or say "your User Library".
- Test devices: `~/Desktop/MAIN - STUDIO/USER LIBRARY/MAX FOR LIVE/push3-max-lab-test/` (PushVizProbe.amxd +
  push-viz-probe.js) and `.../MAX FOR LIVE/push3-ekran-test-v0.62.0/` (Push3Ekran.amxd + p3um-screen.js).
- Unused duplicate copies (safe to delete): `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/`
  `push3-max-lab-test` and `push3-ekran-test-v0.62.0`.
- Downloads: `~/Downloads/push3-test-2026-11-19/` (push3-max-lab main ZIP + push3 release/v0.62.0 ZIP, unzipped) and
  `~/Downloads/max921/Max921_261103.dmg` (1.1 GB installer, can be deleted).
- Standalone Max 9.2.1: `/Applications/Max.app` (official notarized DMG from cycling74.com; Svebor accepted the licence).
  Back to bundled: Live → Settings → File & Folder → Max Application → "Use bundled version", restart Live.
- Push helper log: `~/Library/Preferences/Ableton/Live 12.4.16/Push3.log`.

## Tooling facts about his Mac (for Claude on the Mac)
- No Xcode command line tools: `python3`, `git` and `gh` are stubs that pop up the "install developer tools" dialog.
  Do not call them. For JSON/.amxd parsing use Live's bundled node:
  `/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app/Contents/Resources/C74/packages/Node for Max/source/bin/osx/node/node`.
  To change this repo from his Mac, use the GitHub web editor in his Chrome (Claude in Chrome, "Browser 1").
- In Live 12 the Max for Live device title bar icons are: ver/plug, hot-swap, **save preset**, "…". The Max
  Console is under "…" → **Open Max Window**; the editor is "…" → Edit in Max.
- Live's Max Application file dialog: "Go to folder" + Return did not stick when driven by Claude; Svebor set it by hand.
