-- Personal installer workflow. No OT renumbering, deletion or commercial changes.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('ADMINMASTER','ADMIN_GENERAL','APOYO_COMERCIAL','DISENO','IMPRESION','TALLER','INSTALADOR'));

CREATE TABLE installation_teams (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL CHECK (length(trim(name))>0),
  leader_id uuid NOT NULL REFERENCES users(id),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX installation_teams_name_idx ON installation_teams(lower(name));
CREATE TABLE installation_team_members (
  team_id uuid NOT NULL REFERENCES installation_teams(id),
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY(team_id,user_id)
);
CREATE TABLE installation_team_events (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES installation_teams(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE installation_team_requests (
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  team_id uuid NOT NULL REFERENCES installation_teams(id),
  fingerprint varchar(64) NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);

CREATE TABLE installations (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  installer_id uuid REFERENCES users(id),
  team_id uuid REFERENCES installation_teams(id),
  team_name varchar(120),
  status varchar(16) NOT NULL CHECK (status IN ('PENDING','ASSIGNED','IN_PROGRESS','PAUSED','POSTPONED','COMPLETED')),
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  address text NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 1000),
  contact_name varchar(120) NOT NULL DEFAULT '',
  contact_phone varchar(80) NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 4000),
  started_at timestamptz,
  completed_at timestamptz,
  active_since timestamptz,
  work_seconds numeric(14,3) NOT NULL DEFAULT 0 CHECK (work_seconds >= 0),
  result text CHECK (length(result) <= 4000),
  checklist jsonb,
  location_exception boolean NOT NULL DEFAULT false,
  location_exception_reason text CHECK (length(location_exception_reason) <= 2000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  cycle integer NOT NULL DEFAULT 1 CHECK (cycle > 0),
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK (status NOT IN ('ASSIGNED','IN_PROGRESS','PAUSED','COMPLETED') OR installer_id IS NOT NULL),
  CHECK ((status = 'IN_PROGRESS') = (active_since IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (NOT location_exception OR length(trim(location_exception_reason)) > 0)
);
CREATE INDEX installations_installer_status_idx ON installations(installer_id,status);
CREATE INDEX installations_schedule_idx ON installations(scheduled_start_at,id);

CREATE TABLE installation_members (
  installation_id uuid NOT NULL REFERENCES installations(id),
  cycle integer NOT NULL CHECK (cycle>0),
  user_id uuid NOT NULL REFERENCES users(id),
  is_current boolean NOT NULL DEFAULT true,
  status varchar(16) NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','IN_PROGRESS','PAUSED','CHECKED_OUT')),
  arrived_at timestamptz,
  checked_out_at timestamptz,
  active_since timestamptz,
  work_seconds numeric(14,3) NOT NULL DEFAULT 0 CHECK (work_seconds>=0),
  PRIMARY KEY(installation_id,cycle,user_id),
  CHECK ((status='IN_PROGRESS')=(active_since IS NOT NULL)),
  CHECK (status<>'CHECKED_OUT' OR checked_out_at IS NOT NULL)
);
CREATE INDEX installation_members_user_idx ON installation_members(user_id,installation_id) WHERE is_current;

CREATE TABLE installation_events (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(40) NOT NULL,
  from_status varchar(16),
  to_status varchar(16) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX installation_events_history_idx ON installation_events(installation_id,occurred_at DESC,id DESC);

CREATE TABLE installation_evidence (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id),
  cycle integer NOT NULL CHECK (cycle > 0),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 4 AND 163840),
  mime_type varchar(20) NOT NULL DEFAULT 'image/jpeg' CHECK (mime_type = 'image/jpeg'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX installation_evidence_latest_idx ON installation_evidence(installation_id,cycle,created_at DESC,id DESC);

CREATE TABLE installation_requests (
  actor_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES installations(id),
  fingerprint varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_id)
);

-- Access is mediated by the authenticated server. Never expose GPS or images
-- directly to Supabase anon/authenticated clients.
ALTER TABLE installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_team_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_team_requests ENABLE ROW LEVEL SECURITY;
