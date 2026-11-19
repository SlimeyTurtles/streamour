import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getMediaDir } from '@/lib/media-path';

export interface Show {
  id: string;
  name: string;
  thumbnail: string | null;
  seasons: Season[];
}

export interface Season {
  name: string;
  episodes: Episode[];
}

export interface Episode {
  name: string;
  path: string;
  subtitles?: string;
}

async function scanMediaFolder(): Promise<Show[]> {
  const mediaPath = getMediaDir();

  try {
    await fs.access(mediaPath);
  } catch {
    return [];
  }

  const shows: Show[] = [];
  const entries = await fs.readdir(mediaPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const showPath = path.join(mediaPath, entry.name);
      const show: Show = {
        id: entry.name.toLowerCase().replace(/\s+/g, '-'),
        name: entry.name,
        thumbnail: null,
        seasons: []
      };

      const showContents = await fs.readdir(showPath, { withFileTypes: true });

      for (const item of showContents) {
        if (item.isFile() && item.name.match(/^thumbnail\.(png|jpg|jpeg)$/i)) {
          show.thumbnail = `/api/media/${encodeURIComponent(entry.name)}/${encodeURIComponent(item.name)}`;
        } else if (item.isDirectory() && item.name.match(/^season\s+\d+$/i)) {
          const seasonPath = path.join(showPath, item.name);
          const season: Season = {
            name: item.name,
            episodes: []
          };

          try {
            const seasonContents = await fs.readdir(seasonPath);
            const videoFiles = seasonContents
              .filter(file => file.match(/\.(mkv|mp4)$/i))
              .sort();
            const mediaUrl = (file: string) =>
              `/api/media/${encodeURIComponent(entry.name)}/${encodeURIComponent(item.name)}/${encodeURIComponent(file)}`;

            for (const videoFile of videoFiles) {
              const baseName = path.parse(videoFile).name;

              const episode: Episode = {
                name: baseName,
                path: mediaUrl(videoFile),
              };

              // External subtitles (same base name) win over embedded tracks.
              // Without one, the player falls back to ?subtitle=auto for MKV.
              const subtitleFile =
                seasonContents.find(file => file === `${baseName}.vtt`) ??
                seasonContents.find(file => file === `${baseName}.srt`);
              if (subtitleFile) {
                episode.subtitles = mediaUrl(subtitleFile);
              }

              season.episodes.push(episode);
            }

            if (season.episodes.length > 0) {
              show.seasons.push(season);
            }
          } catch (error) {
            console.error(`Error scanning season ${item.name}:`, error);
          }
        }
      }

      if (show.seasons.length > 0) {
        shows.push(show);
      }
    }
  }

  return shows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  try {
    const shows = await scanMediaFolder();
    return NextResponse.json(shows);
  } catch (error) {
    console.error('Error scanning media folder:', error);
    return NextResponse.json(
      { error: 'Failed to scan media folder' },
      { status: 500 }
    );
  }
}
