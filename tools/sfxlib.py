"""Synthesised SFX: no samples, nothing licensed. A project's sfx.py imports this, calls put(t, sound) / cut_sfx(name, t),
then save(). cut_sfx(name, t) = the canonical sound of each named cut; span() moves a scene's ambience for J/L-cuts;
duck(a, b, gain) asks the mix to dip the music (written to duck.json beside the wav by save())."""
import numpy as np, wave, os
SR = 48000; DUR = float(os.environ.get('REEL_DUR', 20.0))  # build.py passes project.json 'dur'
bed = np.zeros(int(SR * DUR))
rng = np.random.default_rng(7)
def env(n, a=0.004, r=0.08):
    t = np.arange(n) / SR; e = np.minimum(1, t / a) * np.exp(-t / r); return e
def pop(f0=500, f1=1100, d=0.09, v=0.5):
    n = int(SR * d); t = np.arange(n) / SR; f = np.linspace(f0, f1, n)
    return v * np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, d / 3)
def ding(f=1760, d=0.6, v=0.28):
    n = int(SR * d); t = np.arange(n) / SR
    return v * (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.01 * t)) * env(n, 0.002, d / 4)
def whoosh(d=0.35, v=0.35, up=True):
    n = int(SR * d); x = rng.standard_normal(n); out = np.zeros(n); y = 0
    cut = np.linspace(0.02, 0.25, n) if up else np.linspace(0.25, 0.02, n)
    for i in range(n): y += cut[i] * (x[i] - y); out[i] = y
    return v * out * np.sin(np.linspace(0, np.pi, n)) * 2.2
def click(v=0.4):
    n = int(SR * 0.03); return v * rng.standard_normal(n) * env(n, 0.0005, 0.006)
def riser(d=0.95, v=0.22):
    n = int(SR * d); t = np.arange(n) / SR; f = 300 * np.power(4, t / d)
    return v * np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / d) ** 1.5
def boom(v=0.6):
    n = int(SR * 0.5); t = np.arange(n) / SR; f = np.linspace(140, 45, n)
    return v * np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.003, 0.14) + whoosh(0.5, 0.25, False)
def put(t, s):
    i = int(t * SR)
    if i >= len(bed): return  # past the end
    if i < 0: s, i = s[-i:], 0
    bed[i:i + len(s)] += s[:len(bed) - i]

def rumble(d, v=0.25):
    n = int(SR * d); x = rng.standard_normal(n); out = np.zeros(n); y = 0
    for i in range(n): y += 0.012 * (x[i] - y); out[i] = y
    return v * out * 9 * np.minimum(1, np.minimum(np.arange(n) / (SR * 0.3), (n - np.arange(n)) / (SR * 0.4)))

DUCKS = []
def duck(a, b, gain=0.3, ramp=0.15): DUCKS.append([round(a, 3), round(b, 3), gain, ramp])
def span(a, b, cut_in=None, cut_out=None, lead=0.5):
    """Ambience window of a scene [a, b): a J-cut INTO it starts its sound `lead` s early, an L-cut OUT of it lets it trail."""
    n = lambda c: (c if isinstance(c, str) else (c or {}).get('name', '')).lower().replace(' ', '-') if c else ''
    return (a - lead if n(cut_in) == 'j-cut' else a, b + lead if n(cut_out) == 'l-cut' else b)
def cut_sfx(name, t, v=1.0):
    """The canonical sound of a named cut at cut time t (J/L-cuts are carried by span(), not a hit)."""
    k = name.lower().replace('-', ' ')
    if k == 'whip pan': put(t - 0.26, whoosh(0.5, 0.42 * v, True)); put(t - 0.02, whoosh(0.3, 0.3 * v, False))
    elif k == 'smash cut': duck(t - 0.45, t - 0.02, 0.0, 0.08); put(t, boom(0.75 * v)); put(t, click(0.6 * v))
    elif k == 'jump cut': put(t, click(0.45 * v)); put(t, pop(900, 600, 0.05, 0.12 * v))
    elif k == 'match cut': put(t - 0.05, ding(1318, 1.2, 0.09 * v)); put(t, ding(1975, 1.0, 0.05 * v))
    elif k == 'cross dissolve': put(t - 0.3, riser(0.6, 0.06 * v)); put(t, ding(1568, 0.9, 0.04 * v))
    elif k == 'wipe': put(t - 0.22, whoosh(0.45, 0.22 * v, True))
    elif k in ('cut', 'zoom through'): put(t - 0.08, whoosh(0.32, 0.18 * v))
    elif k == 'mask transition': put(t - 0.3, riser(0.45, 0.07 * v)); put(t - 0.25, whoosh(0.5, 0.16 * v, True)); put(t + 0.22, ding(1568, 0.8, 0.06 * v))
    elif k == 'shape transition': put(t - 0.34, whoosh(0.42, 0.26 * v, True)); put(t + 0.0, whoosh(0.4, 0.22 * v, False))
    elif k == 'liquid transition': put(t - 0.32, rumble(0.7, 0.16 * v)); [put(t - 0.25 + j * 0.09, pop(520 - 50 * j, 180, 0.12, 0.13 * v)) for j in range(6)]
    elif k == 'flip': put(t - 0.18, whoosh(0.3, 0.2 * v, True)); put(t - 0.01, click(0.5 * v)); put(t + 0.2, click(0.35 * v)); put(t + 0.2, pop(300, 160, 0.08, 0.12 * v))
    elif k == 'glitch': put(t - 0.15, buzz(0.3, 0.16 * v))

def buzz(d=0.3, v=0.15, seed=3):
    """Digital glitch: a square-ish buzz chopped into 24 Hz on/off slices with noise bursts."""
    n = int(SR * d); t = np.arange(n) / SR; r = np.random.default_rng(seed)
    gate = np.repeat(r.random(int(d * 24) + 2) > 0.35, SR // 24)[:n]; f = np.repeat(r.choice([90, 140, 220, 330], int(d * 24) + 2), SR // 24)[:n]
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.6 + r.standard_normal(n) * 0.4
    return v * x * gate * np.minimum(1, np.minimum(t / 0.005, (d - t) / 0.02))

def save(path='sfx.wav'):
    if DUCKS:
        import json; json.dump(DUCKS, open(os.path.join(os.path.dirname(os.path.abspath(path)), 'duck.json'), 'w'))
    out = np.clip(bed, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32000).astype(np.int16).tobytes())
