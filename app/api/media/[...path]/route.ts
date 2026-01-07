import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
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
    
    if (range && (contentType.startsWith('video/') || contentType.startsWith('audio/'))) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;

      const file = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(chunksize);
      await file.read(buffer, 0, chunksize, start);
      await file.close();

      const headers = new Headers({
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize.toString(),
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
      });

      return new NextResponse(buffer, {
        status: 206,
        headers,
      });
    } else {
      const fileBuffer = await fs.readFile(filePath);

      const headers = new Headers({
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
      });

      if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
        headers.set('Accept-Ranges', 'bytes');
      }

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