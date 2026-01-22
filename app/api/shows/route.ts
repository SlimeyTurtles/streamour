import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

function getMediaDir(): string {
  const mediaDir = process.env.MEDIA_DIR || 'media';
  return path.isAbsolute(mediaDir) ? mediaDir : path.join(process.cwd(), mediaDir);
}

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

interface SubtitleTrack {
  index: number;
  language: string;
  title: string;
  codec: string;
}

// Use ffprobe to detect subtitle tracks in an MKV file
async function getEmbeddedSubtitles(filePath: string): Promise<SubtitleTrack[]> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 's',  // Select subtitle streams only
      '-show_entries', 'stream=index,codec_name:stream_tags=language,title',
      '-of', 'json',
      filePath
    ]);

    let output = '';
    let errorOutput = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        console.error(`ffprobe error for ${filePath}:`, errorOutput);
        resolve([]);
        return;
      }

      try {
        const data = JSON.parse(output);
        const tracks: SubtitleTrack[] = (data.streams || []).map((stream: any) => ({
          index: stream.index,
          language: stream.tags?.language || 'und',
          title: stream.tags?.title || '',
          codec: stream.codec_name || 'unknown',
        }));
        resolve(tracks);
      } catch (err) {
        console.error(`Failed to parse ffprobe output for ${filePath}:`, err);
        resolve([]);
      }
    });

    ffprobe.on('error', (err) => {
      console.error(`ffprobe spawn error for ${filePath}:`, err);
      resolve([]);
    });
  });
}

// Find the best subtitle track (prefer English, then first available)
function selectBestSubtitleTrack(tracks: SubtitleTrack[]): SubtitleTrack | null {
  if (tracks.length === 0) return null;

  // Prefer English subtitles
  const englishTrack = tracks.find(t =>
    t.language.toLowerCase() === 'eng' ||
    t.language.toLowerCase() === 'en' ||
    t.title.toLowerCase().includes('english')
  );

  if (englishTrack) return englishTrack;

  // Fall back to first track
  return tracks[0];
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
              .filter(file => file.match(/\.mkv$/i))
              .sort();

            for (const videoFile of videoFiles) {
              const baseName = path.parse(videoFile).name;
              const videoPath = path.join(seasonPath, videoFile);

              const episode: Episode = {
                name: baseName,
                path: `/api/media/${encodeURIComponent(entry.name)}/${encodeURIComponent(item.name)}/${encodeURIComponent(videoFile)}`,
              };

              // First, check for external SRT subtitle file
              const externalSrtFile = seasonContents.find(file =>
                path.parse(file).name === baseName &&
                file.match(/\.srt$/i)
              );

              if (externalSrtFile) {
                // Use external SRT file
                episode.subtitles = `/api/media/${encodeURIComponent(entry.name)}/${encodeURIComponent(item.name)}/${encodeURIComponent(externalSrtFile)}`;
              } else {
                // Check for embedded subtitles in MKV
                const embeddedTracks = await getEmbeddedSubtitles(videoPath);
                const bestTrack = selectBestSubtitleTrack(embeddedTracks);

                if (bestTrack) {
                  // Use embedded subtitles - add track index as query param
                  episode.subtitles = `/api/media/${encodeURIComponent(entry.name)}/${encodeURIComponent(item.name)}/${encodeURIComponent(videoFile)}?subtitle=${bestTrack.index}`;
                }
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
