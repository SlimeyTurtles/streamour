export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  changes: {
    added?: string[];
    changed?: string[];
    fixed?: string[];
  };
}

// Newest first. The first entry's version is the current site version.
export const changelog: ChangelogEntry[] = [
  {
    version: '1.2.2',
    date: '2026-11-18',
    title: 'Security fix',
    changes: {
      fixed: ['Media requests are now restricted to the media library'],
    },
  },
  {
    version: '1.2.1',
    date: '2026-11-18',
    title: 'MP4 shows are back',
    changes: {
      fixed: [
        'Shows with .mp4 episodes were missing from the library',
        'External .vtt / .srt subtitle files are picked up again',
        'Episode thumbnails for .mp4 episodes',
      ],
    },
  },
  {
    version: '1.2.0',
    date: '2026-08-26',
    title: 'Updates page',
    changes: {
      added: [
        'Updates page showing version history and changelog',
        'Version badge in the home page header',
      ],
    },
  },
  {
    version: '1.1.0',
    date: '2026-08-04',
    title: 'Containerized deployment',
    changes: {
      added: ['Docker support for production deployment'],
      fixed: ['Production build errors', 'HLS generation timeouts'],
    },
  },
  {
    version: '1.0.0',
    date: '2026-07-20',
    title: 'HLS streaming',
    changes: {
      added: ['Pre-encoding of MKV files to HLS for smooth playback'],
      changed: [
        'Faster season page loading (subtitle checks deferred)',
        'Higher resolution episode thumbnails',
      ],
    },
  },
  {
    version: '0.3.0',
    date: '2026-06-15',
    title: 'Mobile support & continue watching',
    changes: {
      added: [
        'Continue watching cards on home and season pages',
        'Full mobile streaming support with on-the-fly remuxing',
      ],
      changed: ['Smaller chunk sizes for better mobile performance'],
    },
  },
  {
    version: '0.2.0',
    date: '2026-05-30',
    title: 'Configurable media library',
    changes: {
      added: ['MEDIA_DIR environment variable for custom media locations'],
      changed: ['Range request support for video seeking'],
    },
  },
  {
    version: '0.1.0',
    date: '2026-05-15',
    title: 'Initial release',
    changes: {
      added: [
        'Password-protected streaming with show/season/episode browsing',
        'Video player with subtitles, keyboard shortcuts, and progress tracking',
        'Automatic media library scanning',
      ],
    },
  },
];

export const currentVersion = changelog[0].version;
