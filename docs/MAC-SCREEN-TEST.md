# Mac task: why is nothing drawn on the Push 3 screen? (for Claude on Svebor's Mac)

You are Claude running on Svebor's MacBook (Claude desktop app with computer use, Claude in Chrome, SVEBOR connector).
Talk to Svebor in Croatian, short and clear. He is a musician, not a programmer.

## Context (read first, 5 minutes)
- Project: https://github.com/udrugaotemporabot123/push3 (Push 3 User Mode controller as a Max for Live device).
  Read `docs/HANDOFF.md` and `docs/PUSH3-SCREEN.md` there (raw: https://raw.githubusercontent.com/udrugaotemporabot123/push3/main/docs/HANDOFF.md).
- Setup: macOS 26, Ableton Live 12.4.16 Suite, Push 3 tethered over USB.
- Goal: draw our own picture on the Push 3 screen from a Max for Live device using `[live.push]` and its undocumented
  `jit_matrix <name>` message. This was found and verified by https://github.com/Cardamien/push3-max-lab
  (`screens/README.md`) on Push 3 tethered + Live 12.4.15 + **Max 9.2** (standalone Max chosen in Live's settings).
  They say it is NOT verified on the Max bundled with Live.
- Our device `Push3Ekran.amxd` (in the push3 release ZIP) shows NOTHING on Svebor's Push, neither in Live Mode nor in
  User Mode. We need to know why.

## Rules
- Do not touch Svebor's real Live set. Before you open a new set, ask him to save his work (or confirm it is saved).
- Do not delete files, do not change Live settings other than the one named in step 6 (and only with his OK),
  do not kill or restart `Push3.app` or any Ableton helper (it resets the whole Push), no `sudo`.
- You cannot see the Push screen. At every step where the result is on the Push, ASK Svebor what he sees
  (or ask him for a phone photo). Keep each question short: "Što sada piše/vidiš na Push ekranu?".
- Write down every result in the report table at the end.

## Steps
1. **Max version.** In Live: Settings → File & Folder (or "Plug-Ins/Max" section) → which Max application is used
   (bundled or a custom path)? Also open any Max device's editor → Max menu "About Max" → exact version. Note both.
2. **Empty set.** File → New Live Set (after Svebor confirms his set is saved). Push stays in Live Mode for now.
3. **Get the known-good test device.** Download https://github.com/Cardamien/push3-max-lab/archive/refs/heads/main.zip
   (Chrome or `curl -L -o ~/Downloads/push3-max-lab.zip <url>`), unzip, and copy the folder `screens/viz-probe`
   (`PushVizProbe.amxd` + `push-viz-probe.js`, they must stay together) to
   `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/push3-max-lab-test/`.
4. **PushVizProbe test, Live Mode.** In the empty set, drag PushVizProbe from Live's browser (User Library) onto an
   audio track. Click the device so it is selected; on the Push press the **Device** button so the Push shows this
   device. On the device: Pattern = Red, Size = 960x160, Order = ARGB, Alpha = 255, Rate = 5, then **Send = on**.
   - Ask Svebor: is the Push screen red (behind Live's parameter names)?
   - Look at the small preview in the device (red?). Open the device editor (wrench icon) → Max Console
     (Window → Max Console): copy any red error lines (e.g. "live.push: doesn't understand jit_matrix").
   - Try Pattern = Corners and Counter, ask again.
5. **PushVizProbe test, User Mode.** With Send on, ask Svebor to press **User** on the Push. Does the picture stay,
   disappear, or does the screen go blank? Then User again (back to Live Mode).
6. **Only if step 4 drew nothing:** ask Svebor whether a standalone **Max 9.2 or newer** is installed
   (`/Applications/Max.app`, check its version). If not, ask him whether you may download it from
   https://cycling74.com/downloads (free to install; Live Suite authorises it for Max for Live). With his OK, set
   Live → Settings → File & Folder → Max Application to that Max, restart Live (ask first), and repeat steps 4–5.
   Afterwards tell him how to switch back to the bundled Max (same setting, "use bundled"), and do it if he wants.
7. **Our device.** Download the latest push3 release ZIP (https://github.com/udrugaotemporabot123/push3 →
   branches `release/v…`, newest; or ask Svebor where his copy is), use `Push3Ekran.amxd` + `p3um-screen.js` from it
   (same folder). Put Push3Ekran on an audio track of the empty set, select it on the Push (Device button), switch
   **Test** on. Ask Svebor what the Push shows; note whether the device's own preview shows "PUSH 3 EKRAN TEST".
   Copy Max Console errors (open the device editor → Max Console).
8. **Push helper log.** Read the end of `~/Library/Preferences/Ableton/Live 12.4.16/Push3.log` (adjust the version
   folder) around the test time; copy lines with "error", "display", "matrix" or "push" that look relevant.

## Report (give it to Svebor in the chat so he can paste it to the cloud session; keep it under 30 lines)
| Item | Result |
|---|---|
| Live version / Max used by Live (bundled or path) / exact Max version | |
| PushVizProbe, Live Mode, Red: Push screen | |
| PushVizProbe preview in the device | |
| PushVizProbe Corners / Counter | |
| PushVizProbe in User Mode | |
| Max Console errors (PushVizProbe) | |
| Max 9.2 test done? result | |
| Push3Ekran Test: Push screen / device preview | |
| Max Console errors (Push3Ekran) | |
| Push3.log relevant lines | |

Then one line of conclusion: "Radi sa službenim Maxom / radi samo s Maxom 9.2 / ne radi ni s jednim / radi u
Live Modeu ali ne u User Modeu".
