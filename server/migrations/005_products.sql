-- Additive commercial lines and internal work. Existing orders retain their
-- original pricing and route; each is represented by one legacy product.
CREATE TABLE order_products (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  position integer NOT NULL CHECK (position > 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_value numeric(14,2) NOT NULL CHECK (unit_value >= 0),
  line_total numeric(16,2) GENERATED ALWAYS AS (round(quantity * unit_value, 2)) STORED,
  specifications text NOT NULL DEFAULT '' CHECK (length(specifications) <= 10000),
  is_legacy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, position),
  UNIQUE (order_id, id)
);
CREATE INDEX order_products_order_idx ON order_products(order_id, position);

CREATE TABLE order_product_materials (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  material varchar(30) NOT NULL CHECK (material IN ('Panaflex','V. Corte','V. Impresión','Banner')),
  length numeric(9,3) NOT NULL CHECK (length > 0 AND length <= 100000),
  width numeric(9,3) NOT NULL CHECK (width > 0 AND width <= 100000),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id,product_id) REFERENCES order_products(order_id,id),
  UNIQUE(product_id,position)
);
CREATE INDEX order_product_materials_order_idx ON order_product_materials(order_id);
CREATE INDEX order_product_materials_consumed_idx ON order_product_materials(consumed_at) WHERE consumed_at IS NOT NULL;

CREATE TABLE order_activities (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  product_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  area varchar(12) NOT NULL CHECK (area IN ('DESIGN','PRINTING','WORKSHOP','EXTERNAL')),
  status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED')),
  assigned_user_id uuid REFERENCES users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id,product_id) REFERENCES order_products(order_id,id),
  UNIQUE(product_id,position),
  CHECK ((status = 'PENDING' AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'IN_PROGRESS' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL))
);
CREATE INDEX order_activities_area_status_idx ON order_activities(area,status);
CREATE INDEX order_activities_assigned_idx ON order_activities(assigned_user_id,status) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX order_activities_order_idx ON order_activities(order_id,product_id,position);

INSERT INTO order_products (id,order_id,position,description,quantity,unit_value,is_legacy)
SELECT md5(o.id::text || ':legacy-product')::uuid,o.id,1,o.description,1,o.value,true FROM orders o;

INSERT INTO order_product_materials (id,order_id,product_id,position,material,length,width,consumed_at)
SELECT md5(o.id::text || ':legacy-material')::uuid,o.id,p.id,1,o.material,o.length,o.width,o.printing_completed_at
FROM orders o JOIN order_products p ON p.order_id=o.id AND p.is_legacy=true
WHERE o.material IS NOT NULL;
