-- Records who receives completed printing work in Taller. Historical completed
-- work remains valid; the API requires it when the IMPRESION profile completes printing.
ALTER TABLE order_activities ADD COLUMN received_by_workshop varchar(200);
ALTER TABLE order_activities ADD CONSTRAINT order_activities_received_by_workshop_check
  CHECK (received_by_workshop IS NULL OR length(btrim(received_by_workshop)) BETWEEN 1 AND 200);

-- Legacy orders without internal activities keep the same handoff information
-- on their parent production stage.
ALTER TABLE orders ADD COLUMN printing_received_by_workshop varchar(200);
ALTER TABLE orders ADD CONSTRAINT orders_printing_received_by_workshop_check
  CHECK (printing_received_by_workshop IS NULL
    OR length(btrim(printing_received_by_workshop)) BETWEEN 1 AND 200);
