# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# The storyboard the narrator records against: a plain page with one section per scene, its screenshot (click for full
# screen), what is on screen, and a few short bullets to say, not sentences to read. Several storyboards (concepts to
# choose between) go on one page, one after another.
#   uv run storyboard.py <storyboard.json> [<more.json> ...] <out-dir> [--images DIR] [--title "Page title"]
#   -> out-dir/index.html + frames/ (open it, or publish it)
# Image paths are relative to each json, or to --images DIR. A card without an image shows "Screenshot pending": use it
# for concepts drafted before the screens can be captured.
#   {"title": "Acme launch video", "subtitle": "A quick tour, then setup in one prompt.", "target_seconds": 120,
#    "notes": ["One take, straight through", "Restart a sentence instead of stopping"],
#    "cards": [{"title": "Intro", "image": "assets/home.png", "on_screen": "The dashboard",
#               "say": ["A quick tour of Acme", "At the end: setup in one prompt"], "tip": "This frame is the poster", "seconds": 6}],
#    "script": [["Intro", "So I'm going to give a quick tour..."]]}
import html, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ff

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
opt = lambda k: args[args.index(k) + 1] if k in args else None
images, page_title = opt('--images'), opt('--title')
pos = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] not in ('--images', '--title'))]
srcs, out = [p for p in pos if p.endswith('.json')], next(p for p in pos if not p.endswith('.json'))
os.makedirs(os.path.join(out, 'frames'), exist_ok=True)
e = lambda s: html.escape(str(s))
mmss = lambda t: f'{int(t) // 60}:{int(t) % 60:02d}'


def board(src, key, h):
    """One storyboard's scenes, with headings at level h (2 alone on the page, 3 under a concept heading)."""
    B = json.load(open(src)); base = images or os.path.dirname(os.path.abspath(src))
    rows, t = [], 0.0
    for n, c in enumerate(B['cards'], 1):
        secs = c.get('seconds', 0)
        tc = f' <small>{mmss(t)}–{mmss(t + secs)}</small>' if secs else ''
        t += secs
        img = '<div class="pending">Screenshot pending</div>'
        if c.get('image'):
            name = f'frames/{key}{n:02d}.jpg'
            ff('-i', os.path.join(base, c['image']), '-vf', "scale='min(1440,iw)':-2:flags=lanczos,format=yuvj420p", '-q:v', 3, os.path.join(out, name))
            img = f'<img class="zoom" src="{name}" alt="{e(c.get("on_screen", c["title"]))}" loading="lazy">'
        on = f'<p class="onscreen">On screen: {e(c["on_screen"])}</p>\n' if c.get('on_screen') else ''
        tip = f'\n<p class="tip">Tip: {e(c["tip"])}</p>' if c.get('tip') else ''
        say = ''.join(f'<li>{e(s)}</li>' for s in c.get('say', []))
        rows.append(f'<h{h + 1}>{n}. {e(c["title"])}{tc}</h{h + 1}>\n{on}{img}\n<ul>{say}</ul>{tip}')
    target = B.get('target_seconds')
    length = f'About {mmss(t)}' + (f' <span class="over">(over the {mmss(target)} cap)</span>' if target and t > target else '') + '. ' if t else ''
    script = ''.join(f'<p><b>{e(k)}.</b> {e(v)}</p>' for k, v in B.get('script', []))
    script = f'\n<details><summary>Draft script</summary>{script}</details>' if script else ''
    return B, length, '\n'.join(rows) + script


def notes(items):
    return f'<h2>Recording notes</h2>\n<ul>{"".join(f"<li>{e(x)}</li>" for x in items)}</ul>' if items else ''


if len(srcs) == 1:
    B, length, scenes = board(srcs[0], '', 2)
    title, sub = B['title'], f'{length}{e(B.get("subtitle", ""))} Click a screenshot to see it full screen.'
    body = f'<h2>Scenes</h2>\n{scenes}\n{notes(B.get("notes"))}'
else:
    parts, toc = [], []
    for i, src in enumerate(srcs):
        L = chr(ord('a') + i)
        B, length, scenes = board(src, f'{L}-', 2)
        toc.append(f'<li><a href="#concept-{L}">{e(B["title"])}</a>: {length}{e(B.get("subtitle", ""))}</li>')
        parts.append(f'<h2 id="concept-{L}">{L.upper()}. {e(B["title"])}</h2>\n<p>{length}{e(B.get("subtitle", ""))}</p>\n{scenes}')
    title = page_title or 'Storyboards'
    sub = f'{len(srcs)} concepts to choose from. Click a screenshot to see it full screen.'
    body = f'<ol>{"".join(toc)}</ol>\n' + '\n'.join(parts) + '\n' + notes(json.load(open(srcs[0])).get('notes'))
page = open(os.path.join(HERE, '..', 'templates', 'storyboard.html')).read()
for k, v in dict(TITLE=e(title), SUBTITLE=sub, BODY=body).items(): page = page.replace(f'%%{k}%%', v)
open(os.path.join(out, 'index.html'), 'w').write(page)
print(f'{out}/index.html: ' + ', '.join(json.load(open(s))['title'] for s in srcs))
