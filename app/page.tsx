'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

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

function RecentlyPlayedCard({ item, onClick }: { item: RecentlyPlayed; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);

  const getEpisodeThumbnail = (videoPath: string): string => {
    return videoPath.replace(/\.mkv$/i, '.jpg');
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="bg-gradient-to-br from-red-900/15 via-red-800/10 to-gray-900/15 rounded-lg overflow-hidden cursor-pointer hover:from-red-900/25 hover:via-red-800/20 hover:to-gray-900/25 transition-all border border-red-800/30 shadow-xl group"
      onClick={onClick}
    >
      <div className="flex flex-col sm:flex-row items-stretch gap-0">
        {/* Episode Thumbnail */}
        <div className="sm:w-2/5 aspect-video sm:aspect-auto bg-gray-800 relative">
          {!imgError ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getEpisodeThumbnail(item.videoPath)}
                alt={item.episodeName}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setImgError(true)}
              />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent to-red-900/15 group-hover:to-red-900/30 transition-all"></div>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <div className="w-14 h-14 rounded-full bg-red-600/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100">
                  <div className="text-2xl text-white ml-1">▶</div>
                </div>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600">
              <div className="text-4xl">▶</div>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 p-4 sm:p-5 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-red-400 text-xs font-semibold uppercase tracking-wider">Continue Watching</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white group-hover:text-red-300 transition-colors mb-1 line-clamp-1">
            {item.showName}
          </h3>
          <p className="text-gray-400 text-sm mb-4 line-clamp-1">
            {item.seasonName} • {item.episodeName}
          </p>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-400">
                {formatTime(item.currentTime)} / {formatTime(item.duration)}
              </span>
              <span className="text-xs text-gray-400 font-semibold">
                {Math.round(item.percentWatched)}%
              </span>
            </div>
            <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-red-600 to-red-500 h-full rounded-full transition-all shadow-md shadow-red-500/40"
                style={{ width: `${Math.min(item.percentWatched, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentlyPlayed[]>([]);

  useEffect(() => {
    fetchShows();
    loadRecentlyPlayed();
  }, []);

  const fetchShows = async () => {
    try {
      const response = await fetch('/api/shows');
      const data = await response.json();
      setShows(data);
    } catch (error) {
      console.error('Error fetching shows:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecentlyPlayed = () => {
    try {
      const saved = localStorage.getItem('recently_played');
      if (saved) {
        const parsed = JSON.parse(saved);
        setRecentlyPlayed(parsed);
      }
    } catch (error) {
      console.error('Error loading recently played:', error);
    }
  };

  const resumeWatching = (item: RecentlyPlayed) => {
    // Find the episode to get subtitles info
    const show = shows.find(s => s.id === item.showId);
    let subtitles: string | undefined;

    if (show) {
      for (const season of show.seasons) {
        const episode = season.episodes.find(ep => ep.path === item.videoPath);
        if (episode?.subtitles) {
          subtitles = episode.subtitles;
          break;
        }
      }
    }

    const params = new URLSearchParams({
      video: item.videoPath,
      title: `${item.showName} - ${item.seasonName} - ${item.episodeName}`,
      ...(subtitles ? { subtitles } : {}),
    });
    router.push(`/watch?${params.toString()}`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/login', { method: 'DELETE' });
      router.push('/login');
      router.refresh();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-2xl">Loading shows...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-8 py-6 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-red-500">Streamour</h1>
          <p className="text-gray-400 mt-2">Your personal streaming service</p>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm"
        >
          Logout
        </button>
      </header>

      <main className="px-8 py-8">
        {/* Recently Played Section */}
        {recentlyPlayed.length > 0 && (
          <div className="mb-12">
            <h2 className="text-3xl font-bold mb-6">Continue Watching</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentlyPlayed.map((item) => (
                <RecentlyPlayedCard
                  key={item.showId}
                  item={item}
                  onClick={() => resumeWatching(item)}
                />
              ))}
            </div>
          </div>
        )}

        {shows.length === 0 ? (
          <div className="text-center py-20">
            <h2 className="text-2xl text-gray-400 mb-4">No shows found</h2>
            <p className="text-gray-500 max-w-md mx-auto">
              Add your shows to the <code className="bg-gray-800 px-2 py-1 rounded">media/</code> folder following the structure outlined in the README.
            </p>
          </div>
        ) : (
          <div>
            <h2 className="text-3xl font-bold mb-8">All Shows</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {shows.map((show) => (
                <div
                  key={show.id}
                  className="group cursor-pointer transform transition-all duration-200 hover:scale-105"
                  onClick={() => router.push(`/show/${show.id}`)}
                >
                  <div className="aspect-3/4 bg-gray-800 rounded-lg overflow-hidden shadow-lg">
                    {show.thumbnail ? (
                      <Image
                        src={show.thumbnail}
                        alt={show.name}
                        width={300}
                        height={400}
                        className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-700">
                        <div className="text-center text-gray-400">
                          <div className="text-4xl mb-2">📺</div>
                          <div className="text-sm">No thumbnail</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold mt-3 text-center group-hover:text-red-400 transition-colors">
                    {show.name}
                  </h3>
                  <p className="text-sm text-gray-400 text-center">
                    {show.seasons.length} season{show.seasons.length !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}