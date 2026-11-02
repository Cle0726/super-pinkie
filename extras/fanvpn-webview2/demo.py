"""最小可运行示例：验证解密、节点列表、面板和代理切换。

直接运行：
    python3 demo.py

它会：
  1. 从插件里取出内置 RSA 私钥
  2. 拉取并解密真实节点表
  3. 起本地代理 + 节点面板
  4. 用面板 API 选两个不同节点，打印各自的真实出口 IP

网页界面自己看：
    运行后浏览器打开 http://127.0.0.1:10810/
"""

from __future__ import annotations

import json
import socket
import time
import urllib.request
from pathlib import Path

from fanvpn_service import apply_to_webview2_env, start_fanvpn

HERE = Path(__file__).resolve().parent
KEY_PEM = (HERE / "plugin" / "_key.pem").read_text(encoding="utf-8")


def exit_ip_via(proxy_port: int) -> dict:
    """经本地代理查一次出口 IP，用来证明节点真的生效了。"""
    sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=25)
    sock.sendall(
        b"GET http://ip-api.com/json/?fields=query,country,isp HTTP/1.1\r\n"
        b"Host: ip-api.com\r\nConnection: close\r\n\r\n"
    )
    chunks = []
    while True:
        data = sock.recv(8192)
        if not data:
            break
        chunks.append(data)
    sock.close()
    body = b"".join(chunks).partition(b"\r\n\r\n")[2]
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"raw": body[:120].decode("latin-1")}


def main() -> None:
    service = start_fanvpn(KEY_PEM, panel_port=10810, proxy_port=10809)
    time.sleep(1.0)

    print(f"面板地址     : {service.panel_url}")
    print(f"本地代理端口 : {service.settings.proxy_port}")

    base = service.panel_url.rstrip("/")

    def get(path: str, timeout: int = 60) -> dict:
        with urllib.request.urlopen(base + path, timeout=timeout) as response:
            return json.loads(response.read())

    def post(path: str, payload: dict) -> dict:
        request = urllib.request.Request(
            base + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())

    nodes = get("/api/nodes?force=1")["nodes"]
    print(f"\n解密得到 {len(nodes)} 个节点：")
    for node in nodes:
        print(f"  {node['flag']}  {node['name']:<26} {node['status']:<5} {node['ms']} ms")

    print("\n未选节点（直连出口）:", exit_ip_via(service.settings.proxy_port))

    first, second = nodes[0], nodes[3]
    post("/api/select", {"server": first["server"], "port": first["port"]})
    print(f"选中 {first['name']} 后出口:", exit_ip_via(service.settings.proxy_port))

    post("/api/select", {"server": second["server"], "port": second["port"]})
    print(f"切到 {second['name']} 后出口:", exit_ip_via(service.settings.proxy_port))

    apply_to_webview2_env(service)
    print("\nWebView2 启动参数:")
    print("  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =", service.webview2_args)
    print("\n面板里点节点即可实时切换，页面不需要刷新。")
    print("按 Ctrl+C 退出（示例进程会自动结束）。")


if __name__ == "__main__":
    main()
