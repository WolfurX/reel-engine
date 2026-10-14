"""Preview contact sheet: labelled frames in a grid, so a whole piece can be checked before the full render.
usage: python3 contact.py <project_dir> out.png t:label [t:label ...]   (frames must already exist in frames/)"""
import sys, json, pathlib
from PIL import Image, ImageDraw, ImageFont

EP = pathlib.Path(sys.argv[1]).resolve(); out, items = sys.argv[2], [a.split(':', 1) for a in sys.argv[3:]]
cfg = json.load(open(EP / 'project.json')); W, H, FPS = int(cfg.get('w', 1080)), int(cfg.get('h', 1920)), int(cfg.get('fps', 30))
TW = 270 if H >= W else 400; TH = round(TW * H / W); COLS, BAR = (6 if H >= W else 4), 34
rows = (len(items) + COLS - 1) // COLS
sheet = Image.new('RGB', (TW * COLS, (TH + BAR) * rows), (17, 19, 43)); d = ImageDraw.Draw(sheet)
font = None
for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
    try: font = ImageFont.truetype(f, 18); break
    except OSError: pass
font = font or ImageFont.load_default()
for n, (ts, label) in enumerate(items):
    im = Image.open(EP / f'frames/{round(float(ts) * FPS):04d}.png').convert('RGB').resize((TW, TH))
    x, y = (n % COLS) * TW, (n // COLS) * (TH + BAR); sheet.paste(im, (x, y + BAR))
    d.text((x + 6, y + 7), f'{float(ts):.2f}s {label}', fill=(255, 210, 63), font=font)
sheet.save(out); print('contact', out, len(items), 'frames')
