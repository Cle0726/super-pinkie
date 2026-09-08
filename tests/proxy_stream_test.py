"""Exercise actual HTTPResponse chunking, without contacting a model."""
import ast
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import unittest
import urllib.request

ROOT=Path(__file__).resolve().parents[1]

class ProxyStreamTests(unittest.TestCase):
    @staticmethod
    def free_port():
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sock.close()
        return port

    def stream_reader(self, filename):
        source=(ROOT/'proxy'/filename).read_text();tree=ast.parse(source)
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name.endswith('ProxyHandler'))
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='read_complete_sse')
        support=[n for n in tree.body if
                 isinstance(n,ast.ClassDef) and n.name=='IncompleteUpstreamStream'
                 or isinstance(n,ast.FunctionDef) and n.name in {'stream_payload_complete','stream_payload_error'}]
        env={'http':http,'json':__import__('json'),'re':__import__('re'),'MAX_BUFFER_BYTES':8*1024*1024}
        exec(compile(ast.Module(body=support+[method],type_ignores=[]),filename,'exec'),env)
        return env

    def response_pair(self, final=True):
        left,right=socket.socketpair();release=threading.Event()
        def upstream():
            right.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n')
            data='data: 你好🎉\n\n'.encode();right.sendall(hex(len(data))[2:].encode()+b'\r\n'+data+b'\r\n')
            release.wait(2)
            if final:
                done=b'data: [DONE]\n\n';right.sendall(hex(len(done))[2:].encode()+b'\r\n'+done+b'\r\n')
            right.sendall(b'0\r\n\r\n')
        thread=threading.Thread(target=upstream);thread.start()
        response=http.client.HTTPResponse(left);response.begin()
        return left,right,response,release,thread

    def test_model_sse_is_held_until_a_terminal_event_makes_replay_safe(self):
        for filename in ('ur-rewrite-proxy.py','mm-retry-proxy.py'):
            env=self.stream_reader(filename)
            left,right,response,release,thread=self.response_pair(final=True)
            result=[];errors=[]
            args=(object(),response,b'') if filename.startswith('mm-') else (object(),response)
            # Preserve assertion details from the worker instead of swallowing them.
            def run():
                try: result.append(env['read_complete_sse'](*args))
                except Exception as error: errors.append(error)
            worker=threading.Thread(target=run);worker.start()
            try:
                time.sleep(.15)
                self.assertTrue(worker.is_alive(),filename+' leaked a partial SSE response')
                self.assertEqual(result,[])
                release.set();worker.join(2);thread.join(2)
                self.assertEqual(errors,[]);self.assertIn('你好🎉'.encode(),result[0]);self.assertIn(b'[DONE]',result[0])
            finally:
                release.set();response.close();left.close();right.close()

    def test_incomplete_sse_is_retryable_before_any_downstream_bytes(self):
        for filename in ('ur-rewrite-proxy.py','mm-retry-proxy.py'):
            env=self.stream_reader(filename)
            left,right,response,release,thread=self.response_pair(final=False)
            args=(object(),response,b'') if filename.startswith('mm-') else (object(),response)
            release.set()
            try:
                with self.assertRaises(env['IncompleteUpstreamStream']):env['read_complete_sse'](*args)
            finally:
                thread.join(2);response.close();left.close();right.close()

    def test_real_proxy_replays_a_truncated_model_stream(self):
        """The first broken SSE must never reach the client; attempt two wins."""
        complete = (
            b'data: {"choices":[{"delta":{"content":"RECOVERED"},'
            b'"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        )
        partial = b'data: {"choices":[{"delta":{"content":"BROKEN"}}]}\n\n'

        for filename in ('ur-rewrite-proxy.py', 'mm-retry-proxy.py'):
            class Upstream(BaseHTTPRequestHandler):
                calls = 0

                def do_POST(self):
                    length = int(self.headers.get('Content-Length', '0'))
                    if length:
                        self.rfile.read(length)
                    type(self).calls += 1
                    payload = partial if type(self).calls == 1 else complete
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.send_header('Content-Length', str(len(payload)))
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    self.wfile.write(payload)

                def log_message(self, *_args):
                    pass

            upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
            upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
            upstream_thread.start()
            proxy_port = self.free_port()
            env = dict(os.environ)
            env.update({
                'UR_PROXY_UPSTREAM_HOST': '127.0.0.1',
                'UR_PROXY_UPSTREAM_PORT': str(upstream.server_port),
                'UR_PROXY_MAX_ATTEMPTS': '4',
            })
            command = [sys.executable, str(ROOT / 'proxy' / filename), str(proxy_port)]
            if filename.startswith('mm-'):
                command.append(str(upstream.server_port))
            process = subprocess.Popen(
                command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                deadline = time.time() + 5
                while True:
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{proxy_port}/health', timeout=.3):
                            break
                    except Exception:
                        if time.time() >= deadline:
                            self.fail(filename + ' did not start')
                        time.sleep(.05)
                request = urllib.request.Request(
                    f'http://127.0.0.1:{proxy_port}/v1/chat/completions',
                    data=json.dumps({'model': 'test', 'stream': True, 'messages': []}).encode(),
                    headers={'Content-Type': 'application/json'},
                )
                with urllib.request.urlopen(request, timeout=5) as response:
                    delivered = response.read()
                self.assertEqual(Upstream.calls, 2, filename)
                self.assertNotIn(b'BROKEN', delivered, filename)
                self.assertIn(b'RECOVERED', delivered, filename)
                self.assertIn(b'[DONE]', delivered, filename)
            finally:
                process.terminate()
                try:
                    process.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=3)
                upstream.shutdown()
                upstream.server_close()
                upstream_thread.join(2)

    def test_both_proxies_retry_stream_breaks_at_high_frequency(self):
        for filename in ('ur-rewrite-proxy.py','mm-retry-proxy.py'):
            source=(ROOT/'proxy'/filename).read_text()
            self.assertIn("if getattr(self, 'response_started', False):",source)
            self.assertIn('read_complete_sse(response',source)
            self.assertIn('UR_PROXY_MAX_ATTEMPTS',source)
            self.assertIn('UR_PROXY_STREAM_IDLE_TIMEOUT',source)
            self.assertIn('SSE ended before terminal model event',source)

    def test_default_retry_window_tolerates_a_flapping_upstream(self):
        """Defaults must wait long enough for a slow provider to recover."""
        for filename in ('ur-rewrite-proxy.py', 'mm-retry-proxy.py'):
            source = (ROOT / 'proxy' / filename).read_text()
            self.assertRegex(source, r'UR_PROXY_MAX_ATTEMPTS[^\n]*"64"', filename)
            self.assertRegex(source, r'UR_PROXY_FIRST_BYTE_TIMEOUT[^\n]*"35"', filename)
            self.assertRegex(source, r'UR_PROXY_STREAM_IDLE_TIMEOUT[^\n]*"30"', filename)
            self.assertRegex(source, r'UR_PROXY_RETRY_BASE_DELAY[^\n]*"0\.2"', filename)
            self.assertRegex(source, r'UR_PROXY_RETRY_MAX_DELAY[^\n]*"3"', filename)
            self.assertIn('RETRY_MAX_DELAY_SECONDS', source, filename)

    def test_gemini_38_uses_the_hard_prompt_route(self):
        for filename in ('ur-rewrite-proxy.py','mm-retry-proxy.py'):
            source=(ROOT/'proxy'/filename).read_text()
            self.assertIn('gemini-3.8-flash-tiered', source, filename)
            self.assertIn('unrestricted-prompt-gemini-hard.txt', source, filename)
        self.assertIn(
            '"gemini-3.8-flash-tiered": "gemini-3.7-flash-tiered"',
            (ROOT/'proxy'/'mm-retry-proxy.py').read_text(),
        )

if __name__=='__main__':unittest.main()
