"""Real isolated OpenClaw gateway, synthetic loopback-only provider.

This verifies the draft/approval/dispatch plumbing and inspects role requests;
it does not grade a model or count as a live model trial.

python -B -X utf8 tools/metre/roles/smoke-isolated.py --runtime-root <existing Metre iso> --out <new evidence dir>
"""
from argparse import ArgumentParser
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import os
import re
import runpy
import secrets
import shutil
import socket
import subprocess
import threading
import time


REPO = Path(__file__).resolve().parents[3]
PARENT = 'agent:metre:iso-role-draft-smoke'
PARENT_MODEL = 'fixture/metre-parent'
CHILD_MODEL = 'fixture/metre-child'
CREATED = 'draft-smoke-research'
DISCARDED = 'discard-smoke-research'
MARKER = 'DRAFT-SMOKE-LOCAL-SOURCE'
BAD_PORTS = {1466, 1467, 3112, 18789}


def dump(out, value):
    out.write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    if port in BAD_PORTS:
        return free_port()
    return port


def read_json(path):
    return json.loads(path.read_bytes())


def json_output(path):
    text = path.read_text(encoding='utf-8', errors='replace')
    decoder = json.JSONDecoder()
    for match in re.finditer(r'(?m)^\{', text):
        try:
            result, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(result, dict):
            return result
    raise RuntimeError(f'No JSON record in {path.name}')


def leaves(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from leaves(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from leaves(item)


def run(runtime_root, out):
    manifest = read_json(runtime_root / 'manifest.json')
    node, runtime = (Path(manifest[name]).resolve() for name in ('node', 'runtime'))
    if not all(p.is_relative_to(runtime_root) and p.is_file() for p in (node, runtime)):
        raise ValueError('The pre-existing runtime must be under the supplied isolated root')
    out.mkdir(parents=True, exist_ok=False)
    home, here = out / 'home', out / 'fixture'
    state = home / '.openclaw'
    metre = state / 'workspace-metre'
    cfg = state / 'openclaw.json'
    for folder in (here, metre, out / 'tmp', out / 'local', out / 'roaming', out / 'app-state'):
        folder.mkdir(parents=True, exist_ok=True)
    for source in (REPO / 'personas/metre').glob('*.md'):
        shutil.copyfile(source, metre / source.name)
    for name in ('TOOLS.md', 'USER.md', 'HEARTBEAT.md'):
        (metre / name).touch()
    data = here / 'source.md'
    data.write_bytes((MARKER + '\n').encode())
    draft_base = (REPO / 'personas/metre/roles/researcher.md').read_text(encoding='utf-8')
    draft_texts = {key: draft_base.replace('id: researcher', f'id: {key}', 1).replace('name: 调研员', 'name: 烟测调研', 1)
                   for key in (CREATED, DISCARDED)}
    events, requests, errors = [], [], []
    port, token = free_port(), secrets.token_urlsafe(32)
    process = None
    event_lock = threading.Lock()

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if urlsplit(self.path).path != '/v1/models':
                self.send_error(404)
                return
            raw = json.dumps({'object': 'list', 'data': [{**row, 'object': 'model'} for row in model_defs]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if urlsplit(self.path).path != '/v1/chat/completions' or not 0 < size <= 2_000_000:
                    raise ValueError('not the local fixture route')
                raw = self.rfile.read(size)
                req = json.loads(raw)
                model = req.get('model')
                if model not in {PARENT_MODEL, CHILD_MODEL}:
                    raise ValueError('unexpected model for fixture')
                messages = req.get('messages', [])
                user = next((m for m in reversed(messages) if m.get('role') == 'user'), {})
                prompt = '\n'.join(leaves(user.get('content')))
                tools = {t['function']['name']: t['function'] for t in req.get('tools', []) if 'function' in t}
                stage = next((mark for mark in ('MAKE-DRAFT', 'TRY-PENDING', 'TRY-ADOPTED', 'MAKE-DISCARD') if mark in prompt), '')
                tool_result = next((m for m in reversed(messages) if m.get('role') in ('user', 'tool')), {}).get('role') == 'tool'
                action, answer = None, '隔离烟测结束。'
                with event_lock:
                    if len(events) >= 24:
                        raise ValueError('too many requests for the isolated fixture')
                    if model == CHILD_MODEL:
                        requests.append((raw, req))
                        if not tool_result:
                            assert 'read' in tools and 'pinkie_roles' not in tools
                            action = ('read', {'path': str(data)})
                        else:
                            assert any(MARKER in text for text in leaves(messages))
                            answer = '## 结论清单\n已读取 ' + MARKER + '（仅为本地夹具）。\n\n## 矛盾与分歧\n无。\n\n## 没查到的问题\n未核查外部事实。'
                    elif stage and not tool_result:
                        catalog = tools['pinkie_session_start']['parameters']['properties']['role']['enum']
                        if stage in ('MAKE-DRAFT', 'MAKE-DISCARD'):
                            role_id = CREATED if stage == 'MAKE-DRAFT' else DISCARDED
                            assert role_id not in catalog
                            action = ('pinkie_roles', {'action': 'draft', 'id': role_id, 'card': draft_texts[role_id]})
                        else:
                            assert (CREATED in catalog) == (stage == 'TRY-ADOPTED')
                            action = ('pinkie_session_start', {'role': CREATED, 'title': '角色草稿隔离烟测', 'initiation': 'user_asked',
                                      'model': f'mm/{CHILD_MODEL}', 'folder': str(here),
                                      'prompt': f'读取本机测试夹具 {data}，汇报文件原文，不写文件。'})
                    events.append({'model': model, 'stage': stage, 'action': action[0] if action else None,
                                   'tools': sorted(tools), 'toolResult': tool_result})
                delta = {'role': 'assistant'}
                finish = 'stop'
                if action:
                    name, args = action
                    delta['tool_calls'] = [{'index': 0, 'id': f'call_local_{len(events)}', 'type': 'function',
                                           'function': {'name': name, 'arguments': json.dumps(args, ensure_ascii=False)}}]
                    finish = 'tool_calls'
                else:
                    delta['content'] = answer
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Connection', 'close')
                self.end_headers()
                base = {'id': 'chatcmpl-draft-smoke', 'object': 'chat.completion.chunk', 'model': model, 'created': int(time.time())}
                for part in ({'index': 0, 'delta': delta, 'finish_reason': None}, {'index': 0, 'delta': {}, 'finish_reason': finish}):
                    self.wfile.write(('data: ' + json.dumps({**base, 'choices': [part]}, ensure_ascii=False) + '\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
            except (AssertionError, KeyError, ValueError, OSError) as exc:
                errors.append(type(exc).__name__)
                self.close_connection = True

    def ready():
        with socket.socket() as sock:
            sock.settimeout(.25)
            return sock.connect_ex(('127.0.0.1', port)) == 0

    with ThreadingHTTPServer(('127.0.0.1', 0), Model) as provider:
        if provider.server_port in BAD_PORTS:
            raise RuntimeError('Conflicting local port')
        provider.daemon_threads = True
        threading.Thread(target=provider.serve_forever, daemon=True).start()
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('OPENCLAW_', 'PINKIE_', 'OPENAI_', 'ANTHROPIC_'))
               and k.upper() not in {'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY'}}
        env.update(HOME=str(home), USERPROFILE=str(home), APPDATA=str(out/'roaming'), LOCALAPPDATA=str(out/'local'),
                   TEMP=str(out/'tmp'), TMP=str(out/'tmp'), OPENCLAW_CONFIG_PATH=str(cfg), OPENCLAW_STATE_DIR=str(state),
                   OPENCLAW_GATEWAY_PORT=str(port), OPENCLAW_GATEWAY_TOKEN=token, OPENCLAW_NO_AUTO_UPDATE='1',
                   PINKIE_STATE_ROOT=str(out/'app-state'), PINKIE_ISO_HOME=str(home), PINKIE_GATEWAY_URL=f'http://127.0.0.1:{port}',
                   PINKIE_NODE_BIN=str(node), PINKIE_OPENCLAW_ENTRY=str(runtime), PINKIE_OPENCLAW_RUNTIME=str(runtime.parent/'dist'),
                   PINKIE_RUNTIME_CONFIG_SCHEMA='2026.7', PINKIE_APP_PATH=str(out/'no-app'),
                   NO_PROXY='127.0.0.1,localhost,::1', NODE_DISABLE_COMPILE_CACHE='1', PYTHONUTF8='1')
        env['PATH'] = str(node.parent) + os.pathsep + env.get('PATH', '')
        for key in ('PINKIE_STATE_ROOT', 'PINKIE_APP_PATH', 'PINKIE_RUNTIME_CONFIG_SCHEMA', 'OPENCLAW_CONFIG_PATH', 'OPENCLAW_STATE_DIR'):
            os.environ[key] = env[key]

        def cli(args, filename, timeout=70):
            result = subprocess.run([str(node), str(runtime), *args], cwd=runtime.parent, env=env,
                                    timeout=timeout, capture_output=True)
            (out / filename).write_bytes(result.stdout + result.stderr)
            return result.returncode

        def rpc(method, params, filename):
            assert cli(['gateway', 'call', method, '--params', json.dumps(params), '--json'], filename) == 0, filename
            return json_output(out / filename)

        def turn(mark):
            args = ['agent', '--agent', 'metre', '--session-key', PARENT, '--model', f'mm/{PARENT_MODEL}',
                    '--message', f'{mark}：本机角色草稿测试。', '--json', '--timeout', '95']
            result = cli(args, mark + '.txt', 105)
            assert result == 0, mark

        def visible_cards(filename):
            return rpc('pinkie.session.cards', {'key': PARENT}, filename)['cards']

        def choose(key, action, filename):
            return rpc('pinkie.session.card.act', {'key': PARENT, 'id': key, 'action': action}, filename)

        model_defs = [{'id': mid, 'name': mid, 'input': ['text'], 'reasoning': False,
                       'contextWindow': 65536, 'maxTokens': 4096} for mid in (PARENT_MODEL, CHILD_MODEL)]
        dump(cfg, {'gateway': {'mode': 'local', 'port': port, 'bind': 'loopback', 'auth': {'mode': 'token', 'token': token}},
                   'agents': {'defaults': {'model': {'primary': f'mm/{PARENT_MODEL}', 'fallbacks': []}, 'heartbeat': {'every': '0m'}},
                              'list': [{'id': 'main'}, {'id': 'project', 'workspace': str(here)}, {'id': 'metre', 'workspace': str(metre)}]},
                   'models': {'mode': 'replace', 'providers': {'mm': {'baseUrl': f'http://127.0.0.1:{provider.server_port}/v1',
                               'apiKey': 'local-fixture-only', 'api': 'openai-completions', 'models': model_defs}}},
                   'tools': {'exec': {'host': 'gateway', 'security': 'full', 'ask': 'off'}}})
        try:
            for service in ('project-scope', 'mode-architecture'):
                runpy.run_path(str(REPO/'services'/service/'setup.py'))['install'](home)
            assert 'roles' in [a['id'] for a in read_json(cfg)['agents']['list']]
            print('Synthetic profile prepared; starting the real loopback gateway.', flush=True)
            assert not ready()
            with (out / 'gateway.log').open('wb') as log:
                process = subprocess.Popen([str(node), str(runtime), 'gateway', 'run', '--port', str(port), '--bind', 'loopback',
                                            '--auth', 'token', '--allow-unconfigured'], cwd=runtime.parent, env=env,
                                           stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            deadline = time.monotonic() + 185
            while not ready() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.25)
            assert ready(), 'isolated gateway did not listen'
            print('Gateway ready.', flush=True)
            turn('MAKE-DRAFT')
            candidate = next((row for row in visible_cards('pending.json') if row.get('metreRoleId') == CREATED), None)
            assert candidate and candidate['state'] == 'pending', 'no pending approval card (check parent transcript)'
            draft = metre / 'roles' / 'drafts' / f"{candidate['id']}.md"
            user = metre / 'roles' / 'user' / f'{CREATED}.md'
            assert draft.read_text(encoding='utf-8') == draft_texts[CREATED] and not user.exists()
            turn('TRY-PENDING')
            assert not requests, 'pending draft reached roles agent'
            assert choose(candidate['id'], 'adopt', 'adopted.json')['state'] == 'adopted'
            assert not draft.exists() and user.read_bytes() == draft_texts[CREATED].encode()
            print('Draft not dispatchable before approval; adopted bytes match.', flush=True)
            turn('TRY-ADOPTED')
            for i in range(6):
                if any(MARKER in c.get('text', '') for c in visible_cards(f'parent-{i}.json')):
                    break
                time.sleep(2)
            else:
                raise AssertionError('No role report with fixture source reached the parent')
            turn('MAKE-DISCARD')
            unwanted = next(row for row in visible_cards('pending-discard.json') if row.get('metreRoleId') == DISCARDED)
            assert choose(unwanted['id'], 'reject', 'rejected.json')['state'] == 'rejected'
            assert not (metre / 'roles' / 'drafts' / f"{unwanted['id']}.md").exists()
            assert not (metre / 'roles' / 'user' / f'{DISCARDED}.md').exists()
            assert requests and not errors
            sources = sorted((REPO/'prompts').glob('unrestricted-prompt*.txt'))
            markers = ['OPENCLAW_UR_INJECT']
            for path in sources:
                segments = list(dict.fromkeys(line.strip()[:40] for line in path.read_text(encoding='utf-8').splitlines()
                                              if len(line.strip()) >= 28))[:5]
                assert len(segments) == 5
                markers.extend(segments)
            for raw, capture in requests:
                parts = list(leaves(capture))
                assert any('【角色卡：烟测调研】' in part for part in parts)
                assert all(not any(marker in part for part in parts) for marker in markers)
            failures = sum(any(m in p for m in markers for p in leaves(capture)) for _, capture in requests)
            dump(out/'result.json', {'pendingNotDispatched': True, 'adoptedBytesEqual': True, 'rejectedNoFile': True,
                                   'reportReturned': True, 'provider': 'local-only mock', 'upstreamRequests': 0,
                                   'roleRequestHashes': [sha256(raw).hexdigest() for raw, _ in requests],
                                   'promptFiles': len(sources), 'promptSegments': len(markers)-1, 'unrestrictedHits': failures})
            print('PASS: draft/approve/reject, role report, and captured request invariant; no upstream call.', flush=True)
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            provider.shutdown()
            dump(out/'local-model-events.json', {'events': events, 'errors': errors})
            for index, (raw, _) in enumerate(requests, start=1):
                (out / f'role-request-{index}.json').write_bytes(raw)


if __name__ == '__main__':
    args = ArgumentParser()
    args.add_argument('--runtime-root', type=Path, required=True)
    args.add_argument('--out', type=Path, required=True)
    ns = args.parse_args()
    run(ns.runtime_root.resolve(), ns.out.resolve())
