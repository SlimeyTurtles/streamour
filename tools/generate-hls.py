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
    python generate-hls.py --stall-timeout 60 # Kill if no progress for 60 seconds
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


def generate_hls(mkv_path: Path, force: bool = False, index: int = 0, total: int = 0, timeout_minutes: int = 0, stall_timeout: int = 120) -> tuple[bool, str]:
    """
    Generate HLS playlist and segments for an MKV file.

    Returns:
        tuple: (success: bool, message: str)
    """
    import time
    import threading

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

    # Build ffmpeg command (output progress to stderr with -stats)
    ffmpeg_args = [
        'ffmpeg',
        '-hide_banner',
        '-y',  # Overwrite output files
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
        start_time = time.time()
        timeout_seconds = timeout_minutes * 60 if timeout_minutes > 0 else None

        # Run ffmpeg - simple approach with threading for output
        process = subprocess.Popen(
            ffmpeg_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Collect stderr in a thread to prevent blocking
        stderr_output = []
        last_activity = [time.time()]  # Use list for mutable reference in thread

        def read_stderr():
            for line in process.stderr:
                stderr_output.append(line)
                last_activity[0] = time.time()
                # Log ffmpeg progress lines (they contain "time=")
                try:
                    line_str = line.decode('utf-8', errors='replace').strip()
                    if 'time=' in line_str and 'speed=' in line_str:
                        # Extract just the relevant part
                        log(f"  {line_str}")
                except:
                    pass

        stderr_thread = threading.Thread(target=read_stderr, daemon=True)
        stderr_thread.start()

        # Wait for process with timeout checking
        while process.poll() is None:
            time.sleep(1)
            elapsed = time.time() - start_time

            # Check overall timeout
            if timeout_seconds and elapsed > timeout_seconds:
                log(f"  TIMEOUT after {format_duration(elapsed)} - killing process")
                process.kill()
                process.wait()
                break

            # Check stall timeout
            if stall_timeout > 0:
                stall_time = time.time() - last_activity[0]
                if stall_time > stall_timeout:
                    log(f"  STALLED for {format_duration(stall_time)} - killing process")
                    process.kill()
                    process.wait()
                    break

        stderr_thread.join(timeout=2)
        total_elapsed = time.time() - start_time

        if process.returncode != 0:
            stderr_text = b''.join(stderr_output).decode('utf-8', errors='replace')
            # Clean up partial files on failure
            if hls_dir.exists():
                for f in hls_dir.iterdir():
                    f.unlink()
                hls_dir.rmdir()
            log(f"  FAILED after {format_duration(total_elapsed)}")
            return False, f"ffmpeg error: {stderr_text[-500:]}"

        log(f"  Done! Total time: {format_duration(total_elapsed)}")
        return True, f"Generated ({'transcoded' if needs_transcode else 'remuxed'}) in {format_duration(total_elapsed)}"

    except Exception as e:
        log(f"  FAILED: {str(e)}")
        # Clean up on exception
        if hls_dir.exists():
            try:
                for f in hls_dir.iterdir():
                    f.unlink()
                hls_dir.rmdir()
            except:
                pass
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
    parser.add_argument(
        '--stall-timeout',
        type=int,
        default=120,
        help='Kill ffmpeg if no progress output for this many seconds (default: 120)'
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
                executor.submit(generate_hls, mkv, args.force, i, len(to_process), args.timeout, args.stall_timeout): mkv
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
            success, message = generate_hls(mkv, args.force, i, len(to_process), args.timeout, args.stall_timeout)

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
