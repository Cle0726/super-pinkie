import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {FILE_GUARD, withPolicy} from '../services/mode-architecture/desktop-apps.mjs';

function install() {
  const clicks = [];
  const proto = {
    click() { this.clicked = true; },
    showPicker() { this.picked = true; },
  };
  const sandbox = {
    DOMException: class DOMException extends Error {
      constructor(message, name) { super(message); this.name = name; }
    },
    Promise, Object,
    addEventListener(type, fn) { if (type === 'click') clicks.push(fn); },
    window: {},
    HTMLInputElement: {prototype: proto},
  };
  assert.match(FILE_GUARD, /^<script>[\s\S]*<\/script>$/);
  vm.runInNewContext(FILE_GUARD.slice('<script>'.length, -'</script>'.length), sandbox);
  const fire = path => {
    const event = {
      target: path[0],
      composedPath: () => path,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    clicks[0](event);
    return event;
  };
  return {proto, window: sandbox.window, fire};
}

test('没勾读文件：影子树里的选择框、showPicker 和三个选择器 API 都打不开', async () => {
  const guard = install();
  const input = {tagName: 'INPUT', type: 'file'};
  const host = {tagName: 'DIV'};
  const shadow = guard.fire([host, input]);
  assert.equal(shadow.prevented, true, '影子树把 target 换成宿主，守卫仍要拦里面的文件框');
  assert.equal(shadow.stopped, true);
  const label = guard.fire([{tagName: 'LABEL', control: input}]);
  assert.equal(label.prevented, true);
  const plain = guard.fire([input]);
  assert.equal(plain.prevented, true);
  const textClick = guard.fire([{tagName: 'INPUT', type: 'text'}]);
  assert.equal(textClick.prevented, undefined);

  const file = {type: 'file'};
  assert.throws(() => guard.proto.showPicker.call(file), error => error.name === 'NotAllowedError' && error.message.includes('没有读文件'));
  assert.equal(file.picked, undefined);
  const text = {type: 'text'};
  guard.proto.showPicker.call(text);
  assert.equal(text.picked, true, '不是文件框的 showPicker 照旧');

  guard.proto.click.call(file);
  assert.equal(file.clicked, undefined);
  guard.proto.click.call(text);
  assert.equal(text.clicked, true);

  await assert.rejects(guard.window.showOpenFilePicker(), error => error.name === 'NotAllowedError');
  await assert.rejects(guard.window.showDirectoryPicker(), error => error.name === 'NotAllowedError');
  await assert.rejects(guard.window.showSaveFilePicker(), error => error.name === 'NotAllowedError');
});

test('守卫跟 CSP 一起放在作品脚本前面；勾了读文件就不插这段', () => {
  const html = withPolicy('<html><head><title>t</title></head><body><script>box.showPicker()</script></body></html>');
  const guard = html.indexOf('composedPath');
  assert.ok(guard > html.indexOf('Content-Security-Policy') && guard < html.indexOf('box.showPicker()'));
  assert.equal(html.includes(FILE_GUARD), true);
  const opened = withPolicy('<html><head><title>t</title></head></html>', {files: true});
  assert.equal(opened.includes('composedPath'), false);
  assert.equal(opened.includes('showPicker'), false);
});
