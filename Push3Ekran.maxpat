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
   800.0,
   520.0
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
     "id": "js",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      200,
      200,
      160,
      22
     ],
     "outlettype": [
      "",
      "",
      ""
     ],
     "text": "js p3um-screen.js"
    }
   },
   {
    "box": {
     "id": "thisdev",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      200,
      20,
      100,
      22
     ],
     "outlettype": [
      "bang",
      "int",
      "int"
     ],
     "text": "live.thisdevice"
    }
   },
   {
    "box": {
     "id": "msg_start",
     "maxclass": "message",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      200,
      60,
      40,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "start"
    }
   },
   {
    "box": {
     "id": "r_screen",
     "maxclass": "newobj",
     "numinlets": 0,
     "numoutlets": 1,
     "patching_rect": [
      320,
      20,
      110,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "r p3um_screen"
    }
   },
   {
    "box": {
     "id": "prep_screen",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      320,
      60,
      100,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "prepend screen"
    }
   },
   {
    "box": {
     "id": "s_req",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      480,
      240,
      130,
      22
     ],
     "text": "s p3um_screen_req"
    }
   },
   {
    "box": {
     "id": "lcd",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "patching_rect": [
      200,
      260,
      160,
      22
     ],
     "outlettype": [
      "jit_matrix",
      ""
     ],
     "text": "jit.lcd 4 char 960 160"
    }
   },
   {
    "box": {
     "id": "alpha",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      200,
      300,
      220,
      22
     ],
     "outlettype": [
      "jit_matrix",
      ""
     ],
     "text": "jit.op @op max pass pass pass @val 255"
    }
   },
   {
    "box": {
     "id": "push",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      200,
      380,
      70,
      22
     ],
     "text": "live.push"
    }
   },
   {
    "box": {
     "id": "preview",
     "maxclass": "jit.pwindow",
     "numinlets": 1,
     "numoutlets": 2,
     "patching_rect": [
      440,
      300,
      240,
      40
     ],
     "outlettype": [
      "jit_matrix",
      ""
     ],
     "presentation": 1,
     "presentation_rect": [
      8,
      52,
      246,
      41
     ]
    }
   },
   {
    "box": {
     "id": "clear",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 2,
     "patching_rect": [
      380,
      340,
      220,
      22
     ],
     "outlettype": [
      "jit_matrix",
      ""
     ],
     "text": "jit.matrix ---ekranclear 4 char 960 160"
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
     "text": "PUSH 3 EKRAN",
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
     "id": "hint",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      20,
      450,
      240,
      34
     ],
     "text": "Ekran u User Modeu (podaci iz Lite devicea). Test = probna slika.",
     "presentation": 1,
     "presentation_rect": [
      8,
      96,
      246,
      30
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
   },
   {
    "box": {
     "id": "enable",
     "maxclass": "live.toggle",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      600,
      20,
      15,
      15
     ],
     "outlettype": [
      ""
     ],
     "presentation": 1,
     "presentation_rect": [
      8,
      30,
      15,
      15
     ],
     "parameter_enable": 1,
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_enum": [
        "off",
        "on"
       ],
       "parameter_initial": [
        1
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Ekran",
       "parameter_mmax": 1,
       "parameter_shortname": "Ekran",
       "parameter_type": 2
      }
     },
     "varname": "Ekran"
    }
   },
   {
    "box": {
     "id": "enable_lbl",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      620,
      20,
      50,
      20
     ],
     "text": "Ekran",
     "presentation": 1,
     "presentation_rect": [
      26,
      28,
      50,
      20
     ],
     "fontsize": 11.0
    }
   },
   {
    "box": {
     "id": "prep_enable",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      600,
      60,
      90,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "prepend enable"
    }
   },
   {
    "box": {
     "id": "test",
     "maxclass": "toggle",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      700,
      20,
      20,
      20
     ],
     "outlettype": [
      "int"
     ],
     "presentation": 1,
     "presentation_rect": [
      90,
      28,
      18,
      18
     ]
    }
   },
   {
    "box": {
     "id": "test_lbl",
     "maxclass": "comment",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      725,
      20,
      50,
      20
     ],
     "text": "Test",
     "presentation": 1,
     "presentation_rect": [
      110,
      28,
      60,
      20
     ],
     "fontsize": 11.0
    }
   },
   {
    "box": {
     "id": "prep_test",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      700,
      60,
      80,
      22
     ],
     "outlettype": [
      ""
     ],
     "text": "prepend test"
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
      "thisdev",
      0
     ],
     "destination": [
      "msg_start",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "msg_start",
      0
     ],
     "destination": [
      "js",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "r_screen",
      0
     ],
     "destination": [
      "prep_screen",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "prep_screen",
      0
     ],
     "destination": [
      "js",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "js",
      2
     ],
     "destination": [
      "s_req",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "js",
      0
     ],
     "destination": [
      "lcd",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "lcd",
      0
     ],
     "destination": [
      "alpha",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "alpha",
      0
     ],
     "destination": [
      "push",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "alpha",
      0
     ],
     "destination": [
      "preview",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "js",
      1
     ],
     "destination": [
      "clear",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "clear",
      0
     ],
     "destination": [
      "push",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "enable",
      0
     ],
     "destination": [
      "prep_enable",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "prep_enable",
      0
     ],
     "destination": [
      "js",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "test",
      0
     ],
     "destination": [
      "prep_test",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "prep_test",
      0
     ],
     "destination": [
      "js",
      0
     ]
    }
   }
  ],
  "dependency_cache": [
   {
    "name": "p3um-screen.js",
    "type": "TEXT",
    "implicit": 1
   }
  ],
  "autosave": 0
 }
}