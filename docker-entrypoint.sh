#!/bin/sh
# Apply pending database migrations, then start the app. A failed migration
# stops the container so a broken schema never serves traffic.
set -e

echo "Applying database migrations..."
node /prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma

exec "$@"
