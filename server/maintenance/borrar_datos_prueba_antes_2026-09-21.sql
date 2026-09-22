-- INTERMEDIOS GESTION - LIMPIEZA FINAL DE LA SEMANA DE PRUEBA
--
-- Ejecutar manualmente en el SQL Editor de Supabase con un usuario administrador,
-- despues de crear un respaldo. Este archivo NO pertenece a migrations y por eso
-- nunca se ejecuta automaticamente durante un despliegue.
--
-- Corte fijo: 2026-09-21 00:00:00 en America/Bogota (2026-09-21 05:00:00 UTC).
-- Se eliminan las OT anteriores al corte, sus datos dependientes, lotes de
-- multiabono que queden huerfanos y clientes antiguos sin datos conservados.
-- Se preservan usuarios, sesiones y cualquier OT/cliente que siga referenciado
-- desde el corte. Si no queda ninguna OT, el siguiente consecutivo vuelve a 1.

BEGIN;

LOCK TABLE
  public.clients,
  public.orders,
  public.order_products,
  public.order_product_materials,
  public.order_activities,
  public.bulk_payment_batches,
  public.payments,
  public.order_events
IN EXCLUSIVE MODE;

DO $cleanup$
DECLARE
  cutoff CONSTANT timestamptz :=
    TIMESTAMP '2026-09-21 00:00:00' AT TIME ZONE 'America/Bogota';
  users_before bigint;
  sessions_before bigint;
  doomed_batch_ids uuid[];
  deleted_materials bigint := 0;
  deleted_activities bigint := 0;
  deleted_products bigint := 0;
  deleted_payments bigint := 0;
  deleted_events bigint := 0;
  deleted_orders bigint := 0;
  deleted_batches bigint := 0;
  deleted_clients bigint := 0;
BEGIN
  SELECT count(*) INTO users_before FROM public.users;
  SELECT count(*) INTO sessions_before FROM public.sessions;

  SELECT coalesce(array_agg(DISTINCT p.bulk_batch_id), ARRAY[]::uuid[])
  INTO doomed_batch_ids
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE o.created_at < cutoff
    AND p.bulk_batch_id IS NOT NULL;

  DELETE FROM public.order_product_materials m
  USING public.orders o
  WHERE m.order_id = o.id
    AND o.created_at < cutoff;
  GET DIAGNOSTICS deleted_materials = ROW_COUNT;

  DELETE FROM public.order_activities a
  USING public.orders o
  WHERE a.order_id = o.id
    AND o.created_at < cutoff;
  GET DIAGNOSTICS deleted_activities = ROW_COUNT;

  DELETE FROM public.order_products p
  USING public.orders o
  WHERE p.order_id = o.id
    AND o.created_at < cutoff;
  GET DIAGNOSTICS deleted_products = ROW_COUNT;

  DELETE FROM public.payments p
  USING public.orders o
  WHERE p.order_id = o.id
    AND o.created_at < cutoff;
  GET DIAGNOSTICS deleted_payments = ROW_COUNT;

  DELETE FROM public.order_events e
  USING public.orders o
  WHERE e.order_id = o.id
    AND o.created_at < cutoff;
  GET DIAGNOSTICS deleted_events = ROW_COUNT;

  DELETE FROM public.orders
  WHERE created_at < cutoff;
  GET DIAGNOSTICS deleted_orders = ROW_COUNT;

  DELETE FROM public.bulk_payment_batches b
  WHERE NOT EXISTS (
      SELECT 1 FROM public.payments p WHERE p.bulk_batch_id = b.id
    )
    AND (b.created_at < cutoff OR b.id = ANY(doomed_batch_ids));
  GET DIAGNOSTICS deleted_batches = ROW_COUNT;

  DELETE FROM public.clients c
  WHERE c.created_at < cutoff
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o WHERE o.client_id = c.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bulk_payment_batches b WHERE b.client_id = c.id
    );
  GET DIAGNOSTICS deleted_clients = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM public.orders WHERE created_at < cutoff) THEN
    RAISE EXCEPTION 'La limpieza no retiro todas las OT anteriores al corte.';
  END IF;

  IF users_before <> (SELECT count(*) FROM public.users)
     OR sessions_before <> (SELECT count(*) FROM public.sessions) THEN
    RAISE EXCEPTION 'La cantidad de usuarios o sesiones cambio. Se revierte la limpieza.';
  END IF;

  PERFORM setval(
    pg_get_serial_sequence('public.orders', 'number'),
    COALESCE((SELECT max(number) FROM public.orders), 1),
    EXISTS (SELECT 1 FROM public.orders)
  );

  RAISE NOTICE 'Limpieza completada: % OT, % pagos, % eventos, % productos, % materiales, % actividades, % lotes y % clientes eliminados.',
    deleted_orders,
    deleted_payments,
    deleted_events,
    deleted_products,
    deleted_materials,
    deleted_activities,
    deleted_batches,
    deleted_clients;
END
$cleanup$;

COMMIT;

-- Resultado de verificacion. La primera columna debe ser 0.
SELECT
  count(*) FILTER (
    WHERE created_at < TIMESTAMP '2026-09-21 00:00:00'
      AT TIME ZONE 'America/Bogota'
  ) AS ordenes_anteriores_restantes,
  count(*) AS ordenes_conservadas,
  COALESCE(max(number) + 1, 1) AS siguiente_numero_ot
FROM public.orders;
