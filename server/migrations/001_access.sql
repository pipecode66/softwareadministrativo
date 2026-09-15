CREATE TABLE system_locks (
  id varchar(60) PRIMARY KEY
);
INSERT INTO system_locks (id) VALUES ('user-management');

CREATE TABLE users (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  email varchar(160) NOT NULL CHECK (email = lower(btrim(email))),
  password_hash varchar(255) NOT NULL,
  role varchar(30) NOT NULL CHECK (role IN ('ADMINMASTER', 'ADMIN_GENERAL', 'DISENO', 'IMPRESION', 'TALLER')),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE sessions (
  token_hash varchar(64) PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token varchar(64) NOT NULL CHECK (length(csrf_token) = 64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
