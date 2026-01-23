#!/usr/bin/env python3
"""
Generate HLS streams from MKV files for pre-transcoding.

This script scans a media directory for MKV files and generates HLS playlists
and segments for each one. The HLS files are stored alongside the original
MKV in a .hls directory (e.g., video.mkv -> video.mkv.hls/).

Usage:
    python generate-hls.py [media_directory]

    media_directory: Path to scan for MKV files (default: ./media)

Examples:
    python generate-hls.py                    # Scan ./media
    python generate-hls.py /path/to/media     # Scan specific directory
    python generate-hls.py --force            # Re-generate all HLS even if exists
    python generate-hls.py --timeout 30       # Timeout after 30 minutes per file
    python generate-hls.py --skip "Extras"    # Skip files containing "Extras" in path
    python generate-hls.py -s "Extras" -s "Animatics" -t 30  # Multiple skips + timeout
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import json


def get_video_codec(file_path: str) -> str:
    """Get the video codec of a file using ffprobe."""
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                file_path
            ],
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.stdout.strip().lower()
    except Exception as e:
        print(f"  Warning: Could not detect codec for {file_path}: {e}")
        return 'unknown'


def get_video_duration(file_path: str) -> float:
    """Get video duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                file_path
            ],
            capture_output=True,
            text=True,
            timeout=30
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def is_hls_complete(hls_dir: Path, mkv_path: Path) -> bool:
    """Check if HLS generation is complete and up-to-date."""
    playlist_path = hls_dir / 'playlist.m3u8'

    if not playlist_path.exists():
        return False

    # Check if playlist contains ENDLIST (complete)
    try:
        content = playlist_path.read_text()
        if '#EXT-X-ENDLIST' not in content:
            return False

        # Check if MKV is newer than playlist
        if mkv_path.stat().st_mtime > playlist_path.stat().st_mtime:
            return False

        return True
    except Exception:
        return False


def log(message: str, flush: bool = True):
    """Print a log message with timestamp."""
    from datetime import datetime
    timestamp = datetime.now().strftime('%H:%M:%S')
    print(f"[{timestamp}] {message}", flush=flush)


def generate_hls(mkv_path: Path, force: bool = False, index: int = 0, total: int = 0, timeout_minutes: int = 0) -> tuple[bool, str]:
    """
    Generate HLS playlist and segments for an MKV file.

    Returns:
        tuple: (success: bool, message: str)
    """
    import time
    import signal

    hls_dir = Path(str(mkv_path) + '.hls')
    progress_prefix = f"[{index}/{total}]" if total > 0 else ""

    # Check if already done
    if not force and is_hls_complete(hls_dir, mkv_path):
        log(f"{progress_prefix} Skipping (already done): {mkv_path.name}")
        return True, "Already exists (skipped)"

    # Create output directory
    hls_dir.mkdir(parents=True, exist_ok=True)

    # Detect video codec
    codec = get_video_codec(str(mkv_path))
    needs_transcode = codec in ('hevc', 'h265', 'vp9', 'av1')

    duration = get_video_duration(str(mkv_path))
    duration_str = format_duration(duration) if duration > 0 else "??:??"

    log(f"{progress_prefix} Starting: {mkv_path.name}")
    log(f"  Duration: {duration_str}, Codec: {codec}, Transcode: {needs_transcode}")

    # Build ffmpeg command
    ffmpeg_args = [
        'ffmpeg',
        '-hide_banner',
        '-loglevel', 'info',
        '-progress', 'pipe:1',
        '-i', str(mkv_path),
        '-map', '0:v:0',
        '-map', '0:a:0',
    ]

    if needs_transcode:
        ffmpeg_args.extend([
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '23',
            '-tune', 'animation',
            '-profile:v', 'high',
            '-level', '4.1',
            '-pix_fmt', 'yuv420p',
        ])
    else:
        ffmpeg_args.extend(['-c:v', 'copy'])

    ffmpeg_args.extend([
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '192k',
        '-ar', '48000',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', str(hls_dir / 'segment%03d.ts'),
        '-hls_flags', 'independent_segments',
        str(hls_dir / 'playlist.m3u8')
    ])

    try:
        # Run ffmpeg with progress output
        process = subprocess.Popen(
            ffmpeg_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        last_percent = -1
        current_time = 0
        start_time = time.time()
        last_log_time = start_time
        speed = 0.0

        # Read progress from stdout
        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break

            # Parse progress info
            if line.startswith('out_time_ms='):
                try:
                    time_ms = int(line.split('=')[1].strip())
                    current_time = time_ms / 1_000_000  # Convert to seconds
                    elapsed = time.time() - start_time

                    if duration > 0 and current_time > 0:
                        percent = min(99, int((current_time / duration) * 100))
                        speed = current_time / elapsed if elapsed > 0 else 0

                        # Calculate ETA
                        remaining_video = duration - current_time
                        eta_seconds = remaining_video / speed if speed > 0 else 0
                        eta_str = format_duration(eta_seconds)

                        # Log every 5% or every 30 seconds
                        now = time.time()
                        should_log = (
                            (percent != last_percent and percent % 5 == 0) or
                            (now - last_log_time >= 30)
                        )

                        if should_log:
                            log(f"  {percent}% | {format_duration(current_time)}/{duration_str} | Speed: {speed:.1f}x | ETA: {eta_str} | Elapsed: {format_duration(elapsed)}")
                            last_percent = percent
                            last_log_time = now

                except (ValueError, IndexError):
                    pass
            elif line.startswith('speed='):
                # Parse actual encoding speed
                try:
                    speed_str = line.split('=')[1].strip().replace('x', '')
                    if speed_str and speed_str != 'N/A':
                        speed = float(speed_str)
                except (ValueError, IndexError):
                    pass

        # Wait for completion and get return code
        # Check for timeout
        timeout_seconds = timeout_minutes * 60 if timeout_minutes > 0 else None
        timed_out = False

        while process.poll() is None:
            total_elapsed = time.time() - start_time
            if timeout_seconds and total_elapsed > timeout_seconds:
                log(f"  TIMEOUT after {format_duration(total_elapsed)} - killing process")
                process.kill()
                process.wait()
                timed_out = True
                break
            time.sleep(0.5)

        total_elapsed = time.time() - start_time

        if timed_out or process.returncode != 0:
            stderr = process.stderr.read() if not timed_out else "Timeout exceeded"
            # Clean up partial files on failure
            if hls_dir.exists():
                for f in hls_dir.iterdir():
                    f.unlink()
                hls_dir.rmdir()
            if timed_out:
                log(f"  FAILED: Timeout after {format_duration(total_elapsed)}")
                return False, f"Timeout after {format_duration(total_elapsed)}"
            else:
                log(f"  FAILED after {format_duration(total_elapsed)}: ffmpeg error")
                return False, f"ffmpeg error: {stderr[:200]}"

        log(f"  Done! Total time: {format_duration(total_elapsed)}")
        return True, f"Generated ({'transcoded' if needs_transcode else 'remuxed'}) in {format_duration(total_elapsed)}"

    except Exception as e:
        log(f"  FAILED: {str(e)}")
        return False, f"Error: {str(e)}"


def find_mkv_files(directory: Path) -> list[Path]:
    """Find all MKV files in directory recursively."""
    return sorted(directory.rglob('*.mkv'))


def format_duration(seconds: float) -> str:
    """Format seconds as HH:MM:SS."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def main():
    parser = argparse.ArgumentParser(
        description='Generate HLS streams from MKV files for pre-transcoding.'
    )
    parser.add_argument(
        'directory',
        nargs='?',
        default='./media',
        help='Directory to scan for MKV files (default: ./media)'
    )
    parser.add_argument(
        '--force', '-f',
        action='store_true',
        help='Re-generate HLS even if it already exists'
    )
    parser.add_argument(
        '--parallel', '-p',
        type=int,
        default=1,
        help='Number of parallel transcodes (default: 1, be careful with CPU usage)'
    )
    parser.add_argument(
        '--dry-run', '-n',
        action='store_true',
        help='Show what would be done without actually doing it'
    )
    parser.add_argument(
        '--timeout', '-t',
        type=int,
        default=0,
        help='Timeout in minutes per file (0 = no timeout, default: 0)'
    )
    parser.add_argument(
        '--skip', '-s',
        action='append',
        default=[],
        help='Skip files matching this pattern (can be used multiple times, e.g. --skip "Extras" --skip "Animatics")'
    )

    args = parser.parse_args()

    media_dir = Path(args.directory).resolve()

    if not media_dir.exists():
        print(f"Error: Directory not found: {media_dir}")
        sys.exit(1)

    print(f"Scanning for MKV files in: {media_dir}")
    print()

    mkv_files = find_mkv_files(media_dir)

    if not mkv_files:
        print("No MKV files found.")
        sys.exit(0)

    print(f"Found {len(mkv_files)} MKV file(s):")
    print()

    # Check status of each file
    to_process = []
    skipped_count = 0
    for mkv in mkv_files:
        relative_path = mkv.relative_to(media_dir)
        hls_dir = Path(str(mkv) + '.hls')

        # Check if file matches any skip pattern
        skip_file = False
        for pattern in args.skip:
            if pattern.lower() in str(relative_path).lower():
                skip_file = True
                break

        if skip_file:
            status = "[SKIP]"
            skipped_count += 1
        elif not args.force and is_hls_complete(hls_dir, mkv):
            status = "[DONE]"
        else:
            status = "[PENDING]"
            to_process.append(mkv)

        duration = get_video_duration(str(mkv))
        duration_str = format_duration(duration) if duration > 0 else "??:??"

        print(f"  {status} {relative_path} ({duration_str})")

    print()

    if not to_process:
        print("All files already have HLS generated. Use --force to regenerate.")
        sys.exit(0)

    status_parts = [f"{len(to_process)} file(s) need HLS generation"]
    if skipped_count > 0:
        status_parts.append(f"{skipped_count} skipped")
    if args.timeout > 0:
        status_parts.append(f"timeout: {args.timeout}min")
    print(", ".join(status_parts) + ".")

    if args.dry_run:
        print("\nDry run - no files were processed.")
        sys.exit(0)

    print()
    log("=" * 56)
    log("Starting HLS generation...")
    log("=" * 56)
    print()

    success_count = 0
    fail_count = 0

    if args.parallel > 1:
        # Parallel processing
        with ThreadPoolExecutor(max_workers=args.parallel) as executor:
            futures = {
                executor.submit(generate_hls, mkv, args.force, i, len(to_process), args.timeout): mkv
                for i, mkv in enumerate(to_process, 1)
            }

            for future in as_completed(futures):
                mkv = futures[future]
                relative_path = mkv.relative_to(media_dir)
                success, message = future.result()

                if success:
                    log(f"[OK] {relative_path}: {message}")
                    success_count += 1
                else:
                    log(f"[FAIL] {relative_path}: {message}")
                    fail_count += 1
    else:
        # Sequential processing with progress
        for i, mkv in enumerate(to_process, 1):
            success, message = generate_hls(mkv, args.force, i, len(to_process), args.timeout)

            if success:
                success_count += 1
            else:
                fail_count += 1

            print()

    log("=" * 56)
    log(f"Complete: {success_count} succeeded, {fail_count} failed")
    log("=" * 56)

    sys.exit(0 if fail_count == 0 else 1)


if __name__ == '__main__':
    main()
