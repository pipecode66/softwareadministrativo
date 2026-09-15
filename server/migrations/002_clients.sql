CREATE TABLE clients (
  id uuid PRIMARY KEY,
  name varchar(180) NOT NULL CHECK (name = btrim(name) AND length(name) > 0),
  identification varchar(60) NOT NULL DEFAULT '' CHECK (identification = btrim(identification)),
  phone varchar(40) NOT NULL DEFAULT '' CHECK (phone = btrim(phone)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The name index also supports stable alphabetical pagination.
CREATE INDEX clients_name_order ON clients (lower(name), id);
