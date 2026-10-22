{
 "patcher": {
  "fileversion": 1,
  "appversion": {
   "major": 9,
   "minor": 0,
   "revision": 0,
   "architecture": "x64",
   "modernui": 1
  },
  "classnamespace": "box",
  "rect": [
   100.0,
   100.0,
   760.0,
   700.0
  ],
  "openinpresentation": 1,
  "default_fontsize": 11.0,
  "default_fontname": "Ableton Sans Medium",
  "devicewidth": 262.0,
  "boxes": [
   {
    "box": {
     "id": "plugin",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      20,
      20,
      60,
      22
     ],
     "outlettype": [
      "signal",
      "signal"
     ],
     "text": "plugin~"
    }
   },
   {
    "box": {
     "id": "plugout",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      20,
      70,
      60,
      22
     ],
     "outlettype": [
      "signal",
      "signal"
     ],
     "text": "plugout~"
    }
   },
   {
    "box": {
     "id": "node",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "patching_rect": [
      200,
      200,
      330,
      22
     ],
     "outlettype": [
      "",
      ""
     ],
     "text": "node.script p3um-lite.js @autostart 1 @watch 0"
    }
   },
   {
    "box": {
     "id": "route",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 5,
     "patching_rect": [
      200,
      240,
      330,
      22
     ],
     "outlettype": [
      "",
      "",
      "",
      "",
      ""
     ],
     "text": "route live status needsInstall editorUrl"
    }
   },
   {
    "box": {
     "id": "prep_live",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      200,
      280,
      80,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "prepend live"
    }
   },
   {
    "box": {
     "id": "prep_set",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      290,
      280,
      80,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "status",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      290,
      380,
      230,
      20
     ],
     "text": "Starting\u2026",
     "presentation": 1,
     "presentation_rect": [
      8,
      30,
      244,
      20
     ],
     "fontsize": 11.0,
     "textcolor": [
      0.43,
      0.9,
      0.72,
      1.0
     ]
    }
   },
   {
    "box": {
     "id": "install_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "patching_rect": [
      380,
      280,
      40,
      22
     ],
     "outlettype": [
      "bang",
      "bang"
     ],
     "text": "t b b"
    }
   },
   {
    "box": {
     "id": "msg_npm",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      380,
      320,
      120,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "script npm install"
    }
   },
   {
    "box": {
     "id": "install_delay",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      520,
      320,
      80,
      22
     ],
     "outlettype": [
      "bang"
     ],
     "text": "delay 45000"
    }
   },
   {
    "box": {
     "id": "msg_restart",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      520,
      360,
      150,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "script stop, script start"
    }
   },
   {
    "box": {
     "id": "title",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      20,
      420,
      200,
      20
     ],
     "text": "PUSH 3 MIDI LITE",
     "presentation": 1,
     "presentation_rect": [
      8,
      6,
      200,
      20
     ],
     "fontsize": 12.0,
     "fontface": 1
    }
   },
   {
    "box": {
     "id": "btn_editor",
     "maxclass": "textbutton",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      20,
      460,
      70,
      22
     ],
     "outlettype": [
      "",
      "",
      "int"
     ],
     "text": "Editor",
     "presentation": 1,
     "presentation_rect": [
      8,
      58,
      76,
      24
     ],
     "texton": "Editor",
     "mode": 0,
     "fontsize": 11.0
    }
   },
   {
    "box": {
     "id": "btn_editor_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      20,
      495,
      30,
      22
     ],
     "outlettype": [
      "bang"
     ],
     "text": "t b"
    }
   },
   {
    "box": {
     "id": "btn_editor_lim",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      20,
      525,
      80,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "speedlim 800"
    }
   },
   {
    "box": {
     "id": "msg_open",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      20,
      560,
      260,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": ";\rmax launchbrowser http://127.0.0.1:47391/"
    }
   },
   {
    "box": {
     "id": "btn_browser",
     "maxclass": "textbutton",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      120,
      460,
      70,
      22
     ],
     "outlettype": [
      "",
      "",
      "int"
     ],
     "text": "Browser",
     "presentation": 1,
     "presentation_rect": [
      88,
      58,
      76,
      24
     ],
     "texton": "Browser",
     "mode": 0,
     "fontsize": 11.0
    }
   },
   {
    "box": {
     "id": "btn_browser_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      120,
      495,
      30,
      22
     ],
     "outlettype": [
      "bang"
     ],
     "text": "t b"
    }
   },
   {
    "box": {
     "id": "btn_browser_lim",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      120,
      525,
      80,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "speedlim 800"
    }
   },
   {
    "box": {
     "id": "msg_browser",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      120,
      560,
      260,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": ";\rmax launchbrowser http://127.0.0.1:47391/"
    }
   },
   {
    "box": {
     "id": "btn_restart",
     "maxclass": "textbutton",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      400,
      460,
      70,
      22
     ],
     "outlettype": [
      "",
      "",
      "int"
     ],
     "text": "Restart",
     "presentation": 1,
     "presentation_rect": [
      168,
      58,
      76,
      24
     ],
     "texton": "Restart",
     "mode": 0,
     "fontsize": 11.0
    }
   },
   {
    "box": {
     "id": "btn_restart_t",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      400,
      495,
      30,
      22
     ],
     "outlettype": [
      "bang"
     ],
     "text": "t b"
    }
   },
   {
    "box": {
     "id": "btn_restart_lim",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      400,
      525,
      80,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "speedlim 800"
    }
   },
   {
    "box": {
     "id": "msg_restart2",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      400,
      560,
      150,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "script stop, script start"
    }
   },
   {
    "box": {
     "id": "hint",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      20,
      640,
      240,
      40
     ],
     "text": "Postavke i mapiranje: Editor. Push: pritisni User.",
     "presentation": 1,
     "presentation_rect": [
      8,
      92,
      244,
      34
     ],
     "fontsize": 10.0,
     "textcolor": [
      0.6,
      0.62,
      0.66,
      1.0
     ],
     "linecount": 2
    }
   }
  ],
  "lines": [
   {
    "patchline": {
     "source": [
      "plugin",
      0
     ],
     "destination": [
      "plugout",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "plugin",
      1
     ],
     "destination": [
      "plugout",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "node",
      0
     ],
     "destination": [
      "route",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "route",
      1
     ],
     "destination": [
      "prep_set",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "prep_set",
      0
     ],
     "destination": [
      "status",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "route",
      2
     ],
     "destination": [
      "install_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "install_t",
      1
     ],
     "destination": [
      "msg_npm",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "msg_npm",
      0
     ],
     "destination": [
      "node",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "install_t",
      0
     ],
     "destination": [
      "install_delay",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "install_delay",
      0
     ],
     "destination": [
      "msg_restart",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "msg_restart",
      0
     ],
     "destination": [
      "node",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_editor",
      0
     ],
     "destination": [
      "btn_editor_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_editor_t",
      0
     ],
     "destination": [
      "btn_editor_lim",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_editor_lim",
      0
     ],
     "destination": [
      "msg_open",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_browser",
      0
     ],
     "destination": [
      "btn_browser_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_browser_t",
      0
     ],
     "destination": [
      "btn_browser_lim",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_browser_lim",
      0
     ],
     "destination": [
      "msg_browser",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_restart",
      0
     ],
     "destination": [
      "btn_restart_t",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_restart_t",
      0
     ],
     "destination": [
      "btn_restart_lim",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "btn_restart_lim",
      0
     ],
     "destination": [
      "msg_restart2",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "msg_restart2",
      0
     ],
     "destination": [
      "node",
      0
     ]
    }
   }
  ],
  "dependency_cache": [
   {
    "name": "p3um-lite.js",
    "type": "TEXT",
    "implicit": 1
   }
  ],
  "autosave": 0
 }
}