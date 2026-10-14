"""Measure the music's beat grid and snap planned cuts to it.
usage: python3 beats.py <project_dir>   -> beats.json + beats.js (BEATS, CUTS) in the project dir
Reads project.json: "music" (audio file, relative to the project), "dur", and optional "cuts" (planned cut times in s).
Tempo from spectral-flux autocorrelation (85-140 BPM); phase from the kick (low-band onset folded over one period),
because flux sits ~50-80 ms early. Each planned cut snaps to the nearest beat within 0.25 s. If the grid is weak
(no steady kick) the cuts stay where they were planned and it says so."""
import sys, json, subprocess, pathlib
import numpy as np

EP = pathlib.Path(sys.argv[1]).resolve(); SR = 22050
cfg = json.load(open(EP / 'project.json')); DUR = float(cfg.get('dur', 10.0)); END = DUR + 0.3
MUSIC = EP / cfg['music']
pcm = lambda *af: np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(MUSIC), '-t', str(END), '-ac', '1', '-ar', str(SR), *af, '-f', 'f32le', '-']), np.float32)
x = pcm(); hop, n = 256, 1024
fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
flux = np.maximum(0, np.diff(np.log1p(np.abs(np.fft.rfft(fr, axis=1))), axis=0)).sum(1); flux = (flux - flux.mean()) / (flux.std() + 1e-9)
fps = SR / hop; ac = np.correlate(flux, flux, 'full')[len(flux) - 1:]
lags = np.arange(len(ac)) / fps; ok = (lags > 60 / 140) & (lags < 60 / 85)
per = np.argmax(np.where(ok, ac, -np.inf)) / fps; bpm = 60 / per
lo = pcm('-af', 'lowpass=f=150'); env = np.sqrt(np.convolve(lo ** 2, np.ones(64) / 64, 'same'))[::64]
on = np.maximum(0, np.diff(env)); tt = np.arange(1, len(env)) * 64 / SR
bins = np.linspace(0, per, 49); prof = np.array([on[((tt % per) >= bins[i]) & ((tt % per) < bins[i + 1])].mean() for i in range(48)])
p0 = float(bins[int(np.argmax(prof))])
beats = [round(p0 + k * per, 3) for k in range(int(END / per) + 1) if p0 + k * per < END]
rms = lambda t: float(np.sqrt(np.mean(lo[int(t * SR):int((t + 0.06) * SR)] ** 2) + 1e-12))
ratio = np.mean([rms(b) for b in beats[:-1]]) / np.mean([rms(b + per / 2) for b in beats[:-1]])
strong = ratio >= 2.0
cuts = []
for c in cfg.get('cuts', []):
    near = [b for b in beats if abs(b - c) <= 0.25] if strong else []
    cuts.append(round(float(min(near, key=lambda b: abs(b - c))), 3) if near else c)
json.dump({'bpm': round(bpm, 2), 'period': round(per, 4), 'phase': round(p0, 3), 'kick_ratio': round(float(ratio), 2),
           'grid': 'beat' if strong else 'weak', 'beats': beats, 'cuts': cuts}, open(EP / 'beats.json', 'w'), indent=1)
open(EP / 'beats.js', 'w').write(f'const BEATS = {json.dumps(beats)};\nconst CUTS = {json.dumps(cuts)};\n')
print(f'beats: {bpm:.1f} BPM, phase {p0:.3f}, kick on/off-beat {ratio:.1f}x, cuts {cuts}'
      + ('' if strong else '\nWARNING weak beat grid (no steady kick): cuts stay as planned; hits can still use BEATS loosely'))
