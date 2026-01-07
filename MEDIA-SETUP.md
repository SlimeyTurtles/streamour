# Media Setup Guide

## Converting Videos (MKV to MP4)

Web browsers don't support MKV files well. You need to convert them to MP4 format.

### Install ffmpeg

```bash
sudo apt install ffmpeg
```

### Convert all MKV files to MP4

```bash
./convert-videos.sh
```

**How long does it take?**
- **Fast mode** (copy video, re-encode audio): ~30 seconds to 2 minutes per file
- The script uses fast mode by default (no video quality loss)
- Conversion speed depends on file size and your CPU

**What happens:**
- Finds all `.mkv` files in the `media/` folder
- Converts them to `.mp4` with AAC audio (browser compatible)
- Skips files that are already converted
- Keeps original MKV files (you can delete them manually later)

---

## Auto-Generating Subtitles

Generate subtitles automatically using OpenAI's Whisper AI model.

### Install Whisper

```bash
pip3 install openai-whisper
```

Note: This downloads PyTorch (~2GB), so it may take a few minutes.

### Generate subtitles for all videos

```bash
python3 generate-subtitles.py
```

**How long does it take?**
- Depends on the model size and video length
- **Small model (default)**: ~1-3x video length (30min video = 30-90min processing)
- **Tiny model (faster)**: ~0.5-1x video length (30min video = 15-30min processing)
- First run downloads the model (~500MB for small, ~75MB for tiny)

**Model options:**
```bash
# Fastest (less accurate)
python3 generate-subtitles.py --model tiny

# Default (good balance)
python3 generate-subtitles.py --model small

# Most accurate (slowest)
python3 generate-subtitles.py --model medium
```

**What happens:**
- Scans `media/` folder for videos without subtitles
- Uses AI to transcribe audio to text
- Saves as `.srt` files (same name as video)
- Your app will automatically detect and use them

---

## Manual Subtitle Downloads

If you prefer to download subtitles manually:

1. Visit [OpenSubtitles](https://www.opensubtitles.org/)
2. Search for your show/episode
3. Download the `.srt` file
4. Rename it to match your video file exactly:
   - Video: `01 - Episode Name.mp4`
   - Subtitle: `01 - Episode Name.srt`
5. Place it in the same folder as the video

---

## Media Folder Structure

```
media/
├── Show Name/
│   ├── thumbnail.jpg          # Show thumbnail
│   ├── Season 1/
│   │   ├── 01 - Episode.mp4  # Video file
│   │   ├── 01 - Episode.srt  # Subtitle file (optional)
│   │   ├── 02 - Episode.mp4
│   │   └── 02 - Episode.srt
│   └── Season 2/
│       └── ...
└── Another Show/
    └── ...
```

**Important:**
- Show thumbnails must be named: `thumbnail.jpg`, `thumbnail.png`, or `thumbnail.jpeg`
- Season folders must be named: `Season 1`, `Season 2`, etc.
- Subtitle files must have the same name as the video file (different extension)
