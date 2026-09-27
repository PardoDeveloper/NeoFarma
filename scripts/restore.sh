#!/usr/bin/env bash
# Restaura un respaldo creado con backup.sh. ¡Reemplaza los datos actuales!
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Uso: scripts/restore.sh backups/archivo.dump}"
set -a; source .env; set +a
read -rp "Esto reemplazará los datos de la base actual con $FILE. ¿Continuar? (si/no) " ok
[[ "$ok" == "si" ]] || { echo "Cancelado"; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$FILE"
echo "Restauración completada"
