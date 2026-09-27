-- +goose Up
-- Datos regulatorios del producto: forma farmacéutica, registro sanitario ISP y condición de genérico.

ALTER TABLE products
    ADD COLUMN dosage_form TEXT CHECK (dosage_form IN (
        'comprimido', 'comprimido_recubierto', 'comprimido_efervescente', 'comprimido_masticable',
        'comprimido_liberacion_prolongada', 'capsula', 'capsula_blanda', 'jarabe', 'suspension_oral',
        'solucion_oral', 'gotas_orales', 'polvo_suspension_oral', 'granulado', 'solucion_inyectable',
        'polvo_inyectable', 'crema', 'gel', 'unguento', 'locion', 'solucion_topica', 'supositorio',
        'ovulo', 'aerosol_inhalacion', 'polvo_inhalacion', 'spray_nasal', 'solucion_oftalmica',
        'gotas_oticas', 'parche_transdermico', 'otro'
    )),
    -- Registro sanitario del ISP, ej. "F-12345/20". Una misma autorización puede cubrir varias
    -- presentaciones, por eso no es UNIQUE.
    ADD COLUMN isp_registry TEXT CHECK (isp_registry ~ '^[A-Z]{1,3}-[0-9]{1,6}/[0-9]{2,4}$'),
    ADD COLUMN is_generic BOOLEAN NOT NULL DEFAULT false;

-- Búsqueda exacta por registro ISP (lo usa el buscador de productos).
CREATE INDEX idx_products_isp_registry ON products (isp_registry) WHERE isp_registry IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_products_isp_registry;
ALTER TABLE products DROP COLUMN IF EXISTS is_generic, DROP COLUMN IF EXISTS isp_registry, DROP COLUMN IF EXISTS dosage_form;
