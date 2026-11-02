"""Apply the shared update UI after the Windows Mac-runtime snapshot overlay.

Read/write the page as bytes: changing inline-script newlines breaks the CSP.
"""
import re
import shutil
import sys
from pathlib import Path

ASSETS = ('laolao-update-dialog.css', 'laolao-update-dialog.js', 'laolao-settings-user.js')
TAGS = {
    b'laolao-update-dialog.css': b'<link rel="stylesheet" href="./laolao-update-dialog.css?v=update1">',
    b'laolao-update-dialog.js': b'<script defer src="./laolao-update-dialog.js?v=update1"></script>',
    b'laolao-settings-user.js': b'<script defer src="./laolao-settings-user.js?v=settingsuser5"></script>',
}


def activate(ui, control):
    sources = Path(ui) / 'injections'
    control = Path(control)
    for name in ASSETS:
        if not (sources / name).is_file():
            raise ValueError(f'missing shared update asset: {name}')
    if b'__pinkieUpdateDialog' not in (sources / 'laolao-settings-user.js').read_bytes():
        raise ValueError('shared settings update entry is not integrated')
    index = control / 'index.html'
    html = index.read_bytes()
    if len(re.findall(rb'</head\s*>', html, re.I)) != 1:
        raise ValueError('expected exactly one control UI head')
    for name, tag in TAGS.items():
        pattern = rb'((?:\./|/)' + re.escape(name) + rb')(?:\?v=[A-Za-z0-9_.-]*)?'
        version = b'settingsuser5' if name == b'laolao-settings-user.js' else b'update1'
        if re.search(pattern, html):
            html = re.sub(pattern, lambda m: m.group(1) + b'?v=' + version, html)
        else:
            html = re.sub(rb'</head\s*>', lambda m: b'    ' + tag + b'\n' + m.group(0), html, count=1, flags=re.I)
    for name in ASSETS:
        shutil.copyfile(sources / name, control / name)
    index.write_bytes(html)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: activate_update_dialog.py <staged-ui> <control-ui>')
    activate(sys.argv[1], sys.argv[2])
