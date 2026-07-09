#!/usr/bin/env python3
"""
Generate word-level VTT subtitles for an audiobook using mlx-whisper.

Usage:
    python gen_vtt.py /path/to/book_01.mp3
    python gen_vtt.py /path/to/audiobook_dir/          # batch mode, all audio in dir

Output:
    book_01.vtt written next to the source audio file
    (matches the filename convention ABS's transcript PR expects)
"""

import sys
import subprocess
from pathlib import Path

import mlx_whisper

AUDIO_EXTS = {".mp3", ".m4a", ".m4b", ".flac", ".ogg", ".wav"}
MODEL = "mlx-community/whisper-large-v3-turbo"  # good accuracy/speed tradeoff on M1


def format_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def words_to_vtt(segments) -> str:
    lines = ["WEBVTT", ""]
    for seg in segments:
        for w in seg.get("words", []):
            start = format_timestamp(w["start"])
            end = format_timestamp(w["end"])
            lines.append(f"{start} --> {end}")
            lines.append(w["word"].strip())
            lines.append("")
    return "\n".join(lines)


def transcribe_file(audio_path: Path):
    vtt_path = audio_path.with_suffix(".vtt")
    if vtt_path.exists():
        print(f"  skip (exists): {vtt_path.name}")
        return

    print(f"  transcribing: {audio_path.name}")
    result = mlx_whisper.transcribe(
        str(audio_path),
        path_or_hf_repo=MODEL,
        word_timestamps=True,
    )
    vtt_path.write_text(words_to_vtt(result["segments"]), encoding="utf-8")
    print(f"  wrote: {vtt_path.name}")


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    target = Path(sys.argv[1])
    if target.is_dir():
        files = sorted(
            (p for p in target.rglob("*") if p.suffix.lower() in AUDIO_EXTS),
            key=lambda p: str(p),
        )
        print(f"found {len(files)} audio files in {target} (including subfolders)")
        for f in files:
            transcribe_file(f)
    elif target.is_file():
        transcribe_file(target)
    else:
        print(f"not found: {target}")
        sys.exit(1)


if __name__ == "__main__":
    main()
