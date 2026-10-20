#!/bin/sh
set -eu

mkdir -p "${STORAGE_ROOT}/public" "${STORAGE_ROOT}/private"

attempt=1
while ! ./node_modules/.bin/prisma migrate deploy; do
  if [ "$attempt" -ge 12 ]; then
    echo "No se pudo aplicar migraciones después de ${attempt} intentos." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 5
done

./node_modules/.bin/tsx scripts/migrate-tenants.ts

if [ ! -s "${STORAGE_ROOT}/public/reference.glb" ] || [ ! -s "${STORAGE_ROOT}/public/dress-M.glb" ] || [ ! -s "${STORAGE_ROOT}/public/skirt-M.glb" ]; then
  "${PYTHON_PATH}" workers/avatar/process.py --demo "${STORAGE_ROOT}/public"
fi

mkdir -p "${STORAGE_ROOT}/public/catalog-women"
cp -n catalog-assets/women/*.jpg "${STORAGE_ROOT}/public/catalog-women/"

if [ "${RUN_DB_SEED:-true}" = "true" ]; then
  ./node_modules/.bin/tsx scripts/seed.ts
fi

exec node dist/api/main.js
