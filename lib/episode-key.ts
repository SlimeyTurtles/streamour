// Episode keys: the media-relative path of an episode
// ("Show/Season 1/01 - Name.mkv"). Watch progress is stored under this key.
// Pure functions, shared by the browser and the server.

const MEDIA_PREFIX = '/api/media/';
const VIDEO_PATTERN = /\.(mkv|mp4)$/i;

export interface EpisodeInfo {
  episodeKey: string;
  showId: string;
  showName: string;
  seasonName: string;
  episodeName: string;
  /** The URL the scanner (`/api/shows`) gives this episode. */
  videoPath: string;
}

/** Same rule as the scanner: folder name lower-cased, spaces to dashes. */
export function toShowId(showName: string): string {
  return showName.toLowerCase().replace(/\s+/g, '-');
}

/** `/api/media/Show/Season%201/01.mkv` → `Show/Season 1/01.mkv`, or null. */
export function episodeKeyFromVideoPath(videoPath: string): string | null {
  const path = videoPath.split('?')[0];
  if (!path.startsWith(MEDIA_PREFIX)) {
    return null;
  }
  try {
    return path
      .slice(MEDIA_PREFIX.length)
      .split('/')
      .map(segment => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

/** Validates a key and derives what the UI needs from it, or null. */
export function parseEpisodeKey(episodeKey: unknown): EpisodeInfo | null {
  if (typeof episodeKey !== 'string' || episodeKey.length === 0 || episodeKey.length > 1000) {
    return null;
  }
  const segments = episodeKey.split('/');
  if (
    segments.length !== 3 ||
    segments.some(s => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))
  ) {
    return null;
  }
  const [showName, seasonName, fileName] = segments;
  if (!VIDEO_PATTERN.test(fileName)) {
    return null;
  }
  return {
    episodeKey,
    showId: toShowId(showName),
    showName,
    seasonName,
    episodeName: fileName.replace(VIDEO_PATTERN, ''),
    videoPath: MEDIA_PREFIX + segments.map(encodeURIComponent).join('/'),
  };
}
