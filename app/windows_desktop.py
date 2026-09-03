"""Self-contained Windows desktop shell for the bundled Super Pinkie runtime."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser


GATEWAY_URL = "http://127.0.0.1:18789/"
PARTY_URL = "http://127.0.0.1:18889/"
ROUNDTABLE_URL = "http://127.0.0.1:18891/"
TTS_URL = "http://127.0.0.1:18888/health"


def state_root():
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData/Local")
    root = Path(base) / "SuperPinkie"
    root.mkdir(parents=True, exist_ok=True)
    return root


def append_log(name, message):
    directory = state_root() / "logs"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f"{name}.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")


def http_alive(url, expected_service=None):
    try:
        with urllib.request.urlopen(url, timeout=1.4) as response:
            if expected_service:
                value = json.loads(response.read().decode("utf-8"))
                return value.get("service") == expected_service
            return response.status is not None
    except urllib.error.HTTPError as error:
        return not expected_service and error.code is not None
    except (OSError, ValueError, urllib.error.URLError):
        return False


def hidden_process_kwargs():
    return {
        "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
    }


class BundledRuntime:
    def __init__(self, root):
        self.root = Path(root)
        self.runtime = self.root / "runtime"
        self.node = self.runtime / "bin/node.exe"
        self.openclaw = self.runtime / "node_modules/openclaw/openclaw.mjs"

    def valid(self):
        return self.node.is_file() and self.openclaw.is_file()

    def environment(self):
        environment = os.environ.copy()
        environment["PATH"] = str(self.runtime / "bin") + os.pathsep + environment.get("PATH", "")
        environment["OPENCLAW_ROOT"] = str(self.openclaw.parent)
        environment["PINKIE_NODE_BIN"] = str(self.node)
        environment["PINKIE_OPENCLAW_ENTRY"] = str(self.openclaw)
        environment["PINKIE_MANAGED_GATEWAY"] = "1"
        environment["PINKIE_GATEWAY_URL"] = GATEWAY_URL
        environment["PINKIE_STATE_ROOT"] = str(state_root())
        environment["PYTHONUTF8"] = "1"
        environment.pop("CLAUDECODE", None)
        return environment


class GatewaySupervisor:
    def __init__(self, runtime):
        self.runtime = runtime
        self.process = None
        self.closing = threading.Event()
        self.lock = threading.RLock()
        self.last_restart = 0.0

    def start(self):
        with self.lock:
            if http_alive(GATEWAY_URL):
                return
            if self.process and self.process.poll() is None:
                return
            if time.monotonic() - self.last_restart < 4:
                return
            self.last_restart = time.monotonic()
            log_dir = state_root() / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            output = (log_dir / "gateway.log").open("ab")
            command = [
                str(self.runtime.node), str(self.runtime.openclaw),
                "gateway", "run", "--port", "18789", "--allow-unconfigured",
            ]
            try:
                self.process = subprocess.Popen(
                    command,
                    cwd=str(self.runtime.openclaw.parent),
                    env=self.runtime.environment(),
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=output,
                    **hidden_process_kwargs(),
                )
                append_log("launcher", f"gateway started pid={self.process.pid}")
            except OSError as error:
                output.close()
                append_log("launcher", f"gateway start failed: {error}")

    def wait_ready(self, seconds=126):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and not self.closing.is_set():
            if http_alive(GATEWAY_URL):
                return True
            self.start()
            time.sleep(.35)
        return False

    def monitor(self):
        failures = 0
        while not self.closing.wait(2):
            if http_alive(GATEWAY_URL):
                failures = 0
                continue
            failures += 1
            if failures >= 2:
                failures = 0
                self.stop_process()
                self.start()

    def stop_process(self):
        with self.lock:
            process = self.process
            self.process = None
        if not process or process.poll() is not None:
            return
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            process.kill()

    def close(self):
        self.closing.set()
        self.stop_process()


def load_file_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LocalServices:
    def __init__(self, runtime):
        self.runtime = runtime
        self.servers = []
        self.threads = []

    def _start(self, name, relative, target, arguments, health, expected=None):
        if http_alive(health, expected):
            return

        def run():
            try:
                module = load_file_module(f"pinkie_windows_{name}", self.runtime.root / relative)

                def ready(server):
                    self.servers.append(server)

                getattr(module, target)(*arguments, on_ready=ready)
            except OSError as error:
                if not http_alive(health, expected):
                    append_log("launcher", f"{name} service failed: {error}")
            except Exception as error:
                append_log("launcher", f"{name} service failed: {error}")

        thread = threading.Thread(target=run, name=f"pinkie-{name}", daemon=True)
        thread.start()
        self.threads.append(thread)

    def start(self):
        os.environ.update(self.runtime.environment())
        data = state_root()
        self._start(
            "party", "services/party/server.py", "serve",
            (18889, str(data / "party")), PARTY_URL + "api/health", "super-pinkie-party",
        )
        self._start(
            "roundtable", "services/roundtable/server.py", "serve",
            (18891, str(data / "roundtable")), ROUNDTABLE_URL + "api/health", "super-pinkie-roundtable",
        )
        self._start("tts", "services/tts/edge_tts_server.py", "serve", (18888,), TTS_URL)
        self._start("relay", "proxy/ur-rewrite-proxy.py", "serve", (1467,), "http://127.0.0.1:1467/health")

    def close(self):
        for server in list(self.servers):
            try:
                server.shutdown()
            except Exception:
                pass


class NativeBridge:
    def __init__(self):
        self.window = None
        self.maximized = False
        self.dictation_stop = threading.Event()
        self.dictation_thread = None
        self.dictation_text = ""

    def attach(self, window):
        self.window = window

    def open_chat(self):
        self.window.load_url(GATEWAY_URL)

    def open_party(self):
        self.window.load_url(PARTY_URL)

    def open_roundtable(self):
        self.window.load_url(ROUNDTABLE_URL)

    def project_folder(self, payload):
        payload = payload if isinstance(payload, dict) else {}
        request_id = str(payload.get("requestId", ""))
        if payload.get("action") == "reveal":
            path = Path(str(payload.get("path", "")))
            if path.is_dir():
                subprocess.Popen(["explorer.exe", str(path)], **hidden_process_kwargs())
            return {"requestId": request_id, "cancelled": not path.is_dir()}
        if payload.get("action") != "choose":
            return {"requestId": request_id, "cancelled": True}
        import webview

        initial = Path(str(payload.get("path", "")))
        directory = str(initial if initial.is_dir() else Path.home())
        selected = self.window.create_file_dialog(
            webview.FOLDER_DIALOG, directory=directory, allow_multiple=False
        )
        if not selected:
            return {"requestId": request_id, "cancelled": True}
        path = Path(selected[0]).resolve()
        return {
            "requestId": request_id,
            "cancelled": False,
            "path": str(path),
            "name": path.name,
        }

    def open_external(self, url):
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            webbrowser.open(url)

    def _dictation_update(self, state, transcript=None, message=None):
        payload = {"state": state}
        if transcript is not None:
            payload["transcript"] = transcript
        if message:
            payload["message"] = message
        try:
            self.window.evaluate_js(
                "window.__laolaoNativeDictationUpdate?.(" + json.dumps(payload, ensure_ascii=False) + ")"
            )
        except Exception:
            pass

    def start_dictation(self):
        if self.dictation_thread and self.dictation_thread.is_alive():
            return
        self.dictation_stop.clear()
        self.dictation_text = ""

        def listen():
            try:
                import pythoncom
                import win32com.client

                pythoncom.CoInitialize()
                recognizer = win32com.client.Dispatch("SAPI.SpSharedRecognizer")
                context = recognizer.CreateRecoContext()
                bridge = self

                class SpeechEvents:
                    def OnRecognition(self, _stream_number, _stream_position, _recognition_type, result):
                        text = str(result.PhraseInfo.GetText() or "").strip()
                        if text:
                            bridge.dictation_text += text
                            bridge._dictation_update("recording", bridge.dictation_text)

                # Keep the COM event sink alive for the whole recording. If it
                # is collected, SAPI keeps listening but no text reaches the UI.
                events = win32com.client.WithEvents(context, SpeechEvents)
                grammar = context.CreateGrammar()
                grammar.DictationLoad()
                grammar.DictationSetState(1)
                self._dictation_update("recording")
                while not self.dictation_stop.wait(.05):
                    pythoncom.PumpWaitingMessages()
                grammar.DictationSetState(0)
                _ = events
                self._dictation_update("idle", self.dictation_text)
            except Exception as error:
                self._dictation_update("error", self.dictation_text, f"语音识别没有启动：{error}")
            finally:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass

        self.dictation_thread = threading.Thread(target=listen, name="pinkie-dictation", daemon=True)
        self.dictation_thread.start()

    def stop_dictation(self):
        self.dictation_stop.set()

    def minimize(self):
        self.window.minimize()

    def toggle_maximize(self):
        if self.maximized:
            self.window.restore()
        else:
            self.window.maximize()
        self.maximized = not self.maximized

    def window_close(self):
        self.window.destroy()

    def control_center(self):
        subprocess.Popen([sys.executable, "--control-center"], **hidden_process_kwargs())


BRIDGE_SCRIPT = r"""
(() => {
  if (location.protocol === 'file:') return;
  document.documentElement.setAttribute('data-pinkie-native-glass', '1');
  const call = (name, payload) => payload === undefined
    ? window.pywebview?.api?.[name]?.()
    : window.pywebview?.api?.[name]?.(payload);
  const handlers = {
    laolaoParty: { postMessage: () => call('open_party') },
    laolaoRoundtable: { postMessage: () => call('open_roundtable') },
    laolaoProjectFolder: { postMessage: payload => call('project_folder', payload).then(result => window.__laolaoProjectFolderResult?.(result)) }
  };
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = Object.assign(window.webkit.messageHandlers || {}, handlers);

  handlers.laolaoNativeDictation = { postMessage(payload) {
    if (payload?.action === 'stop') call('stop_dictation');
    else call('start_dictation');
  }};

  let spokenAudio = null;
  handlers.laolaoLiveVoice = { postMessage(payload) {
    if (payload?.action === 'stop') {
      spokenAudio?.pause();
      spokenAudio = null;
      return;
    }
    const text = String(payload?.text || '').trim();
    if (!text) return;
    fetch('http://127.0.0.1:18888/v1/audio/speech', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({input:text,voice:'zh-CN-XiaoyiNeural'})
    }).then(response => response.ok ? response.blob() : Promise.reject())
      .then(blob => { spokenAudio = new Audio(URL.createObjectURL(blob)); return spokenAudio.play(); })
      .catch(() => {});
  }};

  const installDictation = () => {
    const actions = document.querySelector('.agent-chat__composer-actions');
    if (!actions || document.getElementById('laolao-native-dictation')) return;
    const button = document.createElement('button');
    button.id = 'laolao-native-dictation';
    button.type = 'button';
    button.className = 'chat-send-btn chat-send-btn--laolao-dictation';
    button.setAttribute('aria-label','碧琪听着呢');
    button.innerHTML = '<svg class="laolao-dictation-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="3" width="7" height="11" rx="3.5"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"></path></svg><span class="agent-chat__control-label"></span>';
    let active = false, baseDraft = '';
    const editor = () => document.querySelector('.agent-chat__composer-combobox textarea');
    window.__laolaoNativeDictationUpdate = payload => {
      if (typeof payload?.transcript === 'string' && editor()) {
        editor().value = baseDraft + payload.transcript;
        editor().dataset.laolaoVoiceDraft = '1';
        editor().dispatchEvent(new Event('input',{bubbles:true}));
        window.dispatchEvent(new CustomEvent('laolao:dictation-draft'));
      }
      active = payload?.state === 'recording';
      button.classList.toggle('is-recording',active);
      button.setAttribute('aria-label',payload?.message || (active?'收好啦':'碧琪听着呢'));
    };
    button.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      if (active) handlers.laolaoNativeDictation.postMessage({action:'stop'});
      else { baseDraft = editor()?.value || ''; handlers.laolaoNativeDictation.postMessage({action:'start'}); }
    };
    actions.prepend(button);
  };
  installDictation();
  const dictationTimer = setInterval(installDictation, 900);

  if (!document.getElementById('pinkie-native-window-controls')) {
    const drag = document.createElement('div');
    drag.className = 'pywebview-drag-region';
    drag.id = 'pinkie-native-drag-strip';
    document.body.append(drag);
    const controls = document.createElement('div');
    controls.id = 'pinkie-native-window-controls';
    controls.innerHTML = '<button data-act="min" aria-label="最小化"></button><button data-act="max" aria-label="最大化"></button><button data-act="close" aria-label="关闭"></button>';
    controls.onclick = event => {
      const action = event.target.closest('button')?.dataset.act;
      if (action === 'min') call('minimize');
      if (action === 'max') call('toggle_maximize');
      if (action === 'close') call('window_close');
    };
    document.body.append(controls);
    const style = document.createElement('style');
    style.textContent = '#pinkie-native-drag-strip{position:fixed;z-index:2147482000;left:0;right:0;top:0;height:8px;background:transparent}#pinkie-native-window-controls{position:fixed;z-index:2147483647;top:8px;right:9px;display:flex;gap:7px;padding:5px 7px;border:1px solid rgba(255,255,255,.45);border-radius:999px;background:rgba(255,242,248,.38);backdrop-filter:blur(13px)}#pinkie-native-window-controls button{position:relative;width:11px;height:11px;padding:0;border:0;border-radius:50%;background:#dca0bb;opacity:.55}#pinkie-native-window-controls:hover button{opacity:.92}#pinkie-native-window-controls button[data-act="close"]{background:#d85b91}#pinkie-native-window-controls button:focus-visible{outline:1px solid #fff;outline-offset:2px}';
    document.head.append(style);
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.hostname === '127.0.0.1' && url.port === '18789') { event.preventDefault(); call('open_chat'); return; }
    if (url.protocol.startsWith('http') && !['127.0.0.1','localhost'].includes(url.hostname)) {
      event.preventDefault(); call('open_external',url.href);
    }
  }, true);
  window.addEventListener('beforeunload', () => clearInterval(dictationTimer), {once:true});
})();
"""


def show_startup_error(window):
    window.evaluate_js("""
      (()=>{const box=document.createElement('div');box.style.cssText='position:fixed;left:50%;bottom:9%;transform:translateX(-50%);padding:10px 16px;border:1px solid #fff8;border-radius:18px;background:#f8dcebdd;color:#72455d;font:12px system-ui;box-shadow:0 12px 34px #7b3f5d22';box.textContent='本机服务还没有准备好，现有资料没有改动。重新打开 App 会继续恢复。';document.body.append(box)})();
    """)


def run_desktop(resource_root, prepare):
    import webview

    runtime = BundledRuntime(resource_root)
    if not runtime.valid():
        raise RuntimeError("Windows bundled runtime is incomplete")
    os.environ.update(runtime.environment())
    bridge = NativeBridge()
    loading = (Path(resource_root) / "ui/launcher-loading.html").resolve().as_uri()
    window = webview.create_window(
        "超級碧琪", loading, js_api=bridge, width=1280, height=800,
        min_size=(860, 580), frameless=True, easy_drag=False,
        background_color="#efcbd3",
    )
    bridge.attach(window)
    gateway = GatewaySupervisor(runtime)
    services = LocalServices(runtime)
    started = time.monotonic()

    def loaded(*_):
        try:
            window.evaluate_js(BRIDGE_SCRIPT)
        except Exception:
            pass

    def bootstrap():
        try:
            prepare(lambda message: append_log("setup", message))
            services.start()
            gateway.start()
            threading.Thread(target=gateway.monitor, name="pinkie-gateway-watchdog", daemon=True).start()
            ready = gateway.wait_ready()
            remaining = 6.1 - (time.monotonic() - started)
            if remaining > 0:
                time.sleep(remaining)
            if ready:
                window.load_url(GATEWAY_URL)
            else:
                show_startup_error(window)
        except Exception as error:
            append_log("launcher", f"startup failed: {error}")
            show_startup_error(window)

    def shown(*_):
        threading.Thread(target=bootstrap, name="pinkie-bootstrap", daemon=True).start()

    def closed(*_):
        bridge.stop_dictation()
        services.close()
        gateway.close()

    window.events.loaded += loaded
    window.events.shown += shown
    window.events.closed += closed
    webview.start(
        gui="edgechromium", debug=False, private_mode=False,
        storage_path=str(state_root() / "webview"),
    )
