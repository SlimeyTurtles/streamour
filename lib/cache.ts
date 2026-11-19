// Generated artifacts (HLS output, thumbnails) live in a writable cache
// directory that mirrors the media folder's layout, so the media folder itself
// can stay read-only:
//
//   <cache>/hls/Show/Season 1/01 - Name.mkv/playlist.m3u8
//   <cache>/thumbnails/Show/Season 1/01 - Name.jpg
//
// CACHE_DIR is /cache in the container (a volume) and ./.cache in development.

import path from 'path';
import { getMediaDir } from './media-path';

export function getCacheDir(): string {
  const cacheDir = process.env.CACHE_DIR || '.cache';
  return path.resolve(path.isAbsolute(cacheDir) ? cacheDir : path.join(process.cwd(), cacheDir));
}

/** `absoluteMediaPath` must already be inside the media folder (see resolveMediaPath). */
function mediaRelative(absoluteMediaPath: string): string {
  return path.relative(getMediaDir(), absoluteMediaPath);
}

/** Where HLS output for a video is generated. */
export function hlsCacheDir(videoPath: string): string {
  return path.join(getCacheDir(), 'hls', mediaRelative(videoPath));
}

/** Where HLS output used to be written: next to the source. Read-only fallback. */
export function legacyHlsDir(videoPath: string): string {
  return videoPath + '.hls';
}

/** Cache location of a generated image that would otherwise sit at `imagePath` in the media folder. */
export function thumbnailCachePath(imagePath: string): string {
  return path.join(getCacheDir(), 'thumbnails', mediaRelative(imagePath));
}
