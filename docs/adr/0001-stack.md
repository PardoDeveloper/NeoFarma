# ADR 0001 — Stack tecnológico

**Estado:** aceptado · 2026-09-25

## Decisión
- **Backend Go** con `chi` + `pgx` (SQL explícito, sin ORM) y migraciones `goose` embebidas en el binario.
- **Frontend React + Vite (SPA)** en lugar de Next.js.
- **Dinero en CLP enteros (`BIGINT`/`int64`)**; precios de venta con IVA incluido; neto = round(total / 1,19).

## Motivos
- Es un sistema **interno detrás de login**: no requiere SEO ni SSR. Una SPA compila a estáticos servibles por nginx, sin servidor Node en producción, y ofrece navegación instantánea en el POS.
- SQL explícito da control total sobre bloqueos (`FOR UPDATE`) y rendimiento en operaciones críticas (ventas, cierres).
- El peso chileno no tiene decimales: enteros eliminan errores de redondeo de punto flotante.

## Consecuencias
- El contrato `docs/api.md` + `frontend/src/api/types.ts` se mantienen a mano (sin codegen). Si el API crece mucho, evaluar OpenAPI + generación de tipos.
