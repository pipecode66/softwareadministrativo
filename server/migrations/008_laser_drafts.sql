-- Printing work can be either regular material printing or laser cutting.
-- Existing printing activities retain their current behaviour.
ALTER TABLE order_activities ADD COLUMN printing_type varchar(10);
ALTER TABLE order_activities ADD COLUMN laser_minutes integer;

UPDATE order_activities SET printing_type = 'PRINT' WHERE area = 'PRINTING';

ALTER TABLE order_activities ADD CONSTRAINT order_activities_printing_type_check CHECK (
  (area = 'PRINTING' AND printing_type IN ('PRINT', 'LASER'))
  OR (area <> 'PRINTING' AND printing_type IS NULL)
);
ALTER TABLE order_activities ADD CONSTRAINT order_activities_laser_minutes_check CHECK (
  (printing_type = 'LASER' AND (laser_minutes IS NULL OR laser_minutes BETWEEN 1 AND 999999999))
  OR (printing_type IS DISTINCT FROM 'LASER' AND laser_minutes IS NULL)
);
ALTER TABLE order_activities ADD CONSTRAINT order_activities_completed_laser_check CHECK (
  printing_type IS DISTINCT FROM 'LASER' OR status <> 'COMPLETED' OR laser_minutes IS NOT NULL
);

-- Composite laser work has no legacy top-level material. The API continues to
-- require a material for non-composite regular printing.
ALTER TABLE orders DROP CONSTRAINT orders_printing_route_check;
ALTER TABLE orders ADD CONSTRAINT orders_printing_route_check CHECK (
  (route IN ('WORKSHOP_ONLY', 'EXTERNO', 'MULTI_AREA')
    AND material IS NULL AND length IS NULL AND width IS NULL)
  OR (route IN ('PRINT_ONLY', 'IMPRENTA', 'PRINT_WORKSHOP') AND (
    (material IS NULL AND length IS NULL AND width IS NULL)
    OR (material IS NOT NULL AND length > 0 AND length <= 100000
      AND width > 0 AND width <= 100000)
  ))
);

-- A zero commercial base is valid only for laser work; that cross-table rule is
-- enforced transactionally by the API when the order is created or edited.
ALTER TABLE orders DROP CONSTRAINT orders_value_check;
ALTER TABLE orders ADD CONSTRAINT orders_value_check CHECK (value >= 0);

-- One autosaved, incomplete order form per creator. Drafts never consume an OT
-- number and are not included in sales, portfolio or production tables.
CREATE TABLE order_drafts (
  created_by uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Browser-facing Supabase roles must never read this table directly. The API's
-- database role owns access and additionally scopes every query by created_by.
ALTER TABLE order_drafts ENABLE ROW LEVEL SECURITY;
