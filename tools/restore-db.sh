#!/usr/bin/env bash
# Restore a dump made by tools/backup-db.sh into a Postgres container.
#
#   tools/restore-db.sh <dump file> [postgres container]
#
# The container defaults to staging's, so trying a restore is safe by default.
# Restoring into production (streamour-postgres) REPLACES its data and asks you
# to type the container name first. Stop the app container before a production
# restore and start it again afterwards.
set -euo pipefail

dump="${1:?usage: tools/restore-db.sh <dump file> [postgres container]}"
container="${2:-streamour-staging-postgres}"
DB_USER="${DB_USER:-streamour}"
DB_NAME="${DB_NAME:-streamour}"

[ -r "$dump" ] || { echo "cannot read $dump" >&2; exit 1; }

if [ "$container" = "streamour-postgres" ]; then
  echo "This replaces the PRODUCTION database with $dump."
  read -r -p "Type the container name to continue: " answer
  [ "$answer" = "$container" ] || { echo "aborted"; exit 1; }
fi

# --clean --if-exists drops what the dump is about to recreate, so the result
# is the database as it was at backup time; one transaction, so a failed
# restore leaves the database as it was.
docker exec -i "$container" pg_restore -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --single-transaction < "$dump"

echo "restored $dump into $container"
docker exec "$container" psql -U "$DB_USER" -d "$DB_NAME" -tc \
  "select 'users: ' || count(*) from users union all select 'sessions: ' || count(*) from sessions"
