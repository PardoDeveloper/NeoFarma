# NeoFarma

Sistema interno de gestión de farmacias (Chile). Ver `README.md` para arranque y `docs/api.md` para el contrato de API (fuente de verdad entre backend y frontend).

## Comandos
- Backend: `cd backend && go run ./cmd/api` · tests `go test -count=1 -p 1 ./...` (integración usa `TEST_DATABASE_URL` → `neo_farma_test`; los tests TRUNCAN esa BD).
- Frontend: `cd frontend && npm run dev` · `npm run typecheck && npm run lint && npm test`.
- Demo: `cd backend && go run ./cmd/seed -reset` (borra y recarga `neo_farma`).
- E2E: `./scripts/e2e.sh` con la API corriendo. `make` no está instalado en este equipo; usar `scripts/`.

## Base de datos
- PostgreSQL local nativo. La app se conecta por TCP como rol `admin` (credenciales en `.env`, no versionado). El rol `c4rp4rd0` es superusuario y entra por socket sin clave: `psql -d neo_farma`.
- Nuevas migraciones: `backend/migrations/0000N_nombre.sql` (goose, con `Up` y `Down`), se aplican al iniciar la API.

## Multi-sucursal (ver docs/adr/0004-sucursales.md) — reglas obligatorias
- Todo dato operativo (lotes, movimientos, cajas/sesiones, ventas, ingresos, traspasos) tiene `branch_id`; catálogo, proveedores y usuarios son globales.
- Rutas operativas pasan por `branch.Middleware` (header `X-Branch-ID`). Lecturas: `branch.FromContext(ctx).ID` (nil = consolidado, solo admin). Escrituras: `branch.Require(ctx)`.
- Servicios reciben la sucursal explícita; toda consulta filtra por ella y un recurso de otra sucursal responde 404. Nuevas tablas operativas: `branch_id NOT NULL` + FK compuestas `(id, branch_id)` como en la migración 00005.
- `inventory.Record` exige la sucursal del lote. Frontend: `useBranch()` / `RequireBranch`; nunca armar el header a mano (lo hace `api/client.ts`).
- Entorno demo multi-sucursal: BD `neo_farma_demo` (`go run ./cmd/seed -reset` con `DATABASE_URL` apuntando a ella), API `HTTP_ADDR=:8081`, web `API_URL=http://localhost:8081 npx vite --port 5174`; capturas con `--base http://localhost:5174 --branch <id|all>`. E2E: `BRANCH=2 ./scripts/e2e.sh http://localhost:8081/api`.

## Convenciones
- Montos CLP enteros (`int64`/`BIGINT`), precios con IVA 19% incluido; usar `internal/platform/money`.
- Stock solo cambia vía lotes + `inventory.Record` (ledger). Operaciones multi-tabla dentro de `db.WithTx`.
- Errores de dominio con `apperr` (código + mensaje en español); nunca exponer errores internos.
- Cada módulo backend es `internal/<modulo>/<modulo>.go` (modelo + servicio con SQL + handler). Separar en archivos cuando crezca.
- Frontend: UI en español, primitivas en `components/ui` (usar `cn()` para clases), estado de servidor solo en TanStack Query, tipos en `src/api/types.ts` alineados con `docs/api.md`.

## Diseño / UI
- Sistema de diseño "clínico cálido": `docs/design-system.md` (API de primitivas) y catálogo vivo en `/design` (solo dev). Tokens semánticos (`bg-surface`, `text-ink`, `border-line`, `ok/warn/danger/info/rx-*`); prohibido `slate-*`/`gray-*`/`bg-white` (lo vigila `src/test/design-tokens.test.ts`).
- Skills del proyecto: `neofarma-design-system` y `neofarma-ux-review` (`.claude/skills/`).
- Capturas para revisión visual: `cd frontend && node scripts/shots.mjs --user quimico [--dark] [--mobile] /ruta ...` → `.shots/`.

## Agentes
`.claude/agents/`: tech-lead (orquesta y mantiene el contrato), ux-ui-designer (dueño del sistema de diseño, `components/ui` y `layout`), frontend-react, backend-go, postgres-expert, qa-testing, devops.
