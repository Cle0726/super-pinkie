# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Master the edited narration: 80 Hz high-pass, light FFT denoise, gentle compression, two-pass linear loudnorm to
# -16 LUFS / -1.5 dBTP. The chain delays audio by exactly 1199 samples at 48 kHz (measured by cross-correlation); that
# latency is trimmed so the output stays sample-aligned with the webcam cut.
#   uv run master.py <take-dir>          narration-edit.wav -> narration.wav
import json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ff, need

d = sys.argv[1]; IN, OUT, LAT = os.path.join(d, 'narration-edit.wav'), os.path.join(d, 'narration.wav'), 1199
PRE = 'highpass=f=80,afftdn=nf=-47,acompressor=threshold=-22dB:ratio=2.5:attack=8:release=120:makeup=1'
need('ffmpeg')
log = subprocess.run(['ffmpeg', '-v', 'info', '-i', IN, '-af', f'{PRE},loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', log)
if not m: sys.exit('master.py: loudness measurement failed')
J = json.loads(m.group(0))
ff('-i', IN, '-af', f"{PRE},loudnorm=I=-16:TP=-1.5:LRA=9:measured_I={J['input_i']}:measured_TP={J['input_tp']}:measured_LRA={J['input_lra']}:"
   f"measured_thresh={J['input_thresh']}:offset={J['target_offset']}:linear=true,aresample=48000,atrim=start_sample={LAT},asetpts=PTS-STARTPTS,apad=pad_len={LAT}",
   '-ar', 48000, '-c:a', 'pcm_s16le', OUT)
r = subprocess.run(['ffmpeg', '-v', 'info', '-i', OUT, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
s = r[r.rfind('Summary'):]
I, peak = re.search(r'I:\s+(-?[\d.]+) LUFS', s).group(1), re.search(r'Peak:\s+(-?[\d.]+) dBFS', s).group(1)
print(f'{OUT}: {I} LUFS, true peak {peak} dBFS')
