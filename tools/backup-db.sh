#!/usr/bin/env bash
# Nightly database backup. Runs on the server from cron (installed by the
# "Deploy production" workflow); safe to run by hand at any time.
#
#   tools/backup-db.sh
#
# Dumps the production database (custom format, compressed) to BACKUP_DIR and
# deletes dumps older than RETENTION_DAYS. Restore with tools/restore-db.sh.
set -euo pipefail
umask 077 # dumps contain password and session hashes

CONTAINER="${CONTAINER:-streamour-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/storage/backups/streamour}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_USER="${DB_USER:-streamour}"
DB_NAME="${DB_NAME:-streamour}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

if [ ! -d "$BACKUP_DIR" ] || [ ! -w "$BACKUP_DIR" ]; then
  log "ERROR: $BACKUP_DIR is missing or not writable (is the RAID mounted?)"
  exit 1
fi

target="$BACKUP_DIR/streamour-$(date '+%Y%m%d-%H%M%S').dump"
tmp="$target.partial"
trap 'rm -f "$tmp"' EXIT

# Dump to a temporary name so a failed run never leaves something that looks
# like a backup.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "$tmp"

# A dump that pg_restore can't list is not a backup.
docker exec -i "$CONTAINER" pg_restore --list < "$tmp" > /dev/null

mv "$tmp" "$target"
log "wrote $target ($(du -h "$target" | cut -f1))"

# Retention. Only ever touches this script's own files.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'streamour-*.dump' -mtime "+$RETENTION_DAYS" -print -delete |
  while read -r old; do log "removed $old"; done
