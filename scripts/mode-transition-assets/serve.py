#!/usr/bin/env python3
"""Serve build.html and write the mode-transition and splash assets it produces.

build.html reads each ui/assets/laolao-mode-transition-<mode>.png plus a raw
Vision mask from --masks, prepares the layers in the browser and PUTs them
back. Only the four derived files for each supported scene can be written. See
README.md.
"""
import argparse
import http.server
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
ASSETS = os.path.join(REPO, 'ui', 'assets')
SCENES = (
    'laolao-mode-transition-chat',
    'laolao-mode-transition-project',
    'laolao-mode-transition-thinking',
    'laolao-mode-transition-learning',
    'laolao-mode-transition-unrestricted',
    'laolao-splash',
)
DERIVATIVES = ('mask.png', 'plate.webp', 'plate-soft.png', 'char-soft.png')
OUTPUT = re.compile(
    r'^(?:%s)-(?:%s)$' % (
        '|'.join(re.escape(scene) for scene in SCENES),
        '|'.join(re.escape(derivative) for derivative in DERIVATIVES),
    )
)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18841)
parser.add_argument(
    '--masks',
    required=True,
    help='directory holding <mode>-mask.png plus splash-mask.png from mask.swift',
)
args = parser.parse_args()


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split('?', 1)[0]
        name = os.path.basename(path)
        if path.startswith('/assets/'):
            return os.path.join(ASSETS, name)
        if path.startswith('/masks/'):
            return os.path.join(os.path.abspath(args.masks), name)
        return os.path.join(HERE, name or 'build.html')

    def do_PUT(self):
        name = os.path.basename(self.path.split('?', 1)[0])
        if not self.path.startswith('/out/') or not OUTPUT.match(name):
            self.send_error(403, 'not a mode-transition output')
            return
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        with open(os.path.join(ASSETS, name), 'wb') as handle:
            handle.write(body)
        sys.stderr.write(f'wrote {name} ({len(body)} bytes)\n')
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


print(f'open http://127.0.0.1:{args.port}/build.html')
http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
