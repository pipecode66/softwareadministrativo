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
      balanceRem: 50000, balanceFact: 188000, pendingRetentions: 20000,
    });
    expect(january.body.timeline).toHaveLength(1);
    expect(january.body.timeline[0]).toMatchObject({ period: '2024-01', received: 50000 });
    const february = await get('/reports/sales?from=2024-02-01&to=2024-02-29&groupBy=month');
    expect(february.status).toBe(200);
    expect(february.body.totals).toMatchObject({ count: 0, base: 0, received: 109000,
      balance: 129000, balanceWithoutIva: 110000, ivaDue: 19000,
      balanceRem: 50000, balanceFact: 79000, pendingRetentions: 20000 });
    expect(february.body.timeline[0]).toMatchObject({ period: '2024-02', count: 0, received: 109000 });
  });

  it('separa cartera con IVA, sin IVA y certificados aún pendientes aunque la OT esté pagada', async () => {
    const january = await get('/reports/portfolio?cutoff=2024-01-31');
    expect(january.status).toBe(200);
    expect(january.body).toMatchObject({ totalBalance: 238000,
      totalBalanceRem: 50000, totalBalanceFact: 188000 });
    const report = await get('/reports/portfolio?cutoff=2024-02-29');
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({ total: 2, totalBalance: 129000,
      totalBalanceRem: 50000, totalBalanceFact: 79000,
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

  it('filtra la cartera REM y FACT por categoría y documento y devuelve cero sin coincidencias', async () => {
    const otherRemId = await addOrder({ documentType: 'REM', value: 80000, rule: 'NEW', category: 'Otras' });
    await db.query(`INSERT INTO payments (id,order_id,date,amount,recorded_by,request_key,method)
      VALUES ($1,$2,'2024-01-20',30000,$3,$4,'EFECTIVO')`,
    [randomUUID(), otherRemId, userId, randomUUID()]);

    for (const [filter, rem, fact] of [
      ['', 100000, 188000],
      ['&documentType=REM', 100000, 0],
      ['&documentType=FACT', 0, 188000],
      ['&category=Otras', 50000, 0],
      ['&category=Otras&documentType=FACT', 0, 0],
      ['&category=SuperGiros', 0, 0],
    ] as const) {
      const [sales, portfolio] = await Promise.all([
        get(`/reports/sales?from=2024-01-01&to=2024-01-31${filter}`),
        get(`/reports/portfolio?cutoff=2024-01-31${filter}`),
      ]);
      expect(sales.status).toBe(200);
      expect(portfolio.status).toBe(200);
      expect(sales.body.totals).toMatchObject({ balanceRem: rem, balanceFact: fact, balance: rem + fact });
      expect(portfolio.body).toMatchObject({ totalBalanceRem: rem, totalBalanceFact: fact, totalBalance: rem + fact });
    }

    const [salesBeforeOrders, portfolioBeforeOrders] = await Promise.all([
      get('/reports/sales?from=2023-12-01&to=2023-12-31'),
      get('/reports/portfolio?cutoff=2023-12-31'),
    ]);
    expect(salesBeforeOrders.status).toBe(200);
    expect(portfolioBeforeOrders.status).toBe(200);
    expect(salesBeforeOrders.body.totals).toMatchObject({ balanceRem: 0, balanceFact: 0 });
    expect(portfolioBeforeOrders.body).toMatchObject({ totalBalanceRem: 0, totalBalanceFact: 0 });
  });

  it('reserva los totales de cartera a ADMINMASTER y ADMIN_GENERAL', async () => {
    for (const role of ['ADMINMASTER', 'ADMIN_GENERAL', 'APOYO_COMERCIAL', 'DISENO', 'IMPRESION', 'TALLER']) {
      await db.query('UPDATE users SET role=$2 WHERE id=$1', [userId, role]);
      const [sales, portfolio, receivables, certificates] = await Promise.all([
        get('/reports/sales?from=2024-01-01&to=2024-01-31'),
        get('/reports/portfolio?cutoff=2024-01-31'),
        get('/reports/receivables?cutoff=2024-01-31&metric=retentions'),
        get('/reports/certificates?cutoff=2024-01-31'),
      ]);
      const allowed = ['ADMINMASTER', 'ADMIN_GENERAL'].includes(role);
      expect(sales.status).toBe(allowed ? 200 : 403);
      expect(portfolio.status).toBe(allowed ? 200 : 403);
      expect(receivables.status).toBe(allowed ? 200 : 403);
      expect(certificates.status).toBe(allowed ? 200 : 403);
      if (allowed) {
        expect(sales.body.totals).toMatchObject({ balanceRem: 50000, balanceFact: 188000 });
        expect(portfolio.body).toMatchObject({ totalBalanceRem: 50000, totalBalanceFact: 188000 });
        expect(receivables.body).toMatchObject({ total: 2, totalAmount: 20000 });
      } else {
        expect(sales.body).not.toHaveProperty('totals');
        expect(portfolio.body).not.toHaveProperty('totalBalanceRem');
        expect(portfolio.body).not.toHaveProperty('totalBalanceFact');
        expect(receivables.body).not.toHaveProperty('items');
        expect(certificates.body).not.toHaveProperty('items');
      }
    }
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
    const [sales, receivables] = await Promise.all([
      get('/reports/sales?from=2024-02-01&to=2024-02-29'),
      get('/reports/receivables?cutoff=2024-02-29&metric=retentions'),
    ]);
    expect(sales.body.totals.pendingRetentions).toBe(15000);
    expect(receivables.body.totalAmount).toBe(15000);
    expect(receivables.body.items.find((item: { orderId: string }) => item.orderId === newId))
      .toMatchObject({ amount: 5000 });
    expect((await db.query('SELECT id FROM order_events WHERE order_id=$1 AND action=$2', [newId, 'certificates'])).rows).toHaveLength(1);
  });

  it('rechaza certificados de REM o importes cero', async () => {
    const rem = await addOrder({ documentType: 'REM', value: 100, rule: 'NEW' });
    const flags = { reteFuente: true, reteIva: false, ica: false };
    expect((await post('/reports/certificates', { orderId: rem, expectedVersion: 1, certificates: flags })).status).toBe(409);
    const noRetention = await addOrder({ documentType: 'FACT', value: 100, rule: 'NEW' });
    expect((await post('/reports/certificates', { orderId: noRetention, expectedVersion: 1, certificates: flags })).status).toBe(400);
  });

  it('TOTAL IVA suma el impuesto original de las FACT sin alterarlo por abonos ni retenciones', async () => {
    const first = await addOrder({ documentType: 'FACT', value: 150000, rule: 'NEW', category: 'Otras', reteFuente: 1000 });
    const second = await addOrder({ documentType: 'FACT', value: 150000, rule: 'NEW', category: 'Otras' });
    await db.query(`INSERT INTO payments (id,order_id,date,amount,recorded_by,request_key,method)
      VALUES ($1,$2,'2024-01-20',177500,$3,$4,'EFECTIVO'),
        ($5,$6,'2024-01-20',150000,$3,$7,'BANCOLOMBIA')`,
    [randomUUID(), first, userId, randomUUID(), randomUUID(), second, randomUUID()]);
    const report = await get('/reports/sales?from=2024-01-01&to=2024-01-31&category=Otras');
    expect(report.status).toBe(200);
    expect(report.body.totals).toMatchObject({ base: 300000, iva: 57000,
      retentions: 1000, received: 327500, balance: 28500 });
    expect(report.body.documents.find((item: { documentType: string }) => item.documentType === 'FACT').iva).toBe(57000);
  });

  it('cada desglose concuerda con su cuadro y conserva certificados de OT ya pagadas', async () => {
    for (const [cutoff, from, expected] of [
      ['2024-01-31', '2024-01-01', { balanceWithIva: 238000, balanceWithoutIva: 200000, rem: 50000,
        fact: 188000, retentions: 20000, reteFuente: 10000, reteIva: 6000, ica: 4000 }],
      ['2024-02-29', '2024-02-01', { balanceWithIva: 129000, balanceWithoutIva: 110000, rem: 50000,
        fact: 79000, retentions: 20000, reteFuente: 10000, reteIva: 6000, ica: 4000 }],
    ] as const) {
      const [sales, portfolio] = await Promise.all([
        get(`/reports/sales?from=${from}&to=${cutoff}`),
        get(`/reports/portfolio?cutoff=${cutoff}`),
      ]);
      expect(sales.status).toBe(200);
      expect(portfolio.status).toBe(200);
      expect(sales.body.totals.balanceWithIva).toBe(expected.balanceWithIva);
      expect(sales.body.totals.balanceWithoutIva).toBe(expected.balanceWithoutIva);
      expect(sales.body.totals.balanceRem).toBe(expected.rem);
      expect(sales.body.totals.balanceFact).toBe(expected.fact);
      expect(sales.body.totals.pendingRetentions).toBe(expected.retentions);
      expect(portfolio.body.totalBalanceWithIva).toBe(expected.balanceWithIva);
      expect(portfolio.body.totalBalanceWithoutIva).toBe(expected.balanceWithoutIva);
      expect(portfolio.body.totalBalanceRem).toBe(expected.rem);
      expect(portfolio.body.totalBalanceFact).toBe(expected.fact);

      for (const [metric, amount] of Object.entries(expected)) {
        const details = await get(`/reports/receivables?cutoff=${cutoff}&metric=${metric}`);
        expect(details.status).toBe(200);
        expect(details.body).toMatchObject({ cutoff, metric, page: 1, pageSize: 50, totalAmount: amount });
        expect(details.body.items.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0)).toBe(amount);
        const numbers = details.body.items.map((row: { number: number }) => row.number);
        expect(numbers).toEqual([...numbers].sort((a: number, b: number) => b - a));
        expect(details.body.items.every((row: { amount: number }) => row.amount > 0)).toBe(true);
        if (metric === 'retentions') {
          expect(details.body.items.find((row: { orderId: string }) => row.orderId === newId)).toMatchObject({
            orderId: newId, clientId, clientName: 'Cliente de reportes', description: 'OT de prueba',
            documentType: 'FACT', amount: 10000,
          });
          expect(details.body.items.find((row: { orderId: string }) => row.orderId === legacyId)).toMatchObject({ amount: 10000 });
        }
      }
    }
  });

  it('aplica los mismos filtros a las deudas y certificados, y devuelve ceros donde no hay coincidencias', async () => {
    const other = await addOrder({ documentType: 'FACT', value: 80000, rule: 'NEW', category: 'Otras', reteFuente: 400 });
    for (const filter of ['', '&category=Otras', '&documentType=REM', '&documentType=FACT',
      '&category=SuperGiros', '&category=Otras&documentType=REM']) {
      const [sales, certificates] = await Promise.all([
        get(`/reports/sales?from=2024-01-01&to=2024-01-31${filter}`),
        get(`/reports/certificates?cutoff=2024-01-31${filter}`),
      ]);
      expect(sales.status).toBe(200);
      expect(certificates.status).toBe(200);
      const expected = {
        balanceWithIva: sales.body.totals.balanceWithIva,
        balanceWithoutIva: sales.body.totals.balanceWithoutIva,
        rem: sales.body.totals.balanceRem,
        fact: sales.body.totals.balanceFact,
        retentions: sales.body.totals.pendingRetentions,
        reteFuente: certificates.body.pendingReteFuente,
        reteIva: certificates.body.pendingReteIva,
        ica: certificates.body.pendingIca,
      };
      for (const [metric, amount] of Object.entries(expected)) {
        const details = await get(`/reports/receivables?cutoff=2024-01-31&metric=${metric}${filter}`);
        expect(details.status).toBe(200);
        expect(details.body.totalAmount).toBe(amount);
        if (amount === 0) expect(details.body.items).toEqual([]);
      }
      const numbers = certificates.body.items.map((row: { number: number }) => row.number);
      expect(numbers).toEqual([...numbers].sort((a: number, b: number) => b - a));
      if (filter === '&category=Otras') {
        expect(certificates.body.items).toHaveLength(1);
        expect(certificates.body.items[0].orderId).toBe(other);
        expect(certificates.body.pendingReteFuente).toBe(400);
      }
    }
    const before = await get('/reports/receivables?cutoff=2023-12-31&metric=retentions');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ total: 0, totalAmount: 0, items: [] });
  });

  it('pagina de mayor a menor OT sin recortar el total general ni repetir órdenes', async () => {
    for (let index = 0; index < 53; index++) {
      await addOrder({ documentType: 'REM', value: 10.01, rule: 'NEW', category: 'Otras' });
    }
    const [first, second, beyond] = await Promise.all([
      get('/reports/receivables?cutoff=2024-01-31&metric=rem&category=Otras&page=1'),
      get('/reports/receivables?cutoff=2024-01-31&metric=rem&category=Otras&page=2'),
      get('/reports/receivables?cutoff=2024-01-31&metric=rem&category=Otras&page=3'),
    ]);
    for (const report of [first, second, beyond]) {
      expect(report.status).toBe(200);
      expect(report.body).toMatchObject({ total: 53, totalAmount: 530.53 });
    }
    expect(first.body.items).toHaveLength(50);
    expect(second.body.items).toHaveLength(3);
    expect(beyond.body.items).toEqual([]);
    const rows = [...first.body.items, ...second.body.items];
    expect(new Set(rows.map((row: { orderId: string }) => row.orderId)).size).toBe(53);
    expect(rows[0].number).toBeGreaterThan(rows[52].number);
    expect(Math.round(rows.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0) * 100)).toBe(53053);
    const sales = await get('/reports/sales?from=2024-01-01&to=2024-01-31&category=Otras');
    expect(sales.body.totals.balanceRem).toBe(first.body.totalAmount);
  });

  it('valida el concepto, corte y límites de página del desglose', async () => {
    for (const query of ['cutoff=2024-01-31', 'cutoff=2024-01-31&metric=iva',
      'cutoff=0000-01-01&metric=rem', 'cutoff=2024-01-31&metric=rem&page=0',
      'cutoff=2024-01-31&metric=rem&pageSize=101', 'cutoff=2024-01-31&metric=rem&category=Otro']) {
      expect((await get(`/reports/receivables?${query}`)).status).toBe(400);
    }
  });
});
