#!/usr/bin/env bash
# Respaldo de la base de datos con pg_dump (formato custom, comprimido). Conserva los últimos 14.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p backups
FILE="backups/neo_farma_$(date +%Y%m%d_%H%M%S).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$FILE"
echo "Respaldo creado: $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t backups/*.dump | tail -n +15 | xargs -r rm --
