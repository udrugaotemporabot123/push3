# Push 3 screen: what is possible (research 2026-11-19)

Owner's question: can we draw on the Push 3 screen at all (Push 3, not Push 2), tethered to the Mac with Live running?
Short answer: **yes, two ways are known to work on real Push 3 hardware**; a third (our own USB takeover from inside
Live) is what failed for us earlier.

## 1. `live.push` from a Max for Live device (Live running, tethered) – used by Push3Ekran.amxd
- Found by **push3-max-lab** (github.com/Cardamien/push3-max-lab, `screens/README.md`), verified on a tethered Push 3,
  Live 12.4.15, Max 9.2 (standalone Max chosen in Live's preferences), firmware 1.5.4.
- A device sends `jit_matrix <name>` (4 planes char, ARGB, 960x160) to the stock `[live.push]` object; the undocumented
  message was found by disassembly. Live draws its own names/values/dials on top; black is invisible (light on black);
  at most ~30 new frames/s; the last frame stays until a transparent (all zero) frame; ~1 % Live CPU at 30 fps.
- The picture belongs to the device's screen slot: it shows when that device is selected on the Push.
- **Not verified anywhere**: whether it also shows in **User Mode** (Ableton's manual: in User Mode "the display will
  not show any of Push's built-in views"), and whether it works on the **Max 9.1.x bundled with Live 12.4**.
  That is exactly what the owner's first test answers (Push3Ekran → Test).

## 2. Claim the screen before Live starts (separate program) – push-tethered-app
- github.com/federico-pepe/push-tethered-app (macOS confirmed with Push 3, 2026-10-03): the screen (USB interface 0)
  is **first claimant wins**. A program that claims it **before Live starts** keeps it; Live's helper (Push3.app)
  then starts without the screen and Live runs normally. With User Mode on, pads/LEDs go to that program too.
- Cost: for the whole session **Live's own Push screen is gone** (also in Live Mode), and the program must run
  outside Live (started before Live). Our earlier hang (v0.49) came from claiming the screen from inside Live
  while Live's helper was starting: a race, not this method.
- Frame format (same as Push 2): 16-byte header `ff cc aa 88` + zeros, 160 lines x 2048 bytes (960 px BGR565 +
  128 padding), XOR `e7 f3 e7 ff`; vendor 0x2982, product 0x1969 (push3-max-lab `hardware/README.md`,
  danielknng/push3-protocol-docs).

## 3. Standalone Push 3 only
- Push Hack (github.com/federico-pepe/ableton-push-hack, CDM article "Push Hack, very unauthorized access…") draws
  over the screen on a standalone Push 3 via SSH + LD_PRELOAD. Not usable tethered.

## What we do
- v0.60.0: `Push3Ekran.amxd` + `p3um-screen.js` (route 1). Lite sends a small summary over `[s p3um_screen]`; the
  screen device draws it with jit.lcd only in User Mode (Test toggle: any mode) and sends a transparent frame
  when leaving User Mode, when switched off and when deleted.
- If route 1 does not show in User Mode: options are (a) route 2 as an optional helper app started before Live,
  (b) staying in Live Mode with our device selected (picture + 8 encoders via live.banks, but pads stay Live's),
  (c) the tablet player (works now).
