"""The data scene's numbers: this soundtrack's own loudness envelope, first 8 s, 96 points, normalised -> data.js.
usage: python3 data.py   (run in this folder; needs ffmpeg and numpy)"""
import subprocess, json
import numpy as np

SR = 8000
x = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', 'music.mp3', '-t', '8', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']), np.float32)
n = 96; seg = len(x) // n
env = np.array([np.sqrt(np.mean(x[i * seg:(i + 1) * seg] ** 2)) for i in range(n)]); env = env / env.max()
open('data.js', 'w').write(f'const ENV = {json.dumps([round(float(v), 3) for v in env])};\nconst ENV_DUR = {n * seg / SR:.3f};\n')
print('env', len(env), round(n * seg / SR, 3))
