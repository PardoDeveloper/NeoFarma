#!/usr/bin/env bash
# Levanta API (Go, :8080) y frontend (Vite, :5173) en modo desarrollo. Ctrl+C detiene ambos.
# Equivale a `make dev` para entornos sin make.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' SIGINT SIGTERM EXIT
(cd backend && go run ./cmd/api) &
(cd frontend && npm run dev) &
wait
