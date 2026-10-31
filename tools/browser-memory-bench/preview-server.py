from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import json
root=Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root/'preview'),**kwargs)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
(root/'preview-endpoint.json').write_text(json.dumps({'url':'http://127.0.0.1:'+str(server.server_port)}))
print('preview port',server.server_port,flush=True)
server.serve_forever()
