"""nb_runner.py 的纯逻辑单测：不装 nbformat / jupyter_client、不起真内核、不碰用户目录。

nb_runner 顶层就 import nbformat 和 jupyter_client.manager；这里只在加载模块的那一刻塞进假模块，
加载完立刻从 sys.modules 撤掉，不影响同一进程里的其它测试。内核管理器、客户端、时钟全是假对象。
"""

import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from queue import Empty
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "services/mode-architecture/nb_runner.py"


class FakeNotebook:
    """假 nbformat 读出来的 notebook：和真 NotebookNode 一样，cells 里是 dict。"""

    def __init__(self, data):
        self.data = data
        self.cells = data.get("cells")


def fake_nbformat():
    mod = types.ModuleType("nbformat")
    mod.v4 = types.SimpleNamespace(new_output=lambda output_type, **kw: {"output_type": output_type, **kw})

    def reads(raw, as_version):
        assert as_version == 4
        return FakeNotebook(json.loads(raw))
    def validate(nb):
        if not isinstance(nb.cells, list):
            raise ValueError("cells 必须是列表")
    def write(nb, path):
        Path(path).write_text(json.dumps({**nb.data, "cells": nb.cells}, ensure_ascii=False), encoding="utf-8")

    mod.reads, mod.validate, mod.write = reads, validate, write
    return mod


class FakeClient:
    """假内核客户端：iopub 队列由测试预先塞好，取空了就抛 Empty（和真客户端超时一样）。"""

    def __init__(self):
        self.iopub = []
        self.executed = []
        self.events = []

    def start_channels(self): self.events.append("start_channels")
    def stop_channels(self): self.events.append("stop_channels")
    def wait_for_ready(self, timeout): self.events.append(("wait_for_ready", timeout))

    def execute(self, code, **kw):
        self.executed.append((code, kw))
        return "msg-%d" % len(self.executed)

    def get_shell_msg(self, timeout):
        self.events.append(("shell", timeout))
        return {}

    def get_iopub_msg(self, timeout):
        if not self.iopub:
            raise Empty
        item = self.iopub.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeKernelManager:
    instances = []

    def __init__(self, kernel_name):
        self.kernel_name = kernel_name
        self.alive = True
        self.started = None
        self.interrupted = 0
        self.shutdown = None
        self.fake_client = FakeClient()
        FakeKernelManager.instances.append(self)

    def start_kernel(self, cwd, env): self.started = {"cwd": cwd, "env": env}
    def client(self): return self.fake_client

    def is_alive(self):
        if isinstance(self.alive, Exception):
            raise self.alive
        return self.alive

    def interrupt_kernel(self): self.interrupted += 1

    def shutdown_kernel(self, now):
        if isinstance(self.shutdown, Exception):
            raise self.shutdown
        self.shutdown = now


class FakeClock:
    """每读一次时间往前走 step 秒，sleep 只记账不真睡。"""

    def __init__(self, step=0.5):
        self.now, self.step, self.slept = 1000.0, step, []

    def time(self):
        self.now += self.step
        return self.now

    def sleep(self, seconds): self.slept.append(seconds)


def load_runner():
    jc = types.ModuleType("jupyter_client")
    manager = types.ModuleType("jupyter_client.manager")
    manager.KernelManager = FakeKernelManager
    jc.manager = manager
    spec = importlib.util.spec_from_file_location("pinkie_nb_runner_under_test", str(SOURCE))
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"nbformat": fake_nbformat(), "jupyter_client": jc, "jupyter_client.manager": manager}):
        spec.loader.exec_module(module)
    return module


NB = load_runner()
REAL_KERNEL = NB.Kernel  # 个别测试会把 NB.Kernel 换成工厂函数，这里留住真类


def bare_kernel(path="/tmp/demo.ipynb"):
    """不走 __init__（不起内核）的 Kernel，属性手工装好。"""
    k = REAL_KERNEL.__new__(REAL_KERNEL)
    k.path = path
    k.km = FakeKernelManager("python3")
    k.client = k.km.fake_client
    k.lock = threading.Lock()
    k.exec_count = 0
    return k


def msg(parent, mtype, **content):
    return {"parent_header": {"msg_id": parent}, "header": {"msg_type": mtype}, "content": content}


NOTEBOOK = {"nbformat": 4, "cells": [
    {"cell_type": "markdown", "source": "# 标题"},
    {"cell_type": "code", "source": "1+1", "execution_count": 3, "outputs": [{"output_type": "stream", "name": "stdout", "text": "2"}]},
    {"cell_type": "code", "source": "x"},
]}


class NbRunnerTest(unittest.TestCase):
    def setUp(self):
        NB.KERNELS.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.nb = self.dir / "demo.ipynb"
        self.nb.write_text(json.dumps(NOTEBOOK, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        NB.KERNELS.clear()
        self.tmp.cleanup()

    # ---------- 小工具 ----------
    def test_jsonable_keeps_json_values_and_stringifies_the_rest(self):
        self.assertEqual(NB.jsonable({"a": [1, "二"]}), {"a": [1, "二"]})
        self.assertEqual(NB.jsonable({1, 2}), "{1, 2}")
        self.assertIsInstance(NB.jsonable(object()), str)

    # ---------- handle：路由与校验 ----------
    def test_health_needs_no_notebook_path_and_lists_kernels(self):
        self.assertEqual(NB.handle({"action": "health"}), {"ok": True, "kernels": []})
        k = bare_kernel(str(self.nb))
        k.exec_count = 2
        NB.KERNELS[str(self.nb)] = k
        self.assertEqual(NB.handle({"action": "health", "path": "随便.txt"}),
                         {"ok": True, "kernels": [{"path": str(self.nb), "alive": True, "execCount": 2}]})

    def test_only_ipynb_paths_are_accepted(self):
        for req in ({"action": "load", "path": "a.txt"}, {"action": "run", "path": "a.py", "index": 0, "source": ""},
                    {"action": "restart"}, {"action": "load", "path": ""}):
            self.assertEqual(NB.handle(req), {"ok": False, "error": "只支持 .ipynb"}, req)

    def test_unknown_action_is_reported(self):
        self.assertEqual(NB.handle({"action": "delete", "path": "a.ipynb"}), {"ok": False, "error": "未知动作：delete"})
        self.assertEqual(NB.handle({"path": "a.ipynb"}), {"ok": False, "error": "未知动作："})

    def test_load_lists_cells_and_only_code_cells_carry_outputs(self):
        out = NB.handle({"action": "load", "path": str(self.nb)})
        self.assertEqual(out["ok"], True)
        self.assertEqual(out["path"], os.path.abspath(str(self.nb)))
        self.assertEqual(out["cells"], [
            {"index": 0, "cellType": "markdown", "source": "# 标题", "executionCount": None},
            {"index": 1, "cellType": "code", "source": "1+1", "executionCount": 3, "outputs": [{"output_type": "stream", "name": "stdout", "text": "2"}]},
            {"index": 2, "cellType": "code", "source": "x", "executionCount": None, "outputs": []},
        ])

    def test_load_errors_propagate_for_serve_to_report(self):
        with self.assertRaises(FileNotFoundError):
            NB.handle({"action": "load", "path": str(self.dir / "missing.ipynb")})
        bad = self.dir / "bad.ipynb"
        bad.write_text('{"cells": "nope"}', encoding="utf-8")
        with self.assertRaises(ValueError):
            NB.handle({"action": "load", "path": str(bad)})

    def test_run_rejects_bad_index_and_source_before_starting_a_kernel(self):
        with mock.patch.object(NB, "get_kernel", side_effect=AssertionError("不该起内核")):
            for index in (-1, "1", None, 1.5):
                self.assertEqual(NB.handle({"action": "run", "path": str(self.nb), "index": index, "source": "x"}),
                                 {"ok": False, "error": "cell 下标不合法"}, index)
            for source in (None, 123, ["x"]):
                self.assertEqual(NB.handle({"action": "run", "path": str(self.nb), "index": 1, "source": source}),
                                 {"ok": False, "error": "缺少 cell 源码"}, source)
            self.assertEqual(NB.handle({"action": "run", "path": str(self.nb), "index": 1, "source": "a" * (NB.MAX_SOURCE + 1)}),
                             {"ok": False, "error": "cell 源码过长"})

    def fake_kernel(self, calls, outputs, count=7):
        class K:
            def execute(self, source, timeout):
                calls.append(("execute", source, timeout))
                return outputs, count
        def get(path, name):
            calls.append(("get", path, name))
            return K()
        return get

    def test_run_executes_and_saves_outputs_back_into_the_code_cell(self):
        calls, out = [], [{"output_type": "stream", "name": "stdout", "text": "hi"}]
        with mock.patch.object(NB, "get_kernel", self.fake_kernel(calls, out)), mock.patch.object(NB, "time", FakeClock()):
            res = NB.handle({"action": "run", "path": str(self.nb), "index": 2, "source": "print('hi')", "timeout": "5", "kernel": "ir"})
        self.assertEqual(res, {"ok": True, "outputs": out, "executionCount": 7, "elapsedMs": 500, "saved": True})
        self.assertEqual(calls, [("get", os.path.abspath(str(self.nb)), "ir"), ("execute", "print('hi')", 5)])
        saved = json.loads(self.nb.read_text(encoding="utf-8"))
        self.assertEqual(saved["cells"][2]["outputs"], out)
        self.assertEqual(saved["cells"][2]["execution_count"], 7)
        self.assertEqual(saved["cells"][:2], NOTEBOOK["cells"][:2], "别的 cell 不动")

    def test_run_defaults_and_boundaries(self):
        calls = []
        with mock.patch.object(NB, "get_kernel", self.fake_kernel(calls, [])), mock.patch.object(NB, "time", FakeClock()):
            res = NB.handle({"action": "run", "path": str(self.nb), "index": 1, "source": "a" * NB.MAX_SOURCE})
        self.assertEqual(res["ok"], True, "刚好 MAX_SOURCE 长度仍然放行")
        self.assertEqual(calls[0][2], "python3")
        self.assertEqual(calls[1][2], NB.DEFAULT_TIMEOUT)

    def test_run_does_not_save_into_markdown_or_out_of_range_cells(self):
        before = self.nb.read_text(encoding="utf-8")
        for index in (0, 99):
            with mock.patch.object(NB, "get_kernel", self.fake_kernel([], [])), mock.patch.object(NB, "time", FakeClock()):
                res = NB.handle({"action": "run", "path": str(self.nb), "index": index, "source": "x"})
            self.assertEqual((res["ok"], res["saved"]), (True, False), index)
        self.assertEqual(self.nb.read_text(encoding="utf-8"), before)

    def test_run_still_answers_when_the_notebook_cannot_be_saved(self):
        with mock.patch.object(NB, "get_kernel", self.fake_kernel([], [{"output_type": "stream"}])), mock.patch.object(NB, "time", FakeClock()):
            self.nb.unlink()
            res = NB.handle({"action": "run", "path": str(self.nb), "index": 1, "source": "x"})
        self.assertEqual((res["ok"], res["saved"], res["outputs"]), (True, False, [{"output_type": "stream"}]))

    def test_restart_drops_and_closes_the_kernel(self):
        k = bare_kernel(str(self.nb))
        NB.KERNELS[os.path.abspath(str(self.nb))] = k
        self.assertEqual(NB.handle({"action": "restart", "path": str(self.nb)}), {"ok": True, "restarted": os.path.abspath(str(self.nb))})
        self.assertEqual(NB.KERNELS, {})
        self.assertIs(k.km.shutdown, True)
        self.assertIn("stop_channels", k.client.events)
        NB.drop_kernel(str(self.nb))  # 再删一次不报错

    # ---------- 内核表 ----------
    def test_get_kernel_reuses_alive_kernel_and_replaces_dead_one(self):
        created = []
        def factory(path, name):
            k = bare_kernel(path)
            k.kernel_name = name
            created.append(k)
            return k

        with mock.patch.object(NB, "Kernel", factory):
            a = NB.get_kernel(str(self.dir / "sub" / ".." / "demo.ipynb"))
            b = NB.get_kernel(str(self.nb))
            self.assertIs(a, b, "同一路径（规范化后）共用一个内核")
            self.assertEqual(a.path, os.path.abspath(str(self.nb)))
            a.km.alive = False
            c = NB.get_kernel(str(self.nb), "ir")
        self.assertIsNot(c, a)
        self.assertEqual(c.kernel_name, "ir")
        self.assertIs(a.km.shutdown, True, "死掉的旧内核先关掉")
        self.assertEqual(len(created), 2)

    def test_alive_and_close_swallow_kernel_errors(self):
        k = bare_kernel()
        k.km.alive = RuntimeError("进程表读不了")
        self.assertIs(k.alive(), False)
        k.km.shutdown = RuntimeError("关不掉")
        k.client.stop_channels = mock.Mock(side_effect=RuntimeError("通道坏了"))
        k.close()  # 不抛

    def test_kernel_init_starts_in_notebook_dir_with_agg_backend_and_runs_bootstrap(self):
        FakeKernelManager.instances.clear()
        before = os.environ.get("MPLBACKEND")
        clock = FakeClock()
        with mock.patch.object(NB, "time", clock):
            k = NB.Kernel(str(self.nb), "python3")
        km = FakeKernelManager.instances[-1]
        self.assertEqual(km.kernel_name, "python3")
        self.assertEqual(km.started["cwd"], str(self.dir))
        self.assertEqual(km.started["env"]["MPLBACKEND"], "Agg")
        self.assertEqual(os.environ.get("MPLBACKEND"), before, "不改本进程的环境变量")
        self.assertIn(("wait_for_ready", 60), k.client.events)
        bootstrap = SOURCE.parent / "nb_bootstrap.py"
        self.assertTrue(bootstrap.exists())
        code, kw = k.client.executed[0]
        self.assertEqual(code, "exec(open(%r).read())" % str(bootstrap))
        self.assertEqual(kw, {"silent": True})
        self.assertEqual(clock.slept, [0.2])
        self.assertEqual(k.exec_count, 0)

    # ---------- 执行一格 ----------
    def test_execute_collects_only_own_messages_until_idle(self):
        k = bare_kernel()
        k.client.iopub = [
            msg("other", "stream", name="stdout", text="别的请求的输出"),
            RuntimeError("偶发读错"),
            msg("msg-1", "status", execution_state="busy"),
            msg("msg-1", "stream", name="stderr", text="warn\n"),
            msg("msg-1", "execute_result", data={"text/plain": "42", "x/set": {1, 2}}, metadata={"m": 1}, execution_count=1),
            msg("msg-1", "display_data", data={"image/png": "AAAA"}),
            msg("msg-1", "error", ename="ValueError", evalue="坏了", traceback=["tb"]),
            msg("msg-1", "status", execution_state="idle"),
            msg("msg-1", "stream", name="stdout", text="idle 之后的不收"),
        ]
        with mock.patch.object(NB, "time", FakeClock()):
            outputs, count = k.execute("print(1)")
        self.assertEqual(count, 1)
        self.assertEqual(k.client.executed, [("print(1)", {"store_history": True, "allow_stdin": False})])
        self.assertEqual(outputs, [
            {"output_type": "stream", "name": "stderr", "text": "warn\n"},
            {"output_type": "execute_result", "data": {"text/plain": "42", "x/set": "{1, 2}"}, "metadata": {"m": 1}, "execution_count": 1},
            {"output_type": "display_data", "data": {"image/png": "AAAA"}, "metadata": {}},
            {"output_type": "error", "ename": "ValueError", "evalue": "坏了", "traceback": ["tb"]},
        ])
        self.assertEqual(len(k.client.iopub), 1, "idle 之后就停，不再读")

    def test_execute_fills_defaults_for_sparse_messages_and_counts_up(self):
        k = bare_kernel()
        k.client.iopub = [msg("msg-1", "status", execution_state="idle")]
        with mock.patch.object(NB, "time", FakeClock()):
            k.execute("a")
            k.client.iopub = [msg("msg-2", "stream"), msg("msg-2", "error"), msg("msg-2", "execute_result"), msg("msg-2", "status", execution_state="idle")]
            outputs, count = k.execute("b")
        self.assertEqual(count, 2)
        self.assertEqual(outputs, [
            {"output_type": "stream", "name": "stdout", "text": ""},
            {"output_type": "error", "ename": "Error", "evalue": "", "traceback": []},
            {"output_type": "execute_result", "data": {}, "metadata": {}, "execution_count": None},
        ])

    def test_execute_times_out_and_interrupts_the_kernel(self):
        k = bare_kernel()
        with mock.patch.object(NB, "time", FakeClock()):
            outputs, _ = k.execute("while True: pass", timeout=1)
        self.assertEqual(outputs, [{"output_type": "error", "ename": "TimeoutError", "evalue": "执行超过 1s，已中断。", "traceback": []}])
        self.assertEqual(k.km.interrupted, 1)

    def test_execute_reports_a_dead_kernel_without_waiting_for_timeout(self):
        k = bare_kernel()
        k.km.alive = False
        with mock.patch.object(NB, "time", FakeClock()):
            outputs, _ = k.execute("import os; os._exit(1)")
        self.assertEqual(outputs, [{"output_type": "error", "ename": "KernelDied", "evalue": "内核已退出。", "traceback": []}])
        self.assertEqual(k.km.interrupted, 0)

    # ---------- 常驻行协议 ----------
    def test_serve_answers_one_json_line_per_request_line(self):
        bad = self.dir / "bad.ipynb"
        bad.write_text('{"cells": "nope"}', encoding="utf-8")
        lines = ["", "   ", "{坏的", json.dumps({"action": "health"}), json.dumps({"action": "load", "path": str(self.dir / "missing.ipynb")}),
                 json.dumps({"action": "load", "path": str(bad)}), "[1]", json.dumps({"action": "x", "path": "a.ipynb"})]
        with mock.patch("sys.stdin", io.StringIO("\n".join(lines) + "\n")), mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            NB.serve()
        raw = out.getvalue()
        replies = [json.loads(line) for line in raw.splitlines()]
        self.assertEqual(len(replies), 6, "空行不回")
        self.assertFalse(replies[0]["ok"])
        self.assertTrue(replies[0]["error"].startswith("JSON 解析失败："))
        self.assertEqual(replies[1], {"ok": True, "kernels": []})
        self.assertTrue(replies[2]["error"].startswith("文件不存在："), replies[2])
        self.assertEqual(replies[3], {"ok": False, "error": "ValueError: cells 必须是列表"})
        self.assertTrue(replies[4]["error"].startswith("AttributeError: "), replies[4])
        self.assertEqual(replies[5], {"ok": False, "error": "未知动作：x"})
        self.assertIn("未知动作", raw, "中文原样输出，不转义")


if __name__ == "__main__":
    unittest.main()
