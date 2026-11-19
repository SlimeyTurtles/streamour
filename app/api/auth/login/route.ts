import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  createSession,
  destroySession,
  ensureOwner,
  isLegacyPasswordLoginEnabled,
  OwnerNotConfiguredError,
  safeEqual,
} from '@/lib/auth';

// POST { password }: sign in.
//
// Legacy household login: for one release the shared AUTH_PASSWORD still works
// and signs you in as the owner account (see LEGACY_PASSWORD_LOGIN in
// lib/auth.ts). Per-user email + password sign-in arrives with invites.
export async function POST(request: NextRequest) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const sharedPassword = process.env.AUTH_PASSWORD;
  if (!isLegacyPasswordLoginEnabled() || !sharedPassword) {
    return NextResponse.json(
      { error: 'Password sign-in is not available' },
      { status: 403 }
    );
  }

  if (!safeEqual(password, sharedPassword)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  try {
    const owner = await ensureOwner();
    await createSession(owner.id);
  } catch (error) {
    if (error instanceof OwnerNotConfiguredError) {
      console.error('Login failed: set OWNER_EMAIL so the owner account can be created.');
      return NextResponse.json({ error: 'Sign-in is not configured' }, { status: 500 });
    }
    console.error('Login failed:', error);
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
  }

  // The pre-sessions cookie; harmless, but no longer means anything.
  (await cookies()).delete('auth');

  return NextResponse.json({ success: true });
}

// DELETE: sign out this browser (revokes the session row, clears the cookie).
export async function DELETE() {
  try {
    await destroySession();
  } catch (error) {
    console.error('Logout failed:', error);
    return NextResponse.json({ error: 'Sign-out failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
