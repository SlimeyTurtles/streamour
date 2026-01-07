'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useRef, useEffect, useState } from 'react';

// TypeScript interfaces for show data
interface Episode {
  name: string;
  path: string;
  subtitles?: string;
}

interface Season {
  name: string;
  episodes: Episode[];
}

interface Show {
  id: string;
  name: string;
  thumbnail: string | null;
  seasons: Season[];
}

interface ParsedVideoInfo {
  showName: string;
  seasonName: string;
  episodeName: string;
}

interface NextEpisodeInfo {
  episode: Episode;
  seasonName: string;
  showName: string;
  isNextSeason: boolean;
}

function WatchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [showData, setShowData] = useState<Show | null>(null);
  const [currentSeasonIndex, setCurrentSeasonIndex] = useState<number>(-1);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [thumbnailError, setThumbnailError] = useState(false);

  const videoUrl = searchParams.get('video');
  const subtitlesUrl = searchParams.get('subtitles');
  const title = searchParams.get('title') || 'Unknown';

  // Helper function to parse video URL
  const parseVideoUrl = (url: string): ParsedVideoInfo | null => {
    try {
      // URL format: /api/media/Solar%20Opposites/Season%203/01%20-%20The%20...mp4
      const parts = url.split('/');
      if (parts.length < 5) return null;

      const showName = decodeURIComponent(parts[3]);
      const seasonName = decodeURIComponent(parts[4]);
      const episodeFileName = decodeURIComponent(parts[5]);
      const episodeName = episodeFileName.replace(/\.(mp4|mkv|avi|mov)$/i, '');

      return { showName, seasonName, episodeName };
    } catch (error) {
      console.error('Error parsing video URL:', error);
      return null;
    }
  };

  // Helper function to convert show name to ID
  const toShowId = (showName: string): string => {
    return showName.toLowerCase().replace(/\s+/g, '-');
  };

  // Helper function to convert video path to thumbnail path
  const getThumbnailUrl = (videoPath: string): string => {
    const thumbnailUrl = videoPath.replace(/\.(mp4|mkv|avi|mov)$/i, '.jpg');
    console.log('Thumbnail URL:', thumbnailUrl);
    return thumbnailUrl;
  };

  // Get next episode information
  const getNextEpisode = (): NextEpisodeInfo | null => {
    if (!showData || currentSeasonIndex === -1 || currentEpisodeIndex === -1) {
      return null;
    }

    const currentSeason = showData.seasons[currentSeasonIndex];

    // Check if there's a next episode in the current season
    if (currentEpisodeIndex < currentSeason.episodes.length - 1) {
      return {
        episode: currentSeason.episodes[currentEpisodeIndex + 1],
        seasonName: currentSeason.name,
        showName: showData.name,
        isNextSeason: false,
      };
    }

    // Check if there's a next season
    if (currentSeasonIndex < showData.seasons.length - 1) {
      const nextSeason = showData.seasons[currentSeasonIndex + 1];
      if (nextSeason.episodes.length > 0) {
        return {
          episode: nextSeason.episodes[0],
          seasonName: nextSeason.name,
          showName: showData.name,
          isNextSeason: true,
        };
      }
    }

    // No next episode
    return null;
  };

  // Fetch show data and determine current position
  useEffect(() => {
    const fetchShowData = async () => {
      if (!videoUrl) {
        setLoading(false);
        return;
      }

      try {
        const parsedInfo = parseVideoUrl(videoUrl);
        if (!parsedInfo) {
          setLoading(false);
          return;
        }

        const showId = toShowId(parsedInfo.showName);

        // Fetch all shows
        const response = await fetch('/api/shows');
        if (!response.ok) throw new Error('Failed to fetch shows');

        const shows: Show[] = await response.json();
        const show = shows.find((s) => s.id === showId);

        if (!show) {
          setLoading(false);
          return;
        }

        setShowData(show);

        // Find current season and episode indices
        const seasonIndex = show.seasons.findIndex(
          (s) => s.name === parsedInfo.seasonName
        );

        if (seasonIndex !== -1) {
          setCurrentSeasonIndex(seasonIndex);

          const episodeIndex = show.seasons[seasonIndex].episodes.findIndex(
            (e) => e.path === videoUrl
          );

          if (episodeIndex !== -1) {
            setCurrentEpisodeIndex(episodeIndex);
          }
        }
      } catch (error) {
        console.error('Error fetching show data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Reset thumbnail error state when video changes
    setThumbnailError(false);
    fetchShowData();
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Prevent default behavior for all our shortcuts
      if (['Space', 'KeyM', 'KeyF', 'KeyC', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        e.preventDefault();
      }

      switch (e.code) {
        case 'Space':
          if (video.paused) {
            video.play();
          } else {
            video.pause();
          }
          break;
        case 'KeyM':
          video.muted = !video.muted;
          break;
        case 'KeyF':
          if (!document.fullscreenElement) {
            video.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
          break;
        case 'KeyC':
          // Toggle captions
          if (video.textTracks.length > 0) {
            const track = video.textTracks[0];
            const newMode = track.mode === 'showing' ? 'hidden' : 'showing';
            track.mode = newMode;
            setCaptionsEnabled(newMode === 'showing');
          }
          break;
        case 'ArrowLeft':
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case 'ArrowRight':
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          break;
        case 'ArrowUp':
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        case 'ArrowDown':
          video.volume = Math.max(0, video.volume - 0.1);
          break;
      }
    };

    const handleLoadedMetadata = () => {
      // Enable captions by default when loaded
      const trackElement = video.querySelector('track');
      if (trackElement) {
        trackElement.addEventListener('load', () => {
          if (video.textTracks.length > 0) {
            const track = video.textTracks[0];
            track.mode = 'showing';
            setCaptionsEnabled(true);
          }
        });
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, []);

  if (!videoUrl) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">No video specified</h1>
          <button
            onClick={() => router.push('/')}
            className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg transition-colors"
          >
            Go Back Home
          </button>
        </div>
      </div>
    );
  }

  // Get show ID for back button
  const getShowId = (): string | null => {
    if (!videoUrl) return null;
    const parsedInfo = parseVideoUrl(videoUrl);
    return parsedInfo ? toShowId(parsedInfo.showName) : null;
  };

  // Build next episode URL
  const handleNextEpisode = () => {
    const nextEp = getNextEpisode();
    if (!nextEp) return;

    const params = new URLSearchParams({
      video: nextEp.episode.path,
      title: `${nextEp.showName} - ${nextEp.seasonName} - ${nextEp.episode.name}`,
      ...(nextEp.episode.subtitles ? { subtitles: nextEp.episode.subtitles } : {}),
    });
    router.push(`/watch?${params.toString()}`);
  };

  const nextEpisodeInfo = getNextEpisode();
  const showId = getShowId();

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-8 py-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => router.push(showId ? `/show/${showId}` : '/')}
            className="text-red-500 hover:text-red-400 transition-colors flex items-center gap-2"
          >
            <span>←</span> {showId ? 'Back to Season' : 'Back to Shows'}
          </button>
        </div>
        <h1 className="text-xl font-semibold">{decodeURIComponent(title)}</h1>
      </header>

      <main className="px-8 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="bg-black rounded-lg overflow-hidden shadow-2xl relative">
            <video
              ref={videoRef}
              controls
              className="w-full aspect-video"
              preload="metadata"
              key={videoUrl}
            >
              <source src={videoUrl} type="video/mp4" />
              {subtitlesUrl && subtitlesUrl !== '' && (
                <track
                  kind="subtitles"
                  src={subtitlesUrl}
                  srcLang="en"
                  label="English"
                />
              )}
              Your browser does not support the video tag.
            </video>

            {/* Manual CC Toggle Button */}
            {subtitlesUrl && subtitlesUrl !== '' && (
              <div className="absolute bottom-20 right-4">
                <button
                  onClick={() => {
                    const video = videoRef.current;
                    if (video && video.textTracks.length > 0) {
                      const track = video.textTracks[0];
                      if (track.mode === 'showing') {
                        track.mode = 'hidden';
                        setCaptionsEnabled(false);
                      } else {
                        track.mode = 'showing';
                        setCaptionsEnabled(true);
                      }
                    }
                  }}
                  className={`${
                    captionsEnabled
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-gray-800/90 hover:bg-gray-700'
                  } text-white px-4 py-2 rounded-lg transition-colors font-bold shadow-lg`}
                  title="Toggle Captions (C)"
                >
                  CC
                </button>
              </div>
            )}
          </div>

          <div className="mt-8 text-center text-gray-400">
            <p className="text-sm">
              {subtitlesUrl && subtitlesUrl !== '' ? (
                <span className={`px-3 py-1 rounded-full ${
                  captionsEnabled
                    ? 'bg-red-800 text-red-200'
                    : 'bg-gray-800'
                }`}>
                  🔤 Subtitles {captionsEnabled ? 'ON' : 'OFF'}
                </span>
              ) : (
                <span className="text-gray-500">No subtitles</span>
              )}
            </p>
          </div>

          <div className="mt-8 text-center">
            <div className="bg-gray-900 rounded-lg p-6 max-w-2xl mx-auto">
              <h3 className="text-lg font-semibold mb-4">Player Controls</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
                <div className="space-y-2">
                  <p><kbd className="bg-gray-700 px-2 py-1 rounded">Space</kbd> - Play/Pause</p>
                  <p><kbd className="bg-gray-700 px-2 py-1 rounded">F</kbd> - Fullscreen</p>
                  <p><kbd className="bg-gray-700 px-2 py-1 rounded">M</kbd> - Mute</p>
                </div>
                <div className="space-y-2">
                  <p><kbd className="bg-gray-700 px-2 py-1 rounded">←/→</kbd> - Skip 5s</p>
                  <p><kbd className="bg-gray-700 px-2 py-1 rounded">↑/↓</kbd> - Volume</p>
                  <p><kbd className="bg-gray-700 px-2 py-1 rounded">C</kbd> - Toggle Captions</p>
                </div>
              </div>
            </div>
          </div>

          {/* Next Episode Card */}
          {nextEpisodeInfo && (
            <div className="mt-8">
              <div
                onClick={handleNextEpisode}
                className="bg-gray-900 rounded-lg overflow-hidden shadow-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:brightness-110 group"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Thumbnail */}
                  <div className="md:w-2/5 flex-shrink-0">
                    <div className="relative aspect-video bg-gray-800">
                      {!thumbnailError ? (
                        <img
                          src={getThumbnailUrl(nextEpisodeInfo.episode.path)}
                          alt={`${nextEpisodeInfo.episode.name} thumbnail`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onLoad={() => {
                            console.log('Thumbnail loaded successfully');
                          }}
                          onError={(e) => {
                            console.error('Thumbnail failed to load:', e);
                            setThumbnailError(true);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {/* Dark overlay on hover */}
                      <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-6 md:p-8 flex items-center justify-between">
                    <div className="flex flex-col justify-center">
                      {/* Episode Name */}
                      <h3 className="text-2xl md:text-3xl font-bold mb-2 text-white group-hover:text-red-400 transition-colors">
                        {nextEpisodeInfo.episode.name}
                      </h3>

                      {/* Season Info */}
                      <p className="text-gray-400 text-lg">
                        {nextEpisodeInfo.showName} • {nextEpisodeInfo.seasonName}
                        {nextEpisodeInfo.isNextSeason && (
                          <span className="ml-2 text-red-500 font-semibold">New Season!</span>
                        )}
                      </p>
                    </div>

                    {/* Up Next Badge - Right Side */}
                    <div className="flex-shrink-0 ml-4">
                      <span className="inline-block bg-red-600 text-white text-xs font-semibold px-2 py-1 rounded uppercase tracking-wide">
                        Up Next
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-2xl">Loading player...</div>
      </div>
    }>
      <WatchPageContent />
    </Suspense>
  );
}