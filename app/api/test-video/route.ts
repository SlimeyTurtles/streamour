import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

function getMediaDir(): string {
  const mediaDir = process.env.MEDIA_DIR || 'media';
  return path.isAbsolute(mediaDir) ? mediaDir : path.join(process.cwd(), mediaDir);
}

// Debug endpoint to test video serving
// Access at: /api/test-video
// Or with file: /api/test-video?file=Rick%20and%20Morty/Season%201/01%20-%20Pilot.mp4

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');
  const userAgent = request.headers.get('user-agent') || '';

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isSafari = /Safari/i.test(userAgent) && !/Chrome/i.test(userAgent);
  const isChromeiOS = /CriOS/i.test(userAgent);

  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    request: {
      userAgent,
      isMobile,
      isIOS,
      isSafari,
      isChromeiOS,
      range: request.headers.get('range'),
      accept: request.headers.get('accept'),
      allHeaders: Object.fromEntries(request.headers.entries()),
    },
  };

  if (file) {
    const filePath = path.join(getMediaDir(), ...file.split('/').map(decodeURIComponent));

    try {
      const stat = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();

      result.file = {
        path: filePath,
        exists: true,
        size: stat.size,
        sizeFormatted: `${(stat.size / 1024 / 1024).toFixed(2)} MB`,
        extension: ext,
        isFile: stat.isFile(),
      };

      // Check moov atom position for mp4 files
      if (ext === '.mp4') {
        try {
          const { execSync } = require('child_process');
          const probe = execSync(
            `ffprobe -v trace "${filePath}" 2>&1 | grep -E "type:'(moov|mdat)'" | head -2`,
            { encoding: 'utf-8', timeout: 5000 }
          );

          const moovMatch = probe.match(/type:'moov'.*?(\d+)\s+\d+$/m);
          const mdatMatch = probe.match(/type:'mdat'.*?(\d+)\s+\d+$/m);

          if (moovMatch && mdatMatch) {
            const moovPos = parseInt(moovMatch[1]);
            const mdatPos = parseInt(mdatMatch[1]);
            result.file = {
              ...result.file as object,
              moovPosition: moovPos,
              mdatPosition: mdatPos,
              moovFirst: moovPos < mdatPos,
              mobileOptimized: moovPos < mdatPos,
            };
          }
        } catch {
          result.file = { ...result.file as object, moovCheck: 'ffprobe not available' };
        }
      }
    } catch (err) {
      result.file = {
        path: filePath,
        exists: false,
        error: String(err),
      };
    }
  }

  result.recommendations = [];
  if (isIOS || isChromeiOS) {
    (result.recommendations as string[]).push('iOS detected - uses WebKit engine regardless of browser');
    (result.recommendations as string[]).push('Ensure videos have moov atom at start (run fix-mobile-streaming.py)');
    (result.recommendations as string[]).push('Ensure H.264 codec (not H.265/HEVC)');
  }

  return NextResponse.json(result, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
  });
}
