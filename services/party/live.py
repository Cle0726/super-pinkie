"""Public progress only: coalesced item snapshots, never hidden reasoning."""
import json
import re
import time


def public_host_text(raw):
    """Decode only the top-level message string. Partial tasks are never executed."""
    match = re.match(r'^\s*(?:```(?:json)?\s*)?\{\s*"message"\s*:\s*"', raw)
    if not match:
        return ''
    text = raw[match.end():]
    # raw_decode can decode a completed string even when later JSON is unfinished.
    try:
        return json.JSONDecoder().raw_decode('"' + text)[0]
    except ValueError:
        pass
    # Do not expose an unfinished escape or a lone UTF-16 surrogate to the UI.
    for end in range(len(text), max(-1, len(text) - 13), -1):
        try:
            result = json.loads('"' + text[:end] + '"')
            if result and 0xD800 <= ord(result[-1]) <= 0xDBFF:
                continue
            return result
        except ValueError:
            continue
    return ''


class LiveItems:
    def __init__(self, store, task, redact):
        self.store, self.task, self.redact = store, task, redact
        self.items, self.written = {}, {}
        self.final = ''
        self.assistant_index = 0
        self.assistant_text = ''

    def put(self, key, text, kind='text', status='running', phase=''):
        item = dict(body=text, kind=kind, status=status, phase=phase)
        self.items[key] = item
        now = time.monotonic()
        if status == 'running' and now - self.written.get(key, 0) < .07:
            return
        self.written[key] = now
        self.store.stream_message(self.task, key, self.redact(text), kind, status, phase)

    def finish(self, status='done'):
        for key, item in list(self.items.items()):
            if item['status'] == 'running':
                self.put(key, item['body'], item['kind'], status, item['phase'])

    def codex(self, event):
        method, p = event.get('method'), event.get('params', {})
        if method in ('item/started', 'item/completed'):
            item = p.get('item', {})
            key, typ = item.get('id'), item.get('type')
            if not key:
                return
            status = 'done' if method == 'item/completed' else 'running'
            if item.get('status') in ('failed', 'declined') or item.get('exitCode') not in (None, 0):
                status = 'failed'
            if typ == 'agentMessage':
                text = item.get('text', '')
                self.put(key, text, status=status, phase=item.get('phase') or '')
                if text and status == 'done':
                    self.final = text
            elif typ == 'plan':
                self.put(key, item.get('text', ''), 'progress', status)
            elif typ in ('commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch'):
                detail = item.get('command') or item.get('tool') or item.get('query') or '文件变更'
                if typ == 'fileChange':
                    detail = '\n'.join(c.get('path', '') for c in item.get('changes', []))
                output = item.get('aggregatedOutput') or item.get('result') or item.get('error') or ''
                if not isinstance(output, str):
                    output = json.dumps(output, ensure_ascii=False)
                self.put(key, str(detail) + ('\n' + output[-8000:] if output else ''), 'tool', status)
        elif method == 'item/agentMessage/delta':
            key = p.get('itemId')
            if key:
                old = self.items.get(key, {})
                self.put(key, old.get('body', '') + p.get('delta', ''), phase=old.get('phase', ''))
        elif method in ('item/commandExecution/outputDelta', 'item/fileChange/outputDelta'):
            key = p.get('itemId')
            if key and key in self.items:
                self.put(key, (self.items[key]['body'] + p.get('delta', ''))[-10000:], 'tool')
        # No reasoning streams, private summaries, or raw notification dumps.

    def openclaw(self, event):
        stream, data = event.get('stream'), event.get('data', {})
        if stream == 'assistant':
            self.assistant_text = data.get('text') if isinstance(data.get('text'), str) else self.assistant_text + data.get('delta', '')
            text = public_host_text(self.assistant_text) if self.task['agent'] == 'pinkie' else self.assistant_text
            if text:
                self.put('reply' if self.task['agent'] == 'pinkie' else 'assistant-' + str(self.assistant_index), text)
        elif stream == 'tool' and data.get('toolCallId'):
            key = data['toolCallId']
            if data.get('phase') == 'start' and self.assistant_text:
                self.finish()
                self.assistant_index += 1
                self.assistant_text = ''
            status = 'done' if data.get('phase') == 'result' else 'running'
            if data.get('isError'):
                status = 'failed'
            detail = data.get('args') if data.get('phase') == 'start' else data.get('result', data.get('partialResult', ''))
            self.put(key, data.get('name', '工具') + '\n' + json.dumps(detail, ensure_ascii=False)[-8000:], 'tool', status)
