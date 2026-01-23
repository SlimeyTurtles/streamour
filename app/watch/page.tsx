'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';

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
  const hlsRef = useRef<Hls | null>(null);
  const originalCueTimes = useRef<Map<VTTCue, { start: number; end: number }>>(new Map());
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [showData, setShowData] = useState<Show | null>(null);
  const [currentSeasonIndex, setCurrentSeasonIndex] = useState<number>(-1);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState<number>(-1);
  const [loading, setLoading] = useState(true);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [progressRestored, setProgressRestored] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [subtitlePosition, setSubtitlePosition] = useState<'top' | 'middle' | 'bottom'>('bottom');
  const [subtitleSync, setSubtitleSync] = useState<number>(0); // Sync offset in seconds
  const [showSubtitleSettings, setShowSubtitleSettings] = useState(false);
  const [hlsLoading, setHlsLoading] = useState(false);
  const [transcodeProgress, setTranscodeProgress] = useState<number | null>(null);
  const progressPollRef = useRef<NodeJS.Timeout | null>(null);

  const videoUrl = searchParams.get('video');
  const subtitlesUrlParam = searchParams.get('subtitles');
  // Auto-request subtitles from MKV if no explicit subtitle URL provided
  const subtitlesUrl = subtitlesUrlParam || (videoUrl?.includes('.mkv') ? `${videoUrl}?subtitle=auto` : null);
  const title = searchParams.get('title') || 'Unknown';

  // Convert video URL to HLS URL for MKV files
  const getHlsUrl = (url: string): string | null => {
    if (!url.includes('.mkv')) return null;
    // Convert /api/media/Show/Season/file.mkv to /api/hls/Show/Season/file.mkv/playlist.m3u8
    const hlsPath = url.replace('/api/media/', '/api/hls/') + '/playlist.m3u8';
    return hlsPath;
  };

  // Get progress URL for transcoding status
  const getProgressUrl = (url: string): string | null => {
    if (!url.includes('.mkv')) return null;
    return url.replace('/api/media/', '/api/hls/') + '/progress';
  };

  // Poll for transcoding progress
  const startProgressPolling = (url: string) => {
    const progressUrl = getProgressUrl(url);
    if (!progressUrl) return;

    // Clear any existing poll
    if (progressPollRef.current) {
      clearInterval(progressPollRef.current);
    }

    const poll = async () => {
      try {
        const res = await fetch(progressUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ready') {
            setTranscodeProgress(100);
            if (progressPollRef.current) {
              clearInterval(progressPollRef.current);
              progressPollRef.current = null;
            }
          } else if (data.status === 'transcoding') {
            setTranscodeProgress(data.progress);
          } else {
            setTranscodeProgress(0);
          }
        }
      } catch (e) {
        console.error('Progress poll error:', e);
      }
    };

    // Poll immediately, then every 2 seconds
    poll();
    progressPollRef.current = setInterval(poll, 2000);
  };

  const stopProgressPolling = () => {
    if (progressPollRef.current) {
      clearInterval(progressPollRef.current);
      progressPollRef.current = null;
    }
    setTranscodeProgress(null);
  };

  // Setup HLS playback for MKV files
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    // Always cleanup first when video URL changes
    if (hlsRef.current) {
      console.log('Cleaning up previous HLS instance');
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Stop any existing progress polling
    stopProgressPolling();

    // Clear video source to ensure clean state
    video.removeAttribute('src');
    video.load();
    setVideoError(null);

    const hlsUrl = getHlsUrl(videoUrl);

    // If not an MKV file, use direct playback
    if (!hlsUrl) {
      video.src = videoUrl;
      return;
    }

    // Start progress polling for MKV files
    setHlsLoading(true);
    startProgressPolling(videoUrl);

    // Check if browser supports HLS natively (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('Using native HLS support');
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', () => {
        setHlsLoading(false);
        stopProgressPolling();
      }, { once: true });
      video.addEventListener('error', () => {
        setHlsLoading(false);
        stopProgressPolling();
      }, { once: true });
      return;
    }

    // Use hls.js for other browsers
    if (Hls.isSupported()) {
      console.log('Using hls.js for HLS playback:', hlsUrl);

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hlsRef.current = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed, ready to play');
        setHlsLoading(false);
        stopProgressPolling();
        setVideoError(null);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              setHlsLoading(false);
              stopProgressPolling();
              setVideoError(`HLS Error: ${data.details}`);
              hls.destroy();
              hlsRef.current = null;
              break;
          }
        }
      });

      return () => {
        console.log('Cleanup: destroying HLS instance');
        stopProgressPolling();
        hls.destroy();
        hlsRef.current = null;
      };
    } else {
      setVideoError('Your browser does not support HLS video playback');
    }
  }, [videoUrl]);

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

  // Helper function to get video MIME type from URL
  // MKV files are remuxed to MP4 on the server, so always return video/mp4
  const getVideoMimeType = (url: string): string => {
    return 'video/mp4';
  };

  // LocalStorage keys
  const PROGRESS_KEY = 'video_progress';
  const VOLUME_KEY = 'video_volume';
  const RECENTLY_PLAYED_KEY = 'recently_played';
  const SUBTITLE_POSITION_KEY = 'subtitle_position';
  const SUBTITLE_SYNC_KEY = 'subtitle_sync';

  // Load subtitle settings on mount
  useEffect(() => {
    try {
      const savedPosition = localStorage.getItem(SUBTITLE_POSITION_KEY);
      if (savedPosition && ['top', 'middle', 'bottom'].includes(savedPosition)) {
        setSubtitlePosition(savedPosition as 'top' | 'middle' | 'bottom');
      }
      const savedSync = localStorage.getItem(SUBTITLE_SYNC_KEY);
      if (savedSync) {
        const syncValue = parseFloat(savedSync);
        if (!isNaN(syncValue)) {
          setSubtitleSync(syncValue);
        }
      }
    } catch (error) {
      console.error('Failed to load subtitle settings:', error);
    }
  }, []);

  // Save subtitle settings
  const saveSubtitlePosition = (position: 'top' | 'middle' | 'bottom') => {
    setSubtitlePosition(position);
    try {
      localStorage.setItem(SUBTITLE_POSITION_KEY, position);
    } catch (error) {
      console.error('Failed to save subtitle position:', error);
    }
  };

  const saveSubtitleSync = (sync: number) => {
    setSubtitleSync(sync);
    try {
      localStorage.setItem(SUBTITLE_SYNC_KEY, sync.toString());
    } catch (error) {
      console.error('Failed to save subtitle sync:', error);
    }
  };

  // Apply subtitle sync offset to cues
  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.textTracks.length === 0) return;

    const track = video.textTracks[0];
    if (!track.cues) return;

    const cues = track.cues;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i] as VTTCue;

      // Store original times if not already stored
      if (!originalCueTimes.current.has(cue)) {
        originalCueTimes.current.set(cue, {
          start: cue.startTime,
          end: cue.endTime,
        });
      }

      // Apply sync offset
      const original = originalCueTimes.current.get(cue)!;
      cue.startTime = Math.max(0, original.start + subtitleSync);
      cue.endTime = Math.max(0, original.end + subtitleSync);
    }
  }, [subtitleSync]);

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
      // URL format: /api/media/Solar%20Opposites/Season%203/01%20-%20The%20...mkv
      const parts = url.split('/');
      if (parts.length < 5) return null;

      const showName = decodeURIComponent(parts[3]);
      const seasonName = decodeURIComponent(parts[4]);
      const episodeFileName = decodeURIComponent(parts[5]);
      const episodeName = episodeFileName.replace(/\.mkv$/i, '');

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
    return videoPath.replace(/\.mkv$/i, '.jpg');
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
      if (['Space', 'KeyM', 'KeyF', 'KeyC', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Comma', 'Period'].includes(e.code)) {
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
        case 'Comma':
          // Subtitle sync: earlier (subtitles appear sooner)
          saveSubtitleSync(Math.max(-10, subtitleSync - 0.1));
          break;
        case 'Period':
          // Subtitle sync: later (subtitles appear later)
          saveSubtitleSync(Math.min(10, subtitleSync + 0.1));
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
  }, [videoUrl, progressRestored, showData, currentSeasonIndex, currentEpisodeIndex, router, subtitleSync]);

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
            {/* Subtitle styles */}
            <style>{`
              video::cue {
                background-color: rgba(0, 0, 0, 0.8);
                color: white;
                font-size: 1.2em;
                line-height: 1.4;
                padding: 0.2em 0.4em;
                border-radius: 4px;
              }
            `}</style>

            {/* Video error message */}
            {videoError && (
              <div className="bg-red-900/90 text-red-200 px-4 py-4 text-center">
                <p className="font-semibold mb-2">Video Playback Error</p>
                <p className="text-sm">{videoError}</p>
              </div>
            )}

            <div className="relative">
              <video
                ref={videoRef}
                controls
                className="w-full aspect-video"
              preload="metadata"
              playsInline
              {...(subtitlesUrl ? { crossOrigin: "anonymous" } : {})}
              key={videoUrl}
              onError={(e) => {
                const video = e.currentTarget;
                const error = video.error;

                // Log full error details
                console.error('=== VIDEO PLAYBACK ERROR ===');
                console.error('Video URL:', videoUrl);
                console.error('Error object:', error);
                console.error('Error code:', error?.code);
                console.error('Error message:', error?.message);
                console.error('Network state:', video.networkState);
                console.error('Ready state:', video.readyState);
                console.error('Current src:', video.currentSrc);
                console.error('User Agent:', navigator.userAgent);
                console.error('============================');

                // Ignore if no actual error (can happen during navigation)
                if (!error) {
                  setVideoError('Unknown error occurred. Check browser console for details.');
                  return;
                }

                let errorMessage = 'Failed to load video.';
                const errorCodeNames: Record<number, string> = {
                  1: 'MEDIA_ERR_ABORTED',
                  2: 'MEDIA_ERR_NETWORK',
                  3: 'MEDIA_ERR_DECODE',
                  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
                };

                switch (error.code) {
                  case MediaError.MEDIA_ERR_ABORTED:
                    errorMessage = 'Video loading was aborted. This may be a server or connection issue.';
                    break;
                  case MediaError.MEDIA_ERR_NETWORK:
                    errorMessage = 'Network error while loading video. Check your connection and server.';
                    break;
                  case MediaError.MEDIA_ERR_DECODE:
                    errorMessage = 'Cannot decode video. The codec may not be supported (try H.264/AAC).';
                    break;
                  case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = 'Video source not supported. Check server response and video format.';
                    break;
                }

                const codeName = errorCodeNames[error.code] || 'UNKNOWN';
                errorMessage += ` [${codeName}]`;
                if (error.message) {
                  errorMessage += ` - ${error.message}`;
                }

                setVideoError(errorMessage);
              }}
              onLoadStart={() => setVideoError(null)}
            >
              {/* Only use source element for non-MKV files; HLS sets src directly */}
              {videoUrl && !videoUrl.includes('.mkv') && (
                <source key={videoUrl} src={videoUrl} type={getVideoMimeType(videoUrl)} />
              )}
              {subtitlesUrl && subtitlesUrl !== '' && (
                <track
                  key={subtitlesUrl}
                  kind="subtitles"
                  src={subtitlesUrl}
                  srcLang="en"
                  label="English"
                />
              )}
              Your browser does not support the video tag.
              </video>

              {/* HLS Loading indicator with progress */}
              {hlsLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-white text-center w-80">
                    <svg className="animate-spin h-10 w-10 mx-auto mb-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-lg font-semibold mb-2">
                      {transcodeProgress !== null && transcodeProgress < 100
                        ? 'Transcoding video...'
                        : 'Preparing video...'}
                    </p>

                    {/* Progress bar */}
                    {transcodeProgress !== null && transcodeProgress < 100 && (
                      <div className="mb-3">
                        <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2">
                          <div
                            className="bg-red-600 h-2.5 rounded-full transition-all duration-500"
                            style={{ width: `${transcodeProgress}%` }}
                          />
                        </div>
                        <p className="text-sm text-gray-300">{transcodeProgress}% complete</p>
                      </div>
                    )}

                    <p className="text-sm text-gray-400">
                      {transcodeProgress !== null && transcodeProgress < 100
                        ? 'Converting video for browser playback'
                        : 'First-time playback may take a few minutes to transcode'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Manual CC Toggle Button and Subtitle Settings */}
            {subtitlesUrl && subtitlesUrl !== '' && (
              <div className="absolute bottom-20 right-4 flex gap-2">
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
                <button
                  onClick={() => setShowSubtitleSettings(!showSubtitleSettings)}
                  className={`${
                    showSubtitleSettings
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-gray-800/90 hover:bg-gray-700'
                  } text-white px-3 py-2 rounded-lg transition-colors shadow-lg`}
                  title="Subtitle Settings"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
            )}

            {/* Subtitle Settings Panel */}
            {showSubtitleSettings && subtitlesUrl && (
              <div className="absolute bottom-32 right-4 bg-gray-900/95 rounded-lg p-4 shadow-xl min-w-64 backdrop-blur-sm border border-gray-700">
                <h4 className="text-white font-semibold mb-3 text-sm">Subtitle Settings</h4>

                {/* Position Controls */}
                <div className="mb-4">
                  <label className="text-gray-400 text-xs block mb-2">Position</label>
                  <div className="flex gap-1">
                    {(['top', 'middle', 'bottom'] as const).map((pos) => (
                      <button
                        key={pos}
                        onClick={() => saveSubtitlePosition(pos)}
                        className={`flex-1 px-3 py-1.5 text-xs rounded capitalize ${
                          subtitlePosition === pos
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sync Controls */}
                <div>
                  <label className="text-gray-400 text-xs block mb-2">
                    Sync Offset: <span className="text-white font-mono">{subtitleSync >= 0 ? '+' : ''}{subtitleSync.toFixed(1)}s</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveSubtitleSync(Math.max(-10, subtitleSync - 0.5))}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
                    >
                      -0.5s
                    </button>
                    <button
                      onClick={() => saveSubtitleSync(0)}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => saveSubtitleSync(Math.min(10, subtitleSync + 0.5))}
                      className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
                    >
                      +0.5s
                    </button>
                  </div>
                  <p className="text-gray-500 text-xs mt-2">
                    {subtitleSync > 0 ? 'Subtitles appear later' : subtitleSync < 0 ? 'Subtitles appear earlier' : 'No offset'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 text-center text-gray-400">
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
              <div className="bg-gray-900 rounded-lg p-4 max-w-2xl mx-auto">
                <h3 className="text-base font-semibold mb-3">Player Controls</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-300">
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
                  <div className="space-y-1.5">
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">,</kbd> - Subs earlier</p>
                    <p><kbd className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">.</kbd> - Subs later</p>
                    <p className="text-gray-500">Sync: {subtitleSync >= 0 ? '+' : ''}{subtitleSync.toFixed(1)}s</p>
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