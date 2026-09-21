import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import { createPgliteDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';

// Isolated, ephemeral PostgreSQL-compatible database: no customer data is opened or reset.
const ORIGIN = 'http://127.0.0.1:5173';
const API = '/api/v1';
const PASSWORD = 'Clave de prueba para reportes 2026!';
const config = readConfig({ NODE_ENV: 'test', APP_ORIGINS: ORIGIN, LOGIN_RATE_LIMIT: '100' });
let db: Database;
let app: Express;
let cookie: string;
let csrf: string;
let userId: string;
let clientId: string;
let legacyId: string;
let newId: string;

async function addOrder(input: { documentType: 'REM' | 'FACT'; value: number; rule: 'LEGACY' | 'NEW';
  reteFuente?: number; reteIva?: number; ica?: number; category?: string }) {
  const id = randomUUID();
  await db.query(`
    INSERT INTO orders (id,client_id,description,value,document_type,category,route,requires_installation,
      status,created_by,created_at,material,length,width,rete_fuente,rete_iva,ica,
      creation_key,creation_fingerprint,financial_rule)
    VALUES ($1,$2,'OT de prueba',$3,$4,$5,'WORKSHOP_ONLY',false,'NEW',$6,
      '2024-01-15T12:00:00-05:00',null,null,null,$7,$8,$9,$10,$11,$12)
  `, [id, clientId, input.value, input.documentType, input.category ?? 'Proyecto', userId,
    input.reteFuente ?? 0, input.reteIva ?? 0, input.ica ?? 0, randomUUID(), 'a'.repeat(64), input.rule]);
  return id;
}

function get(path: string) {
  return request(app).get(`${API}${path}`).set('Cookie', cookie);
}
function post(path: string, body: object, csrfToken = csrf) {
  return request(app).post(`${API}${path}`).set('Origin', ORIGIN).set('Cookie', cookie)
    .set('X-CSRF-Token', csrfToken).send(body);
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
  app = await createApp(db, config);
});

beforeEach(async () => {
  await db.exec('TRUNCATE order_events, payments, orders, clients, users RESTART IDENTITY CASCADE');
  const admin = await bootstrapAdmin(db, { name: 'Admin reportes', email: 'reports-master@example.test', password: PASSWORD });
  userId = admin.id;
  const login = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN)
    .send({ email: 'reports-master@example.test', password: PASSWORD });
  expect(login.status).toBe(200);
  cookie = String(login.headers['set-cookie']?.[0] ?? '').split(';')[0];
  csrf = login.body.csrfToken;
  clientId = randomUUID();
  await db.query('INSERT INTO clients (id,name,identification,phone) VALUES ($1,$2,$3,$4)',
    [clientId, 'Cliente de reportes', '123', '3001234567']);
  legacyId = await addOrder({ documentType: 'FACT', value: 100000, rule: 'LEGACY', reteFuente: 5000, reteIva: 3000, ica: 2000 });
  newId = await addOrder({ documentType: 'FACT', value: 100000, rule: 'NEW', reteFuente: 5000, reteIva: 3000, ica: 2000 });
  await addOrder({ documentType: 'REM', value: 50000, rule: 'NEW' });
  await db.query(`INSERT INTO payments (id,order_id,date,amount,recorded_by,request_key,method)
    VALUES ($1,$2,'2024-01-20',50000,$3,$4,'EFECTIVO'),
      ($5,$6,'2024-02-10',109000,$3,$7,'BANCOLOMBIA')`,
  [randomUUID(), legacyId, userId, randomUUID(), randomUUID(), newId, randomUUID()]);
});

afterAll(async () => { await db?.close(); });

describe('reportes con reglas financieras por orden', () => {
  it('preserva el histórico LEGACY y descuenta retenciones en NEW sin contar pagos dos veces', async () => {
    const january = await get('/reports/sales?from=2024-01-01&to=2024-01-31&groupBy=month');
    expect(january.status).toBe(200);
    expect(january.body.totals).toMatchObject({
      count: 3, base: 250000, factBase: 200000, iva: 38000, factGross: 238000,
      reteFuente: 10000, reteIva: 6000, ica: 4000, retentions: 20000,
      collectible: 288000, collectibleWithoutIva: 250000,
      received: 50000, balance: 238000, balanceWithoutIva: 200000, ivaDue: 38000,
    });
    expect(january.body.timeline).toHaveLength(1);
    expect(january.body.timeline[0]).toMatchObject({ period: '2024-01', received: 50000 });
    const february = await get('/reports/sales?from=2024-02-01&to=2024-02-29&groupBy=month');
    expect(february.status).toBe(200);
    expect(february.body.totals).toMatchObject({ count: 0, base: 0, received: 109000,
      balance: 129000, balanceWithoutIva: 110000, ivaDue: 19000 });
    expect(february.body.timeline[0]).toMatchObject({ period: '2024-02', count: 0, received: 109000 });
  });

  it('separa cartera con IVA, sin IVA y certificados aún pendientes aunque la OT esté pagada', async () => {
    const report = await get('/reports/portfolio?cutoff=2024-02-29');
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({ total: 2, totalBalance: 129000,
      totalBalanceWithIva: 129000, totalBalanceWithoutIva: 110000, ivaDue: 19000,
      certificates: { statusAsOf: 'current', reteFuente: 10000, reteIva: 6000, ica: 4000 } });
    expect(report.body.items.find((item: { order: { id: string } }) => item.order.id === newId)).toBeUndefined();
    const certificates = await get('/reports/certificates?cutoff=2024-02-29');
    expect(certificates.status).toBe(200);
    expect(certificates.body).toMatchObject({ certificateStatusAsOf: 'current', total: 2,
      pendingReteFuente: 10000, pendingReteIva: 6000, pendingIca: 4000 });
    expect(certificates.body.items.find((item: { orderId: string }) => item.orderId === newId))
      .toMatchObject({ balance: 0, financialRule: 'NEW', pendingReteFuente: 5000 });
  });

  it('actualiza certificados con versión, sesión y CSRF; no cambia saldos monetarios', async () => {
    const body = { orderId: newId, expectedVersion: 1,
      certificates: { reteFuente: true, reteIva: false, ica: false } };
    expect((await post('/reports/certificates', body, 'incorrecto')).status).toBe(403);
    const changed = await post('/reports/certificates', body);
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ orderId: newId, certificates: body.certificates, version: 2 });
    expect((await post('/reports/certificates', body)).status).toBe(409);
    const replay = await post('/reports/certificates', { ...body, expectedVersion: 2 });
    expect(replay.status).toBe(200);
    expect(replay.body.version).toBe(2);
    const report = await get('/reports/portfolio?cutoff=2024-02-29');
    expect(report.body).toMatchObject({ totalBalance: 129000,
      certificates: { reteFuente: 5000, reteIva: 6000, ica: 4000 } });
    expect((await db.query('SELECT id FROM order_events WHERE order_id=$1 AND action=$2', [newId, 'certificates'])).rows).toHaveLength(1);
  });

  it('rechaza certificados de REM o importes cero', async () => {
    const rem = await addOrder({ documentType: 'REM', value: 100, rule: 'NEW' });
    const flags = { reteFuente: true, reteIva: false, ica: false };
    expect((await post('/reports/certificates', { orderId: rem, expectedVersion: 1, certificates: flags })).status).toBe(409);
    const noRetention = await addOrder({ documentType: 'FACT', value: 100, rule: 'NEW' });
    expect((await post('/reports/certificates', { orderId: noRetention, expectedVersion: 1, certificates: flags })).status).toBe(400);
  });
});
