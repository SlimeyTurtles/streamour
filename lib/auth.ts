// Per-user sessions.
//
// The browser holds an opaque random token in an HttpOnly cookie; the database
// stores only its SHA-256 hash (table `sessions`). Sessions expire after 30
// days without use and are extended while they are used.
//
// middleware.ts only checks that the cookie is present (it cannot reach the
// database cheaply). Anything that returns data must call getSession() or
// requireSession() here, which is the real check.

import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Session, User } from '@prisma/client';
import { db } from './db';

export const SESSION_COOKIE = 'session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days idle
// Don't write to the database on every request: extend at most once an hour.
const REFRESH_AFTER_MS = 60 * 60 * 1000;

export interface AuthSession {
  session: Session;
  user: User;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    // COOKIE_INSECURE=true is for plain-HTTP environments (staging on the LAN),
    // where a Secure cookie would be dropped by the browser.
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== 'true',
    sameSite: 'lax' as const,
    path: '/',
    expires,
  };
}

/** Constant-time string comparison (hashes first so lengths don't leak). */
export function safeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

async function requestMetadata(): Promise<{ userAgent: string | null; ip: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    userAgent: h.get('user-agent')?.slice(0, 500) ?? null,
    ip: forwarded ? forwarded.split(',')[0].trim().slice(0, 64) : h.get('x-real-ip'),
  };
}

/** Creates a session for the user and sets the cookie. Route handlers only. */
export async function createSession(userId: string): Promise<Session> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { userAgent, ip } = await requestMetadata();

  // Housekeeping while we're here: drop this user's expired sessions.
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });

  const session = await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent, ip },
  });

  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return session;
}

/**
 * The current session and its user, or null if the cookie is missing, unknown
 * or expired. Extends the session (and, where the caller may set cookies, the
 * cookie) when it has not been refreshed for a while.
 */
export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const found = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!found) {
    return null;
  }

  const now = Date.now();
  if (found.expiresAt.getTime() <= now) {
    await db.session.deleteMany({ where: { id: found.id } });
    return null;
  }

  const { user, ...session } = found;

  // Disabling an account revokes its sessions (lib/users.ts); this covers a
  // session created in the same instant.
  if (user.disabledAt) {
    await db.session.deleteMany({ where: { userId: user.id } });
    return null;
  }

  if (now - session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    const expiresAt = new Date(now + SESSION_TTL_MS);
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt },
    });
    session.lastSeenAt = new Date(now);
    session.expiresAt = expiresAt;
    try {
      cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    } catch {
      // Server components can't set cookies; the next API call will.
    }
  }

  return { session, user };
}

/** For route handlers: the session, or a 401 response to return as-is. */
export async function requireSession(): Promise<AuthSession | NextResponse> {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  return auth;
}

/**
 * For owner-only route handlers: the owner's session, or the response to
 * return as-is (401 when not signed in, 403 when signed in as a member).
 * Every owner-only route must go through this, so there is one place that
 * decides what an owner is.
 */
export async function requireOwner(): Promise<AuthSession | NextResponse> {
  const auth = await requireSession();
  if (auth instanceof NextResponse) {
    return auth;
  }
  if (auth.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Owners only' }, { status: 403 });
  }
  return auth;
}

/** Signs out the current browser: deletes the session row and the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** "Sign out everywhere": revokes every session the user has. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

/**
 * LEGACY_PASSWORD_LOGIN: while it is not "false", the shared AUTH_PASSWORD
 * still signs in, as the owner account. Transitional, for one release; removed
 * together with AUTH_PASSWORD once people have their own accounts.
 */
export function isLegacyPasswordLoginEnabled(): boolean {
  return process.env.LEGACY_PASSWORD_LOGIN !== 'false';
}

export class OwnerNotConfiguredError extends Error {
  constructor() {
    super('No owner account exists and OWNER_EMAIL is not set');
    this.name = 'OwnerNotConfiguredError';
  }
}

/**
 * The first owner account. Created from OWNER_EMAIL when the server starts
 * (instrumentation.ts) or, failing that, at the first sign-in; after that the
 * oldest enabled owner is returned, whatever OWNER_EMAIL says.
 */
export async function ensureOwner(): Promise<User> {
  const existing = await db.user.findFirst({
    where: { role: 'OWNER', disabledAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    return existing;
  }

  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new OwnerNotConfiguredError();
  }

  // upsert so two first sign-ins racing each other end up with one owner.
  return db.user.upsert({
    where: { email },
    update: { role: 'OWNER', disabledAt: null },
    create: { email, displayName: 'Owner', role: 'OWNER' },
  });
}
