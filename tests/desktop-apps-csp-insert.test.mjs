import test from 'node:test';
import assert from 'node:assert/strict';
import {FILE_GUARD, withPolicy} from '../services/mode-architecture/desktop-apps.mjs';

// CSP 是 <meta>，只管插进去之后的内容。插进注释、或插在已经出现的脚本 / 图片后面，等于没拦。
const cspAt = html => html.indexOf('Content-Security-Policy');
const fetchAt = html => html.indexOf('fetch("https://evil.example")');

test('CSP 不插进注释，并且盖住注释后面的脚本', () => {
  const html = withPolicy('<!-- <head> --><script>fetch("https://evil.example")</script><head></head>', {});
  assert.ok(cspAt(html) >= 0 && cspAt(html) < html.indexOf('<!--'), '策略不能落在注释里面');
  assert.ok(html.indexOf(FILE_GUARD) < fetchAt(html), '守卫也要在作品脚本之前');
  assert.doesNotMatch(html.slice(html.indexOf('<!--'), html.indexOf('-->') + 3), /Content-Security-Policy/);
});

test('head 前面已经有脚本、模板或图片时，策略插在它们之前', () => {
  const beforeHead = withPolicy('<html><script>fetch("https://evil.example")</script><head></head>', {});
  assert.match(beforeHead, /^<html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/);
  assert.ok(cspAt(beforeHead) < beforeHead.indexOf('<script>fetch'));

  const templ = withPolicy('<template><head></head></template><script>fetch("https://evil.example")</script>', {});
  assert.ok(cspAt(templ) >= 0 && cspAt(templ) < templ.indexOf('<template>'));
  assert.ok(htmlGuardBefore(templ), '模板里的 head 不能把策略吞进去');

  const img = withPolicy('<img src="https://evil.example/a.png"><head></head>', {});
  assert.ok(cspAt(img) >= 0 && cspAt(img) < img.indexOf('<img'));
});

test('脚本字符串里的 <head> 不会把策略插进字符串', () => {
  const html = withPolicy('<script>const s="<head>"</script><script>fetch("https://evil.example")</script>', {});
  assert.ok(cspAt(html) >= 0 && cspAt(html) < html.indexOf('const s="<head>"'));
  assert.match(html, /const s="<head>"/);
  assert.ok(html.indexOf(FILE_GUARD) < fetchAt(html));
});

test('注释里的假 head / 假 doctype 不算插入点', () => {
  const html = withPolicy('<html><!-- <head> --><script>fetch("https://evil.example")</script></html>', {});
  assert.match(html, /^<html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/);
  assert.ok(cspAt(html) < html.indexOf('<!--'));

  const padded = withPolicy('<!-- <!doctype html> -->' + 'x'.repeat(2000) + '<html><head><title>t</title></head>', {});
  assert.ok(padded.indexOf('<meta charset="utf-8">') < padded.indexOf('<!--'), '编码声明不能补进注释');
  assert.ok(cspAt(padded) < padded.indexOf('<!--'), '注释里的 doctype 不能把策略留到后面');
  const comment = padded.slice(padded.indexOf('<!--'), padded.indexOf('-->') + 3);
  assert.doesNotMatch(comment, /Content-Security-Policy|charset="utf-8"/);
});

test('正常文档的插入点不变：head 里、只有 html 时跟在 html 后、片段放最前', () => {
  assert.match(withPolicy('<html lang="zh"><head><title>t</title></head></html>', {}), /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/);
  assert.match(withPolicy('<!doctype html><html><body>b</body></html>', {}), /^<!doctype html><html><meta /);
  assert.match(withPolicy('<p>片段</p>', {}), /^<meta charset="utf-8"><meta http-equiv/);
  const files = withPolicy('<html><head><title>t</title></head></html>', {files: true});
  assert.ok(!files.includes(FILE_GUARD));
  assert.ok(cspAt(files) < files.indexOf('<title>'));
});

function htmlGuardBefore(html) {
  return html.indexOf(FILE_GUARD) >= 0 && html.indexOf(FILE_GUARD) < html.indexOf('<template>');
}
