# Contrato de API — NeoFarma

Base: `http://localhost:8080/api` · JSON `snake_case` · Montos en **CLP enteros** (IVA incluido salvo `net_*`/`unit_cost`) · Fechas `AAAA-MM-DD`, timestamps RFC 3339.

Autenticación: `Authorization: Bearer <token>` (obtenido en `/auth/login`). Todas las rutas salvo login lo requieren.

**Errores**: `{"error": {"code": "string", "message": "string", "details": {...}}}`
| HTTP | code típico | Cuándo |
|---|---|---|
| 400 | `bad_request` | JSON mal formado, parámetros inválidos |
| 401 | `unauthorized` | Sin token / token inválido / credenciales |
| 403 | `forbidden` | Rol sin permiso |
| 404 | `not_found` | Recurso inexistente |
| 409 | `conflict` | Duplicado (RUT, SKU, documento, caja ya abierta) |
| 422 | `validation_error` (`details.fields`), `insufficient_stock`, `no_open_session`, `prescription_required`, `insufficient_payment`, `session_closed`, `already_voided`, `expired_lot`, ... | Regla de negocio |

**Listas paginadas**: query `page` (1..), `page_size` (1..100, def. 20) → `{"data": [], "total": n, "page": p, "page_size": s}`.

**Roles**: `admin` (todo), `quimico`, `cajero`, `bodega`. Columna *Roles* = roles permitidos además de admin.

## Sucursales (multi-local) — ver `docs/adr/0004-sucursales.md`
**Header `X-Branch-ID`** en todas las rutas operativas (`/products`, `/inventory`, `/purchases`, `/cash`, `/sales`, `/reports`, `/transfers`):
- `<id>`: el usuario debe pertenecer a esa sucursal (admin: cualquiera, incluso inactiva) → si no, `403 branch_forbidden`.
- `all`: solo admin, **solo lectura** (consolidado). Escrituras con `all` → `422 branch_required`.
- ausente: si el usuario tiene una única sucursal activa se usa esa; admin → `all`; otro caso → `422 branch_required`.
- Rutas globales sin header: `/auth`, `/users`, `/categories`, `/suppliers`, `/branches`.

Todo registro operativo incluye `branch_id` y `branch_name` (ventas, sesiones y cajas, ingresos, lotes, movimientos, rotación, traspasos). Leer un recurso de otra sucursal → `404` (no se revela que existe).
Venta: si la caja abierta del usuario es de otra sucursal → `422 branch_mismatch`.

| Método | Ruta | Roles | Notas |
|---|---|---|---|
| GET | `/branches` | todos | Sucursales accesibles: admin → todas (incl. inactivas); resto → sus sucursales activas. `{data: Branch[]}` |
| POST/PUT | `/branches`, `/branches/{id}` | admin | `{code (A-Z0-9_-), name, address?, phone?, active?}`. No se desactiva con cajas abiertas (`open_sessions`) |
| POST | `/cash/registers` | admin | Crea caja en la sucursal activa `{name, active?}` |
| PUT | `/cash/registers/{id}` | admin | Renombra/(des)activa caja de la sucursal activa |
| GET | `/transfers` | quimico, bodega | Traspasos enviados o recibidos por la sucursal (paginado) |
| GET | `/transfers/{id}` | quimico, bodega | Con `items[]` (404 si no involucra a la sucursal) |
| POST | `/transfers` | quimico, bodega | Desde la sucursal activa: `{to_branch_id, notes?, items: [{lot_id, quantity}]}`. Atómico; crea lote en destino (mismo N°, vencimiento y costo); movimientos `traspaso_salida`/`traspaso_entrada`. Errores: `same_branch`, `insufficient_stock`, `expired_lot`, `duplicate_lot`, `invalid_branch`, lote de otra sucursal → 404 |

`Branch = {id, code, name, address, phone, active, users, registers, created_at}`
`Transfer = {id, from_branch_id, from_branch_name, to_branch_id, to_branch_name, user_name, notes, items_count, units_count, created_at, items?: [{product_id, product_name, product_sku, lot_number, expiry_date, quantity, from_lot_id, to_lot_id}]}`
`User` incluye `branch_ids: number[]`; `POST/PUT /users` aceptan `branch_ids` (obligatorio ≥1 salvo admin → `branches_required`).
`SalesReport` incluye `by_branch: [{branch_id, branch_name, count, total}]`. Movimientos de stock: nuevos tipos `traspaso_salida`, `traspaso_entrada`.

## Auth
| Método | Ruta | Roles | Body / Query | Respuesta |
|---|---|---|---|---|
| POST | `/auth/login` | público | `{username, password}` | `{token, expires_at, user}` |
| GET | `/auth/me` | todos | | `User` |

## Usuarios (`/users`) — solo admin
| GET `/users` | | `{data: User[]}` |
|---|---|---|
| POST `/users` | `{username, full_name, password(>=8), role}` | `User` 201 |
| PUT `/users/{id}` | `{full_name, role, active, password?}` | `User` |

`User = {id, username, full_name, role, active, created_at}`

## Catálogo
| Método | Ruta | Roles | Notas |
|---|---|---|---|
| GET | `/categories` | todos | `{data: [{id, name, products}]}` |
| POST | `/categories` | quimico, bodega | `{name}` |
| GET | `/products` | todos | `q` (nombre, principio activo, laboratorio, SKU/código exacto), `category_id`, `low_stock=true`, `include_inactive=true` |
| GET | `/products/lookup?code=` | todos | Búsqueda exacta por código de barras o SKU (lector POS) |
| GET | `/products/{id}` | quimico, bodega | `Product` + `lots[]` (lotes con stock, orden FEFO) |
| POST/PUT | `/products`, `/products/{id}` | quimico, bodega | `ProductInput` |

`Product = {id, sku, barcode, name, active_ingredient, concentration, ingredients, dosage_form, presentation, isp_registry, laboratory, category_id, category_name, sale_condition, is_bioequivalent, is_generic, price, cost, min_stock, active, stock, stock_sellable, next_expiry, created_at, updated_at}`
**`cost` (costo neto de compra) se omite para el cajero** en `GET /products` y `/products/lookup`: solo recibe `price` (venta al público). `sale_condition ∈ directa | receta_simple | receta_retenida | receta_cheque`. `stock_sellable` excluye lotes vencidos.
- `dosage_form` (opcional) ∈ `comprimido | comprimido_recubierto | comprimido_efervescente | comprimido_masticable | comprimido_liberacion_prolongada | capsula | capsula_blanda | jarabe | suspension_oral | solucion_oral | gotas_orales | polvo_suspension_oral | granulado | solucion_inyectable | polvo_inyectable | crema | gel | unguento | locion | solucion_topica | supositorio | ovulo | aerosol_inhalacion | polvo_inhalacion | spray_nasal | solucion_oftalmica | gotas_oticas | parche_transdermico | otro`.
- `isp_registry` (opcional): registro sanitario ISP, formato `^[A-Z]{1,3}-\d{1,6}/\d{2,4}$` (ej. `F-12345/20`); se normaliza a mayúsculas sin espacios. `q` en `GET /products` también busca por registro ISP exacto.
- `is_generic`: medicamento genérico (independiente de `is_bioequivalent`).
- `ingredients`: composición, lista ordenada (máx. 10) de `{name, dose, unit}` — ej. `{"name": "Paracetamol", "dose": 325, "unit": "mg"}`. `dose` > 0 (decimal) y `unit` ∈ `mg | g | mcg | UI | ml | % | mg/ml | mg/5 ml | mcg/dosis | mEq` van juntos o ambos `null`. En `ProductInput` se envía `ingredients` (reemplaza la composición completa); `active_ingredient` y `concentration` son **solo lectura**: resumen generado por el backend (`"Paracetamol + Cafeína"`, `"325 mg + 32,5 mg"`) usado en búsqueda y listados. Errores por fila: `details.fields["ingredients[i].name"] = "unique"`, `details.fields["ingredients[i].unit"] = "oneof"`.
- Valores inválidos → 422 `validation_error` con `details.fields.dosage_form = "oneof"` / `details.fields.isp_registry = "format"`.

## Proveedores (`/suppliers`)
GET lista (`q`, `include_inactive`), GET `/{id}`, POST/PUT (quimico, bodega).
`Supplier = {id, rut, business_name, trade_name, contact_name, phone, email, address, payment_terms_days, notes, active, purchases_count, last_purchase_at, created_at}`. El RUT se valida (módulo 11) y se normaliza a `12345678-9`.

## Ingreso de mercadería (`/purchases`) — quimico, bodega
| GET `/purchases` | `supplier_id`, `q`, `from`, `to` | lista de `Purchase` |
|---|---|---|
| GET `/purchases/{id}` | | `Purchase` con `items[]` |
| POST `/purchases` | `{supplier_id, document_type: factura|guia_despacho|boleta, document_number, document_date, notes?, items: [{product_id, quantity, unit_cost (neto), lot_number?, expiry_date}]}` | `Purchase` 201 |

`lot_number` es **opcional** (vacío/ausente → `null`, "sin lote"; se normaliza a mayúsculas). En todas las respuestas `lot_number` puede ser `null`. Crea un lote por línea, registra movimiento `compra`, actualiza `products.cost`. Calcula `net_amount`, `tax_amount` (19%), `total_amount`. Rechaza lotes vencidos y documentos duplicados por proveedor.

## Inventario (`/inventory`) — quimico, bodega (el cajero no accede)
| GET `/inventory/lots` | `q`, `product_id`, `expiring_days`, `expired=true` | `LotView` (con `expiry_status`: vencido, critico ≤30d, proximo ≤90d, vigente) |
|---|---|---|
| GET `/inventory/movements` | `product_id`, `type` | ledger de movimientos |
| GET `/inventory/rotation` (**solo admin**) | `product_id`, `from`, `to` (AAAA-MM-DD, máx. 1 año) | Rotación/kardex: `{product_id, product_name, product_sku, barcode, from, to, opening_balance, total_in, total_out, closing_balance, truncated, rows: [{id, created_at, type, lot_number, reference_type, reference_id, document, user_name, notes, qty_in, qty_out, balance}]}`; `balance` = stock total tras el movimiento; máx. 5.000 filas (`truncated`) |
| POST `/inventory/adjustments` (quimico, bodega) | `{lot_id, type: ajuste_positivo|ajuste_negativo|merma, quantity>0, notes}` | 204 |

## Caja (`/cash`) — quimico, cajero
| GET `/cash/registers` | | `{data: [{id, name, active, open_session_id, open_session_user}]}` |
|---|---|---|
| GET `/cash/sessions/current` | | `{session: Session | null}` (sesión abierta del usuario) |
| GET `/cash/sessions` (**solo admin**) | `status` | historial: lista de `Session` con `summary` |
| GET `/cash/sessions/{id}` | | `Session` con `summary` y `movements`. Cada usuario solo su propia sesión (403 si es de otro); admin, cualquiera |
| POST `/cash/sessions` | `{register_id, opening_amount}` | abre caja (409 si la caja o el usuario ya tienen una abierta) |
| POST `/cash/sessions/{id}/movements` | `{type: ingreso|egreso, amount, reason}` | `Session` |
| POST `/cash/sessions/{id}/close` | `{counted_cash, notes?}` | `Session` cerrada con `expected_cash`, `counted_cash`, `difference` |

`Summary = {sales_count, voided_count, sales_total, by_method{efectivo,debito,credito,transferencia}, cash_in, cash_out, expected_cash}`; `expected_cash = opening + ventas en efectivo + ingresos − egresos`.

## Ventas (`/sales`) — quimico, cajero
| GET `/sales` | `from`, `to`, `status`, `payment_method`, `session_id`, `q` (n° venta, cliente) | lista de `Sale` |
|---|---|---|
| GET `/sales/{id}` | | `Sale` con `items[]` (incluye lotes consumidos) |
| POST `/sales` | `{payment_method, amount_paid, discount, customer_rut?, customer_name?, prescription_number?, prescriber_name?, items: [{product_id, quantity}]}` | `Sale` 201 |
| POST `/sales/{id}/void` (quimico) | `{reason}` | `Sale` anulada; restaura stock a los lotes originales |

**Alcance por rol**: el **cajero solo ve sus propias ventas** (lista filtrada por el servidor; `GET /sales/{id}` de una venta ajena → 404); químico y admin ven todas. Cada `Sale` incluye `user_id`. Reglas: requiere caja abierta del usuario; precios se toman de la BD; stock por FEFO excluyendo vencidos; receta retenida/cheque exige `prescription_number` y `prescriber_name`; efectivo exige `amount_paid >= total` y calcula `change_amount`; solo se anulan ventas de cajas abiertas.

## Reportes (`/reports`)
| GET `/reports/dashboard` | KPIs de hoy y del mes, valor de inventario, alertas, serie 14 días, top productos 30 días. Campo `scope`: `all` (químico, bodega, admin) u `own` (**cajero**: solo sus ventas de hoy/mes, ticket promedio, medios de pago de hoy y serie propia; inventario, margen, alertas y listas vienen en 0/vacíos) |
|---|---|
| GET `/reports/sales?from&to` (**químico, admin**) | totales, neto/IVA, margen, ticket promedio, por medio de pago, diario, top productos, por vendedor |
