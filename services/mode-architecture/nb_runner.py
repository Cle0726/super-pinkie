"""Notebook 内核执行器（供网关 RPC 调用，不监听端口）。

为什么改成这样：
工作台页面有严格的 CSP（connect-src 'self'），浏览器不能直接 fetch
另一个端口。之前用 HTTP 服务必须在 CSP 里开口子，等于为了一个功能
放松整个应用的安全边界。

改为由插件进程内直接持有内核并通过网关 RPC 暴露：
- 页面只走已有的同源 RPC 通道，CSP 不用改
- 不占用任何端口，也不会和先生的服务撞车
- 内核仍然是持久的，cell 之间共享内存变量

调用方式（JSON 进出，避免二进制在管道里被截断）：
  python3 nb_runner.py serve        读 stdin 的一行 JSON，写 stdout 一行 JSON
每次请求一个进程会丢掉内核状态，所以这里用常驻 + 行协议。
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from queue import Empty

import nbformat
from jupyter_client.manager import KernelManager

MAX_SOURCE = 2 * 1024 * 1024
DEFAULT_TIMEOUT = 120


def jsonable(value):
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


class Kernel:
    """一个 notebook 路径一个内核，跨请求保留变量。"""

    def __init__(self, path: str, kernel_name: str = "python3"):
        self.path = path
        self.km = KernelManager(kernel_name=kernel_name)
        env = dict(os.environ)
        env["MPLBACKEND"] = "Agg"
        self.km.start_kernel(cwd=os.path.dirname(path) or os.getcwd(), env=env)
        self.client = self.km.client()
        self.client.start_channels()
        self.client.wait_for_ready(timeout=60)
        self.lock = threading.Lock()
        self.exec_count = 0
        bootstrap = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nb_bootstrap.py")
        if os.path.exists(bootstrap):
            try:
                self.client.execute("exec(open(%r).read())" % bootstrap, silent=True)
                self.client.get_shell_msg(timeout=30)
                time.sleep(0.2)
                while True:
                    try:
                        self.client.get_iopub_msg(timeout=0.3)
                    except Empty:
                        break
                    except Exception:
                        break
            except Exception:
                pass

    def alive(self) -> bool:
        try:
            return self.km.is_alive()
        except Exception:
            return False

    def execute(self, source: str, timeout: int = DEFAULT_TIMEOUT):
        with self.lock:
            self.exec_count += 1
            msg_id = self.client.execute(source, store_history=True, allow_stdin=False)
            outputs = []
            deadline = time.time() + max(1, timeout)
            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    self.km.interrupt_kernel()
                    outputs.append(nbformat.v4.new_output(
                        "error", ename="TimeoutError",
                        evalue="执行超过 %ds，已中断。" % timeout, traceback=[]))
                    break
                try:
                    msg = self.client.get_iopub_msg(timeout=min(remaining, 1.0))
                except Empty:
                    if not self.alive():
                        outputs.append(nbformat.v4.new_output(
                            "error", ename="KernelDied", evalue="内核已退出。", traceback=[]))
                        break
                    continue
                except Exception:
                    continue
                if msg.get("parent_header", {}).get("msg_id") != msg_id:
                    continue
                mtype = msg["header"]["msg_type"]
                content = msg["content"]
                if mtype == "stream":
                    outputs.append(nbformat.v4.new_output(
                        "stream", name=content.get("name", "stdout"),
                        text=content.get("text", "")))
                elif mtype == "execute_result":
                    outputs.append(nbformat.v4.new_output(
                        "execute_result",
                        data={k: jsonable(v) for k, v in (content.get("data") or {}).items()},
                        metadata=content.get("metadata") or {},
                        execution_count=content.get("execution_count")))
                elif mtype == "display_data":
                    outputs.append(nbformat.v4.new_output(
                        "display_data",
                        data={k: jsonable(v) for k, v in (content.get("data") or {}).items()},
                        metadata=content.get("metadata") or {}))
                elif mtype == "error":
                    outputs.append(nbformat.v4.new_output(
                        "error", ename=content.get("ename", "Error"),
                        evalue=content.get("evalue", ""),
                        traceback=content.get("traceback") or []))
                elif mtype == "status" and content.get("execution_state") == "idle":
                    break
            return outputs, self.exec_count

    def close(self):
        try:
            self.client.stop_channels()
        except Exception:
            pass
        try:
            self.km.shutdown_kernel(now=True)
        except Exception:
            pass


KERNELS: dict[str, Kernel] = {}
KERNEL_LOCK = threading.Lock()


def get_kernel(path: str, kernel_name: str = "python3") -> Kernel:
    key = os.path.abspath(path)
    with KERNEL_LOCK:
        kernel = KERNELS.get(key)
        if kernel and kernel.alive():
            return kernel
        if kernel:
            kernel.close()
        kernel = Kernel(key, kernel_name)
        KERNELS[key] = kernel
        return kernel


def drop_kernel(path: str):
    key = os.path.abspath(path)
    with KERNEL_LOCK:
        kernel = KERNELS.pop(key, None)
    if kernel:
        kernel.close()


def read_notebook(path: str):
    raw = open(path, encoding="utf-8").read()
    nb = nbformat.reads(raw, as_version=4)
    nbformat.validate(nb)
    return nb


def handle(req: dict) -> dict:
    action = str(req.get("action") or "")
    path = os.path.abspath(str(req.get("path") or ""))
    # health 不需要绑定某个 notebook，先处理，别被路径校验拦下
    if action == "health":
        with KERNEL_LOCK:
            return {"ok": True, "kernels": [
                {"path": k.path, "alive": k.alive(), "execCount": k.exec_count}
                for k in KERNELS.values()]}
    if not path.endswith(".ipynb"):
        return {"ok": False, "error": "只支持 .ipynb"}

    if action == "load":
        nb = read_notebook(path)
        cells = []
        for index, cell in enumerate(nb.cells):
            item = {
                "index": index,
                "cellType": cell.get("cell_type", "code"),
                "source": cell.get("source", ""),
                "executionCount": cell.get("execution_count"),
            }
            if cell.get("cell_type") == "code":
                item["outputs"] = cell.get("outputs") or []
            cells.append(item)
        return {"ok": True, "path": path, "cells": cells}

    if action == "run":
        index = req.get("index")
        source = req.get("source")
        timeout = int(req.get("timeout") or DEFAULT_TIMEOUT)
        if not isinstance(index, int) or index < 0:
            return {"ok": False, "error": "cell 下标不合法"}
        if not isinstance(source, str):
            return {"ok": False, "error": "缺少 cell 源码"}
        if len(source) > MAX_SOURCE:
            return {"ok": False, "error": "cell 源码过长"}
        kernel = get_kernel(path, str(req.get("kernel") or "python3"))
        started = time.time()
        outputs, count = kernel.execute(source, timeout)
        elapsed = int((time.time() - started) * 1000)
        saved = False
        try:
            nb = read_notebook(path)
            if 0 <= index < len(nb.cells) and nb.cells[index].get("cell_type") == "code":
                nb.cells[index]["outputs"] = outputs
                nb.cells[index]["execution_count"] = count
                nbformat.write(nb, path)
                saved = True
        except Exception:
            pass
        return {"ok": True, "outputs": outputs, "executionCount": count,
                "elapsedMs": elapsed, "saved": saved}

    if action == "restart":
        drop_kernel(path)
        return {"ok": True, "restarted": path}

    return {"ok": False, "error": "未知动作：%s" % action}


def serve():
    """常驻行协议：一行请求 JSON，一行响应 JSON。"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError as error:
            sys.stdout.write(json.dumps({"ok": False, "error": "JSON 解析失败：%s" % error},
                                        ensure_ascii=False) + "\n")
            sys.stdout.flush()
            continue
        try:
            result = handle(req)
        except FileNotFoundError as error:
            result = {"ok": False, "error": "文件不存在：%s" % error}
        except Exception as error:
            result = {"ok": False, "error": "%s: %s" % (type(error).__name__, error)}
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        serve()
    elif len(sys.argv) > 1:
        # 单次调用：第一个参数是 JSON 请求
        print(json.dumps(handle(json.loads(sys.argv[1])), ensure_ascii=False))
    else:
        print("usage: nb_runner.py serve | nb_runner.py '<json>'", file=sys.stderr)
        sys.exit(2)
