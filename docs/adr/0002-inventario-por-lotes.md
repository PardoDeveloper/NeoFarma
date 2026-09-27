# ADR 0002 — Inventario por lotes con ledger

**Estado:** aceptado · 2026-09-25

## Decisión
- El stock vive en `product_lots` (un lote por línea de ingreso, con vencimiento). No existe un campo "stock" editable en productos: la vista `product_stock` lo deriva.
- Todo cambio de stock inserta un registro inmutable en `stock_movements` (compra, venta, anulación, ajuste, merma). Invariante verificada en tests: `qty_available = Σ movimientos del lote`.
- Las ventas consumen **FEFO** y bloquean los lotes con `SELECT … FOR UPDATE`, procesando productos ordenados por id para evitar deadlocks. `sale_item_lots` registra qué lotes consumió cada línea para restaurarlos exactamente al anular.
- Los lotes vencidos no son vendibles (`stock_sellable`) y se retiran con una merma.

## Consecuencias
- Trazabilidad completa exigible en farmacia (qué lote se vendió a quién y cuándo).
- Una venta toca varias tablas: siempre en una transacción.
