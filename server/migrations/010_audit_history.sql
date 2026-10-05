-- Structured, human-readable audit metadata for every OT event.
ALTER TABLE order_events
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS order_events_occurred_idx
  ON order_events (occurred_at DESC, id DESC);
