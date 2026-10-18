"""Buat berkas suara narasi per baris dari narasi.json (edge-tts), lalu catat durasinya.

Jalankan: backend/.venv/Scripts/python docs/demo/tts.py
"""

import asyncio
import json
import re
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

DIR = Path(__file__).parent
OUT = DIR / "_tts"
FF = imageio_ffmpeg.get_ffmpeg_exe()


def duration(path: Path) -> float:
    p = subprocess.run([FF, "-i", str(path)], capture_output=True, text=True)
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", p.stderr).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


async def main():
    cfg = json.loads((DIR / "narasi.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    durs = {}
    for line in cfg["lines"]:
        path = OUT / f"{line['id']}.mp3"
        await edge_tts.Communicate(line["say"], cfg["voice"], rate=cfg["rate"]).save(str(path))
        durs[line["id"]] = round(duration(path), 3)
        print(f"{line['id']:10s} {durs[line['id']]:5.1f} dtk")
    (OUT / "durasi.json").write_text(json.dumps(durs, indent=1), encoding="utf-8")
    print("total", round(sum(durs.values()), 1), "dtk")


asyncio.run(main())
