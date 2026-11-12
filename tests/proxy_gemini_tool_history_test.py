"""Gemini tool history is rewritten before it reaches the relay.

The proxy module starts a server on import, so load only the rewriter.
"""
import ast
import json
import os
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "proxy" / "mm-retry-proxy.py").read_text()
TREE = ast.parse(SOURCE)
WANTED = {"_message_text", "_tool_command", "flatten_gemini_tool_history"}
ENV = {"json": json, "os": os}
exec(
    compile(
        ast.Module(
            body=[node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in WANTED],
            type_ignores=[],
        ),
        "mm-retry-proxy.py",
        "exec",
    ),
    ENV,
)
flatten = ENV["flatten_gemini_tool_history"]


def message(role, content="", **extra):
    body = {"role": role, "content": content}
    body.update(extra)
    return body


class GeminiToolHistoryTests(unittest.TestCase):
    def test_non_gemini_history_stays_native(self):
        parsed = {
            "model": "deepseek-v4.1-flash",
            "messages": [
                message("user", "跑 whoami"),
                message("assistant", "先看", tool_calls=[{"id": "c1", "type": "function", "function": {"name": "exec", "arguments": "{\"command\":\"whoami\"}"}}]),
                message("tool", "Admin", tool_call_id="c1"),
            ],
        }
        before = json.dumps(parsed)
        self.assertFalse(flatten(parsed))
        self.assertEqual(json.dumps(parsed), before)

    def test_gemini_without_tool_calls_stays(self):
        parsed = {"model": "gemini-3.8-flash-tiered", "messages": [message("user", "你好")]}
        self.assertFalse(flatten(parsed))
        self.assertEqual(parsed["messages"][0]["content"], "你好")

    def test_past_tool_rounds_become_a_user_log_and_summaries_stay(self):
        parsed = {
            "model": "mm/gemini-3.8-flash-tiered",
            "tools": [{"type": "function"}],
            "messages": [
                message("system", "你是碧琪"),
                message("user", "一步一条：1) date +%d 2) echo $((d*5))"),
                message("assistant", "碧琪接下来运行 date。", tool_calls=[
                    {"id": "c1", "type": "function", "function": {"name": "exec", "arguments": "{\"command\":\"date +%d\"}"}},
                ]),
                message("tool", "05", tool_call_id="c1"),
                message("assistant", "碧琪接下来算乘法。", tool_calls=[
                    {"id": "c2", "type": "function", "function": {"name": "exec", "arguments": "{\"command\":\"echo $((5*5))\"}"}},
                ]),
                message("tool", "25", tool_call_id="c2"),
                message("assistant", "前两步已经算完。"),
                message("user", "继续第 3 步"),
            ],
        }
        self.assertTrue(flatten(parsed))
        roles = [item["role"] for item in parsed["messages"]]
        self.assertNotIn("tool", roles)
        self.assertFalse(any(item.get("tool_calls") for item in parsed["messages"]))
        self.assertEqual(parsed["tools"], [{"type": "function"}])
        logs = [item["content"] for item in parsed["messages"] if item["content"].startswith("已执行")]
        self.assertEqual(logs, [
            "已执行：exec：date +%d\n结果：05",
            "已执行：exec：echo $((5*5))\n结果：25",
        ])
        self.assertIn("前两步已经算完。", [item["content"] for item in parsed["messages"]])
        self.assertEqual(parsed["messages"][0]["content"], "你是碧琪")
        self.assertEqual(parsed["messages"][-1]["content"], "继续第 3 步")

    def test_parallel_results_stay_on_the_same_log(self):
        parsed = {
            "model": "gemini-3.8-flash-tiered",
            "messages": [
                message("user", "两个一起"),
                message("assistant", "", tool_calls=[
                    {"id": "a", "type": "function", "function": {"name": "exec", "arguments": "{\"command\":\"echo a\"}"}},
                    {"id": "b", "type": "function", "function": {"name": "exec", "arguments": "{\"command\":\"echo b\"}"}},
                ]),
                message("tool", "A", tool_call_id="a"),
                message("tool", "B", tool_call_id="b"),
            ],
        }
        self.assertTrue(flatten(parsed))
        self.assertEqual(
            parsed["messages"][-1]["content"],
            "已执行：exec：echo a exec：echo b\n结果：A\n结果：B",
        )


    def test_screenshot_in_tool_result_is_kept(self):
        img = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}}
        parsed = {
            "model": "gemini-3.8-flash-tiered",
            "messages": [
                message("user", "截个图"),
                message("assistant", "", tool_calls=[{"id": "c1", "type": "function", "function": {"name": "browser", "arguments": "{}"}}]),
                message("tool", [{"type": "text", "text": "ok"}, img], tool_call_id="c1"),
            ],
        }
        self.assertTrue(flatten(parsed))
        log = parsed["messages"][1]
        self.assertEqual(log["role"], "user")
        self.assertIn(img, log["content"])
        text = "".join(p.get("text", "") for p in log["content"])
        self.assertIn("已执行：browser", text)
        self.assertIn("结果：ok", text)
        self.assertFalse(any(m.get("tool_calls") or m.get("role") == "tool" for m in parsed["messages"]))


if __name__ == "__main__":
    unittest.main()
