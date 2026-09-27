-- +goose Up
-- Comisión por venta para vendedores.
-- La tasa se expresa en puntos básicos (1% = 100 bps) para usar solo aritmética entera: 2,5% = 250.
-- Base: venta NETA (sin IVA, tras descuentos). Tasa y monto se congelan en cada venta: cambiar la tasa
-- del usuario no altera comisiones pasadas. Las ventas anuladas no generan comisión (se excluyen en reportes).

ALTER TABLE users ADD COLUMN commission_bps INTEGER NOT NULL DEFAULT 0
    CHECK (commission_bps BETWEEN 0 AND 10000);

ALTER TABLE sales
    ADD COLUMN commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
    ADD COLUMN commission_amount BIGINT NOT NULL DEFAULT 0 CHECK (commission_amount >= 0);
ALTER TABLE sales ADD CONSTRAINT sales_commission_le_net CHECK (commission_amount <= net_amount);

-- Reporte de comisiones por vendedor y período.
CREATE INDEX idx_sales_user_created ON sales (user_id, created_at DESC) WHERE status = 'completada';

-- +goose Down
DROP INDEX IF EXISTS idx_sales_user_created;
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_commission_le_net,
    DROP COLUMN IF EXISTS commission_amount, DROP COLUMN IF EXISTS commission_bps;
ALTER TABLE users DROP COLUMN IF EXISTS commission_bps;
