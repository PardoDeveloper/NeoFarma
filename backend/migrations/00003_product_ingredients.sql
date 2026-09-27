-- +goose Up
-- Composición del producto: N principios activos, cada uno con dosis y unidad (ej. Paracetamol 325 mg).
-- products.active_ingredient y products.concentration se conservan como resumen desnormalizado
-- ("Paracetamol + Cafeína", "325 mg + 30 mg") que mantiene el servicio, usado por búsqueda y listados.

CREATE TABLE product_ingredients (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    position   SMALLINT NOT NULL CHECK (position > 0),
    name       TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
    dose       NUMERIC(12, 4) CHECK (dose > 0),
    unit       TEXT CHECK (unit IN ('mg', 'g', 'mcg', 'UI', 'ml', '%', 'mg/ml', 'mg/5 ml', 'mcg/dosis', 'mEq')),
    -- Dosis y unidad van juntas: ambas o ninguna.
    CHECK ((dose IS NULL) = (unit IS NULL)),
    UNIQUE (product_id, position)
);
CREATE INDEX idx_product_ingredients_name ON product_ingredients USING gin (name gin_trgm_ops);

-- Migra el principio activo existente, separando "500 mg" en dosis 500 y unidad mg cuando el formato lo permite.
INSERT INTO product_ingredients (product_id, position, name, dose, unit)
SELECT p.id, 1, p.active_ingredient,
       CASE WHEN x.m IS NOT NULL THEN replace(x.m[1], ',', '.')::numeric END,
       CASE WHEN x.m IS NOT NULL THEN
           CASE lower(replace(x.m[2], ' ', ''))
               WHEN 'mg/5ml' THEN 'mg/5 ml'
               WHEN 'ui' THEN 'UI'
               WHEN 'meq' THEN 'mEq'
               ELSE lower(replace(x.m[2], ' ', ''))
           END
       END
FROM products p
CROSS JOIN LATERAL (
    SELECT regexp_match(coalesce(p.concentration, ''),
        '^\s*([0-9]+(?:[.,][0-9]+)?)\s*(mg/5 ?ml|mg/ml|mcg/dosis|mcg|mg|g|ui|ml|%|meq)\s*$', 'i') AS m
) x
WHERE p.active_ingredient IS NOT NULL AND length(trim(p.active_ingredient)) >= 2;

-- +goose Down
DROP TABLE IF EXISTS product_ingredients;
