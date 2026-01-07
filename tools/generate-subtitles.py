#!/usr/bin/env python3

"""
Auto-generate subtitles for video files using OpenAI Whisper
Usage: python3 generate-subtitles.py [--model small]

Models (larger = more accurate but slower):
- tiny: Fastest, least accurate
- base: Fast, decent accuracy
- small: Good balance (default)
- medium: More accurate, slower
- large: Most accurate, very slow

First time setup:
  pip3 install openai-whisper
"""

import os
import sys
import argparse
from pathlib import Path

def check_dependencies():
    """Check if required packages are installed"""
    try:
        import whisper
        return True
    except ImportError:
        print("\n❌ Error: openai-whisper is not installed")
        print("\nInstall it with:")
        print("  pip3 install openai-whisper")
        print("\nNote: This will also install PyTorch, which is large (~2GB)")
        return False

def find_video_files(media_dir="media"):
    """Find all video files that don't have subtitles yet"""
    video_extensions = ['.mp4', '.mkv', '.avi', '.mov']
    videos_without_subs = []

    for root, dirs, files in os.walk(media_dir):
        for file in files:
            if any(file.lower().endswith(ext) for ext in video_extensions):
                video_path = Path(root) / file
                # Check for existing VTT subtitle files
                base_name = video_path.stem
                vtt_path = video_path.parent / f"{base_name}.vtt"

                if not vtt_path.exists():
                    videos_without_subs.append(video_path)

    return videos_without_subs

def generate_subtitles(video_path, model_name="small"):
    """Generate subtitles for a video file"""
    import whisper

    print(f"\n🎬 Processing: {video_path}")
    print(f"   Model: {model_name}")

    # Load model (cached after first download)
    print("   Loading Whisper model...")
    model = whisper.load_model(model_name)

    # Transcribe
    print("   Transcribing audio... (this may take a while)")
    result = model.transcribe(str(video_path), verbose=False)

    # Save as VTT (WebVTT format for web browsers)
    vtt_path = video_path.parent / f"{video_path.stem}.vtt"

    with open(vtt_path, 'w', encoding='utf-8') as f:
        # WebVTT header
        f.write("WEBVTT\n\n")

        for segment in result['segments']:
            # VTT format:
            # 00:00:00.000 --> 00:00:02.000
            # Subtitle text
            start = format_timestamp(segment['start'])
            end = format_timestamp(segment['end'])
            text = segment['text'].strip()

            f.write(f"{start} --> {end}\n")
            f.write(f"{text}\n\n")

    print(f"   ✅ Saved: {vtt_path}")
    return vtt_path

def format_timestamp(seconds):
    """Convert seconds to VTT timestamp format (HH:MM:SS.mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"

def main():
    parser = argparse.ArgumentParser(
        description="Auto-generate subtitles using Whisper"
    )
    parser.add_argument(
        '--model',
        default='small',
        choices=['tiny', 'base', 'small', 'medium', 'large'],
        help='Whisper model size (default: small)'
    )
    parser.add_argument(
        '--media-dir',
        default='media',
        help='Media directory to scan (default: media)'
    )

    args = parser.parse_args()

    # Check dependencies
    if not check_dependencies():
        sys.exit(1)

    # Find videos
    print(f"\n🔍 Scanning for videos without subtitles in '{args.media_dir}'...")
    videos = find_video_files(args.media_dir)

    if not videos:
        print("\n✅ All videos already have subtitles!")
        return

    print(f"\nFound {len(videos)} video(s) without subtitles:")
    for video in videos:
        print(f"  - {video}")

    # Confirm
    response = input("\nGenerate subtitles for these videos? [y/N] ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    # Process each video
    print(f"\n{'='*60}")
    print("Starting subtitle generation...")
    print(f"{'='*60}")

    for i, video in enumerate(videos, 1):
        print(f"\n[{i}/{len(videos)}]")
        try:
            generate_subtitles(video, args.model)
        except Exception as e:
            print(f"   ❌ Error: {e}")
            continue

    print(f"\n{'='*60}")
    print("✅ Subtitle generation complete!")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
