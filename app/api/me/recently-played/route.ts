import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { listRecentlyPlayed } from '@/lib/watch-state';

// GET: the signed-in user's continue-watching list, most recent first.
export async function GET() {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ items: await listRecentlyPlayed(auth.user.id) });
}
