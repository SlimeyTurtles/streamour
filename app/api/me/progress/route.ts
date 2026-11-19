import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { parseEpisodeKey } from '@/lib/episode-key';
import { getProgress, saveProgress } from '@/lib/watch-state';

// GET ?episode=<episode key>: the signed-in user's position, or null.
export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  const info = parseEpisodeKey(request.nextUrl.searchParams.get('episode'));
  if (!info) {
    return NextResponse.json({ error: 'Invalid episode' }, { status: 400 });
  }
  return NextResponse.json({ progress: await getProgress(auth.user.id, info.episodeKey) });
}

// PUT { episodeKey, positionS, durationS }: save the position. A position at
// 95% or more of the duration marks the episode finished and clears it.
export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const saved = await saveProgress(auth.user.id, body?.episodeKey, body?.positionS, body?.durationS);
  if (!saved) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
