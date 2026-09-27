# NeoFarma — tareas de desarrollo. Ejecute `make help` para ver los objetivos.
SHELL := /bin/bash
include .env
export

COMPOSE ?= podman compose

.PHONY: help setup dev backend frontend migrate seed seed-reset test test-backend test-frontend e2e lint build backup restore up down clean

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Instala dependencias (Go y npm)
	cd backend && go mod download
	cd frontend && npm ci

dev: ## Levanta backend y frontend en modo desarrollo (Ctrl+C detiene ambos)
	@trap 'kill 0' SIGINT SIGTERM EXIT; \
	(cd backend && go run ./cmd/api) & \
	(cd frontend && npm run dev) & \
	wait

backend: ## Levanta solo la API (http://localhost:8080)
	cd backend && go run ./cmd/api

frontend: ## Levanta solo el frontend (http://localhost:5173)
	cd frontend && npm run dev

migrate: ## Aplica migraciones pendientes
	cd backend && go run ./cmd/seed -migrate-only

seed: ## Carga datos de demostración (si la BD está vacía)
	cd backend && go run ./cmd/seed

seed-reset: ## BORRA todos los datos y recarga la demo
	cd backend && go run ./cmd/seed -reset

test: test-backend test-frontend ## Ejecuta todas las pruebas

test-backend: ## Pruebas Go (unitarias + integración contra TEST_DATABASE_URL)
	cd backend && go vet ./... && go test -count=1 -p 1 ./...

test-frontend: ## Pruebas y typecheck del frontend
	cd frontend && npm run typecheck && npm test

e2e: ## Prueba E2E de la API (requiere la API corriendo)
	./scripts/e2e.sh

lint: ## Linters
	cd backend && gofmt -l . | (! grep .) && go vet ./...
	cd frontend && npm run lint

build: ## Compila binario Go y bundle del frontend
	cd backend && CGO_ENABLED=0 go build -ldflags='-s -w' -o bin/api ./cmd/api
	cd frontend && npm run build

backup: ## Respaldo de la BD en backups/ (formato custom de pg_dump)
	./scripts/backup.sh

restore: ## Restaura un respaldo: make restore FILE=backups/xxx.dump
	./scripts/restore.sh $(FILE)

up: ## Levanta todo en contenedores (Postgres propio + API + web) → http://localhost:8081
	$(COMPOSE) up -d --build

down: ## Detiene los contenedores
	$(COMPOSE) down

clean: ## Borra artefactos de build
	rm -rf backend/bin frontend/dist
