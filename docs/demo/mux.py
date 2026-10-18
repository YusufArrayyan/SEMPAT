"""Gabungkan klip narasi ke video demo pada waktu yang dicatat record-demo.mjs.

Jalankan: backend/.venv/Scripts/python docs/demo/mux.py
"""

import json
import subprocess
from pathlib import Path

import imageio_ffmpeg

DIR = Path(__file__).parent
TTS = DIR / "_tts"
FF = imageio_ffmpeg.get_ffmpeg_exe()

marks = json.loads((TTS / "marks.json").read_text(encoding="utf-8"))
cmd = [FF, "-y", "-loglevel", "error", "-i", str(DIR / "sempat-demo.webm")]
parts = []
for i, m in enumerate(marks, start=1):
    cmd += ["-i", str(TTS / f"{m['id']}.mp3")]
    ms = max(0, int(m["t"] * 1000))
    parts.append(f"[{i}:a]adelay={ms}|{ms},aresample=48000[a{i}]")
mix = "".join(f"[a{i}]" for i in range(1, len(marks) + 1))
# normalize=0 menjaga volume asli tiap klip (klip tidak saling tumpang tindih)
graph = ";".join(parts) + f";{mix}amix=inputs={len(marks)}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"
cmd += [
    "-filter_complex", graph,
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart", "-shortest",
    str(DIR / "sempat-demo.mp4"),
]
subprocess.run(cmd, check=True)
print("MP4:", DIR / "sempat-demo.mp4")
