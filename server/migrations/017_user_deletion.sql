-- Remove account access without deleting the identity referenced by production and payment history.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_deleted_inactive_check
  CHECK (deleted_at IS NULL OR is_active = false);

-- A removed account keeps its historical email, but it no longer reserves that login address.
DROP INDEX users_email_unique;
CREATE UNIQUE INDEX users_email_unique ON users (lower(email)) WHERE deleted_at IS NULL;
