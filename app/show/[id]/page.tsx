'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Show, Season, Episode } from '../../api/shows/route';

function EpisodeCard({ episode, showName, seasonName, onClick }: {
  episode: Episode;
  showName: string;
  seasonName: string;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const thumbnailPath = episode.path.replace(/\.mkv$/i, '.jpg');

  return (
    <div
      onClick={onClick}
      className="bg-gray-800/50 rounded-xl overflow-hidden hover:bg-gray-800 transition-all hover:scale-[1.02] cursor-pointer shadow-md group"
    >
      <div className="aspect-video bg-gray-800 flex items-center justify-center relative overflow-hidden">
        {!imgError ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnailPath}
              alt={episode.name}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setImgError(true)}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
              <div className="text-5xl opacity-0 group-hover:opacity-90 transition-opacity">▶</div>
            </div>
          </>
        ) : (
          <div className="text-5xl opacity-40">▶</div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm mb-1 line-clamp-2" title={episode.name}>
          {episode.name}
        </h3>
        {episode.subtitles && (
          <span className="text-xs bg-gray-700/50 px-2 py-0.5 rounded-full text-gray-400">
            CC
          </span>
        )}
      </div>
    </div>
  );
}

interface RecentlyPlayed {
  showId: string;
  showName: string;
  seasonName: string;
  episodeName: string;
  videoPath: string;
  currentTime: number;
  duration: number;
  percentWatched: number;
  timestamp: number;
}

export default function ShowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const showId = params.id as string;

  const [show, setShow] = useState<Show | null>(null);
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recentlyPlayedEpisode, setRecentlyPlayedEpisode] = useState<RecentlyPlayed | null>(null);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [startThumbnailError, setStartThumbnailError] = useState(false);

  useEffect(() => {
    fetch('/api/shows')
      .then(res => res.json())
      .then((shows: Show[]) => {
        const foundShow = shows.find(s => s.id === showId);
        if (foundShow) {
          setShow(foundShow);
          loadRecentlyPlayedForShow(showId);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading show:', err);
        setLoading(false);
      });
  }, [showId]);

  const loadRecentlyPlayedForShow = (currentShowId: string) => {
    try {
      const saved = localStorage.getItem('recently_played');
      if (saved) {
        const recentlyPlayed: RecentlyPlayed[] = JSON.parse(saved);
        const episode = recentlyPlayed.find(item => item.showId === currentShowId);
        if (episode) {
          setRecentlyPlayedEpisode(episode);
        }
      }
    } catch (error) {
      console.error('Error loading recently played:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleContinueWatching = () => {
    if (!recentlyPlayedEpisode) return;
    const params = new URLSearchParams({
      video: recentlyPlayedEpisode.videoPath,
      title: `${recentlyPlayedEpisode.showName} - ${recentlyPlayedEpisode.seasonName} - ${recentlyPlayedEpisode.episodeName}`,
    });
    router.push(`/watch?${params.toString()}`);
  };

  const handleStartWatching = () => {
    if (!show || show.seasons.length === 0 || show.seasons[0].episodes.length === 0) return;

    const firstEpisode = show.seasons[0].episodes[0];
    const params = new URLSearchParams({
      video: firstEpisode.path,
      title: `${show.name} - ${show.seasons[0].name} - ${firstEpisode.name}`,
      ...(firstEpisode.subtitles ? { subtitles: firstEpisode.subtitles } : {}),
    });
    router.push(`/watch?${params.toString()}`);
  };

  const getEpisodeThumbnail = (videoPath: string): string => {
    return videoPath.replace(/\.mkv$/i, '.jpg');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white flex items-center justify-center">
        <div className="text-2xl">Loading...</div>
      </div>
    );
  }

  if (!show) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Show not found</h1>
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

  const selectedSeason = show.seasons[selectedSeasonIndex];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="px-6 py-3 border-b border-gray-800/50">
        <button
          onClick={() => router.push('/')}
          className="text-indigo-400 hover:text-indigo-300 transition-colors mb-3 flex items-center gap-1 text-sm"
        >
          <span>←</span> Back
        </button>
        <div className="flex items-center gap-4">
          {show.thumbnail && (
            <img
              src={show.thumbnail}
              alt={show.name}
              className="w-20 h-20 object-cover rounded-lg"
            />
          )}
          <div>
            <h1 className="text-2xl font-semibold mb-1">{show.name}</h1>
            <p className="text-sm text-gray-400">
              {show.seasons.length} Season{show.seasons.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </header>

      {/* Continue/Start Watching Card */}
      <div className="px-6 py-6 border-b border-gray-800/50">
        <div className="max-w-7xl mx-auto">
          {recentlyPlayedEpisode ? (
            <div
              onClick={handleContinueWatching}
              className="bg-gradient-to-br from-red-900/20 via-red-800/15 to-gray-900/20 rounded-xl overflow-hidden cursor-pointer hover:from-red-900/30 hover:via-red-800/25 hover:to-gray-900/30 transition-all border border-red-800/40 shadow-2xl group"
            >
              <div className="flex flex-col md:flex-row items-stretch gap-0">
                {/* Episode Thumbnail */}
                <div className="md:w-2/5 aspect-video md:aspect-auto bg-gray-800 relative">
                  {!thumbnailError ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getEpisodeThumbnail(recentlyPlayedEpisode.videoPath)}
                        alt={recentlyPlayedEpisode.episodeName}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => setThumbnailError(true)}
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-red-900/20 group-hover:to-red-900/40 transition-all"></div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                        <div className="w-20 h-20 rounded-full bg-red-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100">
                          <div className="text-4xl text-white ml-1">▶</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      <div className="text-6xl">▶</div>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 p-6 md:p-8 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-red-400 text-sm font-semibold uppercase tracking-wider">Continue Watching</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-white group-hover:text-red-300 transition-colors mb-2">
                    {recentlyPlayedEpisode.episodeName}
                  </h3>
                  <p className="text-gray-400 text-lg mb-6">
                    {recentlyPlayedEpisode.seasonName}
                  </p>
                  <div className="max-w-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">
                        {formatTime(recentlyPlayedEpisode.currentTime)} / {formatTime(recentlyPlayedEpisode.duration)}
                      </span>
                      <span className="text-sm text-gray-400 font-semibold">
                        {Math.round(recentlyPlayedEpisode.percentWatched)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-700/50 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-red-600 to-red-500 h-full rounded-full transition-all shadow-lg shadow-red-500/50"
                        style={{ width: `${Math.min(recentlyPlayedEpisode.percentWatched, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              onClick={handleStartWatching}
              className="bg-gradient-to-br from-indigo-900/20 via-indigo-800/15 to-gray-900/20 rounded-xl overflow-hidden cursor-pointer hover:from-indigo-900/30 hover:via-indigo-800/25 hover:to-gray-900/30 transition-all border border-indigo-800/40 shadow-2xl group"
            >
              <div className="flex flex-col md:flex-row items-stretch gap-0">
                {/* Episode Thumbnail */}
                <div className="md:w-2/5 aspect-video md:aspect-auto bg-gray-800 relative">
                  {show && show.seasons.length > 0 && show.seasons[0].episodes.length > 0 && !startThumbnailError ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getEpisodeThumbnail(show.seasons[0].episodes[0].path)}
                        alt={show.seasons[0].episodes[0].name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => setStartThumbnailError(true)}
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-indigo-900/20 group-hover:to-indigo-900/40 transition-all"></div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                        <div className="w-20 h-20 rounded-full bg-indigo-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100">
                          <div className="text-4xl text-white ml-1">▶</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      <div className="text-6xl">▶</div>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 p-6 md:p-8 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></div>
                    <span className="text-indigo-400 text-sm font-semibold uppercase tracking-wider">Start Watching</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-white group-hover:text-indigo-300 transition-colors mb-2">
                    {show && show.seasons.length > 0 && show.seasons[0].episodes.length > 0
                      ? show.seasons[0].episodes[0].name
                      : 'Episode 1'}
                  </h3>
                  <p className="text-gray-400 text-lg">
                    {show && show.seasons.length > 0 ? show.seasons[0].name : 'Season 1'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Season Selector */}
      <div className="px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <label htmlFor="season-select" className="text-sm font-medium text-gray-300">
              Season:
            </label>
            <select
              id="season-select"
              value={selectedSeasonIndex}
              onChange={(e) => setSelectedSeasonIndex(Number(e.target.value))}
              className="bg-gray-800/50 text-white text-sm px-3 py-1.5 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors cursor-pointer focus:outline-none focus:border-indigo-500"
            >
              {show.seasons.map((season, index) => (
                <option key={index} value={index}>
                  {season.name} ({season.episodes.length} ep{season.episodes.length !== 1 ? 's' : ''})
                </option>
              ))}
            </select>
          </div>

          {/* Episodes Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {selectedSeason.episodes.map((episode, index) => (
              <EpisodeCard
                key={index}
                episode={episode}
                showName={show.name}
                seasonName={selectedSeason.name}
                onClick={() => {
                  const params = new URLSearchParams({
                    video: episode.path,
                    title: `${show.name} - ${selectedSeason.name} - ${episode.name}`,
                    ...(episode.subtitles ? { subtitles: episode.subtitles } : {}),
                  });
                  router.push(`/watch?${params.toString()}`);
                }}
              />
            ))}
          </div>

          {selectedSeason.episodes.length === 0 && (
            <div className="text-center text-gray-500 py-12 text-sm">
              No episodes available for this season
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
