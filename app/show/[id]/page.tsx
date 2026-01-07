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
  const thumbnailPath = episode.path.replace(/\.(mp4|mkv|avi|mov)$/i, '.jpg');

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

export default function ShowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const showId = params.id as string;

  const [show, setShow] = useState<Show | null>(null);
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/shows')
      .then(res => res.json())
      .then((shows: Show[]) => {
        const foundShow = shows.find(s => s.id === showId);
        if (foundShow) {
          setShow(foundShow);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading show:', err);
        setLoading(false);
      });
  }, [showId]);

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
