# Audiobook Text Sync

Karaoke-style, word-highlighted captions for audiobooks in
[Audiobookshelf](https://www.audiobookshelf.org/).

## How it works

- `gen_vtt.py` runs **on-device** speech-to-text (mlx-whisper,
  whisper-large-v3-turbo, Apple Silicon) over an audiobook and produces a
  word-level **WebVTT** file
- A **Tampermonkey userscript** overlays lyrics-style captions on the ABS web
  player, highlighting words as they are spoken
- `readalong.html` — standalone demo page for a quick test of the `.vtt`

## Usage

```bash
python gen_vtt.py <audiobook.mp3>     # -> <audiobook>.vtt
# install the .user.js in Tampermonkey, then open your ABS server
```

Personal project, built for fun.
