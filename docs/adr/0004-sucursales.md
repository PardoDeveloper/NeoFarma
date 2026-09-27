# ADR 0004 — Multi-sucursal

**Estado:** aceptado · 2026-09-26

## Contexto
Una farmacia (ej. "Farmacia Estrella") opera varios locales. Cada local tiene su propio stock, cajas, ventas e ingresos,
pero comparten catálogo, precios, proveedores y personal administrativo. El requisito crítico: **ningún dato de una
sucursal puede mezclarse con el de otra** (stock, caja, ventas) y la migración no debe corromper lo existente.

Alcance: **una organización con N sucursales** (no multi-empresa). Multi-empresa sería otro ADR.

## Modelo

| Global (compartido) | Por sucursal (`branch_id NOT NULL`) |
|---|---|
| productos, composición, categorías, precios | lotes (`product_lots`) y su stock |
| proveedores | movimientos de stock (`stock_movements`) |
| usuarios | cajas (`cash_registers`), sesiones y movimientos de caja |
| | ventas (`sales`), ingresos de mercadería (`purchases`) |
| | traspasos (origen y destino) |

- Tabla `branches (id, code, name, address, phone, active)`.
- `user_branches (user_id, branch_id)`: sucursales donde trabaja cada usuario. El **admin accede a todas** sin asignación.

## Integridad en la base de datos (defensa en profundidad)
No basta con filtrar en el código: la BD impide mezclar sucursales mediante **claves foráneas compuestas**
`(id, branch_id)`:
- `cash_sessions (register_id, branch_id) → cash_registers (id, branch_id)`
- `sales (session_id, branch_id) → cash_sessions (id, branch_id)`
- `purchase_items (purchase_id, branch_id) → purchases (id, branch_id)` y `(lot_id, branch_id) → product_lots (id, branch_id)`
- `stock_movements (lot_id, branch_id) → product_lots (id, branch_id)`
- `sale_item_lots (lot_id, branch_id) → product_lots` y `(sale_item_id, branch_id) → sale_items`, que a su vez referencia `sales (id, branch_id)`.

Así, una venta de la sucursal A **no puede** descontar un lote de la sucursal B aunque haya un bug en el código.

## Contexto de sucursal en la API
- El frontend envía la sucursal activa en el header `X-Branch-ID` en cada request.
- Un middleware lo valida contra `user_branches` (o rol admin) → `403` si el usuario no pertenece a esa sucursal.
- El admin puede usar `X-Branch-ID: all` **solo para lecturas** (dashboard, reportes, listados consolidados).
  Toda escritura (vender, abrir caja, ingresar mercadería, ajustar, traspasar) exige una sucursal concreta → `422 branch_required`.
- Un usuario con una sola sucursal la usa automáticamente.
- La venta usa la sucursal de la **caja abierta** del usuario; si no coincide con la sucursal activa → `422 branch_mismatch`.

## Traspasos entre sucursales
`POST /transfers`: mueve unidades de lotes de la sucursal activa a otra sucursal en **una transacción**:
descuenta el lote de origen (`FOR UPDATE`), crea el lote en destino (mismo N° de lote, vencimiento y costo),
y registra `traspaso_salida` / `traspaso_entrada` en el ledger. El stock total de la organización no cambia.

## Migración de datos existentes
1. Se crea la sucursal **"Casa Matriz"** (código `MATRIZ`) y todos los datos existentes se asignan a ella.
2. Todos los usuarios quedan asignados a Casa Matriz.
3. Se verifica con consultas de control que cada lote, venta, sesión y movimiento tenga sucursal y que el ledger siga cuadrando.
Respaldo previo: `backups/neo_farma_20260926_232243.dump`.

## Frontend
- Selector de sucursal en la barra superior (admin: sucursales + "Todas"); al cambiar se **vacía la caché** de datos para no mostrar información de otra sucursal.
- Páginas de escritura muestran "Seleccione una sucursal" cuando el admin está en "Todas".
- Nuevas páginas: **Sucursales** (admin) y **Traspasos** (químico, bodega, admin). Usuarios: asignación de sucursales.

## Fuera de alcance (futuro)
Precios distintos por sucursal, traspasos con estado "en tránsito"/recepción, multi-empresa.
