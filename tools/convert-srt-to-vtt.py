#!/usr/bin/env python3

"""
Convert SRT subtitle files to VTT (WebVTT) format for web browsers
Usage: python3 convert-srt-to-vtt.py [--media-dir media]

WebVTT is the standard subtitle format for HTML5 video players.
This script converts SRT files to VTT while preserving all subtitle content.
"""

import os
import sys
import argparse
import re
from pathlib import Path

def convert_srt_timestamp(srt_timestamp):
    """
    Convert SRT timestamp (HH:MM:SS,mmm) to VTT timestamp (HH:MM:SS.mmm)
    SRT uses comma for milliseconds, VTT uses period
    """
    return srt_timestamp.replace(',', '.')

def convert_srt_to_vtt(srt_path):
    """Convert a single SRT file to VTT format"""
    vtt_path = srt_path.parent / f"{srt_path.stem}.vtt"

    # Skip if VTT already exists
    if vtt_path.exists():
        print(f"   ⏭️  VTT already exists: {vtt_path.name}")
        return vtt_path

    print(f"\n📄 Converting: {srt_path.name}")

    try:
        with open(srt_path, 'r', encoding='utf-8') as srt_file:
            srt_content = srt_file.read()

        # Start VTT with header
        vtt_content = "WEBVTT\n\n"

        # Split into subtitle blocks (separated by blank lines)
        blocks = re.split(r'\n\s*\n', srt_content.strip())

        for block in blocks:
            if not block.strip():
                continue

            lines = block.strip().split('\n')

            # Skip empty blocks
            if len(lines) < 2:
                continue

            # SRT format:
            # 1
            # 00:00:01,000 --> 00:00:03,000
            # Subtitle text

            # Find the timestamp line (contains -->)
            timestamp_line = None
            text_start_idx = 0

            for i, line in enumerate(lines):
                if '-->' in line:
                    timestamp_line = line
                    text_start_idx = i + 1
                    break

            if not timestamp_line:
                continue

            # Convert timestamps
            vtt_timestamp = convert_srt_timestamp(timestamp_line)

            # Get subtitle text (everything after timestamp line)
            subtitle_text = '\n'.join(lines[text_start_idx:])

            # Write to VTT
            vtt_content += f"{vtt_timestamp}\n"
            vtt_content += f"{subtitle_text}\n\n"

        # Write VTT file
        with open(vtt_path, 'w', encoding='utf-8') as vtt_file:
            vtt_file.write(vtt_content)

        print(f"   ✅ Saved: {vtt_path.name}")
        return vtt_path

    except Exception as e:
        print(f"   ❌ Error converting {srt_path.name}: {e}")
        return None

def find_srt_files(media_dir="media"):
    """Find all SRT files that don't have corresponding VTT files"""
    srt_files_without_vtt = []

    for root, dirs, files in os.walk(media_dir):
        for file in files:
            if file.lower().endswith('.srt'):
                srt_path = Path(root) / file
                vtt_path = srt_path.parent / f"{srt_path.stem}.vtt"

                if not vtt_path.exists():
                    srt_files_without_vtt.append(srt_path)

    return srt_files_without_vtt

def main():
    parser = argparse.ArgumentParser(
        description="Convert SRT subtitle files to VTT format"
    )
    parser.add_argument(
        '--media-dir',
        default='media',
        help='Media directory to scan (default: media)'
    )
    parser.add_argument(
        '--file',
        help='Convert a specific SRT file instead of scanning directory'
    )

    args = parser.parse_args()

    print("📝 SRT to VTT Converter")
    print("=" * 60)

    # Convert single file if specified
    if args.file:
        srt_path = Path(args.file)
        if not srt_path.exists():
            print(f"\n❌ Error: File not found: {args.file}")
            sys.exit(1)

        if not srt_path.suffix.lower() == '.srt':
            print(f"\n❌ Error: Not an SRT file: {args.file}")
            sys.exit(1)

        convert_srt_to_vtt(srt_path)
        print(f"\n{'='*60}")
        print("✅ Conversion complete!")
        print(f"{'='*60}\n")
        return

    # Find SRT files
    print(f"\n🔍 Scanning for SRT files in '{args.media_dir}'...")
    srt_files = find_srt_files(args.media_dir)

    if not srt_files:
        print("\n✅ All SRT files already have VTT versions!")
        return

    print(f"\nFound {len(srt_files)} SRT file(s) without VTT:")
    for srt_file in srt_files:
        print(f"  - {srt_file}")

    # Confirm
    response = input("\nConvert these files to VTT? [y/N] ")
    if response.lower() != 'y':
        print("Cancelled.")
        return

    # Process each file
    print(f"\n{'='*60}")
    print("Starting conversion...")
    print(f"{'='*60}")

    successful = 0
    failed = 0

    for i, srt_file in enumerate(srt_files, 1):
        print(f"\n[{i}/{len(srt_files)}]")
        result = convert_srt_to_vtt(srt_file)
        if result:
            successful += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    print(f"✅ Conversion complete!")
    print(f"   Successful: {successful}")
    if failed > 0:
        print(f"   Failed: {failed}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
