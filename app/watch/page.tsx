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
  const [progressRestored, setProgressRestored] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const videoUrl = searchParams.get('video');
  const subtitlesUrl = searchParams.get('subtitles');
  const title = searchParams.get('title') || 'Unknown';

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (window.innerWidth <= 768);
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Check if video format is supported on mobile
  const isFormatSupportedOnMobile = (url: string): boolean => {
    const extension = url.split('.').pop()?.toLowerCase();
    // Mobile browsers only reliably support MP4 (H.264) and WebM
    return extension === 'mp4' || extension === 'webm';
  };

  // Get format warning message
  const getFormatWarning = (url: string): string | null => {
    if (!isMobile) return null;
    const extension = url.split('.').pop()?.toLowerCase();
    if (extension === 'mkv') {
      return 'MKV format may not play on mobile browsers. If the video fails to load, try accessing from a desktop browser.';
    }
    if (extension === 'avi') {
      return 'AVI format is not supported on mobile browsers. Please use a desktop browser to watch this video.';
    }
    if (extension === 'mov') {
      return 'MOV format may not play on some mobile browsers. If playback fails, try a desktop browser.';
    }
    return null;
  };

  // Helper function to get video MIME type from URL
  const getVideoMimeType = (url: string): string => {
    const extension = url.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'mp4':
        return 'video/mp4';
      case 'mkv':
        return 'video/x-matroska';
      case 'avi':
        return 'video/x-msvideo';
      case 'mov':
        return 'video/quicktime';
      default:
        return 'video/mp4';
    }
  };

  // LocalStorage keys
  const PROGRESS_KEY = 'video_progress';
  const VOLUME_KEY = 'video_volume';
  const RECENTLY_PLAYED_KEY = 'recently_played';

  // Save recently played show to localStorage
  const saveRecentlyPlayed = (videoPath: string, currentTime: number, duration: number) => {
    try {
      const parsedInfo = parseVideoUrl(videoPath);
      if (!parsedInfo) return;

      const showId = toShowId(parsedInfo.showName);
      const percentWatched = (currentTime / duration) * 100;

      // Get existing recently played list
      const savedList = localStorage.getItem(RECENTLY_PLAYED_KEY);
      let recentlyPlayed: any[] = savedList ? JSON.parse(savedList) : [];

      // Remove existing entry for this show
      recentlyPlayed = recentlyPlayed.filter(item => item.showId !== showId);

      // Add new entry at the beginning (only if not near the end)
      if (percentWatched < 95) {
        recentlyPlayed.unshift({
          showId,
          showName: parsedInfo.showName,
          seasonName: parsedInfo.seasonName,
          episodeName: parsedInfo.episodeName,
          videoPath,
          currentTime,
          duration,
          percentWatched,
          timestamp: Date.now(),
        });
      }

      // Keep only the most recent 10 shows
      recentlyPlayed = recentlyPlayed.slice(0, 10);

      localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(recentlyPlayed));
    } catch (error) {
      console.error('Failed to save recently played:', error);
    }
  };

  // Save video progress to localStorage
  const saveProgress = (videoPath: string, currentTime: number, duration: number) => {
    try {
      // Don't save if we're near the end (95% or more watched)
      if (currentTime / duration >= 0.95) {
        localStorage.removeItem(PROGRESS_KEY);
        return;
      }

      const progress = {
        videoPath,
        currentTime,
        timestamp: Date.now(),
      };
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));

      // Also save to recently played
      saveRecentlyPlayed(videoPath, currentTime, duration);
    } catch (error) {
      console.error('Failed to save video progress:', error);
    }
  };

  // Load video progress from localStorage
  const loadProgress = (videoPath: string): number | null => {
    try {
      const saved = localStorage.getItem(PROGRESS_KEY);
      if (!saved) return null;

      const progress = JSON.parse(saved);

      // Only restore if it's the same video
      if (progress.videoPath === videoPath) {
        return progress.currentTime;
      }
      return null;
    } catch (error) {
      console.error('Failed to load video progress:', error);
      return null;
    }
  };

  // Save volume to localStorage
  const saveVolume = (volume: number) => {
    try {
      localStorage.setItem(VOLUME_KEY, volume.toString());
    } catch (error) {
      console.error('Failed to save volume:', error);
    }
  };

  // Load volume from localStorage
  const loadVolume = (): number | null => {
    try {
      const saved = localStorage.getItem(VOLUME_KEY);
      if (!saved) return null;
      const volume = parseFloat(saved);
      return isNaN(volume) ? null : volume;
    } catch (error) {
      console.error('Failed to load volume:', error);
      return null;
    }
  };

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
    return videoPath.replace(/\.(mp4|mkv|avi|mov)$/i, '.jpg');
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
    setProgressRestored(false);
    fetchShowData();
  }, [videoUrl]);

  // Restore video progress and setup event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      // Make sure we have a valid video reference
      const currentVideo = videoRef.current;
      if (!currentVideo) return;

      // Prevent default behavior for all our shortcuts
      if (['Space', 'KeyM', 'KeyF', 'KeyC', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        e.preventDefault();
      }

      switch (e.code) {
        case 'Space':
          if (currentVideo.paused) {
            currentVideo.play();
          } else {
            currentVideo.pause();
          }
          break;
        case 'KeyM':
          currentVideo.muted = !currentVideo.muted;
          break;
        case 'KeyF':
          if (!document.fullscreenElement) {
            currentVideo.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
          break;
        case 'KeyC':
          // Toggle captions
          if (currentVideo.textTracks.length > 0) {
            const track = currentVideo.textTracks[0];
            const newMode = track.mode === 'showing' ? 'hidden' : 'showing';
            track.mode = newMode;
            setCaptionsEnabled(newMode === 'showing');
          }
          break;
        case 'ArrowLeft':
          currentVideo.currentTime = Math.max(0, currentVideo.currentTime - 5);
          break;
        case 'ArrowRight':
          currentVideo.currentTime = Math.min(currentVideo.duration, currentVideo.currentTime + 5);
          break;
        case 'ArrowUp':
          currentVideo.volume = Math.min(1, currentVideo.volume + 0.1);
          break;
        case 'ArrowDown':
          currentVideo.volume = Math.max(0, currentVideo.volume - 0.1);
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

      // Restore saved volume
      const savedVolume = loadVolume();
      if (savedVolume !== null) {
        video.volume = savedVolume;
        console.log(`Restored volume: ${savedVolume}`);
      }

      // Restore saved progress
      if (!progressRestored && videoUrl) {
        const savedTime = loadProgress(videoUrl);
        if (savedTime && savedTime > 0) {
          video.currentTime = savedTime;
          console.log(`Restored video progress: ${savedTime}s`);
        }
        setProgressRestored(true);
      }
    };

    const handleTimeUpdate = () => {
      // Save progress every few seconds
      if (video.duration && videoUrl) {
        saveProgress(videoUrl, video.currentTime, video.duration);
      }
    };

    const handleEnded = () => {
      // Clear progress when video finishes
      if (videoUrl) {
        localStorage.removeItem(PROGRESS_KEY);
      }

      // Autoplay next episode
      const nextEp = getNextEpisode();
      if (nextEp) {
        const params = new URLSearchParams({
          video: nextEp.episode.path,
          title: `${nextEp.showName} - ${nextEp.seasonName} - ${nextEp.episode.name}`,
          ...(nextEp.episode.subtitles ? { subtitles: nextEp.episode.subtitles } : {}),
        });
        router.push(`/watch?${params.toString()}`);
      }
    };

    const handleVolumeChange = () => {
      // Save volume whenever it changes
      saveVolume(video.volume);
    };

    window.addEventListener('keydown', handleKeyPress);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('volumechange', handleVolumeChange);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [videoUrl, progressRestored, showData, currentSeasonIndex, currentEpisodeIndex, router]);

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
            {/* Format warning for mobile */}
            {videoUrl && getFormatWarning(videoUrl) && (
              <div className="bg-yellow-900/90 text-yellow-200 px-4 py-3 text-sm">
                <strong>Warning:</strong> {getFormatWarning(videoUrl)}
              </div>
            )}

            {/* Video error message */}
            {videoError && (
              <div className="bg-red-900/90 text-red-200 px-4 py-4 text-center">
                <p className="font-semibold mb-2">Video Playback Error</p>
                <p className="text-sm">{videoError}</p>
                {isMobile && (
                  <p className="text-xs mt-2 text-red-300">
                    Tip: Some video formats are not supported on mobile. Try using a desktop browser.
                  </p>
                )}
              </div>
            )}

            <video
              ref={videoRef}
              controls
              className="w-full aspect-video"
              preload="metadata"
              playsInline
              crossOrigin="anonymous"
              key={videoUrl}
              onError={(e) => {
                const video = e.currentTarget;
                const error = video.error;
                let errorMessage = 'Failed to load video.';

                if (error) {
                  switch (error.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                      errorMessage = 'Video playback was aborted.';
                      break;
                    case MediaError.MEDIA_ERR_NETWORK:
                      errorMessage = 'A network error occurred while loading the video.';
                      break;
                    case MediaError.MEDIA_ERR_DECODE:
                      errorMessage = 'The video format is not supported by your browser.';
                      break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                      errorMessage = 'The video format is not supported. Try using a different browser or device.';
                      break;
                  }
                }
                setVideoError(errorMessage);
              }}
              onLoadStart={() => setVideoError(null)}
            >
              <source src={videoUrl} type={getVideoMimeType(videoUrl)} />
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

          {/* Only show keyboard shortcuts on desktop */}
          {!isMobile && (
            <div className="mt-6 text-center">
              <div className="bg-gray-900 rounded-lg p-4 max-w-xl mx-auto">
                <h3 className="text-base font-semibold mb-3">Player Controls</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-300">
                  <div className="space-y-1.5">
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">Space</kbd> - Play/Pause</p>
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">F</kbd> - Fullscreen</p>
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">M</kbd> - Mute</p>
                  </div>
                  <div className="space-y-1.5">
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">←/→</kbd> - Skip 5s</p>
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">↑/↓</kbd> - Volume</p>
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">C</kbd> - Toggle Captions</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Next Episode Card */}
          {nextEpisodeInfo && (
            <div className="mt-6">
              <div
                onClick={handleNextEpisode}
                className="bg-gray-900 rounded-lg overflow-hidden shadow-xl cursor-pointer transition-all duration-300 hover:scale-[1.01] hover:brightness-110 group max-w-3xl mx-auto"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Thumbnail */}
                  <div className="md:w-1/3 flex-shrink-0">
                    <div className="relative aspect-video bg-gray-800">
                      {!thumbnailError ? (
                        <img
                          src={getThumbnailUrl(nextEpisodeInfo.episode.path)}
                          alt={`${nextEpisodeInfo.episode.name} thumbnail`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={() => {
                            setThumbnailError(true);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {/* Dark overlay on hover */}
                      <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-4 md:p-5 flex items-center justify-between">
                    <div className="flex flex-col justify-center">
                      {/* Episode Name */}
                      <h3 className="text-lg md:text-xl font-bold mb-1 text-white group-hover:text-red-400 transition-colors">
                        {nextEpisodeInfo.episode.name}
                      </h3>

                      {/* Season Info */}
                      <p className="text-gray-400 text-sm">
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