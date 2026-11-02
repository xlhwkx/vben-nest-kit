#!/bin/sh
set -e
# Optional migrate before listen (compose.prod default true).
if [ "${RUN_MIGRATE_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy"
  if [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma migrate deploy
  else
    pnpm exec prisma migrate deploy
  fi
fi
exec "$@"
