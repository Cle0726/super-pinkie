"""tools/skills/vendor_community_skills.py 的纯逻辑单测。

这个脚本没有 main()：一 import 就读清单、按清单拉仓库、把 skills/ 下的同名目录整个换掉。
所以这里不 import 它，而是用 ast 只取出 import、几个常量和函数定义，放进自备的命名空间执行；
ROOT / SKILLS / manifest / cache 全指向临时目录，git 换成假的 subprocess，GitHub 下载换成假的
urlopen —— 不联网、不碰仓库里的 skills/。
"""
import ast
import contextlib
import io
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "skills" / "vendor_community_skills.py"
TREE = ast.parse(SCRIPT.read_text(encoding="utf-8"))
CONSTANTS = {"SKIP_DIRS", "SKIP_SUFFIXES", "MAX_FILE"}
SHA = "abc1234" + "0" * 33


def load(**overrides):
    """只执行 import、常量和函数定义；模块级的拉取 / 替换流程一行都不跑。"""
    keep = [node for node in TREE.body
            if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))
            or isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id in CONSTANTS for t in node.targets)]
    env = {"__name__": "vendor_community_skills_under_test"}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(SCRIPT), "exec"), env)
    env.update(overrides)
    return env


def files_under(folder):
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())


class FakeGit:
    """假的 subprocess：记下每条 git 命令；clone 时可以按需在目标目录里放文件。"""

    def __init__(self, head="", on_clone=None):
        self.calls, self.head, self.on_clone = [], head, on_clone

    def run(self, args, **kwargs):
        self.calls.append(list(args))
        if args[1] == "clone" and self.on_clone:
            self.on_clone(Path(args[-1]))
        return types.SimpleNamespace(returncode=0, stdout=self.head + "\n")

    def verbs(self):
        return [call[3] if call[1] == "-C" else call[1] for call in self.calls]


class LoaderTest(unittest.TestCase):
    def test_loader_leaves_the_vendoring_run_out(self):
        # 脚本顶层确实有「按清单逐个收录」的循环，所以不能直接 import。
        self.assertTrue(any(isinstance(node, ast.For) for node in TREE.body))
        env = load()
        for name in ("pinned", "fetch_raw", "checkout", "hide_from_catalog", "write_fetch_stub",
                     "write_library_index", "copy_tree"):
            self.assertTrue(callable(env[name]), name)
        for side_effect in ("manifest", "cache", "repos", "notices"):
            self.assertNotIn(side_effect, env)
        self.assertIn(".mp4", env["SKIP_SUFFIXES"])
        self.assertIn(".git", env["SKIP_DIRS"])


class PinnedTest(unittest.TestCase):
    def test_reads_marker_or_empty(self):
        pinned = load()["pinned"]
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            self.assertEqual(pinned(target), "")
            (target / ".pinned-commit").write_text("abc1234\n", encoding="utf-8")
            self.assertEqual(pinned(target), "abc1234")


class CheckoutTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name)
        self.info = {"repo": "owner/big-repo", "commit": "abc1234", "license": "MIT"}
        self.manifest = {"skills": [
            {"name": "ppt-master", "from": "big", "path": "./skills/ppt-master/", "fetch": True},
            {"name": "other", "from": "elsewhere", "path": "other-skill"},
        ]}
        self.target = self.cache / "owner_big-repo"

    def tearDown(self):
        self.tmp.cleanup()

    def checkout(self, git, **extra):
        env = load(cache=self.cache, manifest=self.manifest, subprocess=types.SimpleNamespace(run=git.run), **extra)
        return env["checkout"]("big", self.info)

    def put_skill_md(self, target):
        (target / "skills/ppt-master").mkdir(parents=True)
        (target / "skills/ppt-master/SKILL.md").write_text("---\n---\n", encoding="utf-8")

    def test_pinned_cache_of_the_manifest_commit_is_used_without_git(self):
        self.target.mkdir()
        (self.target / ".pinned-commit").write_text(SHA, encoding="utf-8")
        git = FakeGit()
        self.assertEqual(self.checkout(git), self.target)
        self.assertEqual(git.calls, [])

    def test_pinned_cache_of_another_commit_stops_with_both_versions(self):
        self.target.mkdir()
        (self.target / ".pinned-commit").write_text("fff0000aaaa", encoding="utf-8")
        with self.assertRaises(SystemExit) as caught:
            self.checkout(FakeGit())
        self.assertIn("缓存是 fff0000", str(caught.exception.code))
        self.assertIn("清单要 abc1234", str(caught.exception.code))

    def test_existing_checkout_only_checks_head(self):
        self.put_skill_md(self.target)
        git = FakeGit(head="abc1234")
        self.assertEqual(self.checkout(git), self.target)
        self.assertEqual(git.verbs(), ["rev-parse"])

    def test_existing_checkout_on_another_head_fetches_the_manifest_commit(self):
        self.put_skill_md(self.target)
        git = FakeGit(head="9999999")
        self.checkout(git)
        self.assertEqual(git.verbs(), ["rev-parse", "fetch", "checkout"])
        self.assertEqual(git.calls[1][-1], "abc1234")
        self.assertEqual(git.calls[2][-1], "abc1234")

    def test_fresh_clone_sparse_checks_out_only_this_repos_paths(self):
        git = FakeGit(head="abc1234", on_clone=self.put_skill_md)
        self.assertEqual(self.checkout(git), self.target)
        self.assertEqual(git.verbs(), ["clone", "sparse-checkout", "rev-parse"])
        self.assertIn("https://github.com/owner/big-repo.git", git.calls[0])
        sparse = git.calls[1]
        # 「第一次用时下载」的大技能只要它的 SKILL.md；别的仓库的路径不混进来。
        self.assertIn("/skills/ppt-master/SKILL.md", sparse)
        for always in ("/LICENSE*", "/NOTICE*", "/README*"):
            self.assertIn(always, sparse)
        self.assertFalse(any("other-skill" in arg for arg in sparse))

    def test_git_that_keeps_failing_falls_back_to_the_file_tree(self):
        seen = []

        def fetch_raw(info, wanted, target):
            seen.append((info, wanted, target, target.exists()))

        # clone 只留下半截目录（没有 SKILL.md）：每次都删掉重来，三次后改走文件树下载。
        git = FakeGit(on_clone=lambda target: target.mkdir(parents=True))
        self.assertEqual(self.checkout(git, fetch_raw=fetch_raw), self.target)
        self.assertEqual(git.verbs(), ["clone", "sparse-checkout"] * 3)
        self.assertEqual(seen, [(self.info, ["skills/ppt-master/SKILL.md"], self.target, False)])


class FetchRawTest(unittest.TestCase):
    TREE = [
        {"path": "LICENSE", "type": "blob"},
        {"path": "NOTICE.txt", "type": "blob"},
        {"path": "README.md", "type": "blob"},
        {"path": "setup.py", "type": "blob"},
        {"path": "docs/LICENSE", "type": "blob"},
        {"path": "skills", "type": "tree"},
        {"path": "skills/ppt-master/SKILL.md", "type": "blob"},
        {"path": "skills/ppt-master/icons/a.svg", "type": "blob"},
        {"path": "skills/ppt-master/demo/intro.MP4", "type": "blob"},
        {"path": "skills/ppt-master-extra/SKILL.md", "type": "blob"},
    ]

    def fetch(self, wanted):
        requests = []

        def urlopen(request, timeout=None):
            requests.append(request)
            url = request.full_url
            if "/commits/" in url:
                body = json.dumps({"sha": SHA}).encode()
            elif "/git/trees/" in url:
                body = json.dumps({"tree": self.TREE}).encode()
            else:
                body = ("raw:" + url.split(SHA + "/", 1)[1]).encode()
            return contextlib.nullcontext(types.SimpleNamespace(read=lambda: body))

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        target = Path(tmp.name) / "owner_repo"
        env = load()
        with mock.patch("urllib.request.urlopen", urlopen), mock.patch("time.sleep"), \
                contextlib.redirect_stdout(io.StringIO()):
            env["fetch_raw"]({"repo": "owner/repo", "commit": "abc1234"}, wanted, target)
        return target, requests

    def test_downloads_only_the_wanted_folder_plus_top_level_license_files(self):
        target, requests = self.fetch(["skills/ppt-master"])
        self.assertEqual(files_under(target), [
            ".pinned-commit", "LICENSE", "NOTICE.txt", "README.md",
            "skills/ppt-master/SKILL.md", "skills/ppt-master/icons/a.svg"])
        self.assertEqual((target / "skills/ppt-master/SKILL.md").read_bytes(), b"raw:skills/ppt-master/SKILL.md")
        self.assertEqual((target / ".pinned-commit").read_text(encoding="utf-8"), SHA)
        self.assertEqual(load()["pinned"](target), SHA)
        # 先把清单里的短版本号换成完整 sha，之后都按完整 sha 下载。
        self.assertEqual(requests[0].full_url, "https://api.github.com/repos/owner/repo/commits/abc1234")
        self.assertEqual(requests[1].full_url, f"https://api.github.com/repos/owner/repo/git/trees/{SHA}?recursive=1")
        for request in requests[2:]:
            self.assertTrue(request.full_url.startswith(f"https://raw.githubusercontent.com/owner/repo/{SHA}/"))
        self.assertEqual({r.get_header("User-agent") for r in requests}, {"pinkie-vendor"})

    def test_fetch_stub_skill_takes_only_its_skill_md(self):
        target, _ = self.fetch(["skills/ppt-master/SKILL.md"])
        self.assertEqual(files_under(target), [
            ".pinned-commit", "LICENSE", "NOTICE.txt", "README.md", "skills/ppt-master/SKILL.md"])

    def test_whole_repo_skips_only_sample_videos(self):
        target, _ = self.fetch(["."])
        self.assertEqual(files_under(target), [
            ".pinned-commit", "LICENSE", "NOTICE.txt", "README.md", "docs/LICENSE", "setup.py",
            "skills/ppt-master-extra/SKILL.md", "skills/ppt-master/SKILL.md", "skills/ppt-master/icons/a.svg"])


class HideFromCatalogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.skill_md = Path(self.tmp.name) / "SKILL.md"
        self.hide = load()["hide_from_catalog"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_adds_one_line_at_the_top_and_keeps_the_rest(self):
        self.skill_md.write_text("---\nname: x\ndescription: d\n---\n\n# Body\n---\nmore\n", encoding="utf-8")
        self.hide(self.skill_md)
        expected = "---\ndisable-model-invocation: true\nname: x\ndescription: d\n---\n\n# Body\n---\nmore\n"
        self.assertEqual(self.skill_md.read_text(encoding="utf-8"), expected)
        self.hide(self.skill_md)  # 重复收录不会再加一行
        self.assertEqual(self.skill_md.read_text(encoding="utf-8"), expected)

    def test_existing_setting_is_left_alone(self):
        text = "---\nname: x\ndisable-model-invocation: false\n---\nbody\n"
        self.skill_md.write_text(text, encoding="utf-8")
        self.hide(self.skill_md)
        self.assertEqual(self.skill_md.read_text(encoding="utf-8"), text)

    def test_missing_frontmatter_stops_and_does_not_touch_the_file(self):
        self.skill_md.write_text("# no frontmatter\n", encoding="utf-8")
        with self.assertRaises(SystemExit) as caught:
            self.hide(self.skill_md)
        self.assertIn("没有 frontmatter", str(caught.exception.code))
        self.assertEqual(self.skill_md.read_text(encoding="utf-8"), "# no frontmatter\n")


class FetchStubTest(unittest.TestCase):
    INFO = {"repo": "owner/repo", "license": "MIT", "commit": "abc1234"}

    def stub(self, upstream_head, item=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        src, dst = Path(tmp.name) / "src", Path(tmp.name) / "dst"
        src.mkdir()
        dst.mkdir()
        (src / "SKILL.md").write_text(f"---\n{upstream_head}\n---\n\n# upstream body\n", encoding="utf-8")
        item = item or {"name": "ppt-master", "zh": "可编辑 PPT", "size": "约 40 MB"}
        load()["write_fetch_stub"](item, self.INFO, src, dst)
        return (dst / "SKILL.md").read_text(encoding="utf-8")

    def description(self, text):
        return next(line for line in text.splitlines() if line.startswith("description:"))

    def test_stub_names_the_skill_source_and_fetch_command(self):
        text = self.stub("name: ppt-master\ndescription: Make decks.")
        self.assertTrue(text.startswith("---\nname: ppt-master\ndescription: 可编辑 PPT。Make decks.\n---\n"))
        self.assertIn("约 40 MB", text)
        self.assertIn("https://github.com/owner/repo（MIT，版本 abc1234）", text)
        self.assertIn('pinkie-skill-library/fetch_skill.py" ppt-master`', text)
        self.assertNotIn("upstream body", text)

    def test_default_size_when_manifest_has_none(self):
        text = self.stub("description: d", {"name": "big", "zh": "大"})
        self.assertIn("这个技能很大（几十 MB）", text)

    def test_block_descriptions_are_joined(self):
        for indicator in (">", "|", ">-", "|-"):
            text = self.stub(f"name: x\ndescription: {indicator}\n  Line one\n  line two")
            self.assertEqual(self.description(text), "description: 可编辑 PPT。Line one line two", indicator)

    def test_long_description_is_cut_to_300_characters(self):
        text = self.stub("description: " + "x" * 500)
        self.assertEqual(self.description(text), "description: 可编辑 PPT。" + "x" * 300)

    @unittest.expectedFailure
    def test_block_description_stops_at_the_next_key(self):
        """源码 bug：块状 description 把它后面所有缩进行都收进来，下一个键（如 metadata:）
        底下的缩进行也会混进说明里，这里得到的是「Line one line two version: 1」。"""
        text = self.stub("name: x\ndescription: >\n  Line one\n  line two\nmetadata:\n  version: 1")
        self.assertEqual(self.description(text), "description: 可编辑 PPT。Line one line two")


class LibraryIndexTest(unittest.TestCase):
    MANIFEST = {
        "repos": {},
        "own": [{"name": "pinkie-toolbox", "zh": "补齐工具"}],
        "skills": [{"name": "alpha", "zh": "做甲", "from": "r", "path": "."},
                   {"name": "big", "zh": "做大件", "from": "r", "path": "big", "fetch": True}],
    }

    def build(self, with_fetcher):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "skills").mkdir()
        if with_fetcher:
            (root / "tools/skills").mkdir(parents=True)
            (root / "tools/skills/fetch_skill.py").write_text("print('fetch')\n", encoding="utf-8")
        load(ROOT=root, SKILLS=root / "skills", manifest=self.MANIFEST)["write_library_index"]()
        return root / "skills" / "pinkie-skill-library"

    def test_index_lists_own_then_community_skills(self):
        out = self.build(with_fetcher=True)
        text = (out / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: pinkie-skill-library\ndescription: 碧琪自带的 3 个现成技能的目录"))
        self.assertIn("前 1 个是碧琪自己的薄技能", text)
        rows = [line for line in text.splitlines() if line.startswith("| ") and "SKILL.md`" in line]
        self.assertEqual(rows, [
            "| pinkie-toolbox | 补齐工具 | `../pinkie-toolbox/SKILL.md` |",
            "| alpha | 做甲 | `../alpha/SKILL.md` |",
            "| big | 做大件（第一次用时下载） | `../big/SKILL.md` |",
        ])
        # 目录本身要进系统技能清单，所以不加 disable-model-invocation。
        self.assertNotIn("disable-model-invocation", text)
        copied = (out / "community-skills.json").read_text(encoding="utf-8")
        self.assertEqual(json.loads(copied), self.MANIFEST)
        self.assertIn("补齐工具", copied)
        self.assertEqual((out / "fetch_skill.py").read_text(encoding="utf-8"), "print('fetch')\n")

    def test_missing_fetcher_is_not_copied(self):
        out = self.build(with_fetcher=False)
        self.assertEqual(files_under(out), ["SKILL.md", "community-skills.json"])


class CopyTreeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src, self.dst = Path(self.tmp.name) / "src", Path(self.tmp.name) / "dst"
        for rel, data in {
            "SKILL.md": b"s", "a.html": b"a", "sub/b.html": b"b", "sub/clip.MP4": b"v",
            ".git/config": b"g", "node_modules/x/index.js": b"n", "__pycache__/m.pyc": b"p",
            ".DS_Store": b"d", ".pinned-commit": b"c", "examples/demo.html": b"e",
            "examples/demo-rendered.html": b"r", "docs/deep/x.md": b"x",
            "edge.bin": b"0123456789", "big.bin": b"0123456789A",
        }.items():
            (self.src / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.src / rel).write_bytes(data)
        self.copy_tree = load(MAX_FILE=10)["copy_tree"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_whole_tree_skips_vcs_caches_videos_excluded_and_large_files(self):
        log = io.StringIO()
        with contextlib.redirect_stdout(log):
            self.copy_tree(self.src, self.dst, None, ["examples/*-rendered.html", "docs/*"])
        self.assertEqual(files_under(self.dst), ["SKILL.md", "a.html", "edge.bin", "examples/demo.html", "sub/b.html"])
        self.assertEqual((self.dst / "edge.bin").read_bytes(), b"0123456789")  # 正好等于上限的留下
        self.assertIn("跳过大文件 big.bin", log.getvalue())

    def test_patterns_pick_top_level_matches_only(self):
        self.copy_tree(self.src, self.dst, ["*.html", "SKILL.md"])
        self.assertEqual(files_under(self.dst), ["SKILL.md", "a.html"])


if __name__ == "__main__":
    unittest.main()
