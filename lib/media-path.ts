import path from 'path';

export function getMediaDir(): string {
  const mediaDir = process.env.MEDIA_DIR || 'media';
  return path.resolve(path.isAbsolute(mediaDir) ? mediaDir : path.join(process.cwd(), mediaDir));
}

/**
 * Turns the URL segments of a media request into an absolute path inside the
 * media folder. Returns null when the segments are malformed or the result
 * would fall outside the media folder (e.g. encoded `..` segments), so callers
 * can answer 404 without touching the filesystem.
 */
export function resolveMediaPath(segments: string[]): string | null {
  const mediaDir = getMediaDir();

  let decoded: string[];
  try {
    decoded = segments.map(segment => decodeURIComponent(segment));
  } catch {
    return null; // malformed percent-encoding
  }

  if (decoded.length === 0 || decoded.some(segment => segment.includes('\0'))) {
    return null;
  }

  const resolved = path.resolve(mediaDir, ...decoded);
  if (!resolved.startsWith(mediaDir + path.sep)) {
    return null;
  }

  return resolved;
}
