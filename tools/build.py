"""Build one project end to end: validate the scene spec, measure the beat grid, render frames, synthesise SFX, mix, encode.
usage: python3 build.py <project_dir> [--from STEP] [--to STEP] [--K 6] [--workers 2]   steps: spec beats frames sfx mix
       python3 build.py <project_dir> --preview   -> only a few frames + preview/contact.png, before the full render
The project dir holds project.json (w, h, fps, dur, scenes, optional music / voice / cuts), index.html (the scenes; loads
the engine) and optionally sfx.py (cues; imports tools/sfxlib). Output: <project>/<name>.mp4, BT.709 tagged."""
import sys, os, json, re, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent; ENGINE = ROOT / 'engine'; TOOLS = ROOT / 'tools'
EP = pathlib.Path(sys.argv[1]).resolve()
cfg = json.load(open(EP / 'project.json')); name = cfg.get('name', EP.name)
DUR, FPS = float(cfg.get('dur', 10)), int(cfg.get('fps', 30)); NF = round(DUR * FPS)
STEPS = ['spec', 'beats', 'frames', 'sfx', 'mix']
opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
start, stop = STEPS.index(opt('--from', 'spec')), STEPS.index(opt('--to', 'mix'))
run = lambda k: start <= STEPS.index(k) <= stop
PY = os.environ.get('REEL_PY', sys.executable)   # the python that has playwright
RENDER = [PY, str(TOOLS / 'render.py'), str(EP), '--K', opt('--K', '6'), '--workers', opt('--workers', '2')]
def sh(*a, **kw): subprocess.run([str(x) for x in a], check=True, **kw)


def vocab(f):
    return json.loads(re.search(r'/\*VOCAB\*/(.*?)/\*END\*/', (ENGINE / f).read_text(), re.S).group(1))


def check_fx(fx, where):   # per-scene "fx" by NAME (fx.js VOCAB): unknown names, eases, strengths fail before any render
    if fx is None: return
    v = vocab('fx.js')
    key = lambda s: re.sub(r'[^a-z0-9]+', ' ', str(s).lower().replace('&', ' and ')).strip()
    names = {key(n): n for n in v['fx']} | {key(a): n for a, n in v['alias'].items()}
    eases = ['linear', 'in', 'out', 'inOut', 'smooth', 'back', 'overshoot', 'elastic', 'bounce']
    for k, f in enumerate(fx if isinstance(fx, list) else [fx]):
        f = {'fx': f} if isinstance(f, str) else f; w = f'{where}[{k}]'
        if key(f.get('fx', '')) in {key(c) for c in v['cuts']}: sys.exit(f'{w}: "{f["fx"]}" is a transition, write it as the scene\'s "cut"')
        if key(f.get('fx', '')) not in names: sys.exit(f'{w}: unknown fx "{f.get("fx")}". Known: ' + ', '.join(v['fx']))
        if 'ease' in f and f['ease'] not in eases: sys.exit(f'{w}: unknown ease "{f["ease"]}" ({", ".join(eases)})')
        if 'strength' in f and not isinstance(f['strength'], (int, float)) and f['strength'] not in ('soft', 'normal', 'strong'):
            sys.exit(f'{w}: unknown strength "{f["strength"]}"')
        if names[key(f['fx'])] == 'impact shake' and not f.get('target'): sys.exit(f'{w}: impact shake needs the "target" that lands')


def write_spec():   # per-scene "cam" / "cut" / "fx" by NAME -> spec.js (SPEC); unknown names fail here, before any render
    voc = vocab('moves.js')
    def ok(raw, kinds, where):
        k = re.sub(r'[_\s]+', ' ', str(raw).lower().strip()); k = voc['alias'].get(k, k).split(':')[0]
        if not any(k in voc[x] for x in kinds):
            sys.exit(f'{where}: unknown name "{raw}". Known: ' + ' | '.join(', '.join(voc[x]) for x in kinds))
    for i, sc in enumerate(cfg.get('scenes', []), 1):
        cams = sc.get('cam') or []
        for m in (cams if isinstance(cams, list) else [cams]): ok(m if isinstance(m, str) else m.get('move'), ['camera', 'time'], f'scene {i} cam')
        if sc.get('cut') is not None: ok(sc['cut'] if isinstance(sc['cut'], str) else sc['cut'].get('name'), ['cut'], f'scene {i} cut')
        check_fx(sc.get('fx'), f'scene {i} fx')
    (EP / 'spec.js').write_text('const SPEC = ' + json.dumps({'scenes': cfg.get('scenes', [])}, ensure_ascii=False) + ';\n')
    print('spec ok,', len(cfg.get('scenes', [])), 'scenes')


if run('spec') or '--preview' in sys.argv: write_spec()

if run('beats') and cfg.get('music'):
    sh(sys.executable, TOOLS / 'beats.py', EP)

if '--preview' in sys.argv:   # frame 0, then each planned cut +-0.15 s and every second; one contact sheet
    cuts = json.load(open(EP / 'beats.json'))['cuts'] if (EP / 'beats.json').exists() else cfg.get('cuts', [])
    picks = [(0.0, 'frame0')] + [(float(s), f'{s}s') for s in range(1, int(DUR))]
    for k, c in enumerate(cuts, 1): picks += [(c - 0.15, f'cut{k}-'), (c, f'cut{k}'), (c + 0.15, f'cut{k}+')]
    picks = sorted({(round(min(t, DUR - 1 / FPS) * FPS) / FPS, l) for t, l in picks})
    sh(*RENDER, '--only', ','.join(sorted({str(round(t * FPS)) for t, _ in picks})))
    (EP / 'preview').mkdir(exist_ok=True)
    sh(sys.executable, TOOLS / 'contact.py', EP, EP / 'preview/contact.png', *[f'{t:.3f}:{l}' for t, l in picks])
    sys.exit(0)

if run('frames'): sh(*RENDER)

if run('sfx') and (EP / 'sfx.py').exists():
    sh(sys.executable, EP / 'sfx.py', cwd=EP, env={**os.environ, 'REEL_DUR': str(DUR), 'PYTHONPATH': str(TOOLS)})


def duck_expr():   # sfxlib.duck() windows -> a music volume envelope; '' when none
    f = EP / 'duck.json'
    if not f.exists(): return ''
    e = '1'
    for a, b, g, r in json.load(open(f)):   # gain g on [a, b], linear ramps of r s
        e = f'min({e},1-(1-{g})*clip(min((t-{a - r})/{r},({b + r}-t)/{r}),0,1))'
    return f"volume='{e}':eval=frame,"


if run('mix'):
    ins, flt, mixin = [], [], []
    fmt = 'aformat=sample_rates=48000:channel_layouts=stereo'
    music, voice, sfx = cfg.get('music'), cfg.get('voice'), EP / 'sfx.wav'
    if music:
        ins += ['-i', EP / music]; mi = len(ins) // 2 - 1
        flt.append(f'[{mi}:a]atrim=0:{DUR},asetpts=PTS-STARTPTS,{fmt},volume={cfg.get("music_gain", 0.58)},{duck_expr()}'
                   f'afade=t=in:d=0.05,afade=t=out:st={max(0, DUR - 1.4)}:d=1.4[m]'); mixin.append('[m]')
    if voice:
        ins += ['-i', EP / voice]; vi = len(ins) // 2 - 1
        flt.append(f'[{vi}:a]{fmt},volume=1.25,asplit[v][vk]')
        if music: flt.append('[m][vk]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=300[md]'); mixin[-1] = '[md]'
        else: flt.append('[vk]anullsink')
        mixin.append('[v]')
    if sfx.exists():
        ins += ['-i', sfx]; si = len(ins) // 2 - 1
        flt.append(f'[{si}:a]{fmt},volume=0.7[s]'); mixin.append('[s]')
    out = EP / f'{name}.mp4'
    video = ['-framerate', str(FPS), '-i', EP / 'frames/%04d.png']
    venc = ['-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,format=yuv420p',
            '-c:v', 'libx264', '-crf', str(cfg.get('crf', 20)), '-preset', 'slow',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart']
    if mixin:
        flt.append(''.join(mixin) + f'amix=inputs={len(mixin)}:normalize=0,atrim=0:{DUR},loudnorm=I=-14:TP=-1.5:LRA=11[out]')
        sh('ffmpeg', '-y', '-loglevel', 'error', *ins, '-filter_complex', ';'.join(flt), '-map', '[out]', '-ar', '48000', EP / 'mix.wav')
        sh('ffmpeg', '-y', '-loglevel', 'error', *video, '-i', EP / 'mix.wav', *venc, '-c:a', 'aac', '-b:a', '192k', '-shortest', out)
    else:
        sh('ffmpeg', '-y', '-loglevel', 'error', *video, *venc, out)
    print('video', out, round(os.path.getsize(out) / 1e6, 1), 'MB')
