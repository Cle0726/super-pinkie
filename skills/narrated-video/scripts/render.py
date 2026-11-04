# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Lint, snapshot or render a composition with HyperFrames (pinned; runs through npx, nothing to install).
#   uv run render.py <project> lint
#   uv run render.py <project> snapshot 1,14,22.5     those frames plus contact sheets, in <project>/snapshots
#   uv run render.py <project> render                 <project>/renders/base.mp4 (30 fps, PNG frames so UI text stays sharp)
# Lint reports video_nested_in_timed_element for scenes with screen recordings; that one is expected.
import os, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import need

P, mode = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'render'
need('ffmpeg', 'npx')   # HyperFrames needs ffmpeg for snapshots and renders
HF = [shutil.which('npx'), '--yes', 'hyperframes@0.8.62']
if mode == 'lint': args = ['lint']
elif mode == 'snapshot': shutil.rmtree(os.path.join(P, 'snapshots'), ignore_errors=True); args = ['snapshot', '--at', sys.argv[3]]
elif mode == 'render':
    os.makedirs(os.path.join(P, 'renders'), exist_ok=True)
    args = ['render', '-o', 'renders/base.mp4', '--fps', '30', '--video-frame-format', 'png', '--experimental-fast-capture=false']
else: sys.exit('usage: render.py <project> lint|snapshot <times>|render')
sys.exit(subprocess.run(HF + args, cwd=P).returncode)
