# NeoFarma — Sistema de gestión de farmacias

Sistema interno para farmacias (Chile): punto de venta, caja, inventario por lotes con vencimientos, ingreso de mercadería, proveedores, reportes y usuarios con roles.

| Capa | Tecnología |
|---|---|
| Backend | Go 1.27 · chi · pgx v5 · goose (migraciones embebidas) · JWT · slog |
| Frontend | React 19 · Vite · TypeScript estricto · TanStack Query · React Router · Tailwind v4 · Recharts |
| Base de datos | PostgreSQL 18 (`neo_farma`, pruebas en `neo_farma_test`) |
| Contenedores | Dockerfiles multi-stage + `compose.yaml` (Podman/Docker) |

## Inicio rápido (local)

Requisitos: Go, Node 20+, PostgreSQL con la BD `neo_farma` (dueño `admin`).

```bash
cp .env.example .env            # ya existe un .env configurado en esta máquina
cd frontend && npm ci && cd ..
cd backend && go run ./cmd/seed && cd ..   # migraciones + datos demo
./scripts/dev.sh                # API :8080 + web :5173   (o `make dev`)
```

Abrir **http://localhost:5173**. Usuarios demo (clave `neofarma123`):

| Usuario | Rol | Puede |
|---|---|---|
| `admin` | Administrador | Todo, incluida la gestión de usuarios |
| `quimico` | Químico farmacéutico | Ventas, anulaciones, caja, inventario, compras, reportes |
| `cajero` / `cajero2` | Cajero | Punto de venta, caja, historial de ventas |
| `bodega` | Bodega | Productos, proveedores, ingresos, ajustes de stock |

> `make` no viene instalado en Fedora: `sudo dnf install make`. Todos los objetivos tienen equivalente directo (ver `Makefile`).

## Módulos

- **Punto de venta** — optimizado para teclado y lector de código de barras (F2 buscar, F4 cobrar, F8 vaciar, 1-4 medio de pago). Stock por **FEFO** (primero en vencer, primero en salir), excluye lotes vencidos, exige N° de receta para productos con receta retenida/cheque, calcula vuelto con montos sugeridos y emite comprobante imprimible (80 mm).
- **Caja** — apertura con fondo, ingresos/egresos, arqueo por denominación (billetes y monedas CLP), cierre con diferencia (faltante/sobrante) e historial de cierres.
- **Ventas** — historial con filtros, detalle con lotes consumidos, reimpresión y **anulación** (solo químico/admin) que devuelve el stock a los lotes originales.
- **Productos** — catálogo con principio activo, laboratorio, condición de venta (ISP), bioequivalencia, margen y stock mínimo.
- **Stock y vencimientos** — lotes con estado (vencido, crítico ≤30 d, próximo ≤90 d), ledger de movimientos y ajustes/mermas.
- **Ingreso de mercadería** — factura/guía del proveedor con líneas por lote y vencimiento; calcula neto/IVA/total y actualiza costos.
- **Proveedores** — con validación de RUT (módulo 11).
- **Reportes** — ventas por período, margen bruto, ticket promedio, medios de pago, top productos, ventas por vendedor, exportación CSV.
- **Multi-sucursal** — cada local tiene su stock, cajas, ventas e ingresos; catálogo, precios y proveedores son compartidos. Selector de sucursal en la barra superior (el admin ve además el consolidado "Todas", de solo lectura). **Traspasos** entre sucursales con trazabilidad por lote, y administración de **Sucursales** y sus cajas. La base de datos impide mezclar datos entre sucursales (claves foráneas compuestas). Ver `docs/adr/0004-sucursales.md`.
- **Dashboard** — KPIs del día/mes, inventario valorizado y alertas.

## Pruebas

```bash
cd backend && go test -count=1 -p 1 ./...    # unitarias + integración (usa TEST_DATABASE_URL)
cd frontend && npm test && npm run typecheck && npm run lint
./scripts/e2e.sh                               # E2E de API contra la API en ejecución
```

Las pruebas de integración cubren: flujo completo venta→anulación→cierre, FEFO, recetas, lotes vencidos, validaciones de compra, ajustes, **ventas concurrentes sin sobreventa** y permisos por rol vía HTTP. Además verifican que el stock de cada lote coincida con su ledger de movimientos.

## Estructura

```
backend/
  cmd/api          servidor HTTP          cmd/seed   datos demo / migraciones
  internal/<mod>   users, catalog, suppliers, inventory, purchases, cash, sales, reports
  internal/platform  db, httpx (JSON/errores/paginación), auth (JWT/roles), apperr, money (IVA), rut
  migrations/      SQL goose embebido en el binario
frontend/src/
  api/             cliente HTTP, tipos (espejo de docs/api.md), endpoints
  components/ui    design system (Button, Input, Modal, Table, Badge, ...)
  features/<mod>   pantallas por módulo
docs/              api.md (contrato), adr/ (decisiones)
.claude/agents/    agentes especializados del equipo
```

## Operación

```bash
./scripts/backup.sh                          # respaldo pg_dump en backups/ (conserva 14)
./scripts/restore.sh backups/archivo.dump    # restauración (pide confirmación)
cd backend && go run ./cmd/seed -reset       # BORRA y recarga datos demo
podman compose up -d --build                 # todo en contenedores → http://localhost:8081
```

## Agentes de desarrollo (Claude Code)

Definidos en `.claude/agents/`: `tech-lead`, `ux-ui-designer`, `frontend-react`, `backend-go`, `postgres-expert`, `qa-testing`, `devops`. Skills de diseño en `.claude/skills/` (`neofarma-design-system`, `neofarma-ux-review`); el sistema de diseño está documentado en `docs/design-system.md`. Invócalos con `/agents` o pidiendo, por ejemplo, *"usa el agente qa-testing para probar el módulo de caja"*.
