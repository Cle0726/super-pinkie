"""learning-engine.py 的纯逻辑单测。

只验证资源限额的组装、C 程序入口的环境与输入校验、数学表达式白名单解析和命令行 JSON 协议；
不调用 clang / sandbox-exec，不编译或运行任何 C 程序，不联网，不碰用户目录。
"""
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "services" / "mode-architecture" / "learning-engine.py"
HAS_SYMPY = importlib.util.find_spec("sympy") is not None


class FakeResource:
    """代替 Unix 专有的 resource 模块：只记录 setrlimit 调用，不真的给测试进程设限。"""

    RLIMIT_CPU, RLIMIT_FSIZE, RLIMIT_CORE, RLIMIT_NOFILE, RLIMIT_AS = "CPU", "FSIZE", "CORE", "NOFILE", "AS"

    def __init__(self):
        self.calls = []

    def setrlimit(self, kind, value):
        self.calls.append((kind, value))


def load_engine():
    # 文件名带连字符，只能按路径加载；用假 resource 加载，Windows 上也能跑这些纯逻辑测试
    with mock.patch.dict(sys.modules, {"resource": FakeResource()}):
        spec = importlib.util.spec_from_file_location("pinkie_learning_engine", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


ENGINE = load_engine()


def fake_sympy():
    """极简假 sympy：只够解析器拿到符号与常量，数字用 Fraction 承载，用于不依赖 sympy 的白名单测试。"""
    module = types.ModuleType("sympy")
    module.Symbol = lambda name, **_: ("symbol", name)
    module.pi, module.E = ("const", "pi"), ("const", "E")
    for name in ("sin", "cos", "tan", "exp", "log", "sqrt", "Abs"):
        setattr(module, name, lambda value, name=name: (name, value))
    module.Rational = Fraction
    return module


class ResourceLimitTests(unittest.TestCase):
    def setUp(self):
        ENGINE.resource.calls.clear()

    def apply(self, platform, *args, **kwargs):
        with mock.patch.object(ENGINE, "sys", types.SimpleNamespace(platform=platform)):
            hook = ENGINE.limits(*args, **kwargs)
            # limits() 只返回给 preexec_fn 用的钩子，调用前不能对当前进程生效
            self.assertEqual(ENGINE.resource.calls, [])
            hook()
        return ENGINE.resource.calls

    def test_default_limits_on_linux_include_address_space(self):
        self.assertEqual(self.apply("linux"), [
            ("CPU", (3, 4)), ("FSIZE", (32768, 32768)), ("CORE", (0, 0)), ("NOFILE", (64, 64)),
            ("AS", (768 * 1024**2, 768 * 1024**2)),
        ])

    def test_macos_skips_address_space_limit(self):
        # macOS 不支持 RLIMIT_AS，设置会失败，所以只在非 darwin 上加
        calls = self.apply("darwin", cpu=7, files=1024**2)
        self.assertEqual(calls, [("CPU", (7, 8)), ("FSIZE", (1024**2, 1024**2)), ("CORE", (0, 0)), ("NOFILE", (64, 64))])


class FakePath(type(Path())):
    """只把指定路径当成存在，其余一律不存在；不访问真实文件系统。"""

    present = set()

    def exists(self, *args, **kwargs):
        # 用 as_posix() 比较：Windows CI 上 str() 会变成反斜杠路径
        return self.as_posix() in self.present


class CProgramValidationTests(unittest.TestCase):
    SANDBOX = "/usr/bin/sandbox-exec"
    CLANG = "/Library/Developer/CommandLineTools/usr/bin/clang"

    def call(self, data, platform="darwin", present=(SANDBOX,)):
        FakePath.present = set(present)
        forbidden = mock.Mock(side_effect=AssertionError("校验失败前不应启动任何进程或建临时目录"))
        with mock.patch.object(ENGINE, "sys", types.SimpleNamespace(platform=platform)), \
                mock.patch.object(ENGINE, "Path", FakePath), \
                mock.patch.object(ENGINE.subprocess, "Popen", forbidden), \
                mock.patch.object(ENGINE.tempfile, "TemporaryDirectory", forbidden):
            with self.assertRaises(ValueError) as caught:
                ENGINE.c_program(data)
        forbidden.assert_not_called()
        return str(caught.exception)

    def test_isolation_environment_is_checked_before_anything_else(self):
        # 非 macOS，或 macOS 缺 sandbox-exec，都直接拒绝，哪怕代码本身也不合法
        self.assertEqual(self.call({"code": "int main(void){return 0;}"}, platform="linux"), "当前系统尚未配置隔离C运行环境")
        self.assertEqual(self.call({"code": "int main(void){return 0;}"}, platform="win32"), "当前系统尚未配置隔离C运行环境")
        self.assertEqual(self.call({"code": ""}, present=()), "当前系统尚未配置隔离C运行环境")

    def test_code_must_be_1_to_16000_utf8_bytes(self):
        for code in ("", None, 42, ["int main(){}"], "a" * 16001, "中" * 5334):
            with self.subTest(code=len(code) if isinstance(code, str) else type(code).__name__):
                self.assertEqual(self.call({"code": code}), "C代码需要1–16000字节")
        self.assertEqual(self.call({}), "C代码需要1–16000字节")
        # 恰好 16000 字节（含多字节字符）可以通过长度校验，接着才检查编译器
        self.assertEqual(self.call({"code": "中" * 5333 + "a"}), "本机C编译工具尚未就绪")

    def test_stdin_must_be_text_of_at_most_4000_bytes(self):
        for stdin in (None, 7, "a" * 4001, "中" * 1334):
            with self.subTest(stdin=len(stdin) if isinstance(stdin, str) else stdin):
                self.assertEqual(self.call({"code": "x", "stdin": stdin}), "输入最多4000字节")
        self.assertEqual(self.call({"code": "x", "stdin": "a" * 4000}), "本机C编译工具尚未就绪")

    def test_only_the_fixed_command_line_tools_clang_is_accepted(self):
        # 只认固定路径的 clang，PATH 里别处的编译器不算数
        for other in ("/usr/bin/clang", "/usr/local/bin/clang", "/opt/homebrew/bin/gcc"):
            with self.subTest(other=other):
                self.assertEqual(self.call({"code": "int main(void){return 0;}"}, present=(self.SANDBOX, other)), "本机C编译工具尚未就绪")


class MathParserWhitelistTests(unittest.TestCase):
    """白名单解析只依赖 ast；用假 sympy 证明非法输入在交给 sympy 之前就被拒绝。"""

    def check(self, expression, operation="unsupported-op"):
        with mock.patch.dict(sys.modules, {"sympy": fake_sympy()}):
            with self.assertRaises(ValueError) as caught:
                ENGINE.math_check({"expression": expression, "operation": operation})
        return str(caught.exception)

    def test_allowed_names_numbers_and_functions_parse(self):
        # 能走到「不支持这种数学核验」，说明表达式本身已通过白名单
        for expression in ("x", "pi", "e", "sin(x)", "abs(x)", "sqrt(2)", "log(e)", "(1+2)*3-4/5", "-2", "+0.5", "1000000"):
            with self.subTest(expression=expression):
                self.assertEqual(self.check(expression), "不支持这种数学核验")

    def test_code_execution_attempts_and_unsupported_syntax_are_rejected(self):
        rejected = (
            '__import__("os").system("true")', "x.real", "y", "E", "Sin(x)", "sin(x, x)", "sin(x=1)",
            "x // 2", "x % 2", "x if x else 1", "[x]", "lambda: 1", "True", "None", "1j", "'1'", "~x", "x < 1",
        )
        for expression in rejected:
            with self.subTest(expression=expression):
                self.assertEqual(self.check(expression), "仅支持x、数字、四则运算、乘方和sin/cos/tan/exp/log/sqrt/abs")

    def test_length_node_count_and_number_range_are_bounded(self):
        for expression in (None, 3, "1" * 301):
            with self.subTest(expression=len(expression) if isinstance(expression, str) else expression):
                self.assertEqual(self.check(expression), "表达式最多300字")
        # 81 个字符、163 个语法节点：长度合格但节点数超限
        self.assertEqual(self.check("x" + "+x" * 40), "请缩短表达式")
        for expression in ("1000001", "-1000001", "1e7", "2.5e6"):
            with self.subTest(expression=expression):
                self.assertEqual(self.check(expression), "数字超出练习范围")

    def test_syntax_errors_surface_as_exceptions(self):
        with mock.patch.dict(sys.modules, {"sympy": fake_sympy()}):
            with self.assertRaises(SyntaxError):
                ENGINE.math_check({"expression": "2*", "operation": "derivative"})


@unittest.skipUnless(HAS_SYMPY, "本机未安装 sympy，跳过真实符号计算")
class MathCheckWithSympyTests(unittest.TestCase):
    def test_derivative_is_default_and_answers_are_compared_symbolically(self):
        result = ENGINE.math_check({"expression": "x^3+2*x", "answer": "3*x^2+2"})
        self.assertEqual((result["status"], result["matches"]), ("computed", True))
        self.assertIs(ENGINE.math_check({"expression": "x^3+2*x", "answer": "3*x^2"})["matches"], False)
        self.assertIsNone(ENGINE.math_check({"expression": "x^2"})["matches"])

    def test_integral_answers_may_differ_by_a_constant(self):
        self.assertIs(ENGINE.math_check({"operation": "integral", "expression": "2*x", "answer": "x^2+3"})["matches"], True)
        self.assertIs(ENGINE.math_check({"operation": "integral", "expression": "2*x", "answer": "2*x^2"})["matches"], False)

    def test_limits_report_one_sided_disagreement_and_reject_x_in_the_point(self):
        missing = ENGINE.math_check({"operation": "limit", "expression": "1/x", "point": "0"})
        self.assertEqual(missing["status"], "two-sided-limit-missing")
        self.assertNotEqual(missing["left"], missing["right"])
        self.assertEqual(ENGINE.math_check({"operation": "limit", "expression": "sin(x)/x", "point": "0"})["result"], "1")
        with self.assertRaisesRegex(ValueError, "趋近值不能包含x"):
            ENGINE.math_check({"operation": "limit", "expression": "x", "point": "x+1"})

    def test_exponent_above_100_is_rejected(self):
        self.assertEqual(ENGINE.math_check({"operation": "simplify", "expression": "x^100"})["status"], "computed")
        with self.assertRaisesRegex(ValueError, "指数超出练习范围"):
            ENGINE.math_check({"operation": "simplify", "expression": "x^101"})


@unittest.skipIf(sys.platform == "win32", "learning-engine.py 依赖 Unix 的 resource 模块，Windows 由 learning-compute.mjs 提前拒绝")
class CommandLineProtocolTests(unittest.TestCase):
    def run_engine(self, payload):
        with tempfile.TemporaryDirectory(prefix="pinkie-engine-") as directory:
            done = subprocess.run([sys.executable, "-I", str(SCRIPT)], input=payload, capture_output=True,
                                  cwd=directory, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr.decode("utf-8", "replace"))
        lines = done.stdout.decode("utf-8").splitlines()
        self.assertEqual(len(lines), 1, lines)
        # ensure_ascii=False：中文错误原样输出为 UTF-8，而不是 \\u 转义
        self.assertNotIn(b"\\u", done.stdout)
        return json.loads(lines[0])

    def test_unknown_kind_and_malformed_input_return_json_errors(self):
        self.assertEqual(self.run_engine(json.dumps({"kind": "python"}).encode()), {"ok": False, "error": "不支持这种计算"})
        self.assertEqual(self.run_engine(b"{}"), {"ok": False, "error": "不支持这种计算"})
        for payload in (b"", b"not json", b"[]", b'"c_program"'):
            with self.subTest(payload=payload):
                self.assertIs(self.run_engine(payload)["ok"], False)

    def test_input_beyond_64000_bytes_is_truncated_not_trusted(self):
        # 超过 64000 字节的部分被丢弃，截断后的 JSON 无法解析，只能得到错误
        response = self.run_engine(json.dumps({"kind": "c_program", "code": "a" * 70000}).encode())
        self.assertIs(response["ok"], False)
        self.assertLessEqual(len(response["error"]), 500)

    @unittest.skipIf(sys.platform == "darwin", "macOS 上会真的编译运行 C 程序，留给专门的集成测试")
    def test_c_program_is_refused_without_the_macos_sandbox(self):
        response = self.run_engine(json.dumps({"kind": "c_program", "code": "int main(void){return 0;}"}).encode())
        self.assertEqual(response, {"ok": False, "error": "当前系统尚未配置隔离C运行环境"})


if __name__ == "__main__":
    unittest.main()
