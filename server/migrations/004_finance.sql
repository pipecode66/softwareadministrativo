-- Additive changes for orders already operating in production. Existing balances retain
-- their original financial rule; only newly created orders opt in to NEW.
ALTER TABLE clients ADD COLUMN special_payment boolean NOT NULL DEFAULT false;

ALTER TABLE orders ADD COLUMN financial_rule varchar(10) NOT NULL DEFAULT 'LEGACY'
  CONSTRAINT orders_financial_rule_check CHECK (financial_rule IN ('LEGACY', 'NEW'));
ALTER TABLE orders ADD COLUMN certificate_rete_fuente boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN certificate_rete_iva boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN certificate_ica boolean NOT NULL DEFAULT false;

-- Keep IMPRENTA valid for legacy requests still in flight. New requests use EXTERNO.
ALTER TABLE orders DROP CONSTRAINT orders_route_check;
ALTER TABLE orders ADD CONSTRAINT orders_route_check
  CHECK (route IN ('PRINT_ONLY', 'IMPRENTA', 'EXTERNO', 'WORKSHOP_ONLY', 'PRINT_WORKSHOP'));
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('NEW', 'PENDING_ADMIN_REVIEW', 'IN_PRINTING', 'IN_EXTERNAL',
    'IN_WORKSHOP', 'PENDING_INSTALLATION', 'COMPLETED', 'INSTALLED'));
ALTER TABLE orders DROP CONSTRAINT orders_check;
ALTER TABLE orders ADD CONSTRAINT orders_printing_route_check CHECK (
  (route IN ('WORKSHOP_ONLY', 'EXTERNO') AND material IS NULL AND length IS NULL AND width IS NULL)
  OR (route IN ('PRINT_ONLY', 'IMPRENTA', 'EXTERNO', 'PRINT_WORKSHOP')
      AND material IS NOT NULL AND length > 0 AND length <= 100000
      AND width > 0 AND width <= 100000)
);

ALTER TABLE payments ADD COLUMN method varchar(20) NOT NULL DEFAULT 'LEGACY'
  CONSTRAINT payments_method_check CHECK (method IN ('LEGACY','EFECTIVO','BANCOLOMBIA','DAVIVIENDA'));

CREATE TABLE bulk_payment_batches (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id),
  created_by uuid NOT NULL REFERENCES users(id),
  request_key uuid NOT NULL,
  fingerprint varchar(64) NOT NULL,
  date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method varchar(20) NOT NULL CHECK (method IN ('EFECTIVO','BANCOLOMBIA','DAVIVIENDA')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, request_key)
);
ALTER TABLE payments ADD COLUMN bulk_batch_id uuid REFERENCES bulk_payment_batches(id);
CREATE INDEX payments_bulk_batch_idx ON payments(bulk_batch_id) WHERE bulk_batch_id IS NOT NULL;
