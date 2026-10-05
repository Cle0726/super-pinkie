#!/usr/bin/env python3
"""Serve the installed Control UI against an in-page fake gateway.

The real native chat bundle and the laolao-* injections run unchanged; only
window.WebSocket is replaced (fake-gateway.js), so tool turns, watchdog
continuations and history resyncs can be replayed without a model or quota.
See README.md in this directory.
"""
import argparse
import http.server
import mimetypes
import os
import re
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
APP = os.environ.get('PINKIE_APP_PATH', '/Applications/超級碧琪.app')
DEFAULT_UI_ROOT = os.path.join(APP, 'Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui')
SEEDS = '/Users/Admin/.openclaw/workspace-unrestricted/super-pinkie/work/codex-prompts/tools/seeds'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18811)
parser.add_argument('--ui-root', default=DEFAULT_UI_ROOT,
                    help='control-ui directory providing index.html and the native bundles')
parser.add_argument('--injections', default=os.path.join(REPO, 'ui', 'injections'),
                    help='laolao-* files served instead of the ui-root copies')
parser.add_argument('--installed-injections', action='store_true',
                    help='serve the laolao-* files from --ui-root as installed')
args = parser.parse_args()

OVERLAY = '' if args.installed_injections else args.injections
SHIM = '<script src="/__fake-gateway.js"></script>'
ASSET_REF = re.compile(r'(?:src|href)="(?:\./|/)?(laolao-[\w.-]+?\.(?:js|css))[^"]*"')


def extra_tags(index_html):
    """Tags for repo injections that the installed index.html does not load yet."""
    fragment = os.path.join(OVERLAY, 'laolao-head.fragment.html') if OVERLAY else ''
    if not fragment or not os.path.isfile(fragment):
        return ''
    loaded = set(ASSET_REF.findall(index_html))
    tags = []
    for name in dict.fromkeys(ASSET_REF.findall(open(fragment, encoding='utf-8').read())):
        if name in loaded:
            continue
        if name.endswith('.css'):
            tags.append(f'<link rel="stylesheet" href="/{name}">')
        else:
            tags.append(f'<script defer src="/{name}"></script>')
    return '\n'.join(tags)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=args.ui_root, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/__seed/'):
            name = os.path.basename(path)
            if not re.fullmatch(r'(?:s2|full|l2)\.js', name):
                return self.send_error(404)
            try:
                with open(os.path.join(SEEDS, name), 'rb') as seed:
                    return self.send_bytes(seed.read(), 'text/javascript; charset=utf-8')
            except OSError:
                return self.send_error(404)
        if path == '/__fake-gateway.js':
            with open(os.path.join(HERE, 'fake-gateway.js'), 'rb') as f:
                return self.send_bytes(f.read(), 'text/javascript; charset=utf-8')
        if path.endswith('sw.js') or 'service-worker' in path:
            # A service worker would cache between runs and hide edits.
            return self.send_error(404)
        base = os.path.basename(path)
        if OVERLAY and base.startswith('laolao-') and os.path.isfile(os.path.join(OVERLAY, base)):
            ctype = 'text/css' if base.endswith('.css') else 'text/javascript; charset=utf-8'
            with open(os.path.join(OVERLAY, base), 'rb') as f:
                return self.send_bytes(f.read(), ctype)
        assets = os.path.join(REPO, 'ui', 'assets')
        if OVERLAY and base.startswith('laolao-') and os.path.isfile(os.path.join(assets, base)):
            # Repo images (status stickers, art) that the installed App may not have yet.
            ctype = mimetypes.guess_type(base)[0] or 'application/octet-stream'
            with open(os.path.join(assets, base), 'rb') as f:
                return self.send_bytes(f.read(), ctype)
        local = os.path.join(args.ui_root, path.lstrip('/'))
        if path == '/' or ('.' not in base and not os.path.isfile(local)):
            with open(os.path.join(args.ui_root, 'index.html'), encoding='utf-8') as f:
                html = f.read()
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            seed = query.get('seed', [''])[0]
            seed_tag = f'<script src="/__seed/{seed}.js"></script>' if seed in {'s2', 'full', 'l2'} else ''
            html = html.replace('<head>', '<head>' + seed_tag + SHIM, 1)
            html = html.replace('</head>', extra_tags(html) + '\n</head>', 1)
            return self.send_bytes(html.encode('utf-8'), 'text/html; charset=utf-8')
        return super().do_GET()


if __name__ == '__main__':
    session = urllib.parse.quote('agent:unrestricted:dashboard:harness0001', safe='')
    print(f'chat-ui harness: http://127.0.0.1:{args.port}/chat?session={session}', flush=True)
    print(f'  ui-root:    {args.ui_root}', flush=True)
    print(f'  injections: {OVERLAY or "(installed)"}', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
