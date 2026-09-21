-- Optional job dimensions are distinct from printing material usage.
-- Existing products remain valid without dimensions; Externo never requires them.
ALTER TABLE order_products ADD COLUMN length numeric(9,3);
ALTER TABLE order_products ADD COLUMN width numeric(9,3);
ALTER TABLE order_products ADD CONSTRAINT order_products_dimensions_check CHECK (
  (length IS NULL AND width IS NULL)
  OR (length IS NOT NULL AND width IS NOT NULL
    AND length > 0 AND length <= 100000 AND width > 0 AND width <= 100000)
);
