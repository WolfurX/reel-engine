"""Showreel 2 SFX: the canonical sound of each named cut, plus a hit on every element that lands. All synthesised."""
import json
from sfxlib import put, pop, ding, whoosh, click, riser, cut_sfx, save

cfg = json.load(open('project.json')); C = cfg['cuts']; S = [0.0] + C; B = json.load(open('beats.json'))['beats']
for t, sc in zip(C, cfg['scenes']):
    cut = sc['cut']; cut_sfx(cut if isinstance(cut, str) else cut['name'], t)
for k in range(3): put(B[k] - 0.18, pop(380 + 120 * k, 760 + 160 * k, 0.08, 0.32))      # S1 words land
put(1.6, pop(900, 1500, 0.06, 0.35)); put(1.75, riser(0.65, 0.08))                        # the dot, then the dive
for i in range(16): put(S[2] + 0.5 + i * 0.05, click(0.12))                               # S3 beat ticks
for k in range(12): put(S[2] + 0.3 + k * 0.08, click(0.1))                                 # BPM count-up
for i in range(6): put(S[3] + i * 0.1, pop(520 + 70 * i, 1000 + 70 * i, 0.06, 0.2))        # S4 tiles
put(S[3] + 0.7, pop(400, 900, 0.1, 0.35))                                                 # pop-in
for k in range(5): put(S[3] + 0.7 + (k + 1) / 7, click(0.22))                              # h-e-l-l-o
put(S[3] + 1.0, whoosh(0.4, 0.12, True))                                                  # particles
put(S[3] + 2.3, ding(1568, 0.6, 0.06))                                                    # count-up lands on 99
for k in range(40): put(S[4] + 0.25 + (k + 1) / 75 * 3, click(0.1)) if k % 2 == 0 else None   # typing the spec
put(S[4] + 1.6, ding(1318, 0.8, 0.08))                                                    # "You get the scene."
for i in range(30): put(S[5] + 0.5 + (i + 1) / 32, click(0.16))                            # typing the URL
put(17.0, ding(1760, 1.4, 0.1))
save('sfx.wav')
