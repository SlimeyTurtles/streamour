# Streamour

A personal media streaming service built with Next.js. Netflix-like experience for self-hosted media.

## Features

- Password-based authentication
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
MEDIA_PATH=/path/to/your/media
```

### 2. Run with Docker Compose

```bash
docker compose up -d
```

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
| **Deploy staging** | rsyncs into `~/streamour-staging`, builds a separate `streamour-staging` container, smoke-tests, then schedules teardown | http://192.168.1.64:3005 (LAN) |

Staging self-destructs after `ttl_hours` (default 4). A `streamour-staging-reaper`
container does the teardown; re-running the staging workflow replaces it, so the
clock restarts from the latest deploy. Staging reuses production's `.env` unless
`~/streamour-staging/.env` exists on the server.

Workflow files: `.github/workflows/deploy-production.yml`, `.github/workflows/deploy-staging.yml`.
Staging port/container overrides: `docker-compose.staging.yml`.

## Local Development

### Requirements

- Node.js 20+
- ffmpeg/ffprobe (for video transcoding)

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

2. Create `.env.local`:
   ```
   AUTH_PASSWORD=your_password
   MEDIA_DIR=/path/to/media
   ```

3. Run development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000

### Commands

```bash
npm run dev    # Start dev server
npm run build  # Production build
npm run start  # Production server
npm run lint   # ESLint
```

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
