// Rate limiting for sign-in and code endpoints.
//
// In-memory fixed-window counters: the app is one container, so there is
// nothing to share them with, and a restart handing attackers a fresh window
// is acceptable. If the app ever runs as more than one process, move the
// counters to the database behind the same functions.

import { NextResponse } from 'next/server';

export interface RateLimitRule {
  /** Failed attempts allowed per window. */
  limit: number;
  windowMs: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

const counters = new Map<string, Counter>();
const MAX_KEYS = 10_000;

function prune(now: number) {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) {
      counters.delete(key);
    }
  }
  // Still full of live windows (a flood from many addresses): drop the oldest.
  while (counters.size > MAX_KEYS) {
    const oldest = counters.keys().next().value;
    if (oldest === undefined) break;
    counters.delete(oldest);
  }
}

/** Seconds until `key` may try again, or 0 if it is under the limit. */
export function retryAfterSeconds(key: string, rule: RateLimitRule, now = Date.now()): number {
  const counter = counters.get(key);
  if (!counter || counter.resetAt <= now || counter.count < rule.limit) {
    return 0;
  }
  return Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
}

/** Records one attempt against `key`. */
export function recordAttempt(key: string, rule: RateLimitRule, now = Date.now()): void {
  const counter = counters.get(key);
  if (!counter || counter.resetAt <= now) {
    if (counters.size >= MAX_KEYS) {
      prune(now);
    }
    counters.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }
  counter.count += 1;
}

/** Forgets `key`, e.g. after a successful sign-in. */
export function clearAttempts(key: string): void {
  counters.delete(key);
}

/** The 429 to return when retryAfterSeconds() is non-zero. */
export function tooManyRequests(retryAfter: number): NextResponse {
  const minutes = Math.ceil(retryAfter / 60);
  return NextResponse.json(
    { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

/**
 * The client's address for rate-limit keys. Production sits behind Cloudflare
 * and nginx, so prefer the header Cloudflare sets, then the proxy headers.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  return (
    headers.get('cf-connecting-ip')?.trim() ||
    (forwarded ? forwarded.split(',')[0].trim() : '') ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  ).slice(0, 64);
}

// Sign-in: 10 wrong passwords per address per 10 minutes.
export const LOGIN_PER_IP: RateLimitRule = { limit: 10, windowMs: 10 * 60 * 1000 };
// Per account, across all addresses. Looser, so one person can't easily lock
// another out, but it caps a distributed guess at 30 per 10 minutes.
export const LOGIN_PER_ACCOUNT: RateLimitRule = { limit: 30, windowMs: 10 * 60 * 1000 };
