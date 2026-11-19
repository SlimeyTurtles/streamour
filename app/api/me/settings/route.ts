import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getSettings, saveSettings } from '@/lib/watch-state';

// GET: the signed-in user's player settings (only the ones that are set).
export async function GET() {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ settings: await getSettings(auth.user.id) });
}

// PUT { volume?, subtitlePosition?, subtitleSync? }: save the given settings.
export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  await saveSettings(auth.user.id, body);
  return NextResponse.json({ success: true });
}
