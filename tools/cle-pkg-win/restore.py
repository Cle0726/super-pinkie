#!/usr/bin/env python3
"""restore：见 cle_pkg.py 开头的说明。不带 --yes 只列计划。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cle_pkg import main  # noqa: E402

sys.exit(main("restore", sys.argv[1:]))
