import { createHash } from 'node:crypto';
import type { Database, SqlConnection } from '../db/types.js';

export const CLEANUP_TIME_ZONE = 'America/Bogota';

export interface CleanupCounts {
  orders: number;
  payments: number;
  orderEvents: number;
  orderProducts: number;
  orderProductMaterials: number;
  orderActivities: number;
  bulkPaymentBatches: number;
  clients: number;
}

export interface CleanupPlan {
  cutoff: string;
  cutoffDate: string;
  timeZone: typeof CLEANUP_TIME_ZONE;
  delete: CleanupCounts;
  preserve: {
    users: number;
    sessions: number;
    orders: number;
    clients: number;
    clientsOlderThanCutoff: number;
    bulkPaymentBatches: number;
  };
  nextOrderNumber: number;
  /** Opaque identity snapshot; intentionally not printed by the CLI. */
  snapshotFingerprint: string;
}

interface PreviewRow {
  orders: number;
  payments: number;
  order_events: number;
  order_products: number;
  order_product_materials: number;
  order_activities: number;
  bulk_payment_batches: number;
  clients: number;
  users_preserved: number;
  sessions_preserved: number;
  orders_preserved: number;
  clients_preserved: number;
  old_clients_preserved: number;
  batches_preserved: number;
  next_order_number: number;
  snapshot_fingerprint: string;
}

const requiredTables = [
  'users', 'sessions', 'clients', 'orders', 'payments', 'order_events',
  'bulk_payment_batches', 'order_products', 'order_product_materials', 'order_activities',
] as const;

function cutoffDateInBogota(cutoff: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLEANUP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(cutoff);
}

function assertCutoff(cutoff: Date): void {
  if (Number.isNaN(cutoff.getTime())) throw new Error('La fecha de corte no es válida.');
  const date = cutoffDateInBogota(cutoff);
  const expected = new Date(`${date}T00:00:00-05:00`);
  if (expected.getTime() !== cutoff.getTime()) {
    throw new Error(`El corte debe ser exactamente el inicio de un día en ${CLEANUP_TIME_ZONE}.`);
  }
}

async function assertCurrentSchema(connection: SqlConnection): Promise<void> {
  const result = await connection.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1::text[])
  `, [requiredTables]);
  const present = new Set(result.rows.map(row => row.table_name));
  const missing = requiredTables.filter(table => !present.has(table));
  if (missing.length) {
    throw new Error(`La limpieza requiere el esquema vigente. Faltan tablas: ${missing.join(', ')}. Aplica primero las migraciones.`);
  }
}

async function previewInConnection(connection: SqlConnection, cutoff: Date): Promise<CleanupPlan> {
  await assertCurrentSchema(connection);
  const result = await connection.query<PreviewRow>(`
    WITH doomed_orders AS (
      SELECT id FROM orders WHERE created_at < $1::timestamptz
    ),
    doomed_batches AS (
      SELECT b.id
      FROM bulk_payment_batches b
      WHERE b.created_at < $1::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM payments p
          JOIN orders o ON o.id=p.order_id
          WHERE p.bulk_batch_id=b.id AND o.created_at >= $1::timestamptz
        )
    ),
    doomed_clients AS (
      SELECT c.id
      FROM clients c
      WHERE c.created_at < $1::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.client_id=c.id AND o.created_at >= $1::timestamptz
        )
        AND NOT EXISTS (
          SELECT 1 FROM bulk_payment_batches b
          WHERE b.client_id=c.id
            AND NOT EXISTS (SELECT 1 FROM doomed_batches d WHERE d.id=b.id)
        )
    )
    SELECT
      (SELECT count(*) FROM doomed_orders)::integer AS orders,
      (SELECT count(*) FROM payments p JOIN doomed_orders d ON d.id=p.order_id)::integer AS payments,
      (SELECT count(*) FROM order_events e JOIN doomed_orders d ON d.id=e.order_id)::integer AS order_events,
      (SELECT count(*) FROM order_products p JOIN doomed_orders d ON d.id=p.order_id)::integer AS order_products,
      (SELECT count(*) FROM order_product_materials m JOIN doomed_orders d ON d.id=m.order_id)::integer AS order_product_materials,
      (SELECT count(*) FROM order_activities a JOIN doomed_orders d ON d.id=a.order_id)::integer AS order_activities,
      (SELECT count(*) FROM doomed_batches)::integer AS bulk_payment_batches,
      (SELECT count(*) FROM doomed_clients)::integer AS clients,
      (SELECT count(*) FROM users)::integer AS users_preserved,
      (SELECT count(*) FROM sessions)::integer AS sessions_preserved,
      (SELECT count(*) FROM orders o WHERE o.created_at >= $1::timestamptz)::integer AS orders_preserved,
      ((SELECT count(*) FROM clients) - (SELECT count(*) FROM doomed_clients))::integer AS clients_preserved,
      (SELECT count(*) FROM clients c
        WHERE c.created_at < $1::timestamptz
          AND NOT EXISTS (SELECT 1 FROM doomed_clients d WHERE d.id=c.id))::integer AS old_clients_preserved,
      ((SELECT count(*) FROM bulk_payment_batches) - (SELECT count(*) FROM doomed_batches))::integer AS batches_preserved,
      COALESCE((SELECT max(number) + 1 FROM orders o WHERE o.created_at >= $1::timestamptz),1)::integer AS next_order_number,
      md5(
        COALESCE((SELECT string_agg('do:' || id::text, ',' ORDER BY id) FROM doomed_orders),'') || '|' ||
        COALESCE((SELECT string_agg('db:' || id::text, ',' ORDER BY id) FROM doomed_batches),'') || '|' ||
        COALESCE((SELECT string_agg('dc:' || id::text, ',' ORDER BY id) FROM doomed_clients),'') || '|' ||
        COALESCE((SELECT string_agg('o:' || id::text, ',' ORDER BY id) FROM orders),'') || '|' ||
        COALESCE((SELECT string_agg('c:' || id::text, ',' ORDER BY id) FROM clients),'') || '|' ||
        COALESCE((SELECT string_agg('b:' || id::text, ',' ORDER BY id) FROM bulk_payment_batches),'')
      ) AS snapshot_fingerprint
  `, [cutoff.toISOString()]);
  const row = result.rows[0];
  if (!row) throw new Error('No fue posible calcular la vista previa de limpieza.');
  return {
    cutoff: cutoff.toISOString(),
    cutoffDate: cutoffDateInBogota(cutoff),
    timeZone: CLEANUP_TIME_ZONE,
    delete: {
      orders: row.orders,
      payments: row.payments,
      orderEvents: row.order_events,
      orderProducts: row.order_products,
      orderProductMaterials: row.order_product_materials,
      orderActivities: row.order_activities,
      bulkPaymentBatches: row.bulk_payment_batches,
      clients: row.clients,
    },
    preserve: {
      users: row.users_preserved,
      sessions: row.sessions_preserved,
      orders: row.orders_preserved,
      clients: row.clients_preserved,
      clientsOlderThanCutoff: row.old_clients_preserved,
      bulkPaymentBatches: row.batches_preserved,
    },
    nextOrderNumber: row.next_order_number,
    snapshotFingerprint: row.snapshot_fingerprint,
  };
}

export async function previewTestDataCleanup(db: Database, cutoff: Date): Promise<CleanupPlan> {
  assertCutoff(cutoff);
  return previewInConnection(db, cutoff);
}

export function cleanupPlanDigest(plan: CleanupPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export function cleanupConfirmationToken(plan: CleanupPlan, targetSignature: string): string {
  const digest = createHash('sha256')
    .update(`${targetSignature}\n${cleanupPlanDigest(plan)}`)
    .digest('hex').slice(0, 12).toUpperCase();
  return `ELIMINAR-PRUEBAS-ANTES-${plan.cutoffDate}-${digest}`;
}

function samePlan(left: CleanupPlan, right: CleanupPlan): boolean {
  return cleanupPlanDigest(left) === cleanupPlanDigest(right);
}

async function deleteChecked(
  connection: SqlConnection,
  sql: string,
  params: unknown[],
  expected: number,
  label: string,
): Promise<void> {
  const result = await connection.query(sql, params);
  if (result.rowCount !== expected) {
    throw new Error(`La limpieza cambió mientras se ejecutaba (${label}: esperado ${expected}, obtenido ${result.rowCount}). Se revirtió la transacción.`);
  }
}

export async function executeTestDataCleanup(
  db: Database,
  cutoff: Date,
  expectedPlan: CleanupPlan,
): Promise<CleanupPlan> {
  assertCutoff(cutoff);
  return db.transaction(async tx => {
    // Blocks business-data mutations during the short verification/deletion window.
    // Ordinary SELECT queries remain available in PostgreSQL.
    await tx.exec(`LOCK TABLE clients, orders, order_products, order_product_materials,
      order_activities, bulk_payment_batches, payments, order_events IN EXCLUSIVE MODE`);
    const lockedPlan = await previewInConnection(tx, cutoff);
    if (!samePlan(lockedPlan, expectedPlan)) {
      throw new Error('Los datos cambiaron después de la vista previa. No se eliminó nada; genera una nueva vista previa y confirmación.');
    }
    const at = [cutoff.toISOString()];
    await deleteChecked(tx, `DELETE FROM order_product_materials m USING orders o
      WHERE m.order_id=o.id AND o.created_at < $1::timestamptz`, at, lockedPlan.delete.orderProductMaterials, 'materiales');
    await deleteChecked(tx, `DELETE FROM order_activities a USING orders o
      WHERE a.order_id=o.id AND o.created_at < $1::timestamptz`, at, lockedPlan.delete.orderActivities, 'actividades');
    await deleteChecked(tx, `DELETE FROM order_products p USING orders o
      WHERE p.order_id=o.id AND o.created_at < $1::timestamptz`, at, lockedPlan.delete.orderProducts, 'productos');
    await deleteChecked(tx, `DELETE FROM payments p USING orders o
      WHERE p.order_id=o.id AND o.created_at < $1::timestamptz`, at, lockedPlan.delete.payments, 'pagos');
    await deleteChecked(tx, `DELETE FROM order_events e USING orders o
      WHERE e.order_id=o.id AND o.created_at < $1::timestamptz`, at, lockedPlan.delete.orderEvents, 'eventos');
    await deleteChecked(tx, `DELETE FROM orders WHERE created_at < $1::timestamptz`, at, lockedPlan.delete.orders, 'OT');
    await deleteChecked(tx, `DELETE FROM bulk_payment_batches b
      WHERE b.created_at < $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.bulk_batch_id=b.id)`, at,
      lockedPlan.delete.bulkPaymentBatches, 'lotes de multiabono');
    await deleteChecked(tx, `DELETE FROM clients c
      WHERE c.created_at < $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM bulk_payment_batches b WHERE b.client_id=c.id)`, at,
      lockedPlan.delete.clients, 'clientes');

    // Empty orders => next number is 1. Retained orders are never renumbered;
    // in that case the next value is max(number)+1.
    await tx.query(`SELECT setval(
      pg_get_serial_sequence('orders','number'),
      COALESCE((SELECT max(number) FROM orders),1),
      EXISTS(SELECT 1 FROM orders)
    )`);
    return lockedPlan;
  });
}
