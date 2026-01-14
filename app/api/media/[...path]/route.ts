import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const filePath = path.join(process.cwd(), 'media', ...pathSegments.map(decodeURIComponent));

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return NextResponse.json(
        { error: 'Not a file' },
        { status: 400 }
      );
    }

    const fileSize = stat.size;
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.mp4') {
      contentType = 'video/mp4';
    } else if (ext === '.mkv') {
      contentType = 'video/x-matroska';
    } else if (ext === '.avi') {
      contentType = 'video/x-msvideo';
    } else if (ext === '.mov') {
      contentType = 'video/quicktime';
    } else if (ext === '.vtt') {
      contentType = 'text/vtt; charset=utf-8';
    } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      contentType = `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
    }

    const range = request.headers.get('range');
    const isVideo = contentType.startsWith('video/') || contentType.startsWith('audio/');

    // For video files, always handle as streaming with range support
    if (isVideo) {
      let start = 0;
      let end = fileSize - 1;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0], 10);
        // If end is not specified or invalid, use a reasonable chunk size for mobile
        // Mobile browsers work better with smaller chunks
        const requestedEnd = parts[1] ? parseInt(parts[1], 10) : null;

        // Limit chunk size to 1MB for better mobile compatibility
        const maxChunkSize = 1024 * 1024; // 1MB
        if (requestedEnd !== null && !isNaN(requestedEnd)) {
          end = Math.min(requestedEnd, fileSize - 1);
        } else {
          // If no end specified, serve a reasonable chunk
          end = Math.min(start + maxChunkSize - 1, fileSize - 1);
        }

        // Validate range
        if (start >= fileSize || start < 0 || end >= fileSize || start > end) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`,
            },
          });
        }
      }

      const chunkSize = end - start + 1;

      // Create a readable stream for the file chunk
      const stream = createReadStream(filePath, { start, end });

      // Convert Node.js stream to Web ReadableStream
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => {
            if (Buffer.isBuffer(chunk)) {
              controller.enqueue(new Uint8Array(chunk));
            } else {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
          });
          stream.on('end', () => {
            controller.close();
          });
          stream.on('error', (err) => {
            controller.error(err);
          });
        },
        cancel() {
          stream.destroy();
        },
      });

      const headers = new Headers({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Cache-Control': 'public, max-age=3600',
      });

      return new NextResponse(webStream, {
        status: range ? 206 : 200,
        headers,
      });
    } else {
      // For non-video files (images, subtitles), serve normally
      const fileBuffer = await fs.readFile(filePath);

      const headers = new Headers({
        'Content-Type': contentType,
        'Content-Length': fileSize.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Cache-Control': 'public, max-age=3600',
      });

      return new NextResponse(fileBuffer, {
        status: 200,
        headers,
      });
    }
  } catch (error) {
    console.error('Error serving media file:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
