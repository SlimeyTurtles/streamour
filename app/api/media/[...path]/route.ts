import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

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

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Handle HEAD requests for Safari compatibility
  const { path: pathSegments } = await params;
  const filePath = path.join(process.cwd(), 'media', ...pathSegments.map(decodeURIComponent));

  try {
    const stat = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = getContentType(ext);

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
    case '.mp4': return 'video/mp4';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.vtt': return 'text/vtt; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const filePath = path.join(process.cwd(), 'media', ...pathSegments.map(decodeURIComponent));

    // Check file exists
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
    const contentType = getContentType(ext);
    const isMedia = contentType.startsWith('video/') || contentType.startsWith('audio/');

    const range = request.headers.get('range');

    if (isMedia && range) {
      // Parse range header
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      // Validate range
      if (start >= fileSize || end >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }

      const chunkSize = end - start + 1;

      // Read the specific chunk
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
      // No range header - send first 1MB chunk to trigger browser to use range requests
      // This avoids loading huge files into memory
      const initialChunkSize = Math.min(1024 * 1024, fileSize); // 1MB or file size

      const fileHandle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(initialChunkSize);
      await fileHandle.read(buffer, 0, initialChunkSize, 0);
      await fileHandle.close();

      // If file is small enough, send it all with 200
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

      // For large files, send partial with 206 to encourage range requests
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
