"""Demo SFX: the canonical sound of each named cut, plus hits on the fx. build.py runs this with tools/ on PYTHONPATH."""
import json
from sfxlib import put, pop, ding, cut_sfx, save

cfg = json.load(open('project.json'))
for t, sc in zip(cfg['cuts'], cfg['scenes']):
    cut = sc.get('cut')
    if cut: cut_sfx(cut if isinstance(cut, str) else cut['name'], t)
for k in range(11): put(0.1 + k / 14, pop(1400, 1700, 0.03, 0.08))   # typewriter keys
put(2.85, pop(500, 1100, 0.09, 0.4))                                  # label pops in
put(6.0, pop(400, 900, 0.12, 0.5)); put(6.1, ding(1760, 0.8, 0.12))  # end card
save('sfx.wav')
