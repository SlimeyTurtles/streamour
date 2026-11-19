// Browser-side access to the signed-in user's watch state (/api/me/*).
// Every function fails soft: playback must never break because a save did.

import { episodeKeyFromVideoPath } from './episode-key';
import type { PlayerSettings, RecentlyPlayedItem } from './watch-state';

export type { PlayerSettings, RecentlyPlayedItem };

// The localStorage keys the site used before watch state moved to the server.
const LEGACY_KEYS = {
  progress: 'video_progress',
  recentlyPlayed: 'recently_played',
  volume: 'video_volume',
  subtitlePosition: 'subtitle_position',
  subtitleSync: 'subtitle_sync',
} as const;

let importPromise: Promise<void> | null = null;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function readNumber(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? NaN : parseFloat(raw);
    return Number.isNaN(value) ? undefined : value;
  } catch {
    return undefined;
  }
}

/**
 * If this browser still has pre-accounts watch data in localStorage, send it
 * to the server once and clear it. Resolves when that is done (or there was
 * nothing to do); call it before reading watch state so the first read already
 * includes the imported data. The keys are kept if the import fails, so it is
 * retried on the next page load.
 */
export function importLegacyOnce(): Promise<void> {
  if (importPromise) {
    return importPromise;
  }
  importPromise = (async () => {
    let hasLegacy = false;
    try {
      hasLegacy = Object.values(LEGACY_KEYS).some(key => localStorage.getItem(key) !== null);
    } catch {
      return; // localStorage unavailable
    }
    if (!hasLegacy) {
      return;
    }

    let subtitlePosition: string | undefined;
    try {
      subtitlePosition = localStorage.getItem(LEGACY_KEYS.subtitlePosition) ?? undefined;
    } catch {
      // ignore
    }

    try {
      const response = await fetch('/api/me/import-legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recentlyPlayed: readJson(LEGACY_KEYS.recentlyPlayed),
          progress: readJson(LEGACY_KEYS.progress),
          settings: {
            volume: readNumber(LEGACY_KEYS.volume),
            subtitlePosition,
            subtitleSync: readNumber(LEGACY_KEYS.subtitleSync),
          },
        }),
      });
      if (response.ok) {
        for (const key of Object.values(LEGACY_KEYS)) {
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error('Legacy watch data import failed:', error);
    }
  })();
  return importPromise;
}

/** Saved position in seconds for a `/api/media/...` URL, or null. */
export async function fetchProgress(videoPath: string): Promise<number | null> {
  const episodeKey = episodeKeyFromVideoPath(videoPath);
  if (!episodeKey) return null;
  try {
    await importLegacyOnce();
    const response = await fetch(`/api/me/progress?episode=${encodeURIComponent(episodeKey)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.progress?.positionS === 'number' ? data.progress.positionS : null;
  } catch (error) {
    console.error('Failed to load video progress:', error);
    return null;
  }
}

/**
 * Saves the position. `keepalive` lets the request finish while the page is
 * being closed or navigated away from.
 */
export function saveProgress(
  videoPath: string,
  positionS: number,
  durationS: number,
  { keepalive = false } = {}
): void {
  const episodeKey = episodeKeyFromVideoPath(videoPath);
  if (!episodeKey || !Number.isFinite(positionS) || !Number.isFinite(durationS) || durationS <= 0) {
    return;
  }
  fetch('/api/me/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeKey, positionS, durationS }),
    keepalive,
  }).catch(error => console.error('Failed to save video progress:', error));
}

export async function fetchRecentlyPlayed(): Promise<RecentlyPlayedItem[]> {
  try {
    await importLegacyOnce();
    const response = await fetch('/api/me/recently-played');
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    console.error('Error loading recently played:', error);
    return [];
  }
}

export async function fetchSettings(): Promise<PlayerSettings> {
  try {
    await importLegacyOnce();
    const response = await fetch('/api/me/settings');
    if (!response.ok) return {};
    const data = await response.json();
    return data.settings ?? {};
  } catch (error) {
    console.error('Failed to load player settings:', error);
    return {};
  }
}

const pendingSettings: PlayerSettings = {};
let settingsTimer: ReturnType<typeof setTimeout> | null = null;

/** Saves settings, batching rapid changes (a volume drag) into one request. */
export function saveSettings(settings: PlayerSettings): void {
  Object.assign(pendingSettings, settings);
  if (settingsTimer) {
    clearTimeout(settingsTimer);
  }
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    const body = JSON.stringify(pendingSettings);
    for (const key of Object.keys(pendingSettings) as (keyof PlayerSettings)[]) {
      delete pendingSettings[key];
    }
    fetch('/api/me/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(error => console.error('Failed to save player settings:', error));
  }, 800);
}
