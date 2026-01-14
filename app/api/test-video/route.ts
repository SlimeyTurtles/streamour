import { NextRequest, NextResponse } from 'next/server';

// Simple test endpoint to debug video streaming issues
// Access at: /api/test-video?url=/api/media/Show/Season/episode.mp4

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  const info = {
    userAgent: request.headers.get('user-agent'),
    range: request.headers.get('range'),
    accept: request.headers.get('accept'),
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      request.headers.get('user-agent') || ''
    ),
    testUrl: url,
    headers: Object.fromEntries(request.headers.entries()),
  };

  return NextResponse.json(info, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  });
}
