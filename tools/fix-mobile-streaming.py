#!/usr/bin/env python3

"""
Fix MP4 files for mobile streaming by moving the moov atom to the beginning.
Usage: python3 fix-mobile-streaming.py

Mobile browsers require the moov (metadata) atom at the beginning of MP4 files
to start playback immediately. This script uses ffmpeg's faststart flag to
relocate the moov atom without re-encoding.
"""

import os
import sys
import subprocess
import tempfile
import shutil
from pathlib import Path


def check_dependencies():
    """Check if ffmpeg and ffprobe are installed"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        subprocess.run(['ffprobe', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("\n❌ Error: ffmpeg/ffprobe is not installed")
        print("\nInstall it with:")
        print("  Ubuntu/Debian: sudo apt install ffmpeg")
        print("  macOS: brew install ffmpeg")
        print("  Windows: Download from https://ffmpeg.org/download.html")
        return False


def check_moov_position(video_path):
    """
    Check if moov atom is at the beginning or end of the file.
    Returns: 'start', 'end', or None if cannot determine
    """
    try:
        cmd = [
            'ffprobe',
            '-v', 'trace',
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        output = result.stderr  # ffprobe outputs trace to stderr

        moov_pos = None
        mdat_pos = None

        for line in output.split('\n'):
            if "type:'moov'" in line and "parent:'root'" in line:
                # Extract position from line like: type:'moov' parent:'root' sz: 1057508 264137053 265194553
                parts = line.split()
                for i, part in enumerate(parts):
                    if part.startswith('sz:'):
                        # Position is 2 numbers after sz:
                        if i + 2 < len(parts):
                            try:
                                moov_pos = int(parts[i + 2])
                            except ValueError:
                                pass
                        break
            elif "type:'mdat'" in line and "parent:'root'" in line:
                parts = line.split()
                for i, part in enumerate(parts):
                    if part.startswith('sz:'):
                        if i + 2 < len(parts):
                            try:
                                mdat_pos = int(parts[i + 2])
                            except ValueError:
                                pass
                        break

        if moov_pos is not None and mdat_pos is not None:
            return 'start' if moov_pos < mdat_pos else 'end'
        return None
    except Exception as e:
        print(f"   ⚠️  Could not check moov position: {e}")
        return None


def fix_moov_position(video_path):
    """Fix moov atom position using ffmpeg faststart"""
    print(f"\n🔧 Fixing: {video_path.name}")

    # Create temp file in same directory to preserve permissions
    temp_path = video_path.parent / f"{video_path.stem}.tmp.mp4"

    cmd = [
        'ffmpeg',
        '-i', str(video_path),
        '-c', 'copy',           # Copy streams without re-encoding
        '-movflags', '+faststart',  # Move moov to beginning
        '-y',                   # Overwrite output
        str(temp_path)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"   ❌ FFmpeg error: {result.stderr[:200]}")
            if temp_path.exists():
                temp_path.unlink()
            return False

        # Get file sizes for comparison
        original_size = video_path.stat().st_size
        new_size = temp_path.stat().st_size

        # Replace original with fixed version
        shutil.move(str(temp_path), str(video_path))

        print(f"   ✅ Fixed! Size: {original_size / 1024 / 1024:.1f}MB → {new_size / 1024 / 1024:.1f}MB")
        return True

    except Exception as e:
        print(f"   ❌ Error: {e}")
        if temp_path.exists():
            temp_path.unlink()
        return False


def find_videos_needing_fix(media_dir="media"):
    """Find all MP4 files that have moov atom at the end"""
    videos_to_fix = []
    videos_ok = []

    print(f"\n🔍 Scanning for MP4 files...")

    for root, dirs, files in os.walk(media_dir):
        for file in files:
            if file.lower().endswith('.mp4'):
                video_path = Path(root) / file
                print(f"   Checking: {video_path.name}...", end=" ", flush=True)

                moov_pos = check_moov_position(video_path)

                if moov_pos == 'end':
                    print("needs fix")
                    videos_to_fix.append(video_path)
                elif moov_pos == 'start':
                    print("OK")
                    videos_ok.append(video_path)
                else:
                    print("unknown format, skipping")

    return videos_to_fix, videos_ok


def main():
    print("📱 Mobile Streaming Fix Tool")
    print("=" * 60)
    print("This tool moves the moov atom to the beginning of MP4 files")
    print("so they can stream properly on mobile browsers.")
    print("=" * 60)

    # Check dependencies
    if not check_dependencies():
        sys.exit(1)

    # Find videos that need fixing
    videos_to_fix, videos_ok = find_videos_needing_fix()

    print(f"\n{'='*60}")
    print(f"📊 Scan Results:")
    print(f"   ✅ Already optimized: {len(videos_ok)}")
    print(f"   🔧 Need fixing: {len(videos_to_fix)}")
    print(f"{'='*60}")

    if not videos_to_fix:
        print("\n✅ All MP4 files are already optimized for mobile streaming!")
        return

    print(f"\nFiles that need fixing:")
    for video in videos_to_fix:
        size_mb = video.stat().st_size / 1024 / 1024
        print(f"  - {video} ({size_mb:.1f}MB)")

    # Confirm
    print("\n⚠️  This will modify the original files (no quality loss).")
    response = input("Proceed with fixing these files? [y/N] ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    # Process each video
    print(f"\n{'='*60}")
    print("Starting fix process...")
    print(f"{'='*60}")

    successful = 0
    failed = 0

    for i, video in enumerate(videos_to_fix, 1):
        print(f"\n[{i}/{len(videos_to_fix)}]")
        if fix_moov_position(video):
            successful += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    print(f"✅ Fix complete!")
    print(f"   Successful: {successful}")
    if failed > 0:
        print(f"   Failed: {failed}")
    print(f"\n📱 Your videos should now stream on mobile browsers!")
    print(f"   Don't forget to redeploy to your server.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
