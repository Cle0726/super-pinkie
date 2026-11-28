import http.client
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('roundtable_server_wb', ROOT/'services/roundtable/server.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

MODELS = [{'id': 'relay/a', 'name': 'A', 'provider': 'relay'}]


def note(item_id, text='想法', x=10):
    return {'id': item_id, 'kind': 'note', 'x': x, 'y': 20, 'w': 160, 'h': 100, 'text': text, 'color': 'mint'}


class RoundtableWhiteboardTests(unittest.TestCase):
    """灵感圆桌的白板：规则和 services/mode-architecture/whiteboard-store.mjs 一致。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = mock.patch.dict(os.environ, {'PINKIE_STATE_ROOT': str(Path(self.temp.name)/'state')})
        self.state.start()
        self.models = mock.patch.object(MODULE, 'available_models', return_value=MODELS)
        self.models.start()
        self.store = MODULE.Store(self.temp.name)
        self.session = self.store.create_session('白板圆桌')['id']

    def tearDown(self):
        self.store.db.close()
        self.models.stop()
        self.state.stop()
        self.temp.cleanup()

    def put(self, item, base=0, actor='user'):
        return self.store.apply_whiteboard(self.session, [{'op': 'put', 'baseRev': base, 'item': item}], actor)

    def test_new_board_is_empty_and_server_stamps_who_changed_it(self):
        self.assertEqual({'ok': True, 'rev': 0, 'items': []}, self.store.whiteboard(self.session))
        result = self.put({**note('note-aaaa'), 'by': 'pinkie', 'rev': 99, 'extra': 'x'})
        self.assertEqual(1, result['rev'])
        item = result['applied'][0]
        self.assertEqual(('user', 1), (item['by'], item['rev']))
        self.assertNotIn('extra', item)
        self.assertEqual(['note-aaaa'], [it['id'] for it in self.store.whiteboard(self.session)['items']])

    def test_stale_edit_does_not_overwrite_newer_change(self):
        self.put(note('note-aaaa', '原文'))
        self.put(note('note-aaaa', '碧琪改的'), base=1, actor='pinkie')
        result = self.put(note('note-aaaa', '用户旧版本'), base=1)
        self.assertEqual([], result['applied'])
        self.assertEqual('碧琪改的', result['conflicts'][0]['text'])
        self.assertEqual('碧琪改的', self.store.whiteboard(self.session)['items'][0]['text'])

    def test_different_items_both_apply_and_delete_leaves_tombstone(self):
        self.put(note('note-aaaa'))
        self.put(note('note-bbbb', x=300), actor='pinkie')
        result = self.store.apply_whiteboard(self.session, [{'op': 'del', 'baseRev': 1, 'id': 'note-aaaa'}], 'user')
        self.assertTrue(result['applied'][0]['deleted'])
        self.assertEqual(['note-bbbb'], [it['id'] for it in self.store.whiteboard(self.session)['items']])
        since = self.store.whiteboard(self.session, 2)['items']
        self.assertEqual([('note-aaaa', True)], [(it['id'], it.get('deleted', False)) for it in since])

    def test_link_follows_its_ends(self):
        self.store.apply_whiteboard(self.session, [
            {'op': 'put', 'baseRev': 0, 'item': note('note-aaaa')},
            {'op': 'put', 'baseRev': 0, 'item': note('note-bbbb', x=300)},
            {'op': 'put', 'baseRev': 0, 'item': {'id': 'link-cccc', 'kind': 'link', 'from': 'note-aaaa', 'to': 'note-bbbb'}},
        ], 'user')
        result = self.store.apply_whiteboard(self.session, [{'op': 'del', 'baseRev': 2, 'id': 'note-bbbb'}], 'user')
        self.assertEqual({'note-bbbb', 'link-cccc'}, {it['id'] for it in result['applied']})
        self.assertEqual(['note-aaaa'], [it['id'] for it in self.store.whiteboard(self.session)['items']])

    def test_bad_input_rejects_whole_batch(self):
        cases = [
            [{'op': 'put', 'baseRev': 0, 'item': note('x')}],
            [{'op': 'put', 'item': note('note-aaaa')}],
            [{'op': 'put', 'baseRev': 0, 'item': {**note('note-aaaa'), 'w': 2}}],
            [{'op': 'put', 'baseRev': 0, 'item': {**note('note-aaaa'), 'text': '长' * 2001}}],
            [{'op': 'put', 'baseRev': 0, 'item': {'id': 'ink-aaaa', 'kind': 'ink', 'points': [[0, 0]]}}],
            [{'op': 'put', 'baseRev': 0, 'item': note('note-aaaa')}, {'op': 'move', 'baseRev': 0}],
            [],
        ]
        for ops in cases:
            with self.subTest(ops=ops), self.assertRaises(ValueError):
                self.store.apply_whiteboard(self.session, ops, 'user')
        with self.assertRaises(ValueError):
            self.store.apply_whiteboard(self.session, [{'op': 'put', 'baseRev': 0, 'item': note('note-aaaa')}], 'someone')
        self.assertEqual(0, self.store.whiteboard(self.session)['rev'])

    def test_ink_points_round_like_javascript(self):
        item = self.put({'id': 'ink-aaaa', 'kind': 'ink', 'points': [[0.25, 1.05], [2.35, 3]], 'width': 40})['applied'][0]
        self.assertEqual([[0.3, 1.1], [2.4, 3]], item['points'])
        self.assertEqual(2, item['width'])

    def test_unknown_session_and_restart(self):
        with self.assertRaisesRegex(ValueError, '圆桌不存在'):
            self.store.whiteboard('f' * 32)
        self.put(note('note-aaaa', '留下来'))
        self.store.db.close()
        self.store = MODULE.Store(self.temp.name)
        self.assertEqual('留下来', self.store.whiteboard(self.session)['items'][0]['text'])

    def test_http_routes_require_page_token(self):
        server = MODULE.ThreadingHTTPServer(('127.0.0.1', 0), MODULE.Handler)
        server.token, server.store = 'tok', self.store
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_port
        host = '127.0.0.1:' + str(port)

        def call(method, path, body=None, token='tok'):
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            headers = {'Host': host}
            if body is not None:
                headers.update({'Content-Type': 'application/json', 'Origin': 'http://' + host, 'X-Roundtable-Token': token})
            conn.request(method, path, json.dumps(body) if body is not None else None, headers)
            res = conn.getresponse()
            data = res.read()
            conn.close()
            return res.status, data

        try:
            path = '/api/sessions/' + self.session + '/whiteboard'
            ops = {'ops': [{'op': 'put', 'baseRev': 0, 'item': note('note-aaaa')}]}
            self.assertEqual(403, call('POST', path, ops, token='wrong')[0])
            status, data = call('POST', path, ops)
            self.assertEqual(200, status)
            self.assertEqual('user', json.loads(data)['applied'][0]['by'])
            status, data = call('GET', path + '?since=0')
            self.assertEqual((200, 1), (status, len(json.loads(data)['items'])))
            self.assertEqual(400, call('GET', '/api/sessions/' + 'f' * 32 + '/whiteboard')[0])
            for asset in ('/whiteboard.js', '/whiteboard.css', '/dom-watch.js', '/laolao-rich-chart.js'):
                self.assertEqual(200, call('GET', asset)[0], asset)
        finally:
            server.shutdown()
            server.server_close()


class PinkieBoardRouteTests(unittest.TestCase):
    """碧琪那一席动圆桌白板：一次性令牌、只认本机进程、记成 pinkie。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = mock.patch.dict(os.environ, {'PINKIE_STATE_ROOT': str(Path(self.temp.name)/'state')})
        self.state.start()
        self.models = mock.patch.object(MODULE, 'available_models', return_value=MODELS)
        self.models.start()
        self.store = MODULE.Store(self.temp.name)
        self.session = self.store.create_session('碧琪动手')['id']
        self.other = self.store.create_session('另一张')['id']
        self.server = MODULE.ThreadingHTTPServer(('127.0.0.1', 0), MODULE.Handler)
        self.server.token, self.server.store = 'page-token', self.store
        self.server.roundtable = MODULE.Roundtable(self.store)
        self.server.roundtable.board_url = 'http://127.0.0.1:' + str(self.server.server_port)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.host = '127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.roundtable.pool.shutdown(wait=False, cancel_futures=True)
        self.store.db.close()
        self.models.stop()
        self.state.stop()
        self.temp.cleanup()

    def post(self, session, body, board='', origin=None, page=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Host': self.host, 'Content-Type': 'application/json'}
        if board:
            headers['X-Roundtable-Board'] = board
        if origin:
            headers['Origin'] = origin
        if page:
            headers['X-Roundtable-Token'] = page
        conn.request('POST', '/api/sessions/' + session + '/whiteboard/pinkie', json.dumps(body), headers)
        res = conn.getresponse()
        data = json.loads(res.read() or b'{}')
        conn.close()
        return res.status, data

    def test_token_lets_pinkie_write_as_pinkie(self):
        token = self.server.roundtable.issue_board_token(self.session)
        ops = {'ops': [{'op': 'put', 'baseRev': 0, 'item': note('note-pink1', '碧琪的想法')}]}
        status, data = self.post(self.session, ops, board=token)
        self.assertEqual(200, status)
        self.assertEqual('pinkie', data['applied'][0]['by'])
        status, data = self.post(self.session, {'read': True}, board=token)
        self.assertEqual((200, ['碧琪的想法']), (status, [it['text'] for it in data['items']]))

    def test_rejects_wrong_token_other_session_page_token_and_browsers(self):
        token = self.server.roundtable.issue_board_token(self.session)
        ops = {'ops': [{'op': 'put', 'baseRev': 0, 'item': note('note-pink1')}]}
        self.assertEqual(403, self.post(self.session, ops)[0])
        self.assertEqual(403, self.post(self.session, ops, board='x' * 43)[0])
        self.assertEqual(403, self.post(self.other, ops, board=token)[0])
        self.assertEqual(403, self.post(self.session, ops, page='page-token', origin='http://' + self.host)[0])
        self.assertEqual(403, self.post(self.session, ops, board=token, origin='http://' + self.host)[0])
        self.assertEqual(0, self.store.whiteboard(self.session)['rev'])

    def test_token_is_gone_after_the_run_and_without_a_server_url(self):
        token = self.server.roundtable.issue_board_token(self.session)
        self.assertEqual(self.session, self.server.roundtable.board_session(token))
        self.server.roundtable.board_tokens.pop(token)
        self.assertEqual('', self.server.roundtable.board_session(token))
        self.assertEqual(403, self.post(self.session, {'read': True}, board=token)[0])
        self.assertEqual('', MODULE.Roundtable(self.store).issue_board_token(self.session))

    def test_only_pinkie_seat_gets_the_token_and_it_is_dropped_in_finally(self):
        source = (ROOT/'services/roundtable/server.py').read_text(encoding='utf-8')
        invoke = source[source.index('    def invoke(self, run_id'):source.index('    def worker_prompt(')]
        self.assertIn("board_token = self.issue_board_token(session['id']) if member == 'pinkie' else ''", invoke)
        self.assertIn('self.board_tokens.pop(board_token, None)', invoke[invoke.index('finally:'):])
        self.assertNotIn('PINKIE_ROUNDTABLE_BOARD', source[source.index('    def run_worker('):])


if __name__ == '__main__':
    unittest.main()
