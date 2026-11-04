// 組み立て の 見本データ（旧 墓石設計シミュレーターの 部材の 寸法・置き方・ノウハウ式・基準点）。単価は 入れない（公開リポジトリの ため）
window.KUMITATE_DATA = {
 "partsData": {
  "TOWER_VARIANTS": {
   "wa_8sun": {
    "label": "和型 8寸",
    "parts": {
     "shiba_mae": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6a",
      "name": "芝台(前)",
      "grp": "tower",
      "w": 850,
      "h": 150,
      "d": 240,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_R",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "shiba_ushiro": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6b",
      "name": "芝台(後)",
      "grp": "tower",
      "w": 850,
      "h": 150,
      "d": 180,
      "offX": -425,
      "offY": 0,
      "offZ": -440,
      "parent": null
     },
     "shiba_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6c",
      "name": "芝台(左)",
      "grp": "tower",
      "w": 180,
      "h": 150,
      "d": 520,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 0,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_ushiro",
       "dstSign": {
        "sx": 0,
        "sy": 0,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "shiba_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6d",
      "name": "芝台(右)",
      "grp": "tower",
      "w": 180,
      "h": 150,
      "d": 520,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_ushiro",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "nakadai": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "3",
      "name": "中台",
      "grp": "tower",
      "w": 600,
      "h": 300,
      "d": 600,
      "offX": 0,
      "offY": 0,
      "offZ": 100,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_ushiro",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0
       }
      }
     },
     "uedai": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "2",
      "name": "上台",
      "grp": "tower",
      "w": 420,
      "h": 270,
      "d": 420,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0.5
       },
       "dstKey": "nakadai",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0.5
       }
      }
     },
     "sao": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "1",
      "name": "竿",
      "grp": "tower",
      "w": 240,
      "h": 630,
      "d": 240,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0.5
       },
       "dstKey": "uedai",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0.5
       }
      }
     },
     "mizubachi": {
      "parentAnchor": "front_center",
      "childAnchor": "back_bottom",
      "visible": true,
      "no": "4",
      "name": "切出水鉢",
      "grp": "tower",
      "w": 485,
      "h": 275,
      "d": 155,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "nakadai",
       "dstSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 1
       }
      }
     },
     "haishi": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "9",
      "name": "拝石",
      "grp": "tower",
      "w": 690,
      "h": 45,
      "d": 360,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_mae",
       "dstSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "koro": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "5",
      "name": "香炉",
      "grp": "tower",
      "w": 300,
      "h": 210,
      "d": 150,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0.5
       },
       "dstKey": "haishi",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0.5
       }
      }
     }
    }
   },
   "wa_9sun": {
    "label": "和型 9寸",
    "parts": {
     "shiba_mae": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6a",
      "name": "芝台(前)",
      "grp": "tower",
      "w": 950,
      "h": 160,
      "d": 270,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 0,
        "sy": 1,
        "sz": 0
       },
       "dstKey": "shiba_L",
       "dstSign": {
        "sx": 0,
        "sy": 1,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "shiba_ushiro": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6b",
      "name": "芝台(後)",
      "grp": "tower",
      "w": 950,
      "h": 160,
      "d": 200,
      "offX": -475,
      "offY": 0,
      "offZ": -495,
      "parent": null
     },
     "shiba_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6c",
      "name": "芝台(左)",
      "grp": "tower",
      "w": 200,
      "h": 160,
      "d": 590,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 0,
        "sy": 1,
        "sz": 0
       },
       "dstKey": "shiba_ushiro",
       "dstSign": {
        "sx": 0,
        "sy": 1,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "shiba_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6d",
      "name": "芝台(右)",
      "grp": "tower",
      "w": 200,
      "h": 160,
      "d": 590,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_ushiro",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "nakadai": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "3",
      "name": "中台",
      "grp": "tower",
      "w": 660,
      "h": 330,
      "d": 660,
      "offX": 0,
      "offY": 0,
      "offZ": 150,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_ushiro",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0
       }
      }
     },
     "uedai": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "2",
      "name": "上台",
      "grp": "tower",
      "w": 460,
      "h": 300,
      "d": 460,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0.5
       },
       "dstKey": "nakadai",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0.5
       }
      }
     },
     "sao": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "1",
      "name": "竿",
      "grp": "tower",
      "w": 270,
      "h": 720,
      "d": 270,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0.5
       },
       "dstKey": "uedai",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0.5
       }
      }
     },
     "mizubachi": {
      "parentAnchor": "front_center",
      "childAnchor": "back_bottom",
      "visible": true,
      "no": "4",
      "name": "切出水鉢",
      "grp": "tower",
      "w": 530,
      "h": 300,
      "d": 170,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "nakadai",
       "dstSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 1
       }
      }
     },
     "haishi": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "9",
      "name": "拝石",
      "grp": "tower",
      "w": 750,
      "h": 50,
      "d": 400,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "shiba_mae",
       "dstSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 1
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "koro": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "5",
      "name": "香炉",
      "grp": "tower",
      "w": 330,
      "h": 240,
      "d": 165,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0.5,
        "sy": 0,
        "sz": 0.5
       },
       "dstKey": "haishi",
       "dstSign": {
        "sx": 0.5,
        "sy": 1,
        "sz": 0.5
       }
      }
     }
    }
   },
   "youkata": {
    "label": "洋型",
    "parts": {
     "shiba_mae": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6a",
      "name": "芝台(前)",
      "grp": "tower",
      "w": 900,
      "h": 150,
      "d": 270,
      "offX": -450,
      "offY": 0,
      "offZ": 285,
      "parent": null
     },
     "shiba_ushiro": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6b",
      "name": "芝台(後)",
      "grp": "tower",
      "w": 900,
      "h": 150,
      "d": 200,
      "offX": -450,
      "offY": 0,
      "offZ": -480,
      "parent": null
     },
     "shiba_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6c",
      "name": "芝台(左)",
      "grp": "tower",
      "w": 200,
      "h": 150,
      "d": 540,
      "offX": -450,
      "offY": 0,
      "offZ": -270,
      "parent": null
     },
     "shiba_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "6d",
      "name": "芝台(右)",
      "grp": "tower",
      "w": 200,
      "h": 150,
      "d": 540,
      "offX": 250,
      "offY": 0,
      "offZ": -270,
      "parent": null
     },
     "nakadai": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "3",
      "name": "下台",
      "grp": "tower",
      "w": 750,
      "h": 200,
      "d": 520,
      "offX": 0,
      "offY": 0,
      "offZ": -350,
      "parent": "shiba_mae"
     },
     "uedai": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "2",
      "name": "上台",
      "grp": "tower",
      "w": 660,
      "h": 120,
      "d": 420,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": "nakadai"
     },
     "sao": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "1",
      "name": "棹(洋型)",
      "grp": "tower",
      "w": 600,
      "h": 200,
      "d": 350,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": "uedai"
     },
     "mizubachi": {
      "parentAnchor": "front_center",
      "childAnchor": "back_bottom",
      "visible": true,
      "no": "4",
      "name": "切出水鉢",
      "grp": "tower",
      "w": 485,
      "h": 275,
      "d": 155,
      "offX": 0,
      "offY": -150,
      "offZ": 0,
      "parent": "nakadai"
     },
     "haishi": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "9",
      "name": "拝石",
      "grp": "tower",
      "w": 690,
      "h": 45,
      "d": 360,
      "offX": -345,
      "offY": 0,
      "offZ": 425,
      "parent": null
     },
     "koro": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "5",
      "name": "香炉",
      "grp": "tower",
      "w": 300,
      "h": 210,
      "d": 150,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": "haishi"
     }
    }
   }
  },
  "FENCE_VARIANTS": {
   "none": {
    "label": "なし",
    "parts": {}
   },
   "design1": {
    "label": "デザイン1",
    "parts": {
     "fence_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F1",
      "name": "外柵(左)",
      "grp": "fence",
      "w": 120,
      "h": 300,
      "d": 1600,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "fence_U",
       "dstSign": {
        "sx": 0,
        "sy": 0,
        "sz": 1
       }
      }
     },
     "fence_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F2",
      "name": "外柵(右)",
      "grp": "fence",
      "w": 120,
      "h": 300,
      "d": 1600,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       },
       "dstKey": "fence_U",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       }
      }
     },
     "fence_U": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F3",
      "name": "外柵(後)",
      "grp": "fence",
      "w": 1520,
      "h": 300,
      "d": 120,
      "offX": -760,
      "offY": 0,
      "offZ": -860,
      "parent": null
     },
     "part_mo06e360cctm": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "階段1",
      "grp": "tower",
      "w": 1280,
      "h": 150,
      "d": 200,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 0,
        "sy": 0,
        "sz": 1
       },
       "dstKey": "fence_L",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       }
      }
     },
     "part_mo06gqo7ne63": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "階段2",
      "grp": "tower",
      "w": 1280,
      "h": 300,
      "d": 150,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "customChildAnchor": null,
      "customParentAnchor": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       },
       "dstKey": "part_mo06e360cctm",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       }
      }
     }
    }
   },
   "design2": {
    "label": "デザイン2",
    "parts": {
     "fence_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F1",
      "name": "外柵(左)",
      "grp": "fence",
      "w": 150,
      "h": 400,
      "d": 1700,
      "offX": -800,
      "offY": 0,
      "offZ": -850,
      "parent": null
     },
     "fence_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F2",
      "name": "外柵(右)",
      "grp": "fence",
      "w": 150,
      "h": 400,
      "d": 1700,
      "offX": 650,
      "offY": 0,
      "offZ": -850,
      "parent": null
     },
     "fence_U": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F3",
      "name": "外柵(後)",
      "grp": "fence",
      "w": 1700,
      "h": 400,
      "d": 150,
      "offX": -850,
      "offY": 0,
      "offZ": -925,
      "parent": null
     },
     "pillar_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F4",
      "name": "親柱(左)",
      "grp": "fence",
      "w": 200,
      "h": 500,
      "d": 200,
      "offX": -850,
      "offY": 0,
      "offZ": 600,
      "parent": null
     },
     "pillar_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F5",
      "name": "親柱(右)",
      "grp": "fence",
      "w": 200,
      "h": 500,
      "d": 200,
      "offX": 650,
      "offY": 0,
      "offZ": 600,
      "parent": null
     }
    }
   },
   "with_stairs": {
    "label": "階段付き",
    "parts": {
     "fence_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F1",
      "name": "外柵(左)",
      "grp": "fence",
      "w": 150,
      "h": 400,
      "d": 1700,
      "offX": -800,
      "offY": 0,
      "offZ": -850,
      "parent": null
     },
     "fence_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F2",
      "name": "外柵(右)",
      "grp": "fence",
      "w": 150,
      "h": 400,
      "d": 1700,
      "offX": 650,
      "offY": 0,
      "offZ": -850,
      "parent": null
     },
     "fence_U": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F3",
      "name": "外柵(後)",
      "grp": "fence",
      "w": 1700,
      "h": 400,
      "d": 150,
      "offX": -850,
      "offY": 0,
      "offZ": -925,
      "parent": null
     },
     "pillar_L": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F4",
      "name": "親柱(左)",
      "grp": "fence",
      "w": 200,
      "h": 500,
      "d": 200,
      "offX": -850,
      "offY": 0,
      "offZ": 600,
      "parent": null
     },
     "pillar_R": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F5",
      "name": "親柱(右)",
      "grp": "fence",
      "w": 200,
      "h": 500,
      "d": 200,
      "offX": 650,
      "offY": 0,
      "offZ": 600,
      "parent": null
     },
     "kaidan": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "F6",
      "name": "階段",
      "grp": "fence",
      "w": 900,
      "h": 150,
      "d": 400,
      "offX": -450,
      "offY": 0,
      "offZ": 700,
      "parent": null
     }
    }
   }
  },
  "CRYPT_VARIANTS": {
   "ichi_dan": {
    "label": "1段",
    "parts": {
     "part_mo5b9gb7v5bx": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "前側",
      "grp": "tower",
      "w": 820,
      "h": 300,
      "d": 90,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null
     },
     "part_mo5b9hku4nrj": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "左側",
      "grp": "tower",
      "w": 90,
      "h": 300,
      "d": 900,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 0,
        "sy": 0,
        "sz": 1
       },
       "dstKey": "part_mo5b9gb7v5bx",
       "dstSign": {
        "sx": 0,
        "sy": 0,
        "sz": 0
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "part_mo5b9n4uvhij": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "右側",
      "grp": "tower",
      "w": 90,
      "h": 300,
      "d": 900,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       },
       "dstKey": "part_mo5b9gb7v5bx",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     },
     "part_mo5bbhlcnay0": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "後ろ側",
      "grp": "tower",
      "w": 820,
      "h": 300,
      "d": 90,
      "offX": 0,
      "offY": 0,
      "offZ": 0,
      "parent": null,
      "joint": {
       "srcSign": {
        "sx": 1,
        "sy": 0,
        "sz": 1
       },
       "dstKey": "part_mo5b9n4uvhij",
       "dstSign": {
        "sx": 1,
        "sy": 0,
        "sz": 0
       }
      },
      "customChildAnchor": null,
      "customParentAnchor": null
     }
    },
    "colorGroup": "custom",
    "stoneOverride": "aji"
   },
   "ni_dan": {
    "label": "2段",
    "parts": {}
   },
   "concrete": {
    "label": "コンクリート枡",
    "parts": {}
   }
  },
  "BOSHI_VARIANTS": {
   "none": {
    "label": "なし",
    "parts": {}
   },
   "ari": {
    "label": "墓誌あり",
    "parts": {
     "boshi": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "墓誌",
      "grp": "other",
      "w": 60,
      "h": 720,
      "d": 700,
      "offX": 365,
      "offY": 0,
      "offZ": -205,
      "parent": null
     }
    }
   }
  },
  "TOBA_VARIANTS": {
   "none": {
    "label": "なし"
   },
   "sekizai": {
    "label": "石材",
    "parts": {
     "tobabashira": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "T1",
      "name": "塔婆立(石)",
      "grp": "other",
      "w": 150,
      "h": 900,
      "d": 150,
      "offX": -450,
      "offY": 0,
      "offZ": 0,
      "parent": null
     },
     "part_mo2wm6cpkih9": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "-",
      "name": "塔婆立（右）",
      "grp": "tower",
      "w": 150,
      "h": 900,
      "d": 150,
      "offX": 300,
      "offY": 0,
      "offZ": 0,
      "parent": null
     }
    },
    "colorGroup": "fence"
   },
   "stainless": {
    "label": "ステンレス",
    "parts": {
     "tobabashira": {
      "parentAnchor": "top_center",
      "childAnchor": "bottom_center",
      "visible": true,
      "no": "T2",
      "name": "塔婆立(SUS)",
      "grp": "other",
      "w": 80,
      "h": 600,
      "d": 80,
      "offX": -340,
      "offY": 0,
      "offZ": 310,
      "parent": null
     }
    }
   }
  },
  "EDIT_SELECTIONS": [
   {
    "id": "tower_wa_8sun",
    "label": "石塔 ー 和型8寸",
    "varType": "tower",
    "varKey": "wa_8sun"
   },
   {
    "id": "tower_wa_9sun",
    "label": "石塔 ー 和型9寸",
    "varType": "tower",
    "varKey": "wa_9sun"
   },
   {
    "id": "tower_youkata",
    "label": "石塔 ー 洋型",
    "varType": "tower",
    "varKey": "youkata"
   },
   {
    "id": "fence_design1",
    "label": "外柵 ー デザイン1",
    "varType": "fence",
    "varKey": "design1"
   },
   {
    "id": "fence_design2",
    "label": "外柵 ー デザイン2",
    "varType": "fence",
    "varKey": "design2"
   },
   {
    "id": "fence_stairs",
    "label": "外柵 ー 階段付き",
    "varType": "fence",
    "varKey": "with_stairs"
   },
   {
    "id": "crypt_1dan",
    "label": "納骨室 ー 1段",
    "varType": "crypt",
    "varKey": "ichi_dan"
   },
   {
    "id": "crypt_2dan",
    "label": "納骨室 ー 2段",
    "varType": "crypt",
    "varKey": "ni_dan"
   },
   {
    "id": "crypt_concrete",
    "label": "納骨室 ー コンクリート枡",
    "varType": "crypt",
    "varKey": "concrete"
   },
   {
    "id": "toba_sekizai",
    "label": "塔婆立 ー 石材",
    "varType": "toba",
    "varKey": "sekizai"
   },
   {
    "id": "toba_stainless",
    "label": "塔婆立 ー ステンレス",
    "varType": "toba",
    "varKey": "stainless"
   },
   {
    "id": "acc_boshi",
    "label": "付属品 ー 墓誌",
    "varType": "boshi",
    "varKey": "ari"
   }
  ]
 },
 "knowhow": [
  {
   "id": "mo2n9xb8lqyc",
   "type": "dim_calc",
   "name": "見積ページ対応　敷地→土留",
   "order": 1,
   "targets": [
    {
     "selId": "fence_design1",
     "partKey": "fence_U",
     "dim": "w",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "part_mo06gqo7ne63",
     "dim": "w",
     "formulaNo": 2
    },
    {
     "selId": "fence_design1",
     "partKey": "part_mo06e360cctm",
     "dim": "w",
     "formulaNo": 2
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_L",
     "dim": "d",
     "formulaNo": 3
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_R",
     "dim": "d",
     "formulaNo": 3
    }
   ],
   "exprText": "敷地W（間口）-20",
   "towerFilter": "all",
   "memo": "",
   "enabled": true,
   "formulas": [
    {
     "no": 1,
     "expr": "敷地W（間口）-20"
    },
    {
     "no": 2,
     "expr": "敷地W（間口）-20-土留め厚み*2"
    },
    {
     "no": 3,
     "expr": "敷地D（奥行）-土留め厚み"
    }
   ]
  },
  {
   "id": "mo29t7s2dhxs",
   "type": "dim_calc",
   "name": "見積ページ対応　土留幅",
   "order": 2,
   "targets": [
    {
     "selId": "fence_design1",
     "partKey": "fence_U",
     "dim": "d",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_L",
     "dim": "w",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_R",
     "dim": "w",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "part_mo06e360cctm",
     "dim": "w",
     "formulaNo": 2
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_L",
     "dim": "d",
     "formulaNo": 3
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_R",
     "dim": "d",
     "formulaNo": 3
    },
    {
     "selId": "toba_sekizai",
     "partKey": "tobabashira",
     "dim": "d",
     "formulaNo": 1
    },
    {
     "selId": "toba_sekizai",
     "partKey": "part_mo2wm6cpkih9",
     "dim": "d",
     "formulaNo": 1
    }
   ],
   "exprText": "土留め厚み",
   "towerFilter": "all",
   "memo": "",
   "enabled": true,
   "formulas": [
    {
     "no": 1,
     "expr": "土留め厚み"
    },
    {
     "no": 2,
     "expr": "敷地W（間口）-20-土留め厚み*2"
    },
    {
     "no": 3,
     "expr": "敷地D（奥行）-20-土留め厚み"
    }
   ]
  },
  {
   "id": "mo2a9gwubbrx",
   "type": "dim_calc",
   "name": "見積ページ対応　土留高変更",
   "order": 3,
   "targets": [
    {
     "selId": "fence_design1",
     "partKey": "fence_L",
     "dim": "h",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_R",
     "dim": "h",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "fence_U",
     "dim": "h",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "part_mo06gqo7ne63",
     "dim": "h",
     "formulaNo": 1
    },
    {
     "selId": "fence_design1",
     "partKey": "part_mo06e360cctm",
     "dim": "h",
     "formulaNo": 2
    }
   ],
   "exprText": "土留め高さ",
   "towerFilter": "all",
   "memo": "",
   "enabled": true,
   "formulas": [
    {
     "no": 1,
     "expr": "土留め高さ"
    },
    {
     "no": 2,
     "expr": "土留め高さ/2"
    }
   ]
  },
  {
   "id": "mo2u6adu57ee",
   "type": "pos_calc",
   "name": "新しい位置計算ルール",
   "order": 6,
   "srcSelId": "tower_wa_8sun",
   "srcAnchor": "a1",
   "srcPartKeys": [
    "shiba_mae",
    "shiba_ushiro",
    "shiba_L",
    "shiba_R",
    "nakadai",
    "uedai",
    "sao",
    "mizubachi",
    "haishi",
    "koro"
   ],
   "dstSelId": "fence_design1",
   "dstAnchor": "a1",
   "offsetX": 0,
   "offsetY": 0,
   "offsetZ": 0,
   "towerFilter": "all",
   "memo": "",
   "enabled": true,
   "offsetYExpr": "土留め高さ",
   "offsetZExpr": "土留め厚み"
  },
  {
   "id": "mo2wpx5cbfw7",
   "type": "pos_calc",
   "name": "デザイン１土留と塔婆立",
   "order": 7,
   "srcSelId": "toba_sekizai",
   "srcAnchor": "a1",
   "srcPartKeys": [
    "tobabashira",
    "part_mo2wm6cpkih9"
   ],
   "dstSelId": "fence_design1",
   "dstAnchor": "a1",
   "offsetXExpr": "",
   "offsetYExpr": "土留め高さ",
   "offsetZExpr": "",
   "towerFilter": "all",
   "memo": "",
   "enabled": true
  },
  {
   "id": "mo5k7ovrwe3g",
   "type": "pos_calc",
   "name": "石塔8寸と納骨室1段",
   "order": 8,
   "srcSelId": "crypt_1dan",
   "srcAnchor": "a1",
   "srcPartKeys": [
    "part_mo5b9gb7v5bx",
    "part_mo5b9hku4nrj",
    "part_mo5b9n4uvhij",
    "part_mo5bbhlcnay0"
   ],
   "dstSelId": "tower_wa_8sun",
   "dstAnchor": "a2",
   "offsetXExpr": "",
   "offsetYExpr": "",
   "offsetZExpr": "300\n",
   "towerFilter": "all",
   "memo": "",
   "enabled": true
  }
 ],
 "anchors": {
  "tower_wa_8sun": {
   "a1": {
    "name": "芝台　後ろ　中心",
    "x": 0,
    "y": 0,
    "z": -440,
    "partKey": null,
    "sign": null
   },
   "a2": {
    "name": "芝台前中心",
    "x": 0,
    "y": 0,
    "z": 500
   }
  },
  "fence_design1": {
   "a1": {
    "name": "テスト",
    "x": 0,
    "y": 0,
    "z": -860,
    "partKey": null,
    "sign": null,
    "yExpr": ""
   }
  },
  "toba_sekizai": {
   "a1": {
    "x": 0,
    "y": 0,
    "z": 0,
    "name": "後ろ側中心",
    "partKey": null,
    "sign": null
   }
  },
  "crypt_1dan": {
   "a1": {
    "x": 410,
    "y": 300,
    "z": 0,
    "partKey": null,
    "sign": null,
    "name": "開口部　前　中央"
   },
   "a2": {
    "x": 410,
    "y": 300,
    "z": -990,
    "partKey": null,
    "sign": null
   }
  },
  "tower_wa_9sun": {
   "a1": {
    "x": 0,
    "y": 0,
    "z": -495,
    "name": "芝台　後ろ中心",
    "partKey": "shiba_ushiro",
    "sign": {
     "sx": 0.5,
     "sy": 0,
     "sz": 0
    }
   },
   "a2": {
    "x": 0,
    "y": 0,
    "z": 565,
    "name": "芝台　前中心",
    "partKey": "shiba_mae",
    "sign": {
     "sx": 0.5,
     "sy": 0,
     "sz": 1
    }
   }
  }
 }
};
