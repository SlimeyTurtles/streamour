import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { importLegacy } from '@/lib/watch-state';

// POST { recentlyPlayed?, progress?, settings? }: one-time import of what a
// browser kept in localStorage before watch state moved to the server. The
// client clears its keys after a 200. Safe to repeat: it only ever moves a
// position forward.
export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const result = await importLegacy(auth.user.id, body);
  return NextResponse.json({ success: true, ...result });
}
