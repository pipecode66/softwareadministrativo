ALTER TABLE orders
  ADD COLUMN invoice_reference varchar(100);

ALTER TABLE orders
  ADD CONSTRAINT orders_invoice_reference_check
  CHECK (invoice_reference IS NULL OR (document_type = 'FACT' AND length(trim(invoice_reference)) BETWEEN 1 AND 100));
