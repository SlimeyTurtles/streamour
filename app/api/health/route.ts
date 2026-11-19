import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Liveness + database check for deploy smoke tests. Public (see middleware.ts);
// reveals nothing beyond up/down.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'up' });
  } catch (error) {
    console.error('Health check: database unreachable:', error);
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
