"""Check a project without looking at every frame: text inside the safe box, then the rendered MP4.
usage: python3 qc.py <project_dir> [--platform tiktok] [--safe x0,y0,x1,y1] [--K 2] [--no-video]
Exit code 1 when a check fails, so an agent can run it and read one image instead of re-reading frames.

Text: the preview times (frame 0, every second, each planned cut +-0.15 s, the same picks as build.py --preview) are rendered
twice in headless Chrome, once as is and once with every SVG <text> removed. The pixels that differ are where the text really
lands after camera moves, warps and fx; any of them outside the safe box fails (a warning within 0.2 s of a planned cut,
where a transition may carry text off frame on purpose). <project>/preview/qc.png shows each frame with the safe box (green)
and the text box (yellow, red when out). Text drawn as paths is not seen. Decoration that sits outside the box on
purpose (a masthead, background type) carries data-noqc="1" on its <text> and is skipped.
Safe box: the page's SAFE (6% / 7% margins unless the page sets one). --platform tiktok uses the TikTok / Reels / Shorts UI
zones of a vertical frame (left 60, top 130, right 140, bottom 484 px at 1080x1920, scaled). --safe takes frame fractions.
Video (when <project>/<name>.mp4 exists): duration within 0.1 s of "dur"; no black stretch of 0.25 s or more (warning
only when it touches the last 0.5 s, a fade-out); frozen stretches of 1.5 s or more are warnings; integrated loudness is
reported (build.py mixes to -14 LUFS, outside -16..-12 is a warning).
Writes <project>/preview/qc.json. Run it with the Python that has Playwright (REEL_PY), like render.py."""
import sys, os, io, re, json, base64, subprocess, pathlib
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

args = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and not sys.argv[i - 1] in ('--platform', '--safe', '--K')]
opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
EP = pathlib.Path(args[0]).resolve()
cfg = json.load(open(EP / 'project.json')); name = cfg.get('name', EP.name)
W, H, FPS = int(cfg.get('w', 1080)), int(cfg.get('h', 1920)), int(cfg.get('fps', 30))
DUR = float(cfg.get('dur', 10)); K = int(opt('--K', 2))
CANDIDATES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
              '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
CHROME = os.environ.get('CHROME') or next((c for c in CANDIDATES if os.path.exists(c)), None)
STRIP = r"() => { const o = window.svgAt; window.svgAt = t => o(t).replace(/<text\b(?![^>]*\bdata-noqc=)[\s\S]*?<\/text>/g, ''); }"
fails, warns = [], []


CUTS = json.load(open(EP / 'beats.json'))['cuts'] if (EP / 'beats.json').exists() else cfg.get('cuts', [])


def picks():   # build.py --preview's times, as frame indices
    cuts = CUTS
    ps = [(0.0, 'frame0')] + [(float(s), f'{s}s') for s in range(1, int(DUR))]
    for k, c in enumerate(cuts, 1): ps += [(c - 0.15, f'cut{k}-'), (c, f'cut{k}'), (c + 0.15, f'cut{k}+')]
    out = {}
    for t, l in sorted(ps): out.setdefault(round(min(max(t, 0), DUR - 1 / FPS) * FPS), l)
    return sorted(out.items())


def safe_box(page_safe):
    if '--safe' in sys.argv:
        f = [float(v) for v in opt('--safe', '').split(',')]
        return {'x0': f[0] * W, 'y0': f[1] * H, 'x1': f[2] * W, 'y1': f[3] * H, 'from': '--safe'}
    if opt('--platform', '') == 'tiktok':
        if H <= W: sys.exit('--platform tiktok expects a vertical frame (h > w)')
        sx, sy = W / 1080, H / 1920
        return {'x0': 60 * sx, 'y0': 130 * sy, 'x1': W - 140 * sx, 'y1': H - 484 * sy, 'from': 'tiktok'}
    return {**page_safe, 'from': 'page SAFE'}


def render_pairs(frames):   # [(i, with_text, without_text)], one browser
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=['--force-device-scale-factor=1', '--hide-scrollbars',
                              '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-breakpad', '--disable-crash-reporter'])
        pg = b.new_page(viewport={'width': W, 'height': H}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('file://' + str(EP / 'index.html')); pg.wait_for_timeout(300)
        if errs: sys.exit(f'page error on load: {errs[:2]}')
        cdp = pg.context.new_cdp_session(pg)
        def shot(i):
            pg.evaluate(f'renderFrame({i}, {K})')
            png = base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png'})['data'])
            return Image.open(io.BytesIO(png)).convert('RGB')
        page_safe = pg.evaluate('({x0: SAFE.x0, y0: SAFE.y0, x1: SAFE.x1, y1: SAFE.y1})')
        full = [shot(i) for i in frames]
        pg.evaluate(STRIP)
        bare = [shot(i) for i in frames]
        if errs: sys.exit(f'page error while rendering: {errs[:2]}')
        b.close()
    return page_safe, list(zip(frames, full, bare))


def text_check():
    if cfg.get('scenes') and not (EP / 'spec.js').exists(): sys.exit('no spec.js yet: run tools/build.py <project> --preview first')
    pk = picks(); page_safe, pairs = render_pairs([i for i, _ in pk])
    S = safe_box(page_safe); rows = []
    for (i, label), (_, a, b) in zip(pk, pairs):
        mask = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MinFilter(3))
        box = mask.getbbox()
        over = {} if not box else {k: round(v) for k, v in (('left', S['x0'] - box[0]), ('top', S['y0'] - box[1]),
                                                            ('right', box[2] - S['x1']), ('bottom', box[3] - S['y1'])) if v > 1}
        rows.append({'t': round(i / FPS, 3), 'label': label, 'text_box': box, 'out': bool(over), 'over_px': over, 'img': a})
        if over:
            near = any(abs(i / FPS - c) <= 0.2 for c in CUTS)
            (warns if near else fails).append(f'text outside the safe box at {i / FPS:.2f}s ({label}): ' + ', '.join(f'{k} {v}px' for k, v in over.items())
                                              + (' (mid-cut)' if near else ''))
    sheet(rows, S)
    return S, rows


def sheet(rows, S):
    TW = 270 if H >= W else 400; TH = round(TW * H / W); COLS, BAR = (6 if H >= W else 4), 34; f = TW / W
    out = Image.new('RGB', (TW * COLS, (TH + BAR) * ((len(rows) + COLS - 1) // COLS)), (17, 19, 43)); d = ImageDraw.Draw(out)
    font = None
    for fn in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        try: font = ImageFont.truetype(fn, 18); break
        except OSError: pass
    font = font or ImageFont.load_default()
    for n, r in enumerate(rows):
        x, y = (n % COLS) * TW, (n // COLS) * (TH + BAR); out.paste(r['img'].resize((TW, TH)), (x, y + BAR))
        d.rectangle([x + S['x0'] * f, y + BAR + S['y0'] * f, x + S['x1'] * f, y + BAR + S['y1'] * f], outline=(82, 227, 164), width=2)
        if r['text_box']:
            l, t, rr, b = r['text_box']
            d.rectangle([x + l * f, y + BAR + t * f, x + rr * f, y + BAR + b * f], outline=(255, 70, 70) if r['out'] else (255, 210, 63), width=2)
        d.text((x + 6, y + 7), f"{r['t']:.2f}s {r['label']} {'OUT' if r['out'] else 'ok'}", fill=(255, 90, 90) if r['out'] else (255, 210, 63), font=font)
    (EP / 'preview').mkdir(exist_ok=True); out.save(EP / 'preview/qc.png')


def video_check():
    mp4 = EP / f'{name}.mp4'
    if '--no-video' in sys.argv or not mp4.exists(): return None
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', str(mp4)],
                                      capture_output=True, text=True).stdout)
    dur = float(probe['format']['duration']); audio = any(s.get('codec_type') == 'audio' for s in probe.get('streams', []))
    cmd = ['ffmpeg', '-hide_banner', '-nostats', '-i', str(mp4), '-vf', 'blackdetect=d=0.25:pix_th=0.10,freezedetect=n=-60dB:d=1.5']
    log = subprocess.run(cmd + (['-af', 'ebur128=framelog=quiet'] if audio else ['-an']) + ['-f', 'null', '-'], capture_output=True, text=True).stderr
    black = [(float(a), float(b)) for a, b in re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', log)]
    freeze = [float(v) for v in re.findall(r'freeze_start: ([\d.]+)', log)]
    lufs = re.findall(r'I:\s+(-?[\d.]+) LUFS', log); lufs = float(lufs[-1]) if lufs else None
    if abs(dur - DUR) > 0.1: fails.append(f'duration {dur:.2f}s, project.json says {DUR:g}s')
    for a, b in black:
        (warns if b >= dur - 0.5 else fails).append(f'black {a:.2f}-{b:.2f}s' + (' (fade-out?)' if b >= dur - 0.5 else ''))
    for a in freeze: warns.append(f'frozen picture from {a:.2f}s for 1.5 s or more')
    if not audio: warns.append('no audio track')
    elif lufs is not None and not -16 <= lufs <= -12: warns.append(f'loudness {lufs} LUFS (build.py mixes to -14)')
    return {'file': mp4.name, 'duration_s': round(dur, 3), 'black': black, 'frozen_from': freeze, 'lufs': lufs}


if __name__ == '__main__':
    S, rows = text_check(); video = video_check()
    rep = {'safe_box': {k: (round(v) if isinstance(v, float) else v) for k, v in S.items()},
           'frames': [{k: v for k, v in r.items() if k != 'img'} for r in rows], 'video': video, 'fail': fails, 'warn': warns}
    (EP / 'preview/qc.json').write_text(json.dumps(rep, indent=1))
    print(f"text: {len(rows)} frames, {sum(r['out'] for r in rows)} out of the safe box ({S['from']})")
    if video: print(f"video: {video['duration_s']}s, {len(video['black'])} black, {len(video['frozen_from'])} frozen, {video['lufs']} LUFS")
    for w in warns: print('WARN', w)
    for f in fails: print('FAIL', f)
    print('qc', 'FAIL' if fails else 'ok', '->', EP / 'preview/qc.png')
    sys.exit(1 if fails else 0)
