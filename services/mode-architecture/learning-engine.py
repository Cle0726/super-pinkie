"""Bounded local learning computations. JSON in/out; never eval user input."""
import ast
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile


def limits(cpu=3, files=32768):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (files, files))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        if sys.platform != 'darwin':
            resource.setrlimit(resource.RLIMIT_AS, (768 * 1024**2, 768 * 1024**2))
    return apply


def c_program(data):
    if sys.platform != 'darwin' or not Path('/usr/bin/sandbox-exec').exists():
        raise ValueError('当前系统尚未配置隔离C运行环境')
    code, stdin = data.get('code', ''), data.get('stdin', '')
    if not isinstance(code, str) or not 1 <= len(code.encode()) <= 16000:
        raise ValueError('C代码需要1–16000字节')
    if not isinstance(stdin, str) or len(stdin.encode()) > 4000:
        raise ValueError('输入最多4000字节')
    # Use a concrete compiler; do not allow PATH, environment or tool discovery
    # inside a user-authored program to select another executable.
    clang = Path('/Library/Developer/CommandLineTools/usr/bin/clang')
    if not clang.exists():
        raise ValueError('本机C编译工具尚未就绪')
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'LC_ALL': 'C', 'TMPDIR': ''}
    quote = lambda value: json.dumps(str(value))
    with tempfile.TemporaryDirectory(prefix='pinkie-c-') as directory:
        root = Path(directory).resolve()
        source, executable = root / 'main.c', root / 'program'
        source.write_text(code, encoding='utf-8')
        env['TMPDIR'] = str(root)
        reads = ['/System/Library', '/usr/lib', '/Library/Developer/CommandLineTools', str(root)]
        common = '(version 1)(deny default)(allow sysctl-read)(allow file-read-metadata)(allow file-read* (literal "/"))'
        common += ''.join('(allow file-read* (subpath %s))' % quote(p) for p in reads)
        common += '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))'
        compile_policy = common + '(allow process-exec (literal %s) (literal %s))(allow process-fork)' % (quote(clang), quote(clang.parent / 'ld'))
        compile_policy += '(allow file-write* (subpath %s))' % quote(root)
        run_policy = common + '(deny network*)(deny process-fork)(allow process-exec (literal %s))' % quote(executable)
        run_policy += '(allow file-write-data (literal %s) (literal %s))' % (quote(root / 'stdout'), quote(root / 'stderr'))
        # No network, fork, exec of other tools, host file writes or private
        # home-directory reads are granted. The compile root is discarded.
        def run(args, policy, timeout, max_file, cpu):
            with (root / 'stdout').open('w+b') as output, (root / 'stderr').open('w+b') as errors:
                proc = subprocess.Popen(['/usr/bin/sandbox-exec', '-p', policy, *map(str, args)],
                    cwd=root, env=env, stdin=subprocess.PIPE, stdout=output, stderr=errors,
                    start_new_session=True, preexec_fn=limits(cpu, max_file))
                timed_out = False
                memory_limited = False
                try:
                    proc.stdin.write(stdin.encode() if args[0] == executable else b''); proc.stdin.close()
                    import time
                    deadline = time.monotonic() + timeout
                    while proc.poll() is None:
                        if time.monotonic() >= deadline:
                            timed_out = True; break
                        if args[0] == executable:
                            rss = subprocess.run(['/bin/ps', '-p', str(proc.pid), '-o', 'rss='], capture_output=True, text=True).stdout.strip()
                            if rss.isdigit() and int(rss) > 256 * 1024:
                                memory_limited = True; break
                        time.sleep(.06)
                    if timed_out or memory_limited: os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                    # A program must not leave descendants behind, even if a
                    # future platform changes its fork policy.
                    try: os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                except subprocess.TimeoutExpired:
                    timed_out = True
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                output.seek(0); errors.seek(0)
                error_text=errors.read(16000).decode('utf-8', 'replace')
                if memory_limited:error_text+='\nMemory budget exceeded.'
                return proc.returncode, output.read(max_file).decode('utf-8', 'replace'), error_text, timed_out
        sdk = clang.parents[2] / 'SDKs/MacOSX.sdk'
        base = [clang, '-isysroot', sdk, '-std=c11', '-O0', '-g0', '-Wall', '-Wextra', '-fsanitize=undefined,bounds', '-fno-sanitize-recover=all']
        status, _, errors, timeout = run([*base, source, '-o', executable], compile_policy, 7, 16 * 1024**2, 5)
        errors = errors.replace(str(root), '<练习>')
        if status or timeout:
            return {'compiled': False, 'stderr': errors[:12000], 'timedOut': timeout, 'stdout': '', 'exitCode': status}
        status, output, run_errors, timeout = run([executable], run_policy, 3, 32768, 2)
        result = {'compiled': True, 'stdout': output[:16000], 'stderr': run_errors.replace(str(root), '<练习>')[:12000],
            'exitCode': status, 'timedOut': timeout, 'truncated': len(output.encode()) >= 16000,
            'engine': 'clang-c11-ubsan', 'isolated': True}
        # AST is compiler-produced data. The JS interpreter accepts a small,
        # explicit educational subset; it is never a second native execution.
        if status == 0 and not timeout and not stdin:
            ast_code, dump, _, ast_timeout = run([clang, '-isysroot', sdk, '-std=c11', '-Xclang', '-ast-dump=json',
                '-Xclang', '-ast-dump-filter=main', '-fsyntax-only', source], compile_policy, 4, 1024**2, 3)
            if not ast_code and not ast_timeout:
                try:
                    tree = json.loads(dump)
                    if tree.get('kind') == 'FunctionDecl' and tree.get('name') == 'main':
                        result['ast'] = tree
                except (ValueError, TypeError):
                    pass
        return result


def math_check(data):
    import sympy as s
    x = s.Symbol('x', real=True)
    names = {'x': x, 'pi': s.pi, 'e': s.E}
    functions = {'sin': s.sin, 'cos': s.cos, 'tan': s.tan, 'exp': s.exp, 'log': s.log, 'sqrt': s.sqrt, 'abs': s.Abs}
    def parse(value):
        if not isinstance(value, str) or len(value) > 300:
            raise ValueError('表达式最多300字')
        tree = ast.parse(value.replace('^', '**'), mode='eval')
        if sum(1 for _ in ast.walk(tree)) > 100:
            raise ValueError('请缩短表达式')
        def visit(node):
            if isinstance(node, ast.Expression): return visit(node.body)
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                if abs(node.value) > 1000000: raise ValueError('数字超出练习范围')
                return s.Rational(str(node.value))
            if isinstance(node, ast.Name) and node.id in names: return names[node.id]
            if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                return visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
            if isinstance(node, ast.BinOp):
                left, right = visit(node.left), visit(node.right)
                if isinstance(node.op, ast.Add): return left + right
                if isinstance(node.op, ast.Sub): return left - right
                if isinstance(node.op, ast.Mult): return left * right
                if isinstance(node.op, ast.Div): return left / right
                if isinstance(node.op, ast.Pow):
                    if right.is_number and abs(right) > 100: raise ValueError('指数超出练习范围')
                    return left ** right
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in functions and len(node.args) == 1 and not node.keywords:
                return functions[node.func.id](visit(node.args[0]))
            raise ValueError('仅支持x、数字、四则运算、乘方和sin/cos/tan/exp/log/sqrt/abs')
        return visit(tree)
    expr = parse(data.get('expression', ''))
    operation = data.get('operation', 'derivative')
    if operation == 'derivative': result = s.diff(expr, x)
    elif operation == 'integral': result = s.integrate(expr, x)
    elif operation == 'limit':
        point = parse(data.get('point', '0'))
        if x in point.free_symbols: raise ValueError('趋近值不能包含x')
        left, right = s.limit(expr, x, point, dir='-'), s.limit(expr, x, point, dir='+')
        if left != right:
            return {'engine': 'sympy', 'status': 'two-sided-limit-missing', 'left': str(left), 'right': str(right), 'message': '左右极限不一致，双侧极限不存在'}
        result = left
    elif operation == 'simplify': result = s.simplify(expr)
    else: raise ValueError('不支持这种数学核验')
    if result.has(s.Integral, s.Limit, s.Derivative):
        return {'engine': 'sympy', 'status': 'unknown', 'message': '计算工具未能完成此式，请分步核对'}
    verdict = None
    answer = data.get('answer', '').strip()
    if answer:
        candidate = parse(answer)
        delta = s.diff(candidate, x) - expr if operation == 'integral' else candidate - result
        reduced = s.simplify(delta)
        verdict = True if reduced == 0 else False if reduced.is_zero is False else None
    return {'engine': 'sympy', 'status': 'computed', 'result': str(result), 'latex': s.latex(result), 'matches': verdict,
        'message': '不定积分结果省略任意常数；核验仍需保留原题定义域、可导条件与端点限制。' if operation == 'integral' else '符号结果需结合原题定义域和适用条件检查。'}


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(64000)
        data = json.loads(raw)
        if data.get('kind') == 'c_program': result = c_program(data)
        elif data.get('kind') == 'math_check':
            limits(cpu=7, files=1024**2)()
            result = math_check(data)
        else: raise ValueError('不支持这种计算')
        print(json.dumps({'ok': True, 'result': result}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)[:500]}, ensure_ascii=False))
