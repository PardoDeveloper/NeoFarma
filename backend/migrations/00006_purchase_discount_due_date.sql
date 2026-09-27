-- +goose Up
-- Ingreso de mercadería: fecha de vencimiento del documento y descuento global de la factura.
-- El descuento se aplica sobre el neto, antes del IVA (como el descuento global de la factura electrónica SII):
--   subtotal = Σ líneas · neto = subtotal − descuento · IVA = 19% del neto · total = neto + IVA.
-- document_date pasa a entenderse como "fecha de emisión"; created_at es la fecha de registro en el sistema.

ALTER TABLE purchases
    ADD COLUMN due_date DATE,
    ADD COLUMN subtotal_amount BIGINT,
    ADD COLUMN discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

-- Ingresos existentes: sin descuento, el subtotal es el neto.
UPDATE purchases SET subtotal_amount = net_amount;
ALTER TABLE purchases ALTER COLUMN subtotal_amount SET NOT NULL;
ALTER TABLE purchases
    ADD CONSTRAINT purchases_subtotal_check CHECK (subtotal_amount >= 0),
    ADD CONSTRAINT purchases_discount_le_subtotal CHECK (discount_amount <= subtotal_amount),
    ADD CONSTRAINT purchases_net_consistent CHECK (net_amount = subtotal_amount - discount_amount),
    ADD CONSTRAINT purchases_due_after_issue CHECK (due_date IS NULL OR due_date >= document_date);

-- Parte del descuento global asignada a cada línea (prorrateo por monto): trazabilidad del costo efectivo del lote.
ALTER TABLE purchase_items ADD COLUMN discount BIGINT NOT NULL DEFAULT 0 CHECK (discount >= 0);
ALTER TABLE purchase_items ADD CONSTRAINT purchase_items_discount_le_subtotal CHECK (discount <= subtotal);

-- +goose Down
ALTER TABLE purchase_items DROP CONSTRAINT IF EXISTS purchase_items_discount_le_subtotal, DROP COLUMN IF EXISTS discount;
ALTER TABLE purchases
    DROP CONSTRAINT IF EXISTS purchases_due_after_issue,
    DROP CONSTRAINT IF EXISTS purchases_net_consistent,
    DROP CONSTRAINT IF EXISTS purchases_discount_le_subtotal,
    DROP CONSTRAINT IF EXISTS purchases_subtotal_check,
    DROP COLUMN IF EXISTS discount_amount,
    DROP COLUMN IF EXISTS subtotal_amount,
    DROP COLUMN IF EXISTS due_date;
