-- Composite work is routed through its internal activities. Existing OTs retain
-- their original route and production state without rewriting operational history.
ALTER TABLE orders DROP CONSTRAINT orders_route_check;
ALTER TABLE orders ADD CONSTRAINT orders_route_check
  CHECK (route IN ('PRINT_ONLY', 'IMPRENTA', 'EXTERNO', 'WORKSHOP_ONLY', 'PRINT_WORKSHOP', 'MULTI_AREA'));
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('NEW', 'PENDING_ADMIN_REVIEW', 'IN_PRINTING', 'IN_EXTERNAL',
    'IN_WORKSHOP', 'IN_PRODUCTION', 'PENDING_INSTALLATION', 'COMPLETED', 'INSTALLED'));
ALTER TABLE orders DROP CONSTRAINT orders_printing_route_check;
ALTER TABLE orders ADD CONSTRAINT orders_printing_route_check CHECK (
  (route IN ('WORKSHOP_ONLY', 'EXTERNO', 'MULTI_AREA')
    AND material IS NULL AND length IS NULL AND width IS NULL)
  OR (route IN ('PRINT_ONLY', 'IMPRENTA', 'PRINT_WORKSHOP')
    AND material IS NOT NULL AND length > 0 AND length <= 100000
    AND width > 0 AND width <= 100000)
);
