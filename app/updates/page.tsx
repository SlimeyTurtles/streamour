import Link from 'next/link';
import { changelog, currentVersion } from '@/lib/changelog';

export const metadata = {
  title: 'Updates - Streamour',
};

const sectionStyles: Record<string, { label: string; badge: string }> = {
  added: { label: 'Added', badge: 'bg-green-900/40 text-green-400 border-green-800/50' },
  changed: { label: 'Changed', badge: 'bg-blue-900/40 text-blue-400 border-blue-800/50' },
  fixed: { label: 'Fixed', badge: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50' },
};

function formatDate(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function UpdatesPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-8 py-6 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-red-500">Updates</h1>
          <p className="text-gray-400 mt-2">
            What&apos;s new in Streamour · currently v{currentVersion}
          </p>
        </div>
        <Link
          href="/"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-sm"
        >
          ← Home
        </Link>
      </header>

      <main className="px-8 py-8 max-w-3xl">
        <div className="relative border-l border-gray-800 ml-3">
          {changelog.map((entry, i) => (
            <div key={entry.version} className="relative pl-8 pb-10">
              <div
                className={`absolute -left-[7px] top-1.5 w-3.5 h-3.5 rounded-full border-2 ${
                  i === 0
                    ? 'bg-red-500 border-red-500 shadow-md shadow-red-500/50'
                    : 'bg-black border-gray-600'
                }`}
              ></div>

              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-2xl font-bold">v{entry.version}</h2>
                {i === 0 && (
                  <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-800/50">
                    Latest
                  </span>
                )}
                <span className="text-sm text-gray-500">{formatDate(entry.date)}</span>
              </div>
              <p className="text-gray-400 mt-1 font-medium">{entry.title}</p>

              <div className="mt-4 space-y-4">
                {(['added', 'changed', 'fixed'] as const).map((type) => {
                  const items = entry.changes[type];
                  if (!items?.length) return null;
                  const style = sectionStyles[type];
                  return (
                    <div key={type}>
                      <span
                        className={`inline-block text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${style.badge}`}
                      >
                        {style.label}
                      </span>
                      <ul className="mt-2 space-y-1.5">
                        {items.map((item) => (
                          <li key={item} className="text-gray-300 text-sm flex gap-2">
                            <span className="text-gray-600 mt-0.5">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
