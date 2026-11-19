import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { resolveMediaPath } from '@/lib/media-path';
import { hlsCacheDir, legacyHlsDir } from '@/lib/cache';

// The only files this route serves from an HLS directory.
const HLS_FILE_PATTERN = /^(playlist\.m3u8|segment\d+\.ts)$/;


// Get video codec using ffprobe
async function getVideoCodec(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim().toLowerCase());
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });

    ffprobe.on('error', reject);
  });
}

// Get video duration using ffprobe
async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });

    ffprobe.on('error', reject);
  });
}

// Generate HLS playlist and segments
async function generateHls(
  videoPath: string,
  outputDir: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Check video codec
  let videoCodec = 'h264';
  try {
    videoCodec = await getVideoCodec(videoPath);
  } catch (err) {
    console.error('Failed to detect video codec:', err);
  }

  const needsTranscode = videoCodec === 'hevc' || videoCodec === 'h265' || videoCodec === 'vp9' || videoCodec === 'av1';

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-map', '0:v:0',
    '-map', '0:a:0',
  ];

  if (needsTranscode) {
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-tune', 'animation',
      '-profile:v', 'high',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
    );
  } else {
    ffmpegArgs.push('-c:v', 'copy');
  }

  ffmpegArgs.push(
    '-c:a', 'aac',
    '-ac', '2',
    '-b:a', '192k',
    '-ar', '48000',
    // HLS options
    '-f', 'hls',
    '-hls_time', '6',              // 6 second segments
    '-hls_list_size', '0',         // Keep all segments in playlist
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
    '-hls_flags', 'independent_segments',
    path.join(outputDir, 'playlist.m3u8')
  );

  return new Promise((resolve, reject) => {
    console.log(`Generating HLS for: ${videoPath}`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      // Could parse progress here if needed
      if (msg.includes('error') || msg.includes('Error')) {
        console.error(`ffmpeg HLS error: ${msg}`);
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`HLS generation complete: ${outputDir}`);
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Check if HLS is already generated and still valid
async function isHlsReady(outputDir: string, videoPath: string): Promise<boolean> {
  const playlistPath = path.join(outputDir, 'playlist.m3u8');

  if (!existsSync(playlistPath)) {
    return false;
  }

  try {
    // Check if the playlist is complete (contains #EXT-X-ENDLIST)
    const content = await fs.readFile(playlistPath, 'utf-8');
    if (!content.includes('#EXT-X-ENDLIST')) {
      return false;
    }

    // Check if video file is newer than the playlist
    const [playlistStat, videoStat] = await Promise.all([
      fs.stat(playlistPath),
      fs.stat(videoPath)
    ]);

    if (videoStat.mtime > playlistStat.mtime) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Pick the HLS directory for a video: the cache copy if it is complete, else a
// complete legacy copy next to the source (generated before the cache volume
// existed), else the cache location, which is where new output is generated.
async function getHlsDir(videoPath: string): Promise<string> {
  const cacheDir = hlsCacheDir(videoPath);
  if (await isHlsReady(cacheDir, videoPath)) {
    return cacheDir;
  }
  const legacyDir = legacyHlsDir(videoPath);
  if (await isHlsReady(legacyDir, videoPath)) {
    return legacyDir;
  }
  return cacheDir;
}

// Track ongoing HLS generation to prevent duplicate work
const hlsGenerationInProgress = new Map<string, Promise<void>>();

// Get transcoding progress for a video
async function getTranscodeProgress(videoPath: string, hlsDir: string): Promise<{
  status: 'ready' | 'transcoding' | 'pending';
  progress: number;
  estimatedSegments: number;
  completedSegments: number;
}> {
  // Check if already complete
  if (await isHlsReady(hlsDir, videoPath)) {
    return { status: 'ready', progress: 100, estimatedSegments: 0, completedSegments: 0 };
  }

  // Check if HLS directory exists (transcoding in progress)
  if (!existsSync(hlsDir)) {
    return { status: 'pending', progress: 0, estimatedSegments: 0, completedSegments: 0 };
  }

  try {
    // Get video duration to estimate total segments
    const duration = await getVideoDuration(videoPath);
    const segmentDuration = 6; // We use 6-second segments
    const estimatedSegments = Math.ceil(duration / segmentDuration);

    // Count existing segments
    const files = await fs.readdir(hlsDir);
    const completedSegments = files.filter(f => f.endsWith('.ts')).length;

    const progress = estimatedSegments > 0
      ? Math.min(99, Math.round((completedSegments / estimatedSegments) * 100))
      : 0;

    return { status: 'transcoding', progress, estimatedSegments, completedSegments };
  } catch {
    return { status: 'transcoding', progress: 0, estimatedSegments: 0, completedSegments: 0 };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;

    if (pathSegments.length < 2) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if this is a progress request
    if (pathSegments[pathSegments.length - 1] === 'progress') {
      const videoPathSegments = pathSegments.slice(0, -1);
      const videoPath = resolveMediaPath(videoPathSegments);
      if (!videoPath) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }
      const hlsDir = await getHlsDir(videoPath);

      try {
        await fs.stat(videoPath);
      } catch {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }

      const progress = await getTranscodeProgress(videoPath, hlsDir);
      return NextResponse.json(progress);
    }

    // Last segment is the requested file (playlist.m3u8 or segmentXXX.ts)
    const requestedFile = pathSegments[pathSegments.length - 1];
    // Everything else is the video path
    const videoPathSegments = pathSegments.slice(0, -1);
    const videoPath = resolveMediaPath(videoPathSegments);
    if (!videoPath || !HLS_FILE_PATTERN.test(requestedFile)) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Verify the source is a video file (never generate HLS from anything else)
    try {
      const videoStat = await fs.stat(videoPath);
      if (!videoStat.isFile() || !/\.(mkv|mp4)$/i.test(videoPath)) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }
    } catch {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // HLS directory for this video (cache volume, or a complete legacy copy)
    const hlsDir = await getHlsDir(videoPath);

    // Check if HLS needs to be generated
    const ready = await isHlsReady(hlsDir, videoPath);

    if (!ready) {
      // Check if generation is already in progress
      let generationPromise = hlsGenerationInProgress.get(videoPath);

      if (!generationPromise) {
        // Start generation
        generationPromise = generateHls(videoPath, hlsDir).finally(() => {
          hlsGenerationInProgress.delete(videoPath);
        });
        hlsGenerationInProgress.set(videoPath, generationPromise);
        // Segment requests don't await the promise; without a handler a failed
        // run (unwritable cache, ffmpeg error) is an unhandled rejection.
        generationPromise.catch((err) => {
          console.error(`HLS generation failed for ${videoPath}:`, err);
        });
      }

      // If requesting playlist, wait for generation to complete
      if (requestedFile === 'playlist.m3u8') {
        await generationPromise;
      } else if (requestedFile.endsWith('.ts')) {
        // For segments, wait a bit then check if the segment exists
        // This allows streaming to start before full generation
        for (let i = 0; i < 30; i++) {  // Wait up to 30 seconds
          const segmentPath = path.join(hlsDir, requestedFile);
          if (existsSync(segmentPath)) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // Serve the requested file
    const filePath = path.join(hlsDir, requestedFile);

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = await fs.stat(filePath);
    const fileBuffer = await fs.readFile(filePath);

    const contentType = requestedFile.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : 'video/mp2t';

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': requestedFile.endsWith('.m3u8')
          ? 'no-cache'  // Don't cache playlist
          : 'public, max-age=3600',  // Cache segments
      },
    });
  } catch (error) {
    console.error('HLS error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
