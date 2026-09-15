CREATE TABLE orders (
  id uuid PRIMARY KEY,
  number integer GENERATED ALWAYS AS IDENTITY (START WITH 1) UNIQUE NOT NULL CHECK (number > 0),
  client_id uuid NOT NULL REFERENCES clients(id),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 10000),
  value numeric(14,2) NOT NULL CHECK (value > 0),
  document_type varchar(4) NOT NULL CHECK (document_type IN ('REM','FACT')),
  category varchar(30) NOT NULL CHECK (category IN ('SuperGiros','Carro Vallas','Proyecto','Otras')),
  route varchar(20) NOT NULL CHECK (route IN ('PRINT_ONLY','WORKSHOP_ONLY','PRINT_WORKSHOP')),
  requires_installation boolean NOT NULL,
  status varchar(30) NOT NULL CHECK (status IN ('NEW','PENDING_ADMIN_REVIEW','IN_PRINTING','IN_WORKSHOP','PENDING_INSTALLATION','COMPLETED','INSTALLED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  material varchar(30) CHECK (material IN ('Panaflex','Vinilo','V. Corte','V. Impresión','Banner')),
  length numeric(9,3), width numeric(9,3),
  rete_fuente numeric(14,2) NOT NULL DEFAULT 0 CHECK (rete_fuente >= 0),
  rete_iva numeric(14,2) NOT NULL DEFAULT 0 CHECK (rete_iva >= 0),
  ica numeric(14,2) NOT NULL DEFAULT 0 CHECK (ica >= 0),
  printing_completed_at timestamptz,
  workshop_started_at timestamptz,
  ready_for_installation_at timestamptz,
  installed_at timestamptz,
  installation_note text CHECK (length(installation_note) <= 2000),
  closed_at timestamptz,
  creation_key uuid NOT NULL,
  creation_fingerprint varchar(64) NOT NULL,
  CONSTRAINT orders_creation_idempotency UNIQUE(created_by, creation_key),
  CHECK ((route = 'WORKSHOP_ONLY' AND material IS NULL AND length IS NULL AND width IS NULL)
    OR (route <> 'WORKSHOP_ONLY' AND material IS NOT NULL AND length > 0 AND length <= 100000 AND width > 0 AND width <= 100000)),
  CHECK (document_type = 'FACT' OR (rete_fuente = 0 AND rete_iva = 0 AND ica = 0)),
  CHECK (installed_at IS NULL OR (requires_installation AND status = 'INSTALLED')),
  CHECK (closed_at IS NULL OR status IN ('COMPLETED','INSTALLED'))
);
CREATE INDEX orders_created_at_idx ON orders(created_at);
CREATE INDEX orders_client_idx ON orders(client_id);
CREATE INDEX orders_creator_idx ON orders(created_by);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_printing_completed_idx ON orders(printing_completed_at) WHERE printing_completed_at IS NOT NULL;

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request_key uuid NOT NULL,
  UNIQUE(order_id, request_key)
);
CREATE INDEX payments_order_idx ON payments(order_id);
CREATE INDEX payments_date_idx ON payments(date);

CREATE TABLE order_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(30) NOT NULL,
  from_status varchar(30), to_status varchar(30) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events(order_id, occurred_at);
