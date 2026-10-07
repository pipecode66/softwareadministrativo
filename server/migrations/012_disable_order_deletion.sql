-- Order deletion and renumbering were discarded. Keep numbering exclusively
-- server-assigned and prevent ordinary UPDATE statements from changing it.
ALTER TABLE orders
  ALTER COLUMN number SET GENERATED ALWAYS;
