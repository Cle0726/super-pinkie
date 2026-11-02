"""Compatibility entry point: updates use the same complete UI bundle now."""
import importlib.util
import sys
from pathlib import Path


def activate(ui, control):
    source = Path(__file__).resolve().parents[1] / 'ui-parity/bundle.py'
    spec = importlib.util.spec_from_file_location('pinkie_shared_ui', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.install(Path(ui).resolve().parent, Path(control))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: activate_update_dialog.py <staged-ui> <control-ui>')
    activate(sys.argv[1], sys.argv[2])
