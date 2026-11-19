# Streamour

A personal media streaming service built with Next.js. Netflix-like experience for self-hosted media.

## Features

- Per-user sessions (sign in with the household password for now; accounts and invites are on the roadmap)
- Auto-discovers shows/seasons/episodes from folder structure
- MKV files transcoded/remuxed to MP4 on-the-fly via ffmpeg
- Subtitle support (embedded MKV subtitles or external SRT files)
- Progress tracking with resume playback
- Continue watching on home page
- Auto-play next episode
- Mobile support

## Quick Start with Docker (Recommended)

### 1. Create environment file

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```
AUTH_PASSWORD=your_secret_password
OWNER_EMAIL=you@example.com
MEDIA_PATH=/path/to/your/media
POSTGRES_PASSWORD=a_long_random_string   # e.g. openssl rand -hex 24
```

### 2. Run with Docker Compose

```bash
docker compose up -d
```

This starts two containers: the app and its Postgres database (data in the
`db_data` volume). The media folder is mounted read-only; generated HLS and
thumbnails go to a separate `/cache` volume. The app applies pending database migrations every time it
starts, so a fresh `docker compose up` creates the schema by itself.

The app will be available at http://localhost:3000

### Docker Commands

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after changes
docker compose up -d --build --force-recreate
```

## Deploying (home server)

Deploys are **manual** GitHub Actions, run from the repo's Actions tab. Both run on a
self-hosted runner on the home server, which builds the image locally and restarts
the container. Pick the branch to deploy in the "Use workflow from" dropdown.

| Workflow | What it does | URL |
|----------|--------------|-----|
| **Deploy production** | rsyncs into `~/streamour`, rebuilds, restarts, smoke-tests | https://streamour.net |
| **Deploy staging** | rsyncs into `~/streamour-staging`, builds a separate `streamour-staging` container, smoke-tests, then schedules teardown | http://192.168.68.64:3005 (LAN) |

Staging self-destructs after `ttl_hours` (default 4). A `streamour-staging-reaper`
container does the teardown; re-running the staging workflow replaces it, so the
clock restarts from the latest deploy. Staging reuses production's `.env` unless
`~/streamour-staging/.env` exists on the server.

Each environment has its own Postgres container and volume. Staging's database is
thrown away with the rest of staging at teardown, so a branch with a new migration
can be deployed to staging without touching production data. Both workflows
generate `POSTGRES_PASSWORD` into the server's `.env` if it is missing.

Workflow files: `.github/workflows/deploy-production.yml`, `.github/workflows/deploy-staging.yml`.
Staging port/container overrides: `docker-compose.staging.yml`.

## Local Development

### Requirements

- Node.js 20+
- ffmpeg/ffprobe (for video transcoding)
- Docker (for the local Postgres database)

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the database (uses `POSTGRES_PASSWORD` from `.env`, listens on `127.0.0.1:5436`):
   ```bash
   cp .env.example .env   # if you haven't already
   docker compose up -d postgres
   ```

3. Create `.env.local`:
   ```
   AUTH_PASSWORD=your_password
   OWNER_EMAIL=you@example.com
   MEDIA_DIR=/path/to/media
   DATABASE_URL=postgresql://streamour:<POSTGRES_PASSWORD>@localhost:5436/streamour
   ```

4. Apply migrations (Prisma reads `DATABASE_URL` from the shell or a `.env` file, not `.env.local`):
   ```bash
   DATABASE_URL=postgresql://streamour:<POSTGRES_PASSWORD>@localhost:5436/streamour npm run db:deploy
   ```

5. Run development server:
   ```bash
   npm run dev
   ```

6. Open http://localhost:3000

### Commands

```bash
npm run dev    # Start dev server
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint

npm run db:migrate -- --name what_changed   # After editing prisma/schema.prisma: create + apply a migration
npm run db:deploy                           # Apply pending migrations
npm run db:studio                           # Browse the database
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `AUTH_PASSWORD` | `.env`, `.env.local` | Shared household password. Signs you in as the owner account while `LEGACY_PASSWORD_LOGIN` is on. |
| `OWNER_EMAIL` | `.env`, `.env.local` | Email of the first owner account, created at the first sign-in (required) |
| `LEGACY_PASSWORD_LOGIN` | `.env` | `false` turns off sign-in with `AUTH_PASSWORD`. Defaults to on for this release. |
| `COOKIE_INSECURE` | `.env` | `true` only when serving over plain HTTP; drops the `Secure` flag from the session cookie. Staging sets it. |
| `MEDIA_PATH` | `.env` | Host path to the media library, mounted read-only into the container (required for Docker) |
| `MEDIA_DIR` | `.env.local` | Media path for `npm run dev`; defaults to `./media` |
| `CACHE_PATH` | `.env` | Host directory for generated HLS and thumbnails (must be writable by uid 1001). Optional; defaults to a Docker named volume. Production must set it. |
| `CACHE_DIR` | `.env.local` | Cache directory for `npm run dev`; defaults to `./.cache`. In Docker it is always `/cache`. |
| `POSTGRES_PASSWORD` | `.env` | Password for the bundled Postgres container (required for Docker) |
| `POSTGRES_PORT` | `.env` | Host-local port for Postgres; defaults to `5436` |
| `MAIL_PROVIDER` | `.env`, `.env.local` | `log` (default) prints emails to the server log; `resend` sends them. Staging is always `log`. |
| `RESEND_API_KEY` | `.env` | Resend API key; required when `MAIL_PROVIDER=resend` |
| `MAIL_FROM` | `.env` | From address; defaults to `Streamour <no-reply@streamour.net>`. The domain must be verified in Resend. |
| `APP_URL` | `.env`, `.env.local` | Public base URL for links in emails; defaults to `http://localhost:3000` |
| `DATABASE_URL` | `.env.local` | Postgres connection string for `npm run dev`. In Docker it is built from `POSTGRES_PASSWORD` by compose. |

## Media Structure

```
media/
└── Show Name/
    ├── thumbnail.jpg             # Show poster
    └── Season 1/                 # Must match "Season X" pattern
        ├── 01 - Episode Name.mkv # Video file
        ├── 01 - Episode Name.srt # Optional: external subtitles
        └── 01 - Episode Name.jpg # Optional: episode thumbnail
```

**Subtitle Priority:**
1. External `.srt` file (same base name as video)
2. Embedded subtitles in MKV (prefers English track)

## Video Player Controls

| Key | Action |
|-----|--------|
| Space | Play/Pause |
| F | Fullscreen |
| M | Mute |
| C | Toggle captions |
| ←/→ | Seek 10s |
| ↑/↓ | Volume |
| ,/. | Subtitle sync |

## Supported Formats

- **Video**: MKV (H.264 remuxed, H.265/VP9/AV1 transcoded to H.264)
- **Subtitles**: Embedded (SRT, ASS, SSA) or external SRT

## Tools

Utility scripts in `tools/`:

- `generate-thumbnails.py` - Generate episode thumbnails
- `generate-subtitles.py` - Auto-generate subtitles
- `convert-srt-to-vtt.py` - Convert SRT to VTT
- `convert-videos.sh` - Video conversion helper
