-- +goose Up
-- Esquema inicial de NeoFarma.
-- Convenciones: montos en CLP enteros (BIGINT), cantidades en unidades (INTEGER),
-- stock por lote con ledger inmutable en stock_movements.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Usuarios --------------------------------------------------------------------
CREATE TABLE users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,40}$'),
    full_name     TEXT NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'quimico', 'cajero', 'bodega')),
    active        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Catálogo --------------------------------------------------------------------
CREATE TABLE categories (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut                TEXT NOT NULL UNIQUE,
    business_name      TEXT NOT NULL,
    trade_name         TEXT,
    contact_name       TEXT,
    phone              TEXT,
    email              TEXT,
    address            TEXT,
    payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    notes              TEXT,
    active             BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_suppliers_search ON suppliers USING gin ((business_name || ' ' || coalesce(trade_name, '') || ' ' || rut) gin_trgm_ops);

CREATE TABLE products (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku               TEXT NOT NULL UNIQUE,
    barcode           TEXT UNIQUE,
    name              TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
    active_ingredient TEXT,
    concentration     TEXT,
    presentation      TEXT,
    laboratory        TEXT,
    category_id       BIGINT REFERENCES categories (id) ON DELETE SET NULL,
    -- Condición de venta según ISP: directa, receta simple, receta retenida, receta cheque.
    sale_condition    TEXT NOT NULL DEFAULT 'directa'
                      CHECK (sale_condition IN ('directa', 'receta_simple', 'receta_retenida', 'receta_cheque')),
    is_bioequivalent  BOOLEAN NOT NULL DEFAULT false,
    price             BIGINT NOT NULL CHECK (price >= 0),        -- precio de venta con IVA
    cost              BIGINT NOT NULL DEFAULT 0 CHECK (cost >= 0), -- último costo unitario neto
    min_stock         INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
    active            BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_products_category ON products (category_id);
-- Búsqueda difusa por nombre / principio activo / laboratorio.
CREATE INDEX idx_products_search ON products USING gin (
    (name || ' ' || coalesce(active_ingredient, '') || ' ' || coalesce(laboratory, '')) gin_trgm_ops
);

-- Compras / ingreso de mercadería --------------------------------------------
CREATE TABLE purchases (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
    document_type   TEXT NOT NULL CHECK (document_type IN ('factura', 'guia_despacho', 'boleta')),
    document_number TEXT NOT NULL,
    document_date   DATE NOT NULL,
    user_id         BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    net_amount      BIGINT NOT NULL CHECK (net_amount >= 0),
    tax_amount      BIGINT NOT NULL CHECK (tax_amount >= 0),
    total_amount    BIGINT NOT NULL CHECK (total_amount >= 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (supplier_id, document_type, document_number)
);
CREATE INDEX idx_purchases_created ON purchases (created_at DESC);

CREATE TABLE product_lots (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id    BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    lot_number    TEXT NOT NULL,
    expiry_date   DATE NOT NULL,
    qty_initial   INTEGER NOT NULL CHECK (qty_initial > 0),
    qty_available INTEGER NOT NULL CHECK (qty_available >= 0),
    unit_cost     BIGINT NOT NULL CHECK (unit_cost >= 0),
    purchase_id   BIGINT REFERENCES purchases (id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- FEFO: lotes con stock de un producto ordenados por vencimiento.
CREATE INDEX idx_lots_fefo ON product_lots (product_id, expiry_date, id) WHERE qty_available > 0;
CREATE INDEX idx_lots_expiry ON product_lots (expiry_date) WHERE qty_available > 0;

CREATE TABLE purchase_items (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
    product_id  BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    lot_id      BIGINT NOT NULL REFERENCES product_lots (id) ON DELETE RESTRICT,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost   BIGINT NOT NULL CHECK (unit_cost >= 0),
    subtotal    BIGINT NOT NULL CHECK (subtotal >= 0)
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX idx_purchase_items_product ON purchase_items (product_id);

-- Caja ------------------------------------------------------------------------
CREATE TABLE cash_registers (
    id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE cash_sessions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    register_id     BIGINT NOT NULL REFERENCES cash_registers (id) ON DELETE RESTRICT,
    user_id         BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status          TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'cerrada')),
    opening_amount  BIGINT NOT NULL CHECK (opening_amount >= 0),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    expected_cash   BIGINT,
    counted_cash    BIGINT CHECK (counted_cash >= 0),
    difference      BIGINT,
    closing_notes   TEXT,
    CHECK ((status = 'abierta') = (closed_at IS NULL))
);
-- Una sola sesión abierta por caja y por usuario.
CREATE UNIQUE INDEX uq_cash_sessions_open_register ON cash_sessions (register_id) WHERE status = 'abierta';
CREATE UNIQUE INDEX uq_cash_sessions_open_user ON cash_sessions (user_id) WHERE status = 'abierta';
CREATE INDEX idx_cash_sessions_opened ON cash_sessions (opened_at DESC);

CREATE TABLE cash_movements (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES cash_sessions (id) ON DELETE RESTRICT,
    type       TEXT NOT NULL CHECK (type IN ('ingreso', 'egreso')),
    amount     BIGINT NOT NULL CHECK (amount > 0),
    reason     TEXT NOT NULL,
    user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_movements_session ON cash_movements (session_id);

-- Ventas ----------------------------------------------------------------------
CREATE TABLE sales (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id          BIGINT NOT NULL REFERENCES cash_sessions (id) ON DELETE RESTRICT,
    user_id             BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status              TEXT NOT NULL DEFAULT 'completada' CHECK (status IN ('completada', 'anulada')),
    payment_method      TEXT NOT NULL CHECK (payment_method IN ('efectivo', 'debito', 'credito', 'transferencia')),
    subtotal            BIGINT NOT NULL CHECK (subtotal >= 0), -- suma de líneas antes de descuento global
    discount            BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total               BIGINT NOT NULL CHECK (total >= 0),
    net_amount          BIGINT NOT NULL CHECK (net_amount >= 0),
    tax_amount          BIGINT NOT NULL CHECK (tax_amount >= 0),
    amount_paid         BIGINT NOT NULL CHECK (amount_paid >= 0),
    change_amount       BIGINT NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
    customer_rut        TEXT,
    customer_name       TEXT,
    prescription_number TEXT,
    prescriber_name     TEXT,
    voided_at           TIMESTAMPTZ,
    voided_by           BIGINT REFERENCES users (id) ON DELETE RESTRICT,
    void_reason         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (discount <= subtotal),
    CHECK ((status = 'anulada') = (voided_at IS NOT NULL))
);
CREATE INDEX idx_sales_created ON sales (created_at DESC);
CREATE INDEX idx_sales_session ON sales (session_id);

CREATE TABLE sale_items (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_id    BIGINT NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity   INTEGER NOT NULL CHECK (quantity > 0),
    unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
    unit_cost  BIGINT NOT NULL CHECK (unit_cost >= 0), -- costo promedio de lotes consumidos (margen)
    total      BIGINT NOT NULL CHECK (total >= 0)
);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX idx_sale_items_product ON sale_items (product_id);

-- Qué lotes consumió cada línea (necesario para restaurar stock al anular).
CREATE TABLE sale_item_lots (
    sale_item_id BIGINT NOT NULL REFERENCES sale_items (id) ON DELETE CASCADE,
    lot_id       BIGINT NOT NULL REFERENCES product_lots (id) ON DELETE RESTRICT,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (sale_item_id, lot_id)
);

-- Ledger de inventario --------------------------------------------------------
CREATE TABLE stock_movements (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id     BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    lot_id         BIGINT NOT NULL REFERENCES product_lots (id) ON DELETE RESTRICT,
    type           TEXT NOT NULL CHECK (type IN ('compra', 'venta', 'anulacion_venta', 'ajuste_positivo', 'ajuste_negativo', 'merma')),
    quantity       INTEGER NOT NULL CHECK (quantity <> 0), -- con signo: + entra, - sale
    reference_type TEXT,
    reference_id   BIGINT,
    user_id        BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, created_at DESC);
CREATE INDEX idx_stock_movements_lot ON stock_movements (lot_id);

-- Stock actual por producto (derivado de lotes; excluye vencidos del "vendible").
CREATE VIEW product_stock AS
SELECT p.id AS product_id,
       coalesce(sum(l.qty_available), 0)::INTEGER AS stock_total,
       coalesce(sum(l.qty_available) FILTER (WHERE l.expiry_date >= current_date), 0)::INTEGER AS stock_sellable,
       min(l.expiry_date) FILTER (WHERE l.qty_available > 0 AND l.expiry_date >= current_date) AS next_expiry
FROM products p
LEFT JOIN product_lots l ON l.product_id = p.id AND l.qty_available > 0
GROUP BY p.id;

-- +goose Down
DROP VIEW IF EXISTS product_stock;
DROP TABLE IF EXISTS stock_movements, sale_item_lots, sale_items, sales, cash_movements,
    cash_sessions, cash_registers, purchase_items, product_lots, purchases, products,
    suppliers, categories, users;
DROP FUNCTION IF EXISTS set_updated_at();
