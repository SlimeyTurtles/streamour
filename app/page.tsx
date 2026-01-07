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

export default function Home() {
  const router = useRouter();
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShows();
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
        {shows.length === 0 ? (
          <div className="text-center py-20">
            <h2 className="text-2xl text-gray-400 mb-4">No shows found</h2>
            <p className="text-gray-500 max-w-md mx-auto">
              Add your shows to the <code className="bg-gray-800 px-2 py-1 rounded">media/</code> folder following the structure outlined in the README.
            </p>
          </div>
        ) : (
          <div>
            <h2 className="text-3xl font-bold mb-8">Shows</h2>
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