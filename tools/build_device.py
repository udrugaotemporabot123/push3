#!/usr/bin/env python3
"""Builds Push3UserMode.maxpat and Push3UserMode.amxd (Max Audio Effect) from code.

The device only wires things together; all logic lives in p3um-main.js (Node for Max)
and p3um-live.js (Live API bridge). Run: python3 tools/build_device.py
"""
import json
import os
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDITOR_URL = "http://127.0.0.1:47391/"

boxes = []
lines = []


def box(id_, maxclass, rect, text=None, ins=1, outs=0, outtype=None, pres=None, **extra):
    b = {
        "id": id_,
        "maxclass": maxclass,
        "numinlets": ins,
        "numoutlets": outs,
        "patching_rect": rect,
    }
    if outtype is not None:
        b["outlettype"] = outtype
    elif outs:
        b["outlettype"] = [""] * outs
    if text is not None:
        b["text"] = text
    if pres:
        b["presentation"] = 1
        b["presentation_rect"] = pres
    b.update(extra)
    boxes.append({"box": b})
    return id_


def line(src, so, dst, di):
    lines.append({"patchline": {"source": [src, so], "destination": [dst, di]}})


# ---- Audio pass-through (it is an audio effect so it can sit on any track, e.g. Main) ----
box("plugin", "newobj", [20, 20, 60, 22], "plugin~", 2, 2, ["signal", "signal"])
box("plugout", "newobj", [20, 70, 60, 22], "plugout~", 2, 2, ["signal", "signal"])
line("plugin", 0, "plugout", 0)
line("plugin", 1, "plugout", 1)

# ---- Engine ----------------------------------------------------------------------------
box("node", "newobj", [200, 200, 330, 22], "node.script p3um-main.js @autostart 1 @watch 0", 1, 2, ["", ""])
box("route", "newobj", [200, 240, 330, 22], "route live status needsInstall editorUrl", 1, 5)
box("prep_live", "newobj", [200, 280, 80, 22], "prepend live", 1, 1)
box("js", "newobj", [200, 320, 140, 22], "js p3um-live.js", 1, 1)
line("node", 0, "route", 0)
line("route", 0, "prep_live", 0)
line("prep_live", 0, "js", 0)
line("js", 0, "node", 0)

# Live API is only usable after live.thisdevice has fired.
box("thisdev", "newobj", [400, 20, 100, 22], "live.thisdevice", 1, 3, ["bang", "int", "int"])
box("trig", "newobj", [400, 60, 50, 22], "t b b", 1, 2, ["bang", "bang"])
box("msg_init", "message", [460, 100, 40, 22], "init", 2, 1)
box("msg_ready", "message", [400, 100, 80, 22], "bridgeReady", 2, 1)
line("thisdev", 0, "trig", 0)
line("trig", 1, "msg_init", 0)
line("msg_init", 0, "js", 0)
line("trig", 0, "msg_ready", 0)
line("msg_ready", 0, "node", 0)

# Status text in the device UI.
box("prep_set", "newobj", [290, 280, 80, 22], "prepend set", 1, 1)
line("route", 1, "prep_set", 0)
box("status", "comment", [290, 380, 230, 20], "Starting…", 1, 0, pres=[8, 30, 244, 20], fontsize=11.0, textcolor=[0.43, 0.9, 0.72, 1.0])
line("prep_set", 0, "status", 0)

# First run: dependencies missing -> npm install, then restart the script.
box("install_t", "newobj", [380, 280, 40, 22], "t b b", 1, 2, ["bang", "bang"])
box("msg_npm", "message", [380, 320, 120, 22], "script npm install", 2, 1)
box("install_delay", "newobj", [520, 320, 80, 22], "delay 45000", 2, 1, ["bang"])
box("msg_restart", "message", [520, 360, 150, 22], "script stop, script start", 2, 1)
line("route", 2, "install_t", 0)
line("install_t", 1, "msg_npm", 0)
line("msg_npm", 0, "node", 0)
line("install_t", 0, "install_delay", 0)
line("install_delay", 0, "msg_restart", 0)
line("msg_restart", 0, "node", 0)

# ---- UI --------------------------------------------------------------------------------
box("title", "comment", [20, 420, 200, 20], "PUSH 3 USER MODE", 1, 0, pres=[8, 6, 200, 20], fontsize=12.0, fontface=1)


def ui_button(id_, label, x, pres_x):
    box(id_, "textbutton", [x, 460, 70, 22], label, 1, 3, ["", "", "int"], pres=[pres_x, 58, 76, 24], texton=label, mode=0, fontsize=11.0)
    t = box(id_ + "_t", "newobj", [x, 495, 30, 22], "t b", 1, 1, ["bang"])
    s = box(id_ + "_lim", "newobj", [x, 525, 80, 22], "speedlim 800", 2, 1)
    line(id_, 0, t, 0)
    line(t, 0, s, 0)
    return s


lim = ui_button("btn_editor", "Editor", 20, 8)
box("msg_open", "message", [20, 560, 40, 22], "open", 2, 1)
box("pcontrol", "newobj", [20, 600, 60, 22], "pcontrol", 1, 1)
line(lim, 0, "msg_open", 0)
line("msg_open", 0, "pcontrol", 0)

lim = ui_button("btn_browser", "Browser", 120, 88)
box("msg_browser", "message", [120, 560, 260, 22], f";\rmax launchbrowser {EDITOR_URL}", 2, 1)
line(lim, 0, "msg_browser", 0)

lim = ui_button("btn_restart", "Restart", 400, 168)
box("msg_restart2", "message", [400, 560, 150, 22], "script stop, script start", 2, 1)
line(lim, 0, "msg_restart2", 0)
line("msg_restart2", 0, "node", 0)

box("hint", "comment", [20, 640, 240, 40], "Postavke i mapiranje: Editor. Push: pritisni User.", 1, 0, pres=[8, 92, 244, 34], fontsize=10.0, textcolor=[0.6, 0.62, 0.66, 1.0], linecount=2)

# Editor window: a subpatcher with a jweb pointing at the engine's local server.
editor_patcher = {
    "fileversion": 1,
    "rect": [80.0, 80.0, 1460.0, 940.0],
    "boxes": [
        {"box": {"id": "lb", "maxclass": "newobj", "text": "loadbang", "numinlets": 1, "numoutlets": 1, "outlettype": ["bang"], "patching_rect": [10, 10, 60, 22]}},
        {"box": {"id": "url", "maxclass": "message", "text": f"url {EDITOR_URL}", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [10, 40, 220, 22]}},
        # pcontrol "open" arrives through this inlet; it also reloads the page.
        {"box": {"id": "in", "maxclass": "inlet", "numinlets": 0, "numoutlets": 1, "outlettype": [""], "patching_rect": [300, 10, 30, 30]}},
        {"box": {"id": "web", "maxclass": "jweb", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [0, 0, 1460, 940], "presentation": 1, "presentation_rect": [0, 0, 1460, 940], "url": EDITOR_URL}},
    ],
    "lines": [
        {"patchline": {"source": ["lb", 0], "destination": ["url", 0]}},
        {"patchline": {"source": ["in", 0], "destination": ["url", 0]}},
        {"patchline": {"source": ["url", 0], "destination": ["web", 0]}},
    ],
    "openinpresentation": 1,
}
box("editor", "newobj", [100, 600, 90, 22], "p editor", 1, 0, patcher=editor_patcher)
line("pcontrol", 0, "editor", 0)

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 760.0, 700.0],
        "openinpresentation": 1,
        "default_fontsize": 11.0,
        "default_fontname": "Ableton Sans Medium",
        "devicewidth": 262.0,
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [
            {"name": "p3um-main.js", "type": "TEXT", "implicit": 1},
            {"name": "p3um-live.js", "type": "TEXT", "implicit": 1},
        ],
        "autosave": 0,
    }
}

data = json.dumps(patcher, indent=1).encode("utf-8")
with open(os.path.join(ROOT, "Push3UserMode.maxpat"), "wb") as f:
    f.write(data)

# .amxd container: 'ampf' header, device type 'aaaa' (audio effect), meta chunk, patcher chunk.
payload = data + b"\n\x00"
amxd = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + b"\x00\x00\x00\x00" + b"ptch" + struct.pack("<I", len(payload)) + payload
with open(os.path.join(ROOT, "Push3UserMode.amxd"), "wb") as f:
    f.write(amxd)

print(f"wrote Push3UserMode.maxpat ({len(data)} bytes) and Push3UserMode.amxd ({len(amxd)} bytes)")
