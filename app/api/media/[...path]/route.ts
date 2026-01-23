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

interface SubtitleTrack {
  index: number;
  language: string;
  title: string;
}

// Get subtitle tracks from MKV file
async function getSubtitleTracks(filePath: string): Promise<SubtitleTrack[]> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 's',
      '-show_entries', 'stream=index:stream_tags=language,title',
      '-of', 'json',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      try {
        const data = JSON.parse(output);
        const tracks: SubtitleTrack[] = (data.streams || []).map((s: any) => ({
          index: s.index,
          language: s.tags?.language || 'und',
          title: s.tags?.title || '',
        }));
        resolve(tracks);
      } catch {
        resolve([]);
      }
    });

    ffprobe.on('error', () => resolve([]));
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

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': stat.size.toString(),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Content-Duration',
    };

    // Get duration for MKV files
    if (ext === '.mkv') {
      try {
        const duration = await getVideoDuration(filePath);
        if (duration > 0) {
          headers['X-Content-Duration'] = duration.toString();
        }
      } catch (err) {
        console.error('Failed to get duration for HEAD request:', err);
      }
    }

    return new NextResponse(null, {
      status: 200,
      headers,
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

// Convert ASS subtitle format to VTT
function convertAssToVtt(assContent: string): string {
  let vtt = 'WEBVTT\n\n';

  const lines = assContent.split('\n');
  let inEvents = false;

  for (const line of lines) {
    if (line.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (!inEvents || !line.startsWith('Dialogue:')) {
      continue;
    }

    // Parse ASS Dialogue line
    // Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    // But some files have simplified format: Dialogue: Layer,Start,End,Style,Text
    const parts = line.substring('Dialogue:'.length).split(',');
    if (parts.length < 5) continue;

    // Start and End are at positions 1 and 2
    const startTime = parts[1].trim();
    const endTime = parts[2].trim();

    // Text is everything after the 4th comma (or 9th for full format)
    // Find the text by joining remaining parts after style
    let text = '';
    if (parts.length >= 10) {
      // Full format with Name, Margins, Effect
      text = parts.slice(9).join(',');
    } else {
      // Simplified format
      text = parts.slice(4).join(',');
    }

    // Convert ASS time format (H:MM:SS.cc) to VTT (HH:MM:SS.mmm)
    const convertTime = (assTime: string): string => {
      const match = assTime.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
      if (!match) return '00:00:00.000';
      const [, h, m, s, cs] = match;
      const hours = h.padStart(2, '0');
      const ms = (parseInt(cs) * 10).toString().padStart(3, '0');
      return `${hours}:${m}:${s}.${ms}`;
    };

    // Convert ASS formatting to VTT
    // \N -> newline, remove other ASS tags like {\...}
    text = text
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\{[^}]*\}/g, '')  // Remove ASS style tags
      .trim();

    if (!text) continue;

    vtt += `${convertTime(startTime)} --> ${convertTime(endTime)}\n`;
    vtt += `${text}\n\n`;
  }

  return vtt;
}

// Extract embedded subtitle track from MKV and convert to VTT
async function extractSubtitleFromMkv(filePath: string, trackIndex: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Extract as ASS format first (ffmpeg's VTT conversion has bugs with ASS)
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      '-map', `0:${trackIndex}`,
      '-f', 'ass',
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
        // Convert ASS to VTT manually
        const vtt = convertAssToVtt(output);
        resolve(vtt);
      } else {
        console.error(`ffmpeg subtitle extraction error:`, errorOutput);
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

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

// Stream MKV file remuxed/transcoded to MP4 using ffmpeg
async function streamRemuxedVideo(
  filePath: string,
  seekSeconds: number = 0,
  duration: number = 0
): Promise<{ stream: ReadableStream<Uint8Array>; process: ReturnType<typeof spawn> }> {
  // Check video codec to determine if transcoding is needed
  let videoCodec = 'h264';
  try {
    videoCodec = await getVideoCodec(filePath);
  } catch (err) {
    console.error('Failed to detect video codec, assuming h264:', err);
  }

  const needsTranscode = videoCodec === 'hevc' || videoCodec === 'h265' || videoCodec === 'vp9' || videoCodec === 'av1';

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts',  // Regenerate timestamps for better compatibility
  ];

  // Add seek if needed (before input for faster seeking)
  if (seekSeconds > 0) {
    ffmpegArgs.push('-ss', seekSeconds.toString());
  }

  ffmpegArgs.push('-i', filePath);

  // Map only the first video stream and first audio stream
  ffmpegArgs.push(
    '-map', '0:v:0',  // First video stream
    '-map', '0:a:0',  // First audio stream only
  );

  if (needsTranscode) {
    // Transcode to H.264 for browser compatibility
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',  // Fast encoding for streaming
      '-crf', '23',           // Good quality/size balance
      '-tune', 'animation',   // Optimize for animated content (good for most TV)
      '-profile:v', 'high',   // High profile for better quality
      '-level', '4.1',        // Wide compatibility
      '-pix_fmt', 'yuv420p',  // Ensure browser compatibility
    );
  } else {
    // Just copy the video stream if already H.264
    ffmpegArgs.push('-c:v', 'copy');
  }

  ffmpegArgs.push(
    '-c:a', 'aac',       // Re-encode audio to AAC for compatibility
    '-ac', '2',          // Downmix to stereo for wider compatibility
    '-b:a', '192k',      // Good audio bitrate
    '-ar', '48000',      // Standard sample rate
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1'             // Output to stdout
  );

  console.log(`Streaming ${filePath} (codec: ${videoCodec}, transcode: ${needsTranscode})`);

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

    // Check for subtitle extraction request (e.g., ?subtitle=2 or ?subtitle=auto)
    const subtitleParam = request.nextUrl.searchParams.get('subtitle');
    if (subtitleParam !== null && ext === '.mkv') {
      let trackIndex: number;

      if (subtitleParam === 'auto') {
        // Auto-detect best subtitle track
        const tracks = await getSubtitleTracks(filePath);
        if (tracks.length === 0) {
          return new NextResponse('', {
            status: 204,
            headers: { 'Access-Control-Allow-Origin': '*' },
          });
        }
        // Prefer English, then first available
        const englishTrack = tracks.find(t =>
          t.language === 'eng' || t.language === 'en' ||
          t.title.toLowerCase().includes('english')
        );
        trackIndex = englishTrack ? englishTrack.index : tracks[0].index;
      } else {
        trackIndex = parseInt(subtitleParam, 10);
        if (isNaN(trackIndex)) {
          return NextResponse.json({ error: 'Invalid subtitle track index' }, { status: 400 });
        }
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
      let duration = 0;

      // Always get the duration for the timeline
      try {
        duration = await getVideoDuration(filePath);
      } catch (err) {
        console.error('Failed to get video duration:', err);
      }

      if (range) {
        // Parse range header and convert byte position to time position
        const match = range.match(/bytes=(\d+)-/);
        if (match) {
          const startByte = parseInt(match[1], 10);

          if (startByte > 0 && duration > 0) {
            // Estimate time position based on byte position (assumes ~constant bitrate)
            seekSeconds = (startByte / fileSize) * duration;
          }
        }
      }

      const { stream, process: ffmpeg } = await streamRemuxedVideo(filePath, seekSeconds, duration);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        ffmpeg.kill('SIGTERM');
      });

      // Build headers with duration info
      const headers: Record<string, string> = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Content-Duration',
        'Cache-Control': 'no-cache', // Don't cache remuxed streams
      };

      // Add duration header if available (helps some players)
      if (duration > 0) {
        headers['X-Content-Duration'] = duration.toString();
      }

      return new Response(stream, {
        status: 200,
        headers,
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
