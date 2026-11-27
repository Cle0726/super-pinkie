"""tools/study-desk/deploy-game.py 的纯逻辑单测。

这个上线脚本模块顶层就会对 /Users/Admin/release-superpinkie/repo 跑 git、读 App 包、写备份，
不能整份导入。这里用 ast 只摘出要测的函数和顶层语句，放进自建的命名空间里执行：
不跑 git 仓库命令、不读 App 包和用户目录、不联网。merge() 要用 `git merge-file`（只比三个临时文件，
不需要仓库），运行时屏蔽全局 / 系统 git 配置。
"""
from pathlib import Path
from unittest import mock
import ast
import os
import re
import shutil
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tools' / 'study-desk' / 'deploy-game.py'
FRAGMENT = ROOT / 'ui' / 'injections' / 'laolao-head.fragment.html'
TEXT = SOURCE.read_text(encoding='utf-8')
TREE = ast.parse(TEXT, str(SOURCE))


def targets(node):
    if isinstance(node, ast.Assign):
        return {t.id for t in node.targets if isinstance(t, ast.Name)}
    return set()


def segment(node):
    return ast.get_source_segment(TEXT, node) or ''


def run_nodes(nodes, ns):
    """把摘出来的顶层语句按原顺序编译执行；ns 里只放测试给的假数据。"""
    module = ast.Module(body=list(nodes), type_ignores=[])
    exec(compile(module, str(SOURCE), 'exec'), ns)
    return ns


def assigns(*names):
    return [n for n in TREE.body if targets(n) & set(names)]


def between(start, end):
    """从源码含 start 的第一条顶层语句，到其后第一条含 end 的语句（含两端）。"""
    body = TREE.body
    first = next(i for i, n in enumerate(body) if start in segment(n))
    last = next(i for i in range(first, len(body)) if end in segment(body[i]))
    return body[first:last + 1]


def functions():
    wanted = {'branded', 'same_versions', 'merge'}
    nodes = [n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
    assert {n.name for n in nodes} == wanted, '被测函数改名或删掉了'
    return run_nodes(nodes, {'re': re, 'subprocess': subprocess, 'tempfile': tempfile, 'Path': Path})


FN = functions()
CONST = run_nodes(assigns('BASE', 'VERSION'), {})


class ArgsTest(unittest.TestCase):
    """命令行解析：只认 --check / --rev= / --base=，其他参数直接退出。"""

    def parse(self, *argv):
        nodes = [n for n in TREE.body if targets(n) & {'ARGS', 'CHECK', 'REV', 'MERGE_BASE', 'BASE'}
                 or (isinstance(n, ast.If) and '用法' in segment(n))]
        fake_sys = types.SimpleNamespace(argv=['deploy-game.py', *argv], exit=sys.exit)
        return run_nodes(nodes, {'sys': fake_sys})

    def test_defaults(self):
        ns = self.parse()
        self.assertFalse(ns['CHECK'])
        self.assertEqual('review/study-game', ns['REV'])
        # 不传 --base 时合并基准退回背一背上线那次的提交。
        self.assertEqual('069c5cc', ns['BASE'])
        self.assertEqual(ns['BASE'], ns['MERGE_BASE'])

    def test_check_rev_and_base(self):
        ns = self.parse('--check', '--rev=4121bdc', '--base=abc=def')
        self.assertTrue(ns['CHECK'])
        self.assertEqual('4121bdc', ns['REV'])
        # 只按第一个等号切，值里还有等号也保留。
        self.assertEqual('abc=def', ns['MERGE_BASE'])

    def test_unknown_argument_exits_with_usage(self):
        for bad in ('--chek', '--rev', 'extra', '--base'):
            with self.subTest(bad=bad):
                with self.assertRaises(SystemExit) as ctx:
                    self.parse('--check', bad)
                self.assertIn('用法：deploy-game.py', str(ctx.exception.code))


class BrandedTest(unittest.TestCase):
    def test_replaces_every_li_an(self):
        self.assertEqual('碧琪说：碧琪来了'.encode(), FN['branded']('Li An说：Li An来了'.encode()))

    def test_returns_utf8_bytes_and_keeps_other_text(self):
        data = 'const name = "Pinkie"; // 学习台\n'.encode()
        self.assertEqual(data, FN['branded'](data))
        self.assertIsInstance(FN['branded'](b'Li An'), bytes)

    def test_case_sensitive(self):
        self.assertEqual(b'li an LI AN', FN['branded'](b'li an LI AN'))

    def test_non_utf8_input_raises(self):
        with self.assertRaises(UnicodeDecodeError):
            FN['branded'](b'\xff\xfeLi An')


class SameVersionsTest(unittest.TestCase):
    same = staticmethod(lambda ours, base: FN['same_versions'](ours, base))

    def test_live_versions_take_base_values(self):
        base = b'load("laolao-a.js?v=1"); load("laolao-b.css?v=b1");'
        ours = b'load("laolao-a.js?v=drill2"); load("laolao-b.css?v=live.9");'
        self.assertEqual(base, self.same(ours, base))

    def test_names_unknown_to_base_keep_their_version(self):
        out = self.same(b'laolao-new.js?v=7 laolao-a.js?v=9', b'laolao-a.js?v=1')
        self.assertEqual(b'laolao-new.js?v=7 laolao-a.js?v=1', out)

    def test_first_occurrence_in_base_wins(self):
        out = self.same(b'laolao-a.js?v=x', b'laolao-a.js?v=first laolao-a.js?v=second')
        self.assertEqual(b'laolao-a.js?v=first', out)

    def test_only_laolao_js_css_are_touched(self):
        ours = b'other.js?v=2 laolao-a.png?v=2 laolao-a.js?v=2'
        out = self.same(ours, b'other.js?v=1 laolao-a.png?v=1 laolao-a.js?v=1')
        self.assertEqual(b'other.js?v=2 laolao-a.png?v=2 laolao-a.js?v=1', out)

    def test_dotted_names_match_whole_file_name(self):
        out = self.same(b'laolao-vendor-three.module.min.js?v=9', b'laolao-vendor-three.module.min.js?v=r1')
        self.assertEqual(b'laolao-vendor-three.module.min.js?v=r1', out)

    def test_no_versions_is_identity(self):
        data = 'function 背一背() {}\n'.encode()
        self.assertEqual(data, self.same(data, b'laolao-a.js?v=1'))


@unittest.skipUnless(shutil.which('git'), '需要 git merge-file')
class MergeTest(unittest.TestCase):
    """三方合并：我方 = 线上文件，基准 = 上次装的提交，对方 = 新版本。"""

    def setUp(self):
        # 屏蔽用户 / 系统 git 配置（如 merge.conflictStyle），结果只取决于输入。
        patcher = mock.patch.dict(os.environ, {'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'})
        patcher.start()
        self.addCleanup(patcher.stop)

    def merge(self, ours, base, theirs, label='live/learning.mjs'):
        return FN['merge'](ours, base, theirs, label)

    def test_non_overlapping_changes_merge_cleanly(self):
        base = b'a\nb\nc\nd\ne\nf\n'
        ours = b'live-top\na\nb\nc\nd\ne\nf\n'
        theirs = b'a\nb\nc\nd\ne\nf\ngame-bottom\n'
        self.assertEqual(b'live-top\na\nb\nc\nd\ne\nf\ngame-bottom\n', self.merge(ours, base, theirs))

    def test_unchanged_live_becomes_theirs(self):
        base = b'x\ny\n'
        self.assertEqual(b'x\nY\n', self.merge(base, base, b'x\nY\n'))

    def test_unchanged_theirs_keeps_live(self):
        base = b'x\ny\n'
        self.assertEqual(b'x\nlive\n', self.merge(b'x\nlive\n', base, base))

    def test_live_version_drift_does_not_conflict(self):
        # 线上只改过版本号、新版本也改了同一行：先对齐版本号，再合并就不冲突，取新版本那行。
        base = b'1\nload("laolao-a.js?v=1")\n3\n'
        ours = b'1\nload("laolao-a.js?v=drill2")\n3\n'
        theirs = b'1\nload("laolao-a.js?v=1"); game()\n3\n'
        self.assertEqual(theirs, self.merge(ours, base, theirs))

    def test_conflict_stops_with_label_and_markers(self):
        base = b'1\nshared\n3\n'
        with self.assertRaises(SystemExit) as ctx:
            self.merge(b'1\nlive edit\n3\n', base, b'1\ngame edit\n3\n', label='/live/learning.mjs')
        message = str(ctx.exception.code)
        self.assertIn('/live/learning.mjs: 三方合并有 1 处冲突，停下不写。', message)
        self.assertIn('<<<<<<< live', message)
        self.assertIn('>>>>>>> game', message)

    def test_conflict_count_is_reported(self):
        base = b'a\n1\n2\n3\n4\n5\nb\n'
        with self.assertRaises(SystemExit) as ctx:
            self.merge(b'A\n1\n2\n3\n4\n5\nB\n', base, b'Z\n1\n2\n3\n4\n5\nY\n')
        self.assertIn('有 2 处冲突', str(ctx.exception.code))

    def test_conflict_preview_is_truncated(self):
        base = b'head\n'
        with self.assertRaises(SystemExit) as ctx:
            self.merge(b'L' * 5000 + b'\n', base, b'G' * 5000 + b'\n')
        preview = str(ctx.exception.code).split('\n', 1)[1]
        self.assertLessEqual(len(preview), 1500)


class ClassifyTest(unittest.TestCase):
    """按 BASE..REV 的改动清单分出：新后端 / 要合并的后端 / 新前端 / 要合并的前端。"""

    CHANGED = [
        'services/mode-architecture/learning-game.mjs',
        'services/mode-architecture/learning-game-items.json',
        'services/mode-architecture/learning.mjs',
        'services/mode-architecture/learning-drill.mjs',
        'services/mode-architecture/setup.py',
        'services/mode-architecture/router.mjs',
        'ui/injections/laolao-game-fx.js',
        'ui/injections/laolao-game-form-stage.css',
        'ui/injections/laolao-vendor-three-addons.module.min.js',
        'ui/injections/laolao-study-desk-drill.js',
        'ui/injections/laolao-study-desk-drill.css',
        'ui/injections/laolao-head.fragment.html',
        'ui/injections/other.js',
        'ui/assets/study-game/hero.png',
        'tests/learning-game.test.mjs',
    ]

    def setUp(self):
        ns = {'re': re, 'Path': Path, 'changed': self.CHANGED}
        self.ns = run_nodes(assigns('NEW_BACKEND', 'MERGE_BACKEND', 'NEW_UI', 'MERGE_UI'), ns)

    def test_new_backend_is_learning_game_mjs_and_json(self):
        self.assertEqual(['learning-game-items.json', 'learning-game.mjs'], self.ns['NEW_BACKEND'])

    def test_merge_backend_excludes_game_and_non_learning(self):
        self.assertEqual(['learning-drill.mjs', 'learning.mjs'], self.ns['MERGE_BACKEND'])

    def test_new_ui_is_game_files_and_three_addons(self):
        self.assertEqual(['laolao-game-form-stage.css', 'laolao-game-fx.js', 'laolao-vendor-three-addons.module.min.js'],
                         self.ns['NEW_UI'])

    def test_merge_ui_is_other_laolao_js_css_only(self):
        # head fragment（.html）和非 laolao- 文件都不进合并清单。
        self.assertEqual(['laolao-study-desk-drill.css', 'laolao-study-desk-drill.js'], self.ns['MERGE_UI'])

    def test_lists_never_overlap(self):
        groups = [set(self.ns[k]) for k in ('NEW_BACKEND', 'MERGE_BACKEND', 'NEW_UI', 'MERGE_UI')]
        self.assertEqual(sum(map(len, groups)), len(set().union(*groups)))


class IndexRewriteTest(unittest.TestCase):
    """index.html 只动自己的行：改过的已有前端换版本号，游戏标签插在背一背脚本后面。"""

    VERSION = CONST['VERSION']
    OLD_TAGS = ['<link rel="stylesheet" href="/laolao-game-fx.css?v=game3">',
                '<script defer src="/laolao-game-fx.js?v=game3"></script>']
    INDEX = ('<head>\n'
             '    <script defer src="./laolao-mode-switcher.js?v=m1"></script>\n'
             '    <script defer src="./laolao-study-desk-drill.js?v=drill2"></script>\n'
             '    <script defer src="./laolao-game-fx.js?v=game3"></script>\n'
             '    <script defer src="./laolao-tail.js?v=t1"></script>\n'
             '</head>\n')

    def bump(self, index, merge_ui):
        loop = [n for n in TREE.body if isinstance(n, ast.For) and 'pattern = re.compile' in segment(n)]
        self.assertEqual(1, len(loop))
        return run_nodes(loop, {'re': re, 'MERGE_UI': merge_ui, 'new_index': index, 'VERSION': self.VERSION})['new_index']

    def insert(self, index, game_tags, new_ui=('laolao-game-fx.css', 'laolao-game-fx.js')):
        nodes = between("drill = re.search(r'([ \\t]*)", '标签数不对')
        ns = {'re': re, 'new_index': index, 'game_tags': list(game_tags), 'VERSION': self.VERSION, 'NEW_UI': list(new_ui)}
        return run_nodes(nodes, ns)['new_index']

    def test_bumps_version_of_merged_ui_file(self):
        out = self.bump(self.INDEX, ['laolao-study-desk-drill.js'])
        self.assertIn(f'laolao-study-desk-drill.js?v={self.VERSION}"', out)
        self.assertIn('laolao-mode-switcher.js?v=m1"', out)

    def test_does_not_bump_when_name_appears_twice_or_not_at_all(self):
        twice = self.INDEX + '<link href="/laolao-study-desk-drill.js?v=x">\n'
        self.assertEqual(twice, self.bump(twice, ['laolao-study-desk-drill.js']))
        self.assertEqual(self.INDEX, self.bump(self.INDEX, ['laolao-missing.js']))

    def test_tags_inserted_after_drill_with_indent_and_prefix(self):
        out = self.insert(self.INDEX, self.OLD_TAGS)
        lines = out.splitlines()
        at = next(i for i, line in enumerate(lines) if 'laolao-study-desk-drill.js' in line)
        self.assertEqual(f'    <link rel="stylesheet" href="./laolao-game-fx.css?v={self.VERSION}">', lines[at + 1])
        self.assertEqual(f'    <script defer src="./laolao-game-fx.js?v={self.VERSION}"></script>', lines[at + 2])
        # 旧的游戏标签（game3）被删掉，其他行原样保留。
        self.assertNotIn('?v=game3', out)
        self.assertIn('laolao-tail.js?v=t1', out)
        self.assertIn('laolao-mode-switcher.js?v=m1', out)

    def test_root_prefix_is_kept_when_index_uses_slash(self):
        index = self.INDEX.replace('"./laolao-study-desk-drill', '"/laolao-study-desk-drill')
        out = self.insert(index, self.OLD_TAGS)
        self.assertIn(f'src="/laolao-game-fx.js?v={self.VERSION}"', out)

    def test_rerun_is_idempotent(self):
        once = self.insert(self.INDEX, self.OLD_TAGS)
        self.assertEqual(once, self.insert(once, self.OLD_TAGS))

    def test_missing_drill_script_is_refused(self):
        with self.assertRaisesRegex(AssertionError, '找不到背一背脚本'):
            self.insert('<head></head>\n', self.OLD_TAGS)

    def test_game_tags_come_from_fragment_lines(self):
        nodes = assigns('game_tags')
        fragment = 'a\n  <script src="/laolao-game-a.js?v=1"></script>  \nlaolao-study\n'
        self.assertEqual(['<script src="/laolao-game-a.js?v=1"></script>'],
                         run_nodes(nodes, {'fragment': fragment})['game_tags'])

    @unittest.expectedFailure
    def test_current_fragment_tags_get_deploy_version(self):
        # 已知问题（不在本 PR 修）：M2 之后 head fragment 一律写 ?v=@hash，
        # 而 tags 改写只认 \?v=[\w.-]+，@ 不在字符类里，游戏标签保持 ?v=@hash 不换成 VERSION。
        # 拿当前 main 的 fragment 上线时，脚本会在「标签数不对」断言处停下（不会写坏文件）。
        fragment = FRAGMENT.read_text(encoding='utf-8')
        game_tags = run_nodes(assigns('game_tags'), {'fragment': fragment})['game_tags']
        self.assertTrue(game_tags)
        tags = run_nodes(assigns('tags'), {'re': re, 'game_tags': game_tags, 'prefix': './', 'VERSION': self.VERSION})['tags']
        self.assertTrue(all(f'?v={self.VERSION}' in t for t in tags), tags[:2])
        self.assertFalse(any('@hash' in t for t in tags))


class ConstantsTest(unittest.TestCase):
    def test_version_is_replaceable_by_own_pattern(self):
        # 下次上线要能用同一套正则把这次的 VERSION 换掉，所以只能含 [\w.-]。
        self.assertRegex(CONST['VERSION'], r'^[\w.-]+$')

    def test_no_top_level_side_effect_reached_in_tests(self):
        # 自检：本文件只执行摘出来的语句；git()/show() 没被摘进命名空间。
        self.assertNotIn('git', FN)
        self.assertNotIn('show', FN)


if __name__ == '__main__':
    unittest.main()
