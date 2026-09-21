import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';
import {
  cleanupConfirmationToken,
  executeTestDataCleanup,
  previewTestDataCleanup,
} from '../src/maintenance/cleanup-test-data.js';

const cutoff = new Date('2026-09-21T00:00:00-05:00');
const beforeCutoff = '2026-09-21T04:59:59Z';
const atCutoff = '2026-09-21T05:00:00Z';
let db: Database;
let userId: string;

async function insertClient(createdAt: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO clients (id,name,phone,created_at,updated_at)
    VALUES ($1,$2,'3001234567',$3,$3)`, [id, name, createdAt]);
  return id;
}

async function insertOrder(clientId: string, createdAt: string, description: string): Promise<{ id: string; number: number }> {
  const id = randomUUID();
  const result = await db.query<{ number: number }>(`INSERT INTO orders
    (id,client_id,description,value,document_type,category,route,requires_installation,status,
      created_by,created_at,updated_at,creation_key,creation_fingerprint)
    VALUES ($1,$2,$3,100000,'REM','Proyecto','WORKSHOP_ONLY',false,'NEW',$4,$5,$5,$6,$7)
    RETURNING number`, [id, clientId, description, userId, createdAt, randomUUID(), 'a'.repeat(64)]);
  return { id, number: result.rows[0]!.number };
}

async function addDependencies(orderId: string, clientId: string, createdAt: string): Promise<void> {
  const batchId = randomUUID();
  const productId = randomUUID();
  await db.query(`INSERT INTO bulk_payment_batches
    (id,client_id,created_by,request_key,fingerprint,date,amount,method,created_at)
    VALUES ($1,$2,$3,$4,$5,'2026-09-20',1000,'EFECTIVO',$6)`,
  [batchId, clientId, userId, randomUUID(), 'b'.repeat(64), createdAt]);
  await db.query(`INSERT INTO payments
    (id,order_id,date,amount,recorded_by,recorded_at,request_key,method,bulk_batch_id)
    VALUES ($1,$2,'2026-09-20',1000,$3,$4,$5,'EFECTIVO',$6)`,
  [randomUUID(), orderId, userId, createdAt, randomUUID(), batchId]);
  await db.query(`INSERT INTO order_events
    (id,order_id,actor_id,action,to_status,occurred_at)
    VALUES ($1,$2,$3,'create','NEW',$4)`, [randomUUID(), orderId, userId, createdAt]);
  await db.query(`INSERT INTO order_products
    (id,order_id,position,description,quantity,unit_value,created_at,updated_at)
    VALUES ($1,$2,1,'Producto',1,100000,$3,$3)`, [productId, orderId, createdAt]);
  await db.query(`INSERT INTO order_product_materials
    (id,order_id,product_id,position,material,length,width,created_at)
    VALUES ($1,$2,$3,1,'Banner',2,1,$4)`, [randomUUID(), orderId, productId, createdAt]);
  await db.query(`INSERT INTO order_activities
    (id,order_id,product_id,position,area,status,created_at,updated_at)
    VALUES ($1,$2,$3,1,'WORKSHOP','PENDING',$4,$4)`, [randomUUID(), orderId, productId, createdAt]);
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
});

beforeEach(async () => {
  await db.exec(`TRUNCATE order_product_materials, order_activities, order_products,
    payments, order_events, bulk_payment_batches, orders, clients, sessions, users
    RESTART IDENTITY CASCADE`);
  userId = randomUUID();
  await db.query(`INSERT INTO users
    (id,name,email,password_hash,role,must_change_password,created_at,updated_at)
    VALUES ($1,'Administración','admin@example.test','hash','ADMINMASTER',false,$2,$2)`,
  [userId, beforeCutoff]);
  await db.query(`INSERT INTO sessions
    (token_hash,user_id,csrf_token,expires_at,created_at)
    VALUES ($1,$2,$3,'2027-01-01T00:00:00Z',$4)`,
  ['1'.repeat(64), userId, '2'.repeat(64), beforeCutoff]);
});

afterAll(async () => { await db.close(); });

describe('limpieza transaccional de datos de prueba', () => {
  it('la vista previa es de solo lectura y distingue exactamente el inicio del día en Bogotá', async () => {
    const oldClient = await insertClient(beforeCutoff, 'Cliente anterior');
    const sharedOldClient = await insertClient(beforeCutoff, 'Cliente anterior reutilizado');
    await insertClient(atCutoff, 'Cliente del día');
    const oldOrder = await insertOrder(oldClient, beforeCutoff, 'OT anterior');
    const retainedOrder = await insertOrder(sharedOldClient, atCutoff, 'OT del día');
    await addDependencies(oldOrder.id, oldClient, beforeCutoff);

    const plan = await previewTestDataCleanup(db, cutoff);
    expect(plan).toMatchObject({
      cutoff: '2026-09-21T05:00:00.000Z', cutoffDate: '2026-09-21', timeZone: 'America/Bogota',
      delete: {
        orders: 1, payments: 1, orderEvents: 1, orderProducts: 1,
        orderProductMaterials: 1, orderActivities: 1, bulkPaymentBatches: 1, clients: 1,
      },
      preserve: { users: 1, sessions: 1, orders: 1, clients: 2, clientsOlderThanCutoff: 1 },
      nextOrderNumber: 3,
    });
    expect((await db.query('SELECT id FROM orders ORDER BY number')).rows).toHaveLength(2);
    expect((await db.query('SELECT id FROM clients')).rows).toHaveLength(3);
    expect(cleanupConfirmationToken(plan, 'target-a')).not.toBe(cleanupConfirmationToken(plan, 'target-b'));
    expect(retainedOrder.number).toBe(2);
  });

  it('elimina dependencias y clientes antiguos, preserva cuentas/datos del día y no renumera OT retenidas', async () => {
    const oldClient = await insertClient(beforeCutoff, 'Cliente anterior');
    const sharedOldClient = await insertClient(beforeCutoff, 'Cliente compartido');
    const oldOrder = await insertOrder(oldClient, beforeCutoff, 'OT anterior');
    await insertOrder(sharedOldClient, atCutoff, 'OT conservada');
    await addDependencies(oldOrder.id, oldClient, beforeCutoff);
    const plan = await previewTestDataCleanup(db, cutoff);

    await executeTestDataCleanup(db, cutoff, plan);

    expect((await db.query<{ number: number }>('SELECT number FROM orders')).rows).toEqual([{ number: 2 }]);
    expect((await db.query<{ name: string }>('SELECT name FROM clients')).rows).toEqual([{ name: 'Cliente compartido' }]);
    for (const table of ['payments', 'order_events', 'order_products', 'order_product_materials', 'order_activities', 'bulk_payment_batches']) {
      const result = await db.query<{ count: number }>(`SELECT count(*)::integer AS count FROM ${table}`);
      expect(result.rows[0]!.count, table).toBe(0);
    }
    expect((await db.query('SELECT id FROM users')).rows).toHaveLength(1);
    expect((await db.query('SELECT token_hash FROM sessions')).rows).toHaveLength(1);
    const next = await insertOrder(sharedOldClient, atCutoff, 'Siguiente OT');
    expect(next.number).toBe(3);
  });

  it('reinicia el consecutivo en 1 solo cuando no queda ninguna OT', async () => {
    const oldClient = await insertClient(beforeCutoff, 'Cliente solo pruebas');
    await insertOrder(oldClient, beforeCutoff, 'Única OT de prueba');
    const plan = await previewTestDataCleanup(db, cutoff);
    expect(plan.nextOrderNumber).toBe(1);
    await executeTestDataCleanup(db, cutoff, plan);
    const newClient = await insertClient(atCutoff, 'Cliente operativo');
    expect((await insertOrder(newClient, atCutoff, 'Primera OT real')).number).toBe(1);
  });

  it('rechaza una vista previa obsoleta y revierte sin eliminar nada', async () => {
    const oldClient = await insertClient(beforeCutoff, 'Cliente inicial');
    await insertOrder(oldClient, beforeCutoff, 'OT inicial');
    const stalePlan = await previewTestDataCleanup(db, cutoff);
    await insertClient(beforeCutoff, 'Cliente agregado después');

    await expect(executeTestDataCleanup(db, cutoff, stalePlan)).rejects.toThrow('datos cambiaron');
    expect((await db.query('SELECT id FROM orders')).rows).toHaveLength(1);
    expect((await db.query('SELECT id FROM clients')).rows).toHaveLength(2);
    expect((await db.query('SELECT id FROM users')).rows).toHaveLength(1);
  });

  it('rechaza cortes que no sean medianoche exacta de Bogotá', async () => {
    await expect(previewTestDataCleanup(db, new Date('2026-09-21T05:00:01Z')))
      .rejects.toThrow('inicio de un día');
  });
});
