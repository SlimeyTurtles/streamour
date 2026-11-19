# Streamour

A personal media streaming service built with Next.js. Netflix-like experience for self-hosted media.

## Where things live

- **Work tracking:** GitHub project board https://github.com/users/SlimeyTurtles/projects/11 — every change starts as an issue there. Reference the issue number in commits and PRs (`Closes #12`).
- **Shared Claude permissions:** `.claude/settings.json` (committed) pre-approves the routine gh/npm/docker commands used here. Personal extras go in `.claude/settings.local.json` (not committed).
- **Docs for humans and agents:** the repo wiki https://github.com/SlimeyTurtles/streamour/wiki (getting started, workflow, deploys, media layout, architecture). This file is the short version; the wiki is the long version. Keep them consistent.

## Tech Stack

- **Framework**: Next.js 16.1.1 (App Router)
- **React**: 19.2.3
- **Styling**: Tailwind CSS 4
- **Language**: TypeScript 5
- **Database**: Postgres 16 (second container in the compose project) via Prisma 6

## Project Structure

```
streamour/
├── app/
│   ├── api/
│   │   ├── auth/login/route.ts   # POST: login, DELETE: logout
│   │   ├── health/route.ts       # GET: public liveness + DB check (deploy smoke tests)
│   │   ├── media/[...path]/route.ts  # Serves media files with range requests
│   │   ├── shows/route.ts        # GET: scans media folder, returns show list
│   │   └── test-video/route.ts   # Test endpoint
│   ├── login/page.tsx            # Password login page
│   ├── show/[id]/page.tsx        # Show detail with season/episode selection
│   ├── watch/page.tsx            # Video player with progress tracking
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Home page with show grid + continue watching
├── lib/
│   ├── changelog.ts              # Drives /updates
│   ├── auth.ts                   # Sessions: getSession(), requireSession(), createSession(), ensureOwner()
│   ├── db.ts                     # Prisma client singleton (`import { db } from '@/lib/db'`)
│   ├── media-path.ts             # getMediaDir(), resolveMediaPath(): URL segments → path inside the media folder
│   ├── cache.ts                  # Paths in the writable cache (HLS, thumbnails)
│   ├── mail.ts                   # sendMail() over a provider (log | resend)
│   └── mail-templates.ts         # invite, verify email, code, new sign-in
├── prisma/
│   ├── schema.prisma             # Database schema (users, sessions)
│   └── migrations/               # Applied by docker-entrypoint.sh on container start
├── tools/                        # Utility scripts
│   ├── convert-srt-to-vtt.py     # Convert SRT subtitles to VTT
│   ├── convert-videos.sh         # Video conversion helper
│   ├── fix-mobile-streaming.py   # Mobile compatibility fixes
│   ├── generate-subtitles.py     # Auto-generate subtitles
│   └── generate-thumbnails.py    # Generate episode thumbnails
├── middleware.ts                 # First gate: redirects to /login when there is no session cookie
├── server.js                     # Dev server wrapper with timestamps
├── docker-entrypoint.sh          # `prisma migrate deploy`, then starts the app
└── media/                        # Default media directory
```

## Key Features

- **Authentication**: Per-user sessions (opaque token in an HttpOnly cookie, hash in the DB, 30 days sliding). For now the only way in is the shared `AUTH_PASSWORD`, which signs you in as the owner account
- **Media Scanning**: Auto-discovers shows/seasons/episodes from folder structure
- **Video Streaming**: MKV files transcoded/remuxed to MP4 on-the-fly via ffmpeg (HEVC/H.265 auto-transcoded to H.264 for browser compatibility)
- **Subtitles**: Embedded MKV subtitles extracted on-the-fly (prefers English), falls back to external SRT files, with position (top/middle/bottom) and sync controls
- **Progress Tracking**: LocalStorage-based, resumes playback position
- **Continue Watching**: Tracks recently played shows on home page
- **Auto-play**: Plays next episode when current one ends
- **Mobile Support**: Full support via on-the-fly remuxing

## Expected Media Structure

```
media/
└── Show Name/
    ├── thumbnail.jpg (or .png)   # Show poster
    └── Season 1/                  # Must match "Season X" pattern
        ├── 01 - Episode Name.mkv  # Video file (MKV with embedded subs works!)
        ├── 01 - Episode Name.srt  # Optional: external SRT (takes priority over embedded)
        └── 01 - Episode Name.jpg  # Episode thumbnail (same base name)
```

**Subtitle Priority:**
1. External `.srt` file (if exists, same base name as video)
2. Embedded subtitles in MKV (prefers English track, falls back to first available)

## Environment Variables

Create `.env.local`:
```
AUTH_PASSWORD=your_password_here
OWNER_EMAIL=you@example.com   # First owner account, created at first sign-in
MEDIA_DIR=/path/to/media   # Optional, defaults to ./media
DATABASE_URL=postgresql://streamour:<POSTGRES_PASSWORD>@localhost:5436/streamour
```

For local dev, start the database with `docker compose up -d postgres` (needs
`POSTGRES_PASSWORD` in `.env`). In Docker, compose builds `DATABASE_URL` itself.

Auth (`lib/auth.ts`): `middleware.ts` only checks that a session cookie exists; it
cannot verify it. **Every API route that returns data must start with
`requireSession()`** (returns the session + user, or a 401 response to return as-is).
`LEGACY_PASSWORD_LOGIN` (default on) lets `AUTH_PASSWORD` sign in as the owner;
`COOKIE_INSECURE=true` is only for plain-HTTP environments (staging sets it).

Email (`lib/mail.ts`): `MAIL_PROVIDER=log` (default; prints to the server log, and
staging is pinned to it) or `resend` (needs `RESEND_API_KEY`, `MAIL_FROM`). `APP_URL`
is the public base URL for links in emails. All outbound email goes through
`sendMail()`; don't call a provider directly.

## Generated files (cache)

The media folder is read-only in production. Never write next to source files:
generated HLS and thumbnails go under `CACHE_DIR` (`/cache` in Docker, `./.cache` in
dev), mirrored by media path (`hls/<Show>/<Season>/<file>.mkv/`,
`thumbnails/<Show>/...`); use the helpers in `lib/cache.ts`. Readers check the cache
first, then fall back to legacy `<file>.mkv.hls/` folders next to the source. Any route
that turns URL segments into a media path must use `resolveMediaPath()`.

## Database

Postgres + Prisma. Schema changes: edit `prisma/schema.prisma`, run
`npm run db:migrate -- --name what_changed`, commit the generated migration. Never
edit an applied migration. The container applies pending migrations on start
(`docker-entrypoint.sh`), so deploying a branch with a migration is self-contained.
Production and staging have separate Postgres containers and volumes; staging's is
deleted at teardown.

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/login` | POST | Login with `{ password }` |
| `/api/auth/login` | DELETE | Logout (revokes the session, clears cookie) |
| `/api/shows` | GET | List all shows with seasons/episodes |
| `/api/health` | GET | Public; 200 when the app is up and can reach the database |
| `/api/media/[...path]` | GET/HEAD | Serve media files (range support) |

## Video Player Features

- Keyboard shortcuts: Space (play/pause), F (fullscreen), M (mute), C (captions), arrows (seek/volume), comma/period (subtitle sync)
- Subtitle settings: position (top/middle/bottom), sync offset (+/- seconds)
- Volume persistence across sessions
- Progress save every few seconds
- Auto-clear progress when video completes (>95%)

## Versioning & Changelog

The site has an updates page at `/updates` driven by `lib/changelog.ts`.

**Whenever you make a user-facing change to the site, before finishing:**
1. Add a new entry to the TOP of the `changelog` array in `lib/changelog.ts` with a bumped
   version, today's date, a short title, and changes categorized as `added`/`changed`/`fixed`.
2. Bump `version` in `package.json` to match.

Version bump rules (semver-ish): bug fixes → patch (x.x.+1), new features → minor (x.+1.0),
major overhauls → major (+1.0.0). Skip the changelog for internal-only changes (refactors,
tooling, docs).

## Deployment

Production (streamour.net) and staging run on the home server `avinhsdell` via two
**manual** GitHub Actions (`workflow_dispatch`, not push-to-main) on a self-hosted
runner: `Deploy production` (→ `~/streamour`, port 3000) and `Deploy staging`
(→ `~/streamour-staging`, port 3005, self-destructs after `ttl_hours`, default 4).
Trigger with `gh workflow run "Deploy production"` or `gh workflow run "Deploy staging" -f ttl_hours=4`
(add `--ref <branch>` to deploy a branch). Pushing to `main` does **not** deploy.
See `.github/workflows/` and `docker-compose.staging.yml`.

## Commands

```bash
npm run dev    # Start dev server (uses server.js wrapper)
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
npm run db:migrate -- --name x   # Create + apply a migration after a schema change
npm run db:deploy                # Apply pending migrations
```

## Supported Formats

- **Video**: MKV (transcoded/remuxed to fragmented MP4 on-the-fly)
  - H.264/AVC: Remuxed (fast, no quality loss)
  - H.265/HEVC, VP9, AV1: Transcoded to H.264 (slower, enables browser playback)
- **Subtitles**:
  - Embedded in MKV (SRT, ASS, SSA, etc. - extracted and converted to VTT)
  - External SRT files (converted to VTT on-the-fly)

## Requirements

- **ffmpeg/ffprobe**: Required for MKV to MP4 remuxing. Install via:
  ```bash
  # Ubuntu/Debian
  sudo apt install ffmpeg

  # macOS
  brew install ffmpeg
  ```
