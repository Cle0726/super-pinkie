"""Cross-platform subprocess streaming and process-tree cleanup helpers."""

from __future__ import annotations

import contextlib
import os
import queue
import signal
import subprocess
import threading


def popen_group_kwargs():
    if os.name == "nt":
        return {
            "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
        }
    return {"start_new_session": True}


def iter_process_output(process, streams, interval=0.2):
    """Yield ``(name, bytes)`` and periodic ``(None, None)`` idle ticks."""
    if os.name != "nt":
        import selectors

        with selectors.DefaultSelector() as selector:
            for name, stream in streams.items():
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map():
                selected = selector.select(interval)
                if not selected:
                    yield None, None
                    continue
                for key, _ in selected:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        yield key.data, chunk
        return

    events = queue.Queue()

    def read_pipe(name, stream):
        try:
            # BufferedReader.read(n) may wait for the whole buffer on a Windows
            # pipe. read1() performs one raw read, so partial model/tool output
            # reaches the UI as soon as it is available.
            read_available = getattr(stream, "read1", stream.read)
            while True:
                chunk = read_available(65536)
                events.put((name, chunk))
                if not chunk:
                    return
        except (OSError, ValueError):
            events.put((name, b""))

    remaining = set(streams)
    for name, stream in streams.items():
        threading.Thread(target=read_pipe, args=(name, stream), daemon=True).start()
    while remaining:
        try:
            name, chunk = events.get(timeout=interval)
        except queue.Empty:
            yield None, None
            continue
        if chunk:
            yield name, chunk
        else:
            remaining.discard(name)


def stop_process_tree(process, graceful_seconds=2):
    if not process or process.poll() is not None:
        return
    if os.name == "nt":
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=max(2, graceful_seconds),
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
    else:
        with contextlib.suppress(ProcessLookupError, OSError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=graceful_seconds)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError, OSError):
                os.killpg(process.pid, signal.SIGKILL)
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.wait(timeout=graceful_seconds)
