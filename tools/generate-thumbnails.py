#!/usr/bin/env python3

"""
Auto-generate thumbnails for video files using FFmpeg
Usage: python3 generate-thumbnails.py

This will extract a frame from each video (at 10% duration) and save it as a thumbnail.
"""

import os
import sys
import subprocess
from pathlib import Path

def check_dependencies():
    """Check if ffmpeg is installed"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("\n❌ Error: ffmpeg is not installed")
        print("\nInstall it with:")
        print("  Ubuntu/Debian: sudo apt install ffmpeg")
        print("  macOS: brew install ffmpeg")
        print("  Windows: Download from https://ffmpeg.org/download.html")
        return False

def get_video_duration(video_path):
    """Get video duration in seconds using ffprobe"""
    try:
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip())
    except Exception as e:
        print(f"   ⚠️  Could not get duration: {e}")
        return None

def generate_thumbnail(video_path, timestamp=None):
    """Generate a thumbnail from a video file at a specific timestamp"""
    thumbnail_path = video_path.parent / f"{video_path.stem}.jpg"

    # Skip if thumbnail already exists
    if thumbnail_path.exists():
        print(f"   ⏭️  Thumbnail already exists: {thumbnail_path.name}")
        return thumbnail_path

    print(f"\n🎬 Processing: {video_path.name}")

    # Get video duration if timestamp not provided
    if timestamp is None:
        duration = get_video_duration(video_path)
        if duration:
            # Extract frame at 10% through the video
            timestamp = duration * 0.1
            print(f"   ⏱️  Extracting frame at {timestamp:.1f}s ({duration:.1f}s total)")
        else:
            # Fallback to 5 seconds if we can't get duration
            timestamp = 5
            print(f"   ⏱️  Extracting frame at {timestamp}s (default)")

    # Generate thumbnail using ffmpeg
    cmd = [
        'ffmpeg',
        '-ss', str(timestamp),  # Seek to timestamp
        '-i', str(video_path),   # Input file
        '-vframes', '1',         # Extract 1 frame
        '-vf', 'scale=480:-1',   # Scale to 480px width, maintain aspect ratio
        '-q:v', '2',             # High quality (2-5 is good, lower is better)
        '-y',                    # Overwrite output file
        str(thumbnail_path)
    ]

    try:
        subprocess.run(cmd, capture_output=True, check=True)
        print(f"   ✅ Saved: {thumbnail_path.name}")
        return thumbnail_path
    except subprocess.CalledProcessError as e:
        print(f"   ❌ Error generating thumbnail: {e}")
        return None

def find_videos_without_thumbnails(media_dir="media"):
    """Find all video files that don't have thumbnails yet"""
    video_extensions = ['.mp4', '.mkv', '.avi', '.mov']
    videos_without_thumbs = []

    for root, dirs, files in os.walk(media_dir):
        for file in files:
            if any(file.lower().endswith(ext) for ext in video_extensions):
                video_path = Path(root) / file
                thumbnail_path = video_path.parent / f"{video_path.stem}.jpg"

                if not thumbnail_path.exists():
                    videos_without_thumbs.append(video_path)

    return videos_without_thumbs

def main():
    print("🖼️  Video Thumbnail Generator")
    print("=" * 60)

    # Check dependencies
    if not check_dependencies():
        sys.exit(1)

    # Find videos
    print(f"\n🔍 Scanning for videos without thumbnails...")
    videos = find_videos_without_thumbnails()

    if not videos:
        print("\n✅ All videos already have thumbnails!")
        return

    print(f"\nFound {len(videos)} video(s) without thumbnails:")
    for video in videos:
        print(f"  - {video}")

    # Confirm
    response = input("\nGenerate thumbnails for these videos? [y/N] ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    # Process each video
    print(f"\n{'='*60}")
    print("Starting thumbnail generation...")
    print(f"{'='*60}")

    successful = 0
    failed = 0

    for i, video in enumerate(videos, 1):
        print(f"\n[{i}/{len(videos)}]")
        result = generate_thumbnail(video)
        if result:
            successful += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    print(f"✅ Thumbnail generation complete!")
    print(f"   Successful: {successful}")
    if failed > 0:
        print(f"   Failed: {failed}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
