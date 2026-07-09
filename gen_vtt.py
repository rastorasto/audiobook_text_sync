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
import threading
import time
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


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def render_progress(current: int, total: int, label: str, elapsed: float) -> str:
    if total <= 0:
        return ""

    width = 24
    ratio = current / total
    filled = min(width, max(0, int(round(width * ratio))))
    bar = "█" * filled + "░" * (width - filled)

    if current > 0:
        eta = elapsed / current * (total - current)
    else:
        eta = 0.0

    short_label = label if len(label) <= 42 else f"…{label[-41:]}"
    return (
        f"\r[{bar}] {current:>3}/{total:<3} {ratio * 100:5.1f}% "
        f"elapsed {format_duration(elapsed)} eta {format_duration(eta)} {short_label}"
    )


def spinner(message: str):
    stop_event = threading.Event()
    started = time.monotonic()
    frames = "|/-\\"

    def animate():
        index = 0
        last_heartbeat = started
        while not stop_event.wait(0.15):
            elapsed = format_duration(time.monotonic() - started)
            sys.stdout.write(f"\r{frames[index % len(frames)]} {message} {elapsed}")
            sys.stdout.flush()
            now = time.monotonic()
            if now - last_heartbeat >= 10:
                sys.stdout.write(f"\n  still working: {message} ({elapsed})\n")
                sys.stdout.flush()
                last_heartbeat = now
            index += 1

    thread = threading.Thread(target=animate, daemon=True)
    thread.start()
    return stop_event, thread, started


def transcribe_file(audio_path: Path):
    vtt_path = audio_path.with_suffix(".vtt")
    if vtt_path.exists():
        print(f"  skip (exists): {vtt_path.name}")
        return

    print(f"  transcribing: {audio_path.name}")
    print("  this can take a while; progress will update while the model runs")
    stop_event, thread, started = spinner(f"transcribing {audio_path.name}")
    result = mlx_whisper.transcribe(
        str(audio_path),
        path_or_hf_repo=MODEL,
        word_timestamps=True,
    )
    stop_event.set()
    thread.join(timeout=1)
    elapsed = format_duration(time.monotonic() - started)
    sys.stdout.write("\r" + " " * 80 + "\r")
    sys.stdout.flush()
    vtt_path.write_text(words_to_vtt(result["segments"]), encoding="utf-8")
    print(f"  wrote: {vtt_path.name} ({elapsed})")
    return True


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
        started = time.monotonic()
        processed = 0
        skipped = 0

        if not files:
            print("nothing to do")
            return

        for index, f in enumerate(files, start=1):
            result = transcribe_file(f)
            if result:
                processed += 1
            else:
                skipped += 1

            elapsed = time.monotonic() - started
            print(render_progress(index, len(files), f.name, elapsed), end="", flush=True)

        print()
        total_elapsed = format_duration(time.monotonic() - started)
        print(f"done: {processed} transcribed, {skipped} skipped, total {total_elapsed}")
    elif target.is_file():
        transcribe_file(target)
    else:
        print(f"not found: {target}")
        sys.exit(1)


if __name__ == "__main__":
    main()
