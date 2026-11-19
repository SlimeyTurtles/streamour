// Server-side watch state: per-user progress, the continue-watching row and
// player settings. The API routes under app/api/me are thin wrappers over this.

import { db } from './db';
import { episodeKeyFromVideoPath, parseEpisodeKey } from './episode-key';

/** Past this fraction an episode counts as finished and its progress is dropped. */
const FINISHED_FRACTION = 0.95;
const RECENTLY_PLAYED_LIMIT = 10;

export interface ProgressEntry {
  positionS: number;
  durationS: number;
}

/** The shape the home and show pages render (unchanged from the localStorage days). */
export interface RecentlyPlayedItem {
  showId: string;
  showName: string;
  seasonName: string;
  episodeName: string;
  videoPath: string;
  currentTime: number;
  duration: number;
  percentWatched: number;
  timestamp: number;
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e6;
}

export async function getProgress(userId: string, episodeKey: string): Promise<ProgressEntry | null> {
  const row = await db.watchProgress.findUnique({
    where: { userId_episodeKey: { userId, episodeKey } },
  });
  return row ? { positionS: row.positionS, durationS: row.durationS } : null;
}

/**
 * Records where the user is in an episode and makes it the show's
 * continue-watching entry. Finishing an episode (95%+) clears both instead.
 * Returns false if the input is not valid.
 */
export async function saveProgress(
  userId: string,
  episodeKey: unknown,
  positionS: unknown,
  durationS: unknown
): Promise<boolean> {
  const info = parseEpisodeKey(episodeKey);
  if (!info || !isSeconds(positionS) || !isSeconds(durationS)) {
    return false;
  }

  if (durationS > 0 && positionS / durationS >= FINISHED_FRACTION) {
    await db.$transaction([
      db.watchProgress.deleteMany({ where: { userId, episodeKey: info.episodeKey } }),
      db.recentlyPlayed.deleteMany({ where: { userId, showId: info.showId } }),
    ]);
    return true;
  }

  const now = new Date();
  await db.$transaction([
    db.watchProgress.upsert({
      where: { userId_episodeKey: { userId, episodeKey: info.episodeKey } },
      update: { positionS, durationS, updatedAt: now },
      create: { userId, episodeKey: info.episodeKey, positionS, durationS, updatedAt: now },
    }),
    db.recentlyPlayed.upsert({
      where: { userId_showId: { userId, showId: info.showId } },
      update: { episodeKey: info.episodeKey, lastPlayedAt: now },
      create: { userId, showId: info.showId, episodeKey: info.episodeKey, lastPlayedAt: now },
    }),
  ]);
  return true;
}

export async function listRecentlyPlayed(userId: string): Promise<RecentlyPlayedItem[]> {
  const rows = await db.recentlyPlayed.findMany({
    where: { userId },
    orderBy: { lastPlayedAt: 'desc' },
    take: RECENTLY_PLAYED_LIMIT,
  });
  if (rows.length === 0) {
    return [];
  }
  const progress = await db.watchProgress.findMany({
    where: { userId, episodeKey: { in: rows.map(r => r.episodeKey) } },
  });
  const byKey = new Map(progress.map(p => [p.episodeKey, p]));

  const items: RecentlyPlayedItem[] = [];
  for (const row of rows) {
    const info = parseEpisodeKey(row.episodeKey);
    if (!info) continue;
    const p = byKey.get(row.episodeKey);
    const currentTime = p?.positionS ?? 0;
    const duration = p?.durationS ?? 0;
    items.push({
      showId: info.showId,
      showName: info.showName,
      seasonName: info.seasonName,
      episodeName: info.episodeName,
      videoPath: info.videoPath,
      currentTime,
      duration,
      percentWatched: duration > 0 ? (currentTime / duration) * 100 : 0,
      timestamp: row.lastPlayedAt.getTime(),
    });
  }
  return items;
}

// --- Settings ---------------------------------------------------------------

export interface PlayerSettings {
  volume?: number;
  subtitlePosition?: 'top' | 'middle' | 'bottom';
  subtitleSync?: number;
}

const SUBTITLE_POSITIONS = ['top', 'middle', 'bottom'] as const;

/** Keeps only known keys with valid values. */
export function sanitizeSettings(input: unknown): PlayerSettings {
  const out: PlayerSettings = {};
  if (!input || typeof input !== 'object') {
    return out;
  }
  const { volume, subtitlePosition, subtitleSync } = input as Record<string, unknown>;
  if (typeof volume === 'number' && volume >= 0 && volume <= 1) {
    out.volume = volume;
  }
  if (SUBTITLE_POSITIONS.includes(subtitlePosition as (typeof SUBTITLE_POSITIONS)[number])) {
    out.subtitlePosition = subtitlePosition as PlayerSettings['subtitlePosition'];
  }
  if (typeof subtitleSync === 'number' && subtitleSync >= -10 && subtitleSync <= 10) {
    out.subtitleSync = subtitleSync;
  }
  return out;
}

export async function getSettings(userId: string): Promise<PlayerSettings> {
  const rows = await db.setting.findMany({ where: { userId } });
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    raw[row.key] = row.key === 'subtitlePosition' ? row.value : Number(row.value);
  }
  return sanitizeSettings(raw);
}

/** Saves the valid keys in `input`. With onlyMissing, existing values are kept. */
export async function saveSettings(
  userId: string,
  input: unknown,
  { onlyMissing = false } = {}
): Promise<void> {
  const entries = Object.entries(sanitizeSettings(input));
  if (entries.length === 0) {
    return;
  }
  await db.$transaction(
    entries.map(([key, value]) =>
      db.setting.upsert({
        where: { userId_key: { userId, key } },
        update: onlyMissing ? {} : { value: String(value) },
        create: { userId, key, value: String(value) },
      })
    )
  );
}

// --- One-time import of a browser's localStorage data -------------------------

export interface LegacyImport {
  /** The old `recently_played` array. */
  recentlyPlayed?: unknown;
  /** The old `video_progress` object. */
  progress?: unknown;
  settings?: unknown;
}

interface LegacyEntry {
  episodeKey: string;
  showId: string;
  positionS: number;
  durationS: number;
  playedAt: Date;
}

function legacyEntry(item: unknown): LegacyEntry | null {
  if (!item || typeof item !== 'object') return null;
  const { videoPath, currentTime, duration, timestamp } = item as Record<string, unknown>;
  if (typeof videoPath !== 'string' || !isSeconds(currentTime)) return null;
  const info = parseEpisodeKey(episodeKeyFromVideoPath(videoPath));
  if (!info) return null;
  const playedAtMs =
    typeof timestamp === 'number' && timestamp > 0 && timestamp <= Date.now() ? timestamp : Date.now();
  return {
    episodeKey: info.episodeKey,
    showId: info.showId,
    positionS: currentTime,
    durationS: isSeconds(duration) ? duration : 0,
    playedAt: new Date(playedAtMs),
  };
}

/**
 * Merges what a browser had in localStorage into the user's account. For each
 * episode the furthest position wins; for each show the most recently played
 * episode wins; settings only fill in ones the account doesn't have yet.
 */
export async function importLegacy(userId: string, data: LegacyImport): Promise<{ imported: number }> {
  const items = Array.isArray(data.recentlyPlayed) ? data.recentlyPlayed.slice(0, 50) : [];
  const entries = [...items, data.progress]
    .map(item => legacyEntry(item))
    .filter((e): e is LegacyEntry => e !== null);

  let imported = 0;
  for (const entry of entries) {
    const { episodeKey, showId, positionS, durationS, playedAt } = entry;

    const existing = await db.watchProgress.findUnique({
      where: { userId_episodeKey: { userId, episodeKey } },
    });
    if (!existing) {
      await db.watchProgress.create({
        data: { userId, episodeKey, positionS, durationS, updatedAt: playedAt },
      });
      imported += 1;
    } else if (positionS > existing.positionS) {
      await db.watchProgress.update({
        where: { userId_episodeKey: { userId, episodeKey } },
        data: { positionS, durationS: durationS || existing.durationS, updatedAt: playedAt },
      });
      imported += 1;
    }

    const recent = await db.recentlyPlayed.findUnique({
      where: { userId_showId: { userId, showId } },
    });
    if (!recent) {
      await db.recentlyPlayed.create({ data: { userId, showId, episodeKey, lastPlayedAt: playedAt } });
    } else if (playedAt > recent.lastPlayedAt) {
      await db.recentlyPlayed.update({
        where: { userId_showId: { userId, showId } },
        data: { episodeKey, lastPlayedAt: playedAt },
      });
    }
  }

  await saveSettings(userId, data.settings, { onlyMissing: true });
  return { imported };
}
