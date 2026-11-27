"""Static undefined-global-name gate for every Python file under app/.

Uses only the Python standard library (ast, builtins, symtable). No whitelist
for application symbols is allowed: only genuine Python builtins and runtime
dunder attributes are considered pre-bound.
"""

import ast
import builtins
from pathlib import Path
import symtable
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
PYTHON_BUILTINS_AND_DUNDERS = frozenset(dir(builtins)) | frozenset(
    {
        "__annotations__",
        "__builtins__",
        "__class__",
        "__doc__",
        "__file__",
        "__loader__",
        "__module__",
        "__name__",
        "__package__",
        "__path__",
        "__qualname__",
        "__spec__",
    }
)


def find_undefined_globals(source: str, filename: str = "<source>") -> list[tuple[str, list[int]]]:
    """Return sorted (name, line_numbers) pairs for globals read but never bound."""
    clean = source.lstrip("\ufeff")
    top = symtable.symtable(clean, filename, "exec")
    bound = {
        sym.get_name()
        for sym in top.get_symbols()
        if sym.is_assigned() or sym.is_imported() or sym.is_namespace()
    }
    missing: set[str] = set()

    def walk(table: symtable.SymbolTable) -> None:
        is_module = table.get_type() == "module"
        for sym in table.get_symbols():
            name = sym.get_name()
            if sym.is_referenced() and (True if is_module else sym.is_global()):
                if name not in bound and name not in PYTHON_BUILTINS_AND_DUNDERS:
                    missing.add(name)
            if not is_module and sym.is_declared_global() and sym.is_assigned():
                bound.add(name)
        for child in table.get_children():
            walk(child)

    walk(top)
    missing -= bound
    if not missing:
        return []

    lines: dict[str, set[int]] = {}
    for node in ast.walk(ast.parse(clean, filename=filename)):
        if isinstance(node, ast.Name) and node.id in missing:
            lines.setdefault(node.id, set()).add(node.lineno)
    return [(name, sorted(lines.get(name, []))) for name in sorted(missing)]


def _top_level_defined_names(source: str, filename: str) -> set[str]:
    clean = source.lstrip("\ufeff")
    top = symtable.symtable(clean, filename, "exec")
    return {
        sym.get_name()
        for sym in top.get_symbols()
        if sym.is_assigned() or sym.is_imported() or sym.is_namespace()
    }


class AppUndefinedNamesTest(unittest.TestCase):
    def test_scanner_catches_undefined_globals_in_module_function_method_and_nested_scope(self):
        sample = (
            "def f():\n"
            "    return missing_fn_global\n"
            "class C:\n"
            "    def m(self):\n"
            "        def inner():\n"
            "            return missing_nested_global\n"
            "        return inner()\n"
            "X = missing_top_global\n"
        )
        found = dict(find_undefined_globals(sample, "sample.py"))
        self.assertEqual(
            found,
            {
                "missing_fn_global": [2],
                "missing_nested_global": [6],
                "missing_top_global": [8],
            },
        )

    def test_no_undefined_global_names_in_app_python_files(self):
        py_files = sorted(APP_DIR.rglob("*.py"))
        self.assertGreater(len(py_files), 0, "expected Python files under app/")
        problems = []
        for path in py_files:
            rel = path.relative_to(ROOT).as_posix()
            source = path.read_text(encoding="utf-8-sig")
            for name, line_numbers in find_undefined_globals(source, rel):
                problems.append(f"{rel}:{line_numbers} undefined {name}")
        self.assertEqual(
            problems,
            [],
            "Undefined global names found in app/**/*.py:\n" + "\n".join(problems),
        )

    def test_windows_desktop_static_part_imports_exist_in_target_files_and_runtime_module(self):
        desktop_path = APP_DIR / "windows_desktop.py"
        tree = ast.parse(desktop_path.read_text(encoding="utf-8-sig"), filename=str(desktop_path))

        part_defs: dict[str, set[str]] = {}
        missing_in_parts = []
        imported_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                mod_name = node.module.removeprefix("app.")
                if not mod_name.startswith("windows_"):
                    continue
                target_file = APP_DIR / f"{mod_name}.py"
                self.assertTrue(target_file.is_file(), f"imported split module missing: {target_file}")
                if mod_name not in part_defs:
                    part_defs[mod_name] = _top_level_defined_names(
                        target_file.read_text(encoding="utf-8-sig"), str(target_file)
                    )
                for alias in node.names:
                    imported_names.add(alias.asname or alias.name)
                    if alias.name not in part_defs[mod_name]:
                        missing_in_parts.append(f"{mod_name}.py missing {alias.name}")

        self.assertEqual(missing_in_parts, [])

        if str(APP_DIR) not in sys.path:
            sys.path.insert(0, str(APP_DIR))
        import windows_desktop

        missing_runtime = sorted(name for name in imported_names if not hasattr(windows_desktop, name))
        self.assertEqual(missing_runtime, [], "windows_desktop missing runtime exports from split parts")


if __name__ == "__main__":
    unittest.main()
