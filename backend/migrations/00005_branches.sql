-- +goose Up
-- Multi-sucursal (ver docs/adr/0004-sucursales.md).
-- Todo dato operativo (lotes, movimientos, cajas, ventas, ingresos) pasa a pertenecer a una sucursal.
-- Las claves foráneas compuestas (id, branch_id) impiden a nivel de BD mezclar datos entre sucursales:
-- p. ej. una venta de la sucursal A no puede referenciar un lote de la sucursal B.
-- Los datos existentes se asignan a la sucursal "Casa Matriz".

CREATE TABLE branches (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
    name       TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 80),
    address    TEXT,
    phone      TEXT,
    active     BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_branches_updated BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO branches (code, name) VALUES ('MATRIZ', 'Casa Matriz');

-- Sucursales en que trabaja cada usuario (el admin accede a todas sin necesidad de asignación).
CREATE TABLE user_branches (
    user_id   BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    branch_id BIGINT NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX idx_user_branches_branch ON user_branches (branch_id);
INSERT INTO user_branches (user_id, branch_id) SELECT id, (SELECT id FROM branches WHERE code = 'MATRIZ') FROM users;

-- Cajas ---------------------------------------------------------------------------------------------
ALTER TABLE cash_registers ADD COLUMN branch_id BIGINT REFERENCES branches (id) ON DELETE RESTRICT;
UPDATE cash_registers SET branch_id = (SELECT id FROM branches WHERE code = 'MATRIZ');
ALTER TABLE cash_registers ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE cash_registers DROP CONSTRAINT cash_registers_name_key;
ALTER TABLE cash_registers ADD CONSTRAINT cash_registers_branch_name_key UNIQUE (branch_id, name);
ALTER TABLE cash_registers ADD CONSTRAINT cash_registers_id_branch_key UNIQUE (id, branch_id);

ALTER TABLE cash_sessions ADD COLUMN branch_id BIGINT;
UPDATE cash_sessions cs SET branch_id = r.branch_id FROM cash_registers r WHERE r.id = cs.register_id;
ALTER TABLE cash_sessions ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_register_branch_fkey
    FOREIGN KEY (register_id, branch_id) REFERENCES cash_registers (id, branch_id) ON DELETE RESTRICT;
ALTER TABLE cash_sessions ADD CONSTRAINT cash_sessions_id_branch_key UNIQUE (id, branch_id);
CREATE INDEX idx_cash_sessions_branch ON cash_sessions (branch_id, opened_at DESC);

-- Ingresos de mercadería ----------------------------------------------------------------------------
ALTER TABLE purchases ADD COLUMN branch_id BIGINT REFERENCES branches (id) ON DELETE RESTRICT;
UPDATE purchases SET branch_id = (SELECT id FROM branches WHERE code = 'MATRIZ');
ALTER TABLE purchases ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE purchases ADD CONSTRAINT purchases_id_branch_key UNIQUE (id, branch_id);
CREATE INDEX idx_purchases_branch ON purchases (branch_id, created_at DESC);

-- Lotes ---------------------------------------------------------------------------------------------
ALTER TABLE product_lots ADD COLUMN branch_id BIGINT REFERENCES branches (id) ON DELETE RESTRICT;
UPDATE product_lots SET branch_id = (SELECT id FROM branches WHERE code = 'MATRIZ');
ALTER TABLE product_lots ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE product_lots ADD CONSTRAINT product_lots_id_branch_key UNIQUE (id, branch_id);
-- Un lote nacido de un ingreso pertenece a la misma sucursal del ingreso.
ALTER TABLE product_lots ADD CONSTRAINT product_lots_purchase_branch_fkey
    FOREIGN KEY (purchase_id, branch_id) REFERENCES purchases (id, branch_id) ON DELETE RESTRICT;
DROP INDEX idx_lots_fefo;
DROP INDEX idx_lots_expiry;
CREATE INDEX idx_lots_fefo ON product_lots (branch_id, product_id, expiry_date, id) WHERE qty_available > 0;
CREATE INDEX idx_lots_expiry ON product_lots (branch_id, expiry_date) WHERE qty_available > 0;

ALTER TABLE purchase_items ADD COLUMN branch_id BIGINT;
UPDATE purchase_items pi SET branch_id = p.branch_id FROM purchases p WHERE p.id = pi.purchase_id;
ALTER TABLE purchase_items ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_purchase_branch_fkey
    FOREIGN KEY (purchase_id, branch_id) REFERENCES purchases (id, branch_id) ON DELETE CASCADE;
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_lot_branch_fkey
    FOREIGN KEY (lot_id, branch_id) REFERENCES product_lots (id, branch_id) ON DELETE RESTRICT;

-- Ventas --------------------------------------------------------------------------------------------
ALTER TABLE sales ADD COLUMN branch_id BIGINT;
UPDATE sales s SET branch_id = cs.branch_id FROM cash_sessions cs WHERE cs.id = s.session_id;
ALTER TABLE sales ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE sales ADD CONSTRAINT sales_session_branch_fkey
    FOREIGN KEY (session_id, branch_id) REFERENCES cash_sessions (id, branch_id) ON DELETE RESTRICT;
ALTER TABLE sales ADD CONSTRAINT sales_id_branch_key UNIQUE (id, branch_id);
CREATE INDEX idx_sales_branch ON sales (branch_id, created_at DESC);

ALTER TABLE sale_items ADD COLUMN branch_id BIGINT;
UPDATE sale_items si SET branch_id = s.branch_id FROM sales s WHERE s.id = si.sale_id;
ALTER TABLE sale_items ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_sale_branch_fkey
    FOREIGN KEY (sale_id, branch_id) REFERENCES sales (id, branch_id) ON DELETE CASCADE;
ALTER TABLE sale_items ADD CONSTRAINT sale_items_id_branch_key UNIQUE (id, branch_id);

ALTER TABLE sale_item_lots ADD COLUMN branch_id BIGINT;
UPDATE sale_item_lots sil SET branch_id = si.branch_id FROM sale_items si WHERE si.id = sil.sale_item_id;
ALTER TABLE sale_item_lots ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE sale_item_lots ADD CONSTRAINT sale_item_lots_item_branch_fkey
    FOREIGN KEY (sale_item_id, branch_id) REFERENCES sale_items (id, branch_id) ON DELETE CASCADE;
ALTER TABLE sale_item_lots ADD CONSTRAINT sale_item_lots_lot_branch_fkey
    FOREIGN KEY (lot_id, branch_id) REFERENCES product_lots (id, branch_id) ON DELETE RESTRICT;

-- Traspasos entre sucursales ------------------------------------------------------------------------
CREATE TABLE transfers (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_branch_id BIGINT NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    to_branch_id   BIGINT NOT NULL REFERENCES branches (id) ON DELETE RESTRICT,
    user_id        BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_branch_id <> to_branch_id),
    UNIQUE (id, from_branch_id, to_branch_id)
);
CREATE INDEX idx_transfers_from ON transfers (from_branch_id, created_at DESC);
CREATE INDEX idx_transfers_to ON transfers (to_branch_id, created_at DESC);

CREATE TABLE transfer_items (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transfer_id    BIGINT NOT NULL,
    from_branch_id BIGINT NOT NULL,
    to_branch_id   BIGINT NOT NULL,
    product_id     BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    from_lot_id    BIGINT NOT NULL,
    to_lot_id      BIGINT NOT NULL,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    FOREIGN KEY (transfer_id, from_branch_id, to_branch_id)
        REFERENCES transfers (id, from_branch_id, to_branch_id) ON DELETE CASCADE,
    FOREIGN KEY (from_lot_id, from_branch_id) REFERENCES product_lots (id, branch_id) ON DELETE RESTRICT,
    FOREIGN KEY (to_lot_id, to_branch_id) REFERENCES product_lots (id, branch_id) ON DELETE RESTRICT
);
CREATE INDEX idx_transfer_items_transfer ON transfer_items (transfer_id);

-- Ledger de inventario ------------------------------------------------------------------------------
ALTER TABLE stock_movements ADD COLUMN branch_id BIGINT;
UPDATE stock_movements m SET branch_id = l.branch_id FROM product_lots l WHERE l.id = m.lot_id;
ALTER TABLE stock_movements ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_lot_branch_fkey
    FOREIGN KEY (lot_id, branch_id) REFERENCES product_lots (id, branch_id) ON DELETE RESTRICT;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN (
    'compra', 'venta', 'anulacion_venta', 'ajuste_positivo', 'ajuste_negativo', 'merma',
    'traspaso_salida', 'traspaso_entrada'));
CREATE INDEX idx_stock_movements_branch ON stock_movements (branch_id, product_id, created_at DESC);

-- El stock ahora se calcula por sucursal en las consultas; la vista global deja de existir.
DROP VIEW product_stock;

-- +goose Down
CREATE VIEW product_stock AS
SELECT p.id AS product_id,
       coalesce(sum(l.qty_available), 0)::INTEGER AS stock_total,
       coalesce(sum(l.qty_available) FILTER (WHERE l.expiry_date >= current_date), 0)::INTEGER AS stock_sellable,
       min(l.expiry_date) FILTER (WHERE l.qty_available > 0 AND l.expiry_date >= current_date) AS next_expiry
FROM products p
LEFT JOIN product_lots l ON l.product_id = p.id AND l.qty_available > 0
GROUP BY p.id;

DROP INDEX IF EXISTS idx_stock_movements_branch;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
DELETE FROM stock_movements WHERE type IN ('traspaso_salida', 'traspaso_entrada');
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN (
    'compra', 'venta', 'anulacion_venta', 'ajuste_positivo', 'ajuste_negativo', 'merma'));
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_lot_branch_fkey, DROP COLUMN branch_id;

DROP TABLE transfer_items;
DROP TABLE transfers;

ALTER TABLE sale_item_lots DROP CONSTRAINT sale_item_lots_lot_branch_fkey, DROP CONSTRAINT sale_item_lots_item_branch_fkey, DROP COLUMN branch_id;
ALTER TABLE sale_items DROP CONSTRAINT sale_items_id_branch_key, DROP CONSTRAINT sale_items_sale_branch_fkey, DROP COLUMN branch_id;
DROP INDEX IF EXISTS idx_sales_branch;
ALTER TABLE sales DROP CONSTRAINT sales_id_branch_key, DROP CONSTRAINT sales_session_branch_fkey, DROP COLUMN branch_id;

ALTER TABLE purchase_items DROP CONSTRAINT purchase_items_lot_branch_fkey, DROP CONSTRAINT purchase_items_purchase_branch_fkey, DROP COLUMN branch_id;
DROP INDEX IF EXISTS idx_lots_fefo;
DROP INDEX IF EXISTS idx_lots_expiry;
ALTER TABLE product_lots DROP CONSTRAINT product_lots_purchase_branch_fkey, DROP CONSTRAINT product_lots_id_branch_key, DROP COLUMN branch_id;
CREATE INDEX idx_lots_fefo ON product_lots (product_id, expiry_date, id) WHERE qty_available > 0;
CREATE INDEX idx_lots_expiry ON product_lots (expiry_date) WHERE qty_available > 0;

DROP INDEX IF EXISTS idx_purchases_branch;
ALTER TABLE purchases DROP CONSTRAINT purchases_id_branch_key, DROP COLUMN branch_id;

DROP INDEX IF EXISTS idx_cash_sessions_branch;
ALTER TABLE cash_sessions DROP CONSTRAINT cash_sessions_id_branch_key, DROP CONSTRAINT cash_sessions_register_branch_fkey, DROP COLUMN branch_id;
ALTER TABLE cash_registers DROP CONSTRAINT cash_registers_id_branch_key, DROP CONSTRAINT cash_registers_branch_name_key, DROP COLUMN branch_id;
ALTER TABLE cash_registers ADD CONSTRAINT cash_registers_name_key UNIQUE (name);

DROP TABLE user_branches;
DROP TABLE branches;
