"""Exercise actual HTTPResponse chunking, without contacting a model."""
import ast
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
from pathlib import Path
import socket
import threading
import time
import unittest

ROOT=Path(__file__).resolve().parents[1]

class ProxyStreamTests(unittest.TestCase):
    def test_first_small_event_is_relayed_without_waiting_for_eof(self):
        for filename,classname in [('ur-rewrite-proxy.py','RewriteProxyHandler'),('mm-retry-proxy.py','RetryProxyHandler')]:
            source=(ROOT/'proxy'/filename).read_text();tree=ast.parse(source)
            cls=next(n for n in tree.body if isinstance(n,ast.ClassDef))
            relay=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='relay')
            env={'HOP_BY_HOP_HEADERS':set()};exec(compile(ast.Module(body=[relay],type_ignores=[]),filename,'exec'),env)
            left,right=socket.socketpair();first=threading.Event();release=threading.Event()
            def upstream():
                right.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n')
                data='data: 你好🎉\n\n'.encode();right.sendall(hex(len(data))[2:].encode()+b'\r\n'+data+b'\r\n')
                release.wait(2);right.sendall(b'0\r\n\r\n')
            thread=threading.Thread(target=upstream);thread.start()
            response=http.client.HTTPResponse(left);response.begin()
            class Writer(io.BytesIO):
                def write(self,data):first.set();return super().write(data)
            class Sink:
                wfile=Writer()
                def send_response(self,*a):pass
                def send_header(self,*a):pass
                def end_headers(self):pass
            sink=Sink();worker=threading.Thread(target=env['relay'],args=(sink,response));worker.start()
            try:
                self.assertTrue(first.wait(.6),filename+' buffered the first SSE chunk')
                self.assertIn('你好🎉'.encode(),sink.wfile.getvalue())
                self.assertTrue(sink.response_started)
            finally:release.set();worker.join(2);thread.join(2);response.close();left.close();right.close()

    def test_both_proxies_stop_retries_after_headers(self):
        for filename in ('ur-rewrite-proxy.py','mm-retry-proxy.py'):
            source=(ROOT/'proxy'/filename).read_text()
            self.assertIn("if getattr(self, 'response_started', False):",source)
            self.assertIn('response.read1(64 * 1024)',source)

if __name__=='__main__':unittest.main()
