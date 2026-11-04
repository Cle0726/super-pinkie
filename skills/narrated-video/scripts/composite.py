# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# The final video: the webcam as an anti-aliased circle in the layout's bubble slot, the mastered narration, and a
# 0.6 s fade out at the end.
#   uv run composite.py <project> <take-dir> [out.mp4]      (default <project>/renders/final.mp4)
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ff, ffprobe_json

P, D = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(P, 'renders', 'final.mp4')
L = json.load(open(os.path.join(P, 'layout.json'))); X, Y, DIAM = L['CAM_X'], L['CAM_Y'], L['CAM_D']; R = DIAM / 2
base = os.path.join(P, 'renders', 'base.mp4')
DUR = float(ffprobe_json(base)['format']['duration']); FST = round(DUR - 0.6, 3)
ff('-i', base, '-i', os.path.join(D, 'cam-edit.mp4'), '-i', os.path.join(D, 'narration.wav'), '-filter_complex',
   f"[1:v]scale={DIAM}:{DIAM}:flags=lanczos,setsar=1,format=rgba,"
   f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip({R}-hypot(X+0.5-{R},Y+0.5-{R}),0,1)',tpad=stop_mode=clone:stop_duration=5[cam];"
   f"[0:v][cam]overlay=x={X}:y={Y}:eof_action=repeat:format=auto,fade=t=out:st={FST}:d=0.6[v];"
   f"[2:a]apad,atrim=0:{DUR},afade=t=out:st={FST}:d=0.6[a]",
   '-map', '[v]', '-map', '[a]', '-t', DUR, '-c:v', 'libx264', '-crf', 17, '-preset', 'slow', '-pix_fmt', 'yuv420p',
   '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT)
v = ffprobe_json(OUT)
print(OUT, f"{float(v['format']['duration']):.3f} s", ', '.join(f"{s['codec_type']} {s.get('width', '')}x{s.get('height', '')}".rstrip('x') for s in v['streams']))
