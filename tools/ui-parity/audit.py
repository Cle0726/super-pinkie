#!/usr/bin/env python3
"""Read-only comparison of an installed Mac and an unpacked Windows release."""
import argparse
import hashlib
import json
import re
from pathlib import Path


def inventory(root):
    return {p.relative_to(root).as_posix(): {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for p in sorted(root.rglob('*')) if p.is_file()}


def compare(left, right):
    a, b = inventory(left), inventory(right)
    changed = []
    for name in sorted(a.keys() & b.keys()):
        if a[name]['sha256'] != b[name]['sha256']:
            x, y = (left / name).read_bytes(), (right / name).read_bytes()
            changed.append({'path': name, 'kind': 'CRLF only' if x.replace(b'\r\n', b'\n') == y.replace(b'\r\n', b'\n') else 'content', 'mac': a[name], 'windows': b[name]})
    return {'mac': {'files': len(a), 'bytes': sum(x['bytes'] for x in a.values())},
            'windows': {'files': len(b), 'bytes': sum(x['bytes'] for x in b.values())},
            'missing_in_windows': sorted(a.keys() - b.keys()), 'extra_in_windows': sorted(b.keys() - a.keys()),
            'different': changed, 'mac_inventory': a, 'windows_inventory': b}


def entries(root):
    text = (root / 'index.html').read_text(encoding='utf-8-sig')
    tags = re.findall(r'<(?:script|link)\b[^>]*(?:src|href)=["\']([^"\']+)["\'][^>]*>', text, re.I)
    return {'versioned': [x for x in tags if '?v=' in x],
            'custom': [x for x in tags if re.search(r'(?:/|^)laolao-[^/?]+\.(?:js|css)\?', x)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mac-root', type=Path, required=True, help='Contents/Resources/SuperPinkie')
    parser.add_argument('--windows-root', type=Path, required=True, help='portable _internal directory')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for name, relative in [('injections','ui/injections'), ('assets','ui/assets'), ('control','runtime/openclaw/dist/control-ui')]:
        win_relative = relative.replace('runtime/openclaw/', 'runtime/node_modules/openclaw/')
        result = compare(args.mac_root / relative, args.windows_root / win_relative)
        (args.out / f'{name}-release-diff.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(name, 'missing',len(result['missing_in_windows']),'extra',len(result['extra_in_windows']), 'content',sum(x['kind']=='content' for x in result['different']), 'EOL',sum(x['kind']=='CRLF only' for x in result['different']))
    result = {'mac':entries(args.mac_root/'runtime/openclaw/dist/control-ui'), 'windows':entries(args.windows_root/'runtime/node_modules/openclaw/dist/control-ui')}
    (args.out/'entry-lists.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')


if __name__ == '__main__':
    main()
