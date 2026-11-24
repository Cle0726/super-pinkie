#!/usr/bin/env python3
"""Install and verify the one shared Control UI bundle, on either platform.

ui/runtime owns the shared patched browser renderer; the Windows snapshot
owns backend runtime files, never a second browser renderer or Pinkie skin.
Run install AFTER every runtime overlay. Manifests are recomputed from actual
package bytes, rather than trusting a manifest copied into the package.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[2]
STAMP_SCRIPT = ROOT / 'tools/assets/stamp.mjs'
HASH_LEN = 10
TAG = re.compile(r'<script\b[^>]*\bsrc=["\'][^"\']+["\'][^>]*>\s*</script>|<link\b[^>]*>', re.I)
REF = re.compile(r'\b(?:src|href)=["\']([^"\']+)["\']', re.I)
NATIVE = re.compile(r'assets/index-[^/]+\.(?:js|css)$')
CSS_URL_HASH = re.compile(r'url\((["\']?)(\.?/)?(laolao-[A-Za-z0-9._/-]+)\?v=(?:@hash|[a-f0-9]{10})\1\)')
CHAT_IMPORT = re.compile(rb'(\./chat-page-[A-Za-z0-9_-]+\.js)(?:\?v=[^`"\'\\)]*)?')
NATIVE_SLOT = '<!-- pinkie-native-assets -->'
MANIFEST = 'pinkie-ui-manifest.json'
ASSET_MANIFEST_JS = 'laolao-asset-manifest.js'
HEAD_FRAGMENT = 'laolao-head.fragment.html'
FRAGMENTS = {'laolao-head.fragment.html', 'laolao-body.fragment.html'}
RUNTIME_DATA = {'laolao-stats.json', 'laolao-quota.json', 'laolao-exam-packs.json'}
GENERATED_UI = {ASSET_MANIFEST_JS, HEAD_FRAGMENT}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha10(data):
    return digest(data)[:HASH_LEN]


def ref_path(ref):
    return urlsplit(ref).path.lstrip('./')


def owned(ref):
    name = ref_path(ref)
    return name.startswith(('laolao-', 'vendor/')) and name.endswith(('.js', '.css'))


def retired(path):
    # Only the separate C.le. Studio product (cat app icon, cat plugin, its
    # installer) is retired. The laolao-cle-* files are the author's C.le.
    # signature on the process card and stay in every package.
    parts = Path(path).parts
    return (Path(path).name == 'CLeAppIcon.icns'
            or any(parts[i:i + 2] in (('services', 'cle-studio'), ('installer', 'cle'))
                   for i in range(len(parts) - 1)))


def ui_resource(name):
    return (name.startswith(('laolao-', 'vendor/', 'fonts/', 'study-desk/', 'provider-icons/', 'ProviderIcon-'))
            or name in FRAGMENTS or name in {'PinkieAppIcon.icns', 'CLeAppIcon.icns'})


def source_files(root):
    """Keep nested fonts, vendors and art automatically; no platform file lists."""
    root = Path(root)
    policy = json.loads((root / 'ui/parity-policy.json').read_text(encoding='utf-8'))
    excluded = set(policy['native_only_assets'])
    result = {}
    folded = {}
    directories = [(root / 'ui/assets', ''), (root / 'ui/injections', ''),
                   (root / 'ui/runtime', 'assets/')]
    for directory, prefix in directories:
        for file in sorted(directory.rglob('*')):
            if not file.is_file():
                continue
            relative = prefix + file.relative_to(directory).as_posix()
            if (file.name in FRAGMENTS or relative in excluded or retired(relative)
                    or any(p.startswith('.') for p in Path(relative).parts)
                    or '.bak' in file.name or file.suffix == '.pyc'):
                continue
            if file.is_symlink():
                raise ValueError(f'UI source must be a regular tracked file: {file}')
            if relative.casefold() in folded and folded[relative.casefold()] != relative:
                raise ValueError(f'Windows case-insensitive filename collision: {relative}')
            folded[relative.casefold()] = relative
            if relative in result and result[relative].read_bytes() != file.read_bytes():
                raise ValueError(f'two different UI sources for {relative}')
            if file.read_bytes().startswith(b'version https://git-lfs.github.com/spec/v1'):
                raise ValueError(f'unresolved LFS pointer: {file}')
            result[relative] = file
    # Public aliases used by the upstream shell and the shared model picker.
    result['apple-touch-icon.png'] = root / 'ui/assets/laolao-avatar.png'
    result['provider-icons/ProviderIcon-crossmodel.svg'] = root / 'ui/assets/ProviderIcon-crossmodel.svg'
    return result


def read_entry_bytes(item):
    if isinstance(item, (bytes, bytearray)):
        return bytes(item)
    return Path(item).read_bytes()


def render_asset_manifest_js(hashes):
    table = {k: hashes[k] for k in sorted(hashes) if not k.startswith('assets/') and k not in GENERATED_UI and k not in FRAGMENTS}
    body = json.dumps(table, ensure_ascii=False, indent=2).replace('\n', '\n  ')
    return (
        '(() => {\n'
        '  "use strict";\n'
        f'  const M = {body};\n'
        '  window.__pinkieAssetManifest = M;\n'
        '  window.__pinkieAsset = (p) => {\n'
        '    const s = String(p || "");\n'
        '    const q = s.indexOf("?");\n'
        '    const clean = q < 0 ? s : s.slice(0, q);\n'
        '    const key = clean.replace(/^(?:\\.\\/|\\/)+/, "");\n'
        '    const h = M[key];\n'
        '    return h ? `${clean}?v=${h}` : s;\n'
        '  };\n'
        '})();\n'
    ).encode('utf-8')


def stamped_sources(root, files=None):
    root = Path(root)
    if files is None:
        files = source_files(root)
    data_map = {name: read_entry_bytes(src) for name, src in files.items()}
    hashes = {name: sha10(data) for name, data in data_map.items()}
    for name in sorted(data_map):
        if name.startswith('laolao-') and name.endswith('.css'):
            text = data_map[name].decode('utf-8')
            if CSS_URL_HASH.search(text):
                stamped = CSS_URL_HASH.sub(
                    lambda m: f'url({m[1]}{m[2] or ""}{m[3]}?v={hashes[m[3]]}{m[1]})' if m[3] in hashes else m[0],
                    text,
                ).encode('utf-8')
                data_map[name] = stamped
                hashes[name] = sha10(stamped)
    for name in sorted(data_map):
        if NATIVE.fullmatch(name) and name.endswith('.js'):
            def update_chat(match):
                target_rel = 'assets/' + match[1].decode()[2:]
                target_bytes = data_map.get(target_rel)
                ver = sha10(target_bytes if target_bytes is not None else match[1]).encode()
                return match[1] + b'?v=' + ver
            stamped = CHAT_IMPORT.sub(update_chat, data_map[name])
            data_map[name] = stamped
            hashes[name] = sha10(stamped)
    manifest_js = render_asset_manifest_js(hashes)
    data_map[ASSET_MANIFEST_JS] = manifest_js
    hashes[ASSET_MANIFEST_JS] = sha10(manifest_js)
    head_path = root / 'ui/injections' / HEAD_FRAGMENT
    if head_path.is_file():
        head_text = head_path.read_text(encoding='utf-8').replace('\r\n', '\n').lstrip('\ufeff')
        head_text = re.sub(
            r'^[ \t]*<script\b[^>]*\bsrc=["\']/?laolao-asset-manifest\.js(?:\?[^"\']*)?["\'][^>]*>\s*</script>[ \t]*\n?',
            '',
            head_text,
            flags=re.I | re.M,
        )
        head_text = TAG.sub(lambda m: version_tag(m[0], data_map, hashes), head_text)
        manifest_tag = f'<script src="/{ASSET_MANIFEST_JS}?v={hashes[ASSET_MANIFEST_JS]}"></script>'
        head_text = re.sub(
            r'(<script\b[^>]*\bsrc=["\']/laolao-night\.js\?v=[^"\']+["\'][^>]*>\s*</script>)',
            lambda m: m[1] + '\n' + manifest_tag,
            head_text,
            count=1,
            flags=re.I,
        )
        data_map[HEAD_FRAGMENT] = head_text.encode('utf-8')
        hashes[HEAD_FRAGMENT] = sha10(data_map[HEAD_FRAGMENT])
    return data_map, hashes


def version_tag(tag, files, hashes=None):
    match = REF.search(tag)
    if not match:
        raise ValueError(f'entry tag has no resource: {tag}')
    path = ref_path(match[1])
    if path not in files and (hashes is None or path not in hashes):
        raise ValueError(f'entry references an unbundled resource: {path}')
    ver = hashes[path] if hashes and path in hashes else sha10(read_entry_bytes(files[path]))
    query = [(k, v) for k, v in parse_qsl(urlsplit(match[1]).query) if k not in ('v', 'h')]
    query.append(('v', ver))
    return tag[:match.start(1)] + '/' + path + '?' + urlencode(query) + tag[match.end(1):]


def entry_tags(root, files):
    fragment = (Path(root) / 'ui/injections/laolao-head.fragment.html').read_text(encoding='utf-8')
    if fragment.count(NATIVE_SLOT) != 1:
        raise ValueError('shared head must contain exactly one native-assets slot')
    data_map, hashes = stamped_sources(root, files)
    before, after = fragment.split(NATIVE_SLOT)
    tags = []
    for section in (before, after):
        group = []
        for match in TAG.finditer(section):
            ref = REF.search(match[0])
            if not ref or not owned(ref[1]) or retired(ref_path(ref[1])):
                raise ValueError(f'invalid shared head entry: {match[0]}')
            if ref_path(ref[1]) == ASSET_MANIFEST_JS:
                continue
            group.append(version_tag(match[0], data_map, hashes))
        tags.append(group)
    paths = [ref_path(REF.search(t)[1]) for group in tags for t in group]
    if len(paths) != len(set(paths)):
        raise ValueError('duplicate shared head resource')
    if not paths or paths[0] != 'laolao-night.js':
        raise ValueError('night bootstrap must run before the upstream theme bootstrap')
    manifest_tag = f'<script src="/{ASSET_MANIFEST_JS}?v={hashes[ASSET_MANIFEST_JS]}"></script>'
    tags[0].insert(1, manifest_tag)
    return tags


def inline_scripts(html):
    return [m[1] for m in re.finditer(r'<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>', html, re.I)]


def outside_inline(html, transform):
    chunks = re.split(r'(<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?</script>)', html, flags=re.I)
    return ''.join(chunk if i % 2 else transform(chunk) for i, chunk in enumerate(chunks))


def normalize_index(html, root, files, control=None):
    # Browser and gateway must hash exactly the same LF-normalized script bytes.
    html = html.replace('\r\n', '\n').lstrip('\ufeff')
    original_inline = inline_scripts(html)
    data_map, hashes = stamped_sources(root, files)
    html = re.sub(r",?\s*interactive-widget=[A-Za-z-]+", "", html)
    # WKWebView already sets this at document start; WebView2's loaded bridge
    # used to arrive after the first paint. Share the same initial surface.
    html = re.sub(r'<html\b([^>]*)>', lambda m: '<html' + re.sub(r'\s+data-pinkie-native-glass=["\'][^"\']*["\']', '', m[1]) + ' data-pinkie-native-glass="1">', html, count=1, flags=re.I)
    native = []
    def remove(match):
        ref = REF.search(match[0])
        if not ref:
            return match[0]
        path = ref_path(ref[1])
        if NATIVE.fullmatch(path):
            # Upstream names stay hashed after our runtime patch. Advance its
            # cache key from actual content bytes without dropping feature flags.
            query = [(k, v) for k, v in parse_qsl(urlsplit(ref[1]).query) if k not in ('v', 'h')]
            if path in hashes:
                ver = hashes[path]
            elif control is not None and (Path(control) / path).is_file():
                ver = sha10((Path(control) / path).read_bytes())
            else:
                ver = sha10(path.encode('utf-8'))
            query.append(('v', ver))
            native.append(match[0][:ref.start(1)] + '/' + path + '?' + urlencode(query) + match[0][ref.end(1):])
            return ''
        return '' if owned(ref[1]) else match[0]
    html = TAG.sub(remove, html)
    if len([t for t in native if t.lower().startswith('<script')]) != 1:
        raise ValueError('expected exactly one upstream entry module')
    groups = entry_tags(root, files)
    early = '\n    '.join(groups[0][:2])
    block = '\n'.join(groups[0][2:] + native + groups[1])
    # Whitespace outside scripts is disposable. Clearing former tag-only lines
    # makes repeated installation byte-for-byte idempotent.
    html = outside_inline(html, lambda text: re.sub(r'\n{3,}', '\n\n', re.sub(r'(?m)^[ \t]+$', '', text)))
    html = re.sub(r'(<head\b[^>]*>)\s*', lambda m: m[1] + '\n    ' + early + '\n', html, count=1, flags=re.I)
    html = re.sub(r'\s*</head\s*>', lambda m: '\n    ' + block.replace('\n', '\n    ') + '\n  </head>', html, count=1, flags=re.I)
    if 'id="laolao-splash"' not in html:
        body = (Path(root) / 'ui/injections/laolao-body.fragment.html').read_text(encoding='utf-8').replace('\r\n', '\n').replace('"./laolao-', '"/laolao-')
        html = re.sub(r'(<body\b[^>]*>)', lambda m: m[1] + '\n' + body, html, count=1, flags=re.I)
    handoff = version_tag('<script src="/laolao-handoff-bootstrap.js?v=@hash"></script>', data_map, hashes)
    html = re.sub(r'\s*(?=<openclaw-app\b)', lambda m: '\n    ' + handoff + '\n    ', html, count=1)
    html = re.sub(r'<title>[^<]*</title>', '<title>超級碧琪</title>', html, count=1)
    if inline_scripts(html) != original_inline:
        raise ValueError('shared UI installation changed an inline script')
    return html


def write_if_changed(path, data):
    path = Path(path)
    if not path.exists() or path.read_bytes() != data:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def refresh_native_imports(control):
    # The runtime patch changes chat-page bytes without changing its upstream
    # hashed filename. Both shells must request the patched copy after upgrade.
    for entry in Path(control).glob('assets/index-*.js'):
        original = entry.read_bytes()
        def update(match):
            target = entry.parent / match[1].decode()
            ver = sha10(target.read_bytes() if target.is_file() else match[1]).encode()
            return match[1] + b'?v=' + ver
        updated = CHAT_IMPORT.sub(update, original)
        write_if_changed(entry, updated)


def run_stamp_tool(root, control):
    script = Path(root) / 'tools/assets/stamp.mjs'
    if not script.is_file():
        script = STAMP_SCRIPT
    node = shutil.which('node')
    if script.is_file() and node:
        subprocess.run([node, str(script), '--root', str(root), '--control-ui', str(control)], check=True)


def install(root, control):
    root, control = Path(root), Path(control)
    files = source_files(root)
    data_map, _ = stamped_sources(root, files)
    index = control / 'index.html'
    # The entrypoint is browser code too. A platform runtime overlay must not
    # supply different feature flags, bootstrap or fallback UI.
    template = root / 'ui/control-ui.index.html'
    base = template if template.is_file() else index
    base_html = base.read_bytes().decode('utf-8-sig')
    for name, data in data_map.items():
        write_if_changed(control / name, data)
    for name in ('laolao-stats.json', 'laolao-quota.json'):
        if not (control / name).exists():
            write_if_changed(control / name, b'null\n')
    # Remove stale UI and raw build fragments even in a dirty installation.
    # User statistics and runtime-generated learning metadata are not artwork.
    for file in list(control.rglob('*')):
        name = file.relative_to(control).as_posix()
        if file.is_file() and (retired(name) or (ui_resource(name) and name not in data_map and name not in RUNTIME_DATA)):
            file.unlink()
    refresh_native_imports(control)
    html = normalize_index(base_html, root, files, control)
    write_if_changed(index, html.encode('utf-8'))
    actual = inspect(root, control)
    write_if_changed(control / MANIFEST, (json.dumps(actual, ensure_ascii=False, indent=2) + '\n').encode())
    return actual


def inspect(root, control):
    root, control = Path(root), Path(control)
    expected = source_files(root)
    data_map, hashes = stamped_sources(root, expected)
    html = (control / 'index.html').read_bytes().decode('utf-8-sig')
    template = root / 'ui/control-ui.index.html'
    if template.is_file() and html != normalize_index(template.read_bytes().decode('utf-8-sig'), root, expected, control):
        raise ValueError('package entry HTML differs from the shared entrypoint')
    wanted = [t for group in entry_tags(root, expected) for t in group]
    actual = [m[0] for m in TAG.finditer(html) if (r := REF.search(m[0])) and owned(r[1])
              and ref_path(r[1]) != 'laolao-handoff-bootstrap.js']
    if actual != wanted:
        raise ValueError('package injection list/order/versions differ from the shared head')
    for script in inline_scripts(html):
        if '\r' in script:
            raise ValueError('CR in an inline script would break the gateway CSP')
    handoffs = [m[0] for m in TAG.finditer(html) if (r := REF.search(m[0])) and ref_path(r[1]) == 'laolao-handoff-bootstrap.js']
    if handoffs != [version_tag('<script src="/laolao-handoff-bootstrap.js?v=@hash"></script>', data_map, hashes)]:
        raise ValueError('missing, duplicate or stale splash handoff bootstrap')
    manifest = {'schema': 1, 'injections': actual, 'resources': {}}
    if template.is_file():
        data = (control / 'index.html').read_bytes()
        manifest['resources']['index.html'] = {'sha256': digest(data), 'bytes': len(data)}
    for match in TAG.finditer(html):
        ref = REF.search(match[0])
        if ref and ref_path(ref[1]).startswith('assets/') and not (control / ref_path(ref[1])).is_file():
            raise ValueError(f'package is missing upstream entry resource: {ref_path(ref[1])}')
    for name, expected_data in data_map.items():
        file = control / name
        if not file.is_file():
            raise ValueError(f'package is missing UI resource: {name}')
        data = file.read_bytes()
        if data != expected_data:
            raise ValueError(f'package has stale/modified UI resource: {name}')
        manifest['resources'][name] = {'sha256': digest(data), 'bytes': len(data)}
    # The browser's upstream chunks are part of the visible UI as well. Read
    # every chunk back from each package, including those provided by pinned
    # OpenClaw, so a skin-only comparison cannot hide a different chat renderer.
    for file in sorted((control / 'assets').rglob('*')):
        if file.is_file():
            name = file.relative_to(control).as_posix()
            data = file.read_bytes()
            manifest['resources'][name] = {'sha256': digest(data), 'bytes': len(data)}
    for file in control.rglob('*'):
        name = file.relative_to(control).as_posix()
        if file.is_file() and retired(name):
            raise ValueError(f'retired Cle UI remains in package: {file}')
        if file.is_file() and ui_resource(name) and name not in data_map and name not in RUNTIME_DATA:
            raise ValueError(f'unlisted UI resource remains in package: {name}')
    return manifest


def check_tracked(root):
    root = Path(root)
    tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0'))
    templates = [root / name for name in ('ui/control-ui.index.html',
                 'ui/parity-policy.json', 'ui/injections/laolao-head.fragment.html',
                 'ui/injections/laolao-body.fragment.html') if (root / name).is_file()]
    for file in set(source_files(root).values()) | set(templates):
        if file.relative_to(root).as_posix() not in tracked:
            raise ValueError(f'UI resource is not tracked by Git: {file}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('install', 'check', 'compare', 'source'))
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--control-ui', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--tracked', action='store_true')
    parser.add_argument('manifests', nargs='*', type=Path)
    args = parser.parse_args()
    if args.action == 'source':
        files = source_files(args.root)
        entry_tags(args.root, files)
        if args.tracked:
            check_tracked(args.root)
        print(f'shared UI source OK: {len(files)} resources')
        return
    if args.action == 'compare':
        if len(args.manifests) != 2:
            parser.error('compare requires the actual Mac and Windows manifests')
        first, second = [json.loads(p.read_text(encoding='utf-8')) for p in args.manifests]
        if first != second:
            raise ValueError('Mac and Windows packaged UI manifests differ')
        print(f'Mac/Windows UI identical: {len(first["injections"])} entries, {len(first["resources"])} resources')
        return
    if args.control_ui is None:
        parser.error('--control-ui is required')
    if args.action == 'install':
        install(args.root, args.control_ui)
        run_stamp_tool(args.root, args.control_ui)
    result = inspect(args.root, args.control_ui)
    if args.action == 'install':
        write_if_changed(args.control_ui / MANIFEST, (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode())
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'shared UI {args.action} OK: {len(result["injections"])} entries, {len(result["resources"])} resources')


if __name__ == '__main__':
    main()
