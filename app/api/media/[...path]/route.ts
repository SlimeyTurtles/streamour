import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';

function getMediaDir(): string {
  const mediaDir = process.env.MEDIA_DIR || 'media';
  return path.isAbsolute(mediaDir) ? mediaDir : path.join(process.cwd(), mediaDir);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
    },
  });
}

// Get video duration in seconds using ffprobe
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

// Convert Node.js Readable stream to Web ReadableStream
function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on('end', () => {
        controller.close();
      });
      nodeStream.on('error', (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    }
  });
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const filePath = path.join(getMediaDir(), ...pathSegments.map(decodeURIComponent));

  try {
    const stat = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // For MKV files, report as MP4 since we remux on-the-fly
    const contentType = ext === '.mkv' ? 'video/mp4' : getContentType(ext);

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

function getContentType(ext: string): string {
  switch (ext) {
    case '.mkv': return 'video/mp4'; // Remuxed to MP4
    case '.mp4': return 'video/mp4';
    case '.avi': return 'video/x-msvideo';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.srt': return 'text/vtt; charset=utf-8';
    case '.vtt': return 'text/vtt; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

// Convert SRT subtitle format to VTT format
function convertSrtToVtt(srtContent: string): string {
  let vttContent = 'WEBVTT\n\n';
  const lines = srtContent.replace(/\r\n/g, '\n').split('\n');
  let inCue = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^\d+$/.test(line)) {
      continue;
    }

    if (line.includes('-->')) {
      const convertedLine = line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      vttContent += convertedLine + '\n';
      inCue = true;
      continue;
    }

    if (line === '') {
      if (inCue) {
        vttContent += '\n';
        inCue = false;
      }
      continue;
    }

    vttContent += line + '\n';
  }

  return vttContent;
}

// Extract embedded subtitle track from MKV and convert to VTT
async function extractSubtitleFromMkv(filePath: string, trackIndex: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      '-map', `0:${trackIndex}`,  // Select specific stream by absolute index
      '-f', 'webvtt',              // Output as WebVTT
      'pipe:1'
    ]);

    let output = '';
    let errorOutput = '';

    ffmpeg.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        console.error(`ffmpeg subtitle extraction error:`, errorOutput);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Stream MKV file remuxed to MP4 using ffmpeg
function streamRemuxedVideo(
  filePath: string,
  seekSeconds: number = 0
): { stream: ReadableStream<Uint8Array>; process: ReturnType<typeof spawn> } {
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
  ];

  // Add seek if needed (before input for faster seeking)
  if (seekSeconds > 0) {
    ffmpegArgs.push('-ss', seekSeconds.toString());
  }

  ffmpegArgs.push(
    '-i', filePath,
    '-c:v', 'copy',      // Copy video stream (no re-encoding)
    '-c:a', 'aac',       // Re-encode audio to AAC for compatibility
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'             // Output to stdout
  );

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  // Log errors for debugging
  ffmpeg.stderr.on('data', (data) => {
    console.error(`ffmpeg: ${data}`);
  });

  const webStream = nodeStreamToWebStream(ffmpeg.stdout);
  return { stream: webStream, process: ffmpeg };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const filePath = path.join(getMediaDir(), ...pathSegments.map(decodeURIComponent));

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();

    // Check for subtitle extraction request (e.g., ?subtitle=2)
    const subtitleParam = request.nextUrl.searchParams.get('subtitle');
    if (subtitleParam !== null && ext === '.mkv') {
      const trackIndex = parseInt(subtitleParam, 10);
      if (isNaN(trackIndex)) {
        return NextResponse.json({ error: 'Invalid subtitle track index' }, { status: 400 });
      }

      try {
        const vttContent = await extractSubtitleFromMkv(filePath, trackIndex);
        const vttBuffer = Buffer.from(vttContent, 'utf-8');

        return new NextResponse(vttBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Content-Length': vttBuffer.length.toString(),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (err) {
        console.error('Failed to extract subtitles:', err);
        return NextResponse.json({ error: 'Failed to extract subtitles' }, { status: 500 });
      }
    }

    // Handle MKV files - remux to MP4 on-the-fly
    if (ext === '.mkv') {
      const range = request.headers.get('range');
      let seekSeconds = 0;

      if (range) {
        // Parse range header and convert byte position to time position
        const match = range.match(/bytes=(\d+)-/);
        if (match) {
          const startByte = parseInt(match[1], 10);

          if (startByte > 0) {
            try {
              const duration = await getVideoDuration(filePath);
              // Estimate time position based on byte position (assumes ~constant bitrate)
              seekSeconds = (startByte / fileSize) * duration;
            } catch (err) {
              console.error('Failed to get video duration:', err);
            }
          }
        }
      }

      const { stream, process: ffmpeg } = streamRemuxedVideo(filePath, seekSeconds);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        ffmpeg.kill('SIGTERM');
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
          'Cache-Control': 'no-cache', // Don't cache remuxed streams
        },
      });
    }

    // Handle other video formats with standard byte-range serving
    const contentType = getContentType(ext);
    const isMedia = contentType.startsWith('video/') || contentType.startsWith('audio/');
    const range = request.headers.get('range');

    if (isMedia && range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }

      const chunkSize = end - start + 1;
      const fileHandle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(chunkSize);
      await fileHandle.read(buffer, 0, chunkSize, start);
      await fileHandle.close();

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } else if (isMedia) {
      const initialChunkSize = Math.min(1024 * 1024, fileSize);
      const fileHandle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(initialChunkSize);
      await fileHandle.read(buffer, 0, initialChunkSize, 0);
      await fileHandle.close();

      if (fileSize <= initialChunkSize) {
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': initialChunkSize.toString(),
          'Content-Range': `bytes 0-${initialChunkSize - 1}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } else {
      // Non-media files (images, subtitles)
      const fileBuffer = await fs.readFile(filePath);

      if (ext === '.srt') {
        const srtContent = fileBuffer.toString('utf-8');
        const vttContent = convertSrtToVtt(srtContent);
        const vttBuffer = Buffer.from(vttContent, 'utf-8');

        return new NextResponse(vttBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'text/vtt; charset=utf-8',
            'Content-Length': vttBuffer.length.toString(),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': fileSize.toString(),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
  } catch (error) {
    console.error('Error serving media file:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
