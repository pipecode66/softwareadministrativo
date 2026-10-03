-- INTERMEDIOS GESTION - REINICIO TOTAL PARA ENTREGA (2026-10-03)
--
-- ADVERTENCIA: esta consulta elimina de forma irreversible todos los datos
-- comerciales y operativos, sin importar su fecha. Ejecutarla manualmente en
-- el SQL Editor de Supabase solo despues de crear un respaldo y detener
-- temporalmente el uso del aplicativo.
--
-- Elimina: clientes, OT, pagos, cartera, eventos, productos, materiales,
-- actividades de produccion, lotes de multiabono y borradores.
-- Los reportes y estadisticas quedan en cero porque se calculan desde esos datos.
--
-- Conserva: usuarios, sesiones, bloqueos del sistema e historial de migraciones.
-- La proxima OT creada sera la numero 1. Este archivo no pertenece a migrations
-- y nunca se ejecuta automaticamente durante un despliegue.

BEGIN;

DO $reset$
DECLARE
  users_before bigint;
  sessions_before bigint;
  locks_before bigint;
  order_sequence text;
  sequence_last_value bigint;
  sequence_is_called boolean;
BEGIN
  -- Respeta el mismo orden de bloqueo usado por autenticacion y administracion
  -- de usuarios. Despues impide cambios concurrentes en cuentas y sesiones
  -- mientras TRUNCATE bloquea por si mismo todas las tablas comerciales.
  PERFORM id FROM public.system_locks
  WHERE id = 'user-management'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro el bloqueo de administracion de usuarios. Se revierte la operacion.';
  END IF;

  LOCK TABLE public.users, public.sessions IN SHARE MODE;

  SELECT count(*) INTO users_before FROM public.users;
  SELECT count(*) INTO sessions_before FROM public.sessions;
  SELECT count(*) INTO locks_before FROM public.system_locks;

  -- La lista es intencionalmente explicita y no usa CASCADE. Si en el futuro
  -- aparece una dependencia desconocida, PostgreSQL abortara y revertira todo.
  TRUNCATE TABLE
    public.order_product_materials,
    public.order_activities,
    public.order_products,
    public.payments,
    public.order_events,
    public.orders,
    public.bulk_payment_batches,
    public.clients,
    public.order_drafts
  RESTART IDENTITY;

  -- Se declara tambien de forma explicita para garantizar que la primera OT
  -- real posterior a la entrega reciba el numero 1, nunca el numero 0.
  ALTER TABLE public.orders ALTER COLUMN number RESTART WITH 1;

  IF EXISTS (
    SELECT 1 FROM public.order_product_materials
    UNION ALL SELECT 1 FROM public.order_activities
    UNION ALL SELECT 1 FROM public.order_products
    UNION ALL SELECT 1 FROM public.payments
    UNION ALL SELECT 1 FROM public.order_events
    UNION ALL SELECT 1 FROM public.orders
    UNION ALL SELECT 1 FROM public.bulk_payment_batches
    UNION ALL SELECT 1 FROM public.clients
    UNION ALL SELECT 1 FROM public.order_drafts
  ) THEN
    RAISE EXCEPTION 'El reinicio no dejo vacias todas las tablas comerciales. Se revierte la operacion.';
  END IF;

  IF users_before <> (SELECT count(*) FROM public.users)
     OR sessions_before <> (SELECT count(*) FROM public.sessions)
     OR locks_before <> (SELECT count(*) FROM public.system_locks) THEN
    RAISE EXCEPTION 'Usuarios, sesiones o bloqueos del sistema cambiaron. Se revierte la operacion.';
  END IF;

  SELECT pg_get_serial_sequence('public.orders', 'number')
  INTO order_sequence;

  IF order_sequence IS NULL THEN
    RAISE EXCEPTION 'No se encontro la secuencia del consecutivo de OT. Se revierte la operacion.';
  END IF;

  EXECUTE format('SELECT last_value, is_called FROM %s', order_sequence)
  INTO sequence_last_value, sequence_is_called;

  IF sequence_last_value <> 1 OR sequence_is_called THEN
    RAISE EXCEPTION 'El consecutivo de OT no quedo reiniciado en 1. Se revierte la operacion.';
  END IF;

  RAISE NOTICE 'Reinicio completado: datos comerciales en cero; % usuarios y % sesiones conservados; proxima OT: 1.',
    users_before,
    sessions_before;
END
$reset$;

COMMIT;

-- Verificacion visible en el SQL Editor. Todos los contadores comerciales deben
-- ser 0 y siguiente_numero_ot debe ser 1.
SELECT
  (SELECT count(*) FROM public.clients) AS clientes,
  (SELECT count(*) FROM public.orders) AS ordenes,
  (SELECT count(*) FROM public.payments) AS pagos,
  (SELECT count(*) FROM public.bulk_payment_batches) AS lotes_multiabono,
  (SELECT count(*) FROM public.order_products) AS productos,
  (SELECT count(*) FROM public.order_product_materials) AS materiales,
  (SELECT count(*) FROM public.order_activities) AS actividades,
  (SELECT count(*) FROM public.order_events) AS eventos,
  (SELECT count(*) FROM public.order_drafts) AS borradores,
  (SELECT count(*) FROM public.users) AS usuarios_conservados,
  (SELECT count(*) FROM public.sessions) AS sesiones_conservadas,
  COALESCE((SELECT max(number) + 1 FROM public.orders), 1) AS siguiente_numero_ot;
