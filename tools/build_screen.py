#!/usr/bin/env python3
"""Builds Push3Ekran.maxpat / Push3Ekran.amxd: the Push 3 screen for the Lite device.

An audio effect (put it on any track, e.g. next to the Lite device on Main). It receives a small summary
from the Lite device ([r p3um_screen]), draws it with jit.lcd in p3um-screen.js and hands every frame to
[live.push] ("jit_matrix" message, found by github.com/Cardamien/push3-max-lab, MIT). Removing the device
removes the screen; the Lite device works the same with or without it.
Run: python3 tools/build_screen.py
"""
import json
import os
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "Push3Ekran"

boxes = []
lines = []


def box(id_, maxclass, rect, text=None, ins=1, outs=0, outtype=None, pres=None, **extra):
    b = {"id": id_, "maxclass": maxclass, "numinlets": ins, "numoutlets": outs, "patching_rect": rect}
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


box("plugin", "newobj", [20, 20, 60, 22], "plugin~", 2, 2, ["signal", "signal"])
box("plugout", "newobj", [20, 70, 60, 22], "plugout~", 2, 2, ["signal", "signal"])
line("plugin", 0, "plugout", 0)
line("plugin", 1, "plugout", 1)

box("js", "newobj", [200, 200, 160, 22], "js p3um-screen.js", 1, 3)
box("thisdev", "newobj", [200, 20, 100, 22], "live.thisdevice", 1, 3, ["bang", "int", "int"])
box("msg_start", "message", [200, 60, 40, 22], "start", 2, 1)
line("thisdev", 0, "msg_start", 0)
line("msg_start", 0, "js", 0)

box("r_screen", "newobj", [320, 20, 110, 22], "r p3um_screen", 0, 1)
box("prep_screen", "newobj", [320, 60, 100, 22], "prepend screen", 1, 1)
line("r_screen", 0, "prep_screen", 0)
line("prep_screen", 0, "js", 0)

box("s_req", "newobj", [480, 240, 130, 22], "s p3um_screen_req", 1, 0)
line("js", 2, "s_req", 0)

# Drawing: jit.lcd (ARGB char) -> alpha forced to 255 -> live.push; preview in the device.
box("lcd", "newobj", [200, 260, 160, 22], "jit.lcd 4 char 960 160", 1, 2, ["jit_matrix", ""])
box("alpha", "newobj", [200, 300, 220, 22], "jit.op @op max pass pass pass @val 255", 2, 2, ["jit_matrix", ""])
box("push", "newobj", [200, 380, 70, 22], "live.push", 1, 0)
line("js", 0, "lcd", 0)
line("lcd", 0, "alpha", 0)
line("alpha", 0, "push", 0)
box("preview", "jit.pwindow", [440, 300, 240, 40], None, 1, 2, ["jit_matrix", ""], pres=[8, 52, 246, 41])
line("alpha", 0, "preview", 0)

# Transparent frame (all zeros) hands the screen back to Live.
box("clear", "newobj", [380, 340, 220, 22], "jit.matrix ---ekranclear 4 char 960 160", 1, 2, ["jit_matrix", ""])
line("js", 1, "clear", 0)
line("clear", 0, "push", 0)

# UI
box("title", "comment", [20, 420, 200, 20], "PUSH 3 EKRAN", 1, 0, pres=[8, 6, 200, 20], fontsize=12.0, fontface=1)
box("hint", "comment", [20, 450, 240, 34], "Ekran u User Modeu (podaci iz Lite devicea). Test = probna slika.", 1, 0, pres=[8, 96, 246, 30], fontsize=10.0, textcolor=[0.6, 0.62, 0.66, 1.0], linecount=2)
box(
    "enable",
    "live.toggle",
    [600, 20, 15, 15],
    None,
    1,
    1,
    [""],
    pres=[8, 30, 15, 15],
    parameter_enable=1,
    saved_attribute_attributes={
        "valueof": {
            "parameter_enum": ["off", "on"],
            "parameter_initial": [1],
            "parameter_initial_enable": 1,
            "parameter_longname": "Ekran",
            "parameter_mmax": 1,
            "parameter_shortname": "Ekran",
            "parameter_type": 2,
        }
    },
    varname="Ekran",
)
box("enable_lbl", "comment", [620, 20, 50, 20], "Ekran", 1, 0, pres=[26, 28, 50, 20], fontsize=11.0)
box("prep_enable", "newobj", [600, 60, 90, 22], "prepend enable", 1, 1)
line("enable", 0, "prep_enable", 0)
line("prep_enable", 0, "js", 0)
box("test", "toggle", [700, 20, 20, 20], None, 1, 1, ["int"], pres=[90, 28, 18, 18])
box("test_lbl", "comment", [725, 20, 50, 20], "Test", 1, 0, pres=[110, 28, 60, 20], fontsize=11.0)
box("prep_test", "newobj", [700, 60, 80, 22], "prepend test", 1, 1)
line("test", 0, "prep_test", 0)
line("prep_test", 0, "js", 0)

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 800.0, 520.0],
        "openinpresentation": 1,
        "default_fontsize": 11.0,
        "default_fontname": "Ableton Sans Medium",
        "devicewidth": 262.0,
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [{"name": "p3um-screen.js", "type": "TEXT", "implicit": 1}],
        "autosave": 0,
    }
}

data = json.dumps(patcher, indent=1).encode("utf-8")
with open(os.path.join(ROOT, f"{NAME}.maxpat"), "wb") as f:
    f.write(data)
payload = data + b"\n\x00"
amxd = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + b"\x00\x00\x00\x00" + b"ptch" + struct.pack("<I", len(payload)) + payload
with open(os.path.join(ROOT, f"{NAME}.amxd"), "wb") as f:
    f.write(amxd)
print(f"wrote {NAME}.maxpat ({len(data)} bytes) and {NAME}.amxd ({len(amxd)} bytes)")
