-- +goose Up
-- El número de lote pasa a ser opcional en el ingreso de mercadería (hay productos/insumos sin lote impreso).
-- Si se informa no puede ser una cadena vacía: "sin lote" se representa con NULL.
ALTER TABLE product_lots ALTER COLUMN lot_number DROP NOT NULL;
ALTER TABLE product_lots ADD CONSTRAINT product_lots_lot_number_not_blank CHECK (length(trim(lot_number)) > 0);

-- +goose Down
ALTER TABLE product_lots DROP CONSTRAINT IF EXISTS product_lots_lot_number_not_blank;
UPDATE product_lots SET lot_number = 'S/L' WHERE lot_number IS NULL;
ALTER TABLE product_lots ALTER COLUMN lot_number SET NOT NULL;
