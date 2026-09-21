import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import type { PublicUser, Role } from '../src/contracts.js';
import { createPgliteDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';
import { dateOnly } from '../src/orders/domain.js';
import { replaceOrderProducts } from '../src/work/service.js';

const API = '/api/v1';
const ORIGIN = 'http://127.0.0.1:5173';
const EMAIL = 'work-master@example.test';
const PASSWORD = 'Una clave ficticia para tareas 2026!';
const config = readConfig({ NODE_ENV: 'test', APP_ORIGINS: ORIGIN, LOGIN_RATE_LIMIT: '100' });
type Session = { cookie: string; csrf: string; user: PublicUser };
type Activity = { id: string; area: string; status: string; ready: boolean; assignedUserId: string | null; materials: { consumedAt: string | null }[] };
let db: Database;
let app: Express;
let admin: Session;
let clientId: string;

function sessionOf(response: Response): Session {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const cookies = !header ? [] : Array.isArray(header) ? header : [header];
  return { cookie: cookies.map(cookie => cookie.split(';')[0]).join('; '), csrf: response.body.csrfToken, user: response.body.user };
}

async function login(email: string): Promise<Session> {
  const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return sessionOf(response);
}

async function actor(role: Role, name = role): Promise<Session> {
  const email = `${role.toLowerCase()}-${randomUUID()}@example.test`;
  await db.query(`
    INSERT INTO users (id,name,email,role,password_hash,must_change_password)
    SELECT $1,$2,$3,$4,password_hash,false FROM users WHERE id=$5
  `, [randomUUID(), name, email, role, admin.user.id]);
  return login(email);
}

function post(path: string, payload: object, session = admin) {
  return request(app).post(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload);
}
function patch(path: string, payload: object, session = admin) {
  return request(app).patch(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload);
}
function get(path: string, session = admin) {
  return request(app).get(`${API}${path}`).set('Cookie', session.cookie);
}

const products = [
  { description: 'Pieza impresa', quantity: 2, unitValue: 30000, length: 2, width: 1.5, specifications: 'A todo color',
    materials: [{ material: 'Banner', length: 2, width: 1.5 }, { material: 'Panaflex', length: 1, width: 2 }],
    activities: [{ area: 'DESIGN' }, { area: 'PRINTING' }, { area: 'WORKSHOP' }] },
  { description: 'Pieza por proveedor', quantity: 1, unitValue: 40000, specifications: 'Coordinar entrega',
    materials: [], activities: [{ area: 'EXTERNAL' }] },
];

async function create(overrides: Record<string, unknown> = {}, session = admin) {
  const response = await post('/orders', {
    clientId, description: 'OT compuesta', value: 100000, documentType: 'REM', category: 'Proyecto',
    route: 'MULTI_AREA', requiresInstallation: false, products, requestId: randomUUID(), ...overrides,
  }, session);
  expect(response.status).toBe(201);
  return response.body.order as { id: string; number: number; status: string; version: number };
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
});
beforeEach(async () => {
  await db.exec('TRUNCATE order_events, payments, orders, clients, users RESTART IDENTITY CASCADE');
  await bootstrapAdmin(db, { name: 'Admin tareas', email: EMAIL, password: PASSWORD });
  app = await createApp(db, config);
  admin = await login(EMAIL);
  clientId = randomUUID();
  await db.query('INSERT INTO clients (id,name,identification,phone,special_payment) VALUES ($1,$2,$3,$4,true)',
    [clientId, 'Cliente de prueba', 'NIT-800000001', '3001234567']);
});
afterAll(async () => { await db?.close(); });

describe('Productos y trabajo interno', () => {
  it('conserva un solo valor comercial y muestra dos productos y cuatro actividades', async () => {
    const order = await create();
    expect(order.status).toBe('IN_PRODUCTION');
    const read = await get(`/work/orders/${order.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ orderNumber: 1, products: [
      { description: 'Pieza impresa', quantity: 2, length: 2, width: 1.5, unitValue: 30000, lineTotal: 60000,
        materials: [{ material: 'Banner', areaM2: 3, consumedAt: null },
          { material: 'Panaflex', areaM2: 2, consumedAt: null }],
        activities: [{ area: 'DESIGN' }, { area: 'PRINTING' }, { area: 'WORKSHOP' }] },
      { description: 'Pieza por proveedor', lineTotal: 40000, activities: [{ area: 'EXTERNAL' }] },
    ] });
    const printPage = await get('/work/activities?area=PRINTING&pageSize=1');
    expect(printPage.body.total).toBe(1);
    expect(printPage.body.items).toEqual([expect.objectContaining({ area: 'PRINTING' })]);
    const rows = await db.query<{ total: string }>('SELECT sum(line_total) AS total FROM order_products WHERE order_id=$1', [order.id]);
    expect(Number(rows.rows[0].total)).toBe(100000);
    const today = dateOnly();
    const sales = await get(`/reports/sales?from=${today}&to=${today}`);
    expect(sales.status).toBe(200);
    expect(sales.body.totals.base).toBe(100000);
    expect((await db.query('SELECT id FROM orders')).rows).toHaveLength(1);
  });

  it('limita renglones y precios por rol y por asignación', async () => {
    const designer = await actor('DISENO', 'Diseñador uno');
    const otherDesigner = await actor('DISENO', 'Diseñador dos');
    const printer = await actor('IMPRESION');
    const workshop = await actor('TALLER');
    const order = await create({ products: [
      { ...products[0], activities: [{ area: 'DESIGN', assignedUserId: designer.user.id }, { area: 'PRINTING' }, { area: 'WORKSHOP' }] },
      products[1],
    ] });
    const designRead = await get(`/work/orders/${order.id}`, designer);
    expect(designRead.status).toBe(200);
    expect(designRead.body.products).toHaveLength(1);
    expect(designRead.body.products[0]).not.toHaveProperty('unitValue');
    expect(designRead.body.products[0]).not.toHaveProperty('lineTotal');
    const assignedOrder = await get(`/orders/${order.id}`, designer);
    expect(assignedOrder.status).toBe(200);
    expect(assignedOrder.body.order).not.toHaveProperty('value');
    expect((await get('/orders', designer)).body.items.find((item: { id: string }) => item.id === order.id)).not.toHaveProperty('value');
    expect((await get(`/work/orders/${order.id}`, otherDesigner)).status).toBe(404);
    for (const session of [printer, workshop]) {
      const view = await get(`/work/orders/${order.id}`, session);
      expect(view.status).toBe(200);
      expect(view.body.products).toHaveLength(1);
      expect(JSON.stringify(view.body)).not.toMatch(/unitValue|lineTotal|100000|40000/);
      const tasks = await get(`/work/activities?orderId=${order.id}`, session);
      expect(tasks.body.items).toHaveLength(1);
      expect(JSON.stringify(tasks.body)).not.toMatch(/unitValue|lineTotal|100000|40000/);
      expect((await get(`/orders/${order.id}`, session)).body.order).not.toHaveProperty('value');
    }
    const own = await create({}, designer);
    const ownRead = await get(`/work/orders/${own.id}`, designer);
    expect(ownRead.body.products[0].unitValue).toBe(30000);
  });

  it('exige completar diseño antes de impresión y consume material al terminar impresión', async () => {
    const designer = await actor('DISENO');
    const printer = await actor('IMPRESION');
    const workshop = await actor('TALLER');
    const order = await create();
    const items = (await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[];
    const design = items.find(item => item.area === 'DESIGN')!;
    const printing = items.find(item => item.area === 'PRINTING')!;
    const cutting = items.find(item => item.area === 'WORKSHOP')!;
    const external = items.find(item => item.area === 'EXTERNAL')!;
    expect(printing.ready).toBe(false);
    expect((await post(`/work/activities/${printing.id}/start`, {}, printer)).status).toBe(409);
    expect((await post(`/work/activities/${design.id}/start`, {}, designer)).status).toBe(409);
    expect((await post(`/work/activities/${design.id}/claim`, {}, designer)).body.activity.assignedUserId).toBe(designer.user.id);
    expect((await post(`/work/activities/${design.id}/start`, {}, designer)).status).toBe(200);
    expect((await post(`/work/activities/${design.id}/complete`, {}, designer)).status).toBe(200);
    expect((await post(`/work/activities/${cutting.id}/start`, {}, workshop)).status).toBe(409);
    expect((await get(`/work/activities?orderId=${order.id}`, printer)).body.items[0].materials[0].consumedAt).toBeNull();
    expect((await post(`/work/activities/${printing.id}/start`, {}, printer)).status).toBe(200);
    const printed = await post(`/work/activities/${printing.id}/complete`, {}, printer);
    expect(printed.status).toBe(200);
    expect(printed.body.activity.materials[0].consumedAt).toBeTruthy();
    const today = dateOnly();
    const materialReport = await get(`/reports/materials?from=${today}&to=${today}`);
    expect(materialReport.status).toBe(200);
    expect(materialReport.body.totalOrders).toBe(1);
    expect(materialReport.body.totalM2).toBe(5);
    expect(materialReport.body.materials).toEqual(expect.arrayContaining([
      expect.objectContaining({ material: 'Banner', count: 1, m2: 3 }),
      expect.objectContaining({ material: 'Panaflex', count: 1, m2: 2 }),
    ]));
    expect((await post(`/work/activities/${cutting.id}/start`, {}, workshop)).status).toBe(200);
    expect((await post(`/work/activities/${cutting.id}/complete`, {}, workshop)).status).toBe(200);
    expect((await get(`/orders/${order.id}`)).body.order.status).toBe('IN_PRODUCTION');
    expect((await post(`/work/activities/${external.id}/start`, {})).status).toBe(200);
    expect((await post(`/work/activities/${external.id}/complete`, {})).status).toBe(200);
    const finished = await get(`/orders/${order.id}`);
    expect(finished.body.order.status).toBe('COMPLETED');
    expect(finished.body.order.version).toBe(order.version + 1);
    const events = await db.query<{ action: string }>('SELECT action FROM order_events WHERE order_id=$1 AND action=$2', [order.id, 'finishProduction']);
    expect(events.rows).toHaveLength(1);
  });

  it('deriva instalación pendiente cuando la OT la requiere', async () => {
    const order = await create({ requiresInstallation: true, value: 40000, route: 'EXTERNO', products: [products[1]] });
    const external = (await get(`/work/activities?orderId=${order.id}`)).body.items[0] as Activity;
    await post(`/work/activities/${external.id}/start`, {});
    await post(`/work/activities/${external.id}/complete`, {});
    expect((await get(`/orders/${order.id}`)).body.order.status).toBe('PENDING_INSTALLATION');
  });

  it('asigna un diseñador activo y permite reemplazar productos solo antes del primer avance', async () => {
    const designer = await actor('DISENO');
    const order = await create();
    const design = ((await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[])
      .find(item => item.area === 'DESIGN')!;
    const load = await get('/work/designers/load');
    expect(load.body.unassigned).toBe(1);
    expect((await get('/work/designers/load', designer)).status).toBe(403);
    const assigned = await patch(`/work/activities/${design.id}/assign`, { assignedUserId: designer.user.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.activity.assignedUserId).toBe(designer.user.id);
    expect((await get('/work/designers/load')).body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: designer.user.id, pending: 1, total: 1 }),
    ]));
    const replacement = [
      { ...products[0], description: 'Pieza corregida', unitValue: 25000 },
      { ...products[1], unitValue: 50000 },
    ];
    await db.transaction(tx => replaceOrderProducts(tx, order.id, replacement));
    expect((await get(`/work/orders/${order.id}`)).body.products[0].description).toBe('Pieza corregida');
    const nextDesign = ((await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[])
      .find(item => item.area === 'DESIGN')!;
    expect((await post(`/work/activities/${design.id}/claim`, {}, designer)).status).toBe(404);
    await post(`/work/activities/${nextDesign.id}/claim`, {}, designer);
    await post(`/work/activities/${nextDesign.id}/start`, {}, designer);
    await expect(db.transaction(tx => replaceOrderProducts(tx, order.id, replacement)))
      .rejects.toMatchObject({ status: 409, code: 'ACTIVITY_CONFLICT' });
  });

  it('rechaza importes inconsistentes sin persistir productos ni OT', async () => {
    const response = await post('/orders', { clientId, description: 'Inconsistente', value: 100000,
      documentType: 'REM', category: 'Proyecto', route: 'MULTI_AREA', requiresInstallation: false,
      products: [{ ...products[0], unitValue: 20000 }, products[1]], requestId: randomUUID() });
    expect(response.status).toBe(400);
    expect((await db.query('SELECT id FROM orders')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM order_products')).rows).toHaveLength(0);
  });

  it('acepta Externo sin medidas y rechaza medidas internas completas o parciales', async () => {
    const valid = await create({ requiresInstallation: false, value: 40000, route: 'EXTERNO', products: [products[1]] });
    expect((await get(`/work/orders/${valid.id}`)).body.products[0]).not.toHaveProperty('length');
    const invalid = await post('/orders', {
      clientId, description: 'Medida incompleta', value: 40000, documentType: 'REM',
      category: 'Proyecto', route: 'EXTERNO', requiresInstallation: false,
      products: [{ ...products[1], length: 2 }], requestId: randomUUID(),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.field).toContain('length');
    const externalDimensions = await post('/orders', {
      clientId, description: 'Externo con medidas internas', value: 40000, documentType: 'REM',
      category: 'Proyecto', route: 'EXTERNO', requiresInstallation: false,
      products: [{ ...products[1], length: 2, width: 3 }], requestId: randomUUID(),
    });
    expect(externalDimensions.status).toBe(400);
    expect(externalDimensions.body.error.field).toContain('length');
  });
});

describe('Migración de materiales históricos', () => {
  it('representa cada material antiguo una sola vez sin duplicar los m²', async () => {
    const historical = await createPgliteDatabase();
    try {
      for (const name of ['001_access.sql', '002_clients.sql', '003_orders.sql', '004_finance.sql']) {
        await historical.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      }
      const owner = await bootstrapAdmin(historical, { name: 'Admin histórico', email: 'historico@example.test', password: PASSWORD });
      const historicalClient = randomUUID();
      const historicalOrder = randomUUID();
      await historical.query('INSERT INTO clients (id,name,identification,phone) VALUES ($1,$2,$3,$4)',
        [historicalClient, 'Cliente previo', 'NIT-800000002', '3001234567']);
      await historical.query(`
        INSERT INTO orders (id,client_id,description,value,document_type,category,route,requires_installation,status,
          created_by,material,length,width,printing_completed_at,creation_key,creation_fingerprint)
        VALUES ($1,$2,$3,100000,'REM','Proyecto','PRINT_ONLY',false,'COMPLETED',
          $4,'Banner',2,1.5,now(),$5,$6)
      `, [historicalOrder, historicalClient, 'Trabajo histórico', owner.id, randomUUID(), 'a'.repeat(64)]);
      for (const name of ['005_products.sql', '006_composite_order.sql', '007_product_dimensions.sql']) {
        await historical.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      }
      const rows = await historical.query<{ product_count: string; material_count: string; m2: string }>(`
        SELECT (SELECT count(*) FROM order_products WHERE order_id=$1) AS product_count,
          (SELECT count(*) FROM order_product_materials WHERE order_id=$1) AS material_count,
          (SELECT sum(round(length*width,3)) FROM order_product_materials
            WHERE order_id=$1 AND consumed_at IS NOT NULL) AS m2
      `, [historicalOrder]);
      expect(rows.rows[0]).toEqual({ product_count: 1, material_count: 1, m2: '3.000' });
      expect((await historical.query<{ is_legacy: boolean }>('SELECT is_legacy FROM order_products WHERE order_id=$1', [historicalOrder])).rows[0].is_legacy).toBe(true);
    } finally {
      await historical.close();
    }
  });

  it('conserva la OT de un esquema antiguo con Vinilo sin copiarlo al catálogo ni a métricas', async () => {
    const historical = await createPgliteDatabase();
    try {
      for (const name of ['001_access.sql', '002_clients.sql', '003_orders.sql', '004_finance.sql']) {
        let sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
        if (name === '003_orders.sql') {
          sql = sql.replace(
            "'Panaflex','V. Corte','V. Impresión','Banner'",
            "'Panaflex','Vinilo','V. Corte','V. Impresión','Banner'",
          );
        }
        await historical.exec(sql);
      }
      const owner = await bootstrapAdmin(historical, {
        name: 'Admin histórico Vinilo', email: 'historico-vinilo@example.test', password: PASSWORD,
      });
      const historicalClient = randomUUID();
      const historicalOrder = randomUUID();
      await historical.query('INSERT INTO clients (id,name,identification,phone) VALUES ($1,$2,$3,$4)',
        [historicalClient, 'Cliente Vinilo previo', 'NIT-800000003', '3001234567']);
      await historical.query(`
        INSERT INTO orders (id,client_id,description,value,document_type,category,route,requires_installation,status,
          created_by,material,length,width,printing_completed_at,creation_key,creation_fingerprint)
        VALUES ($1,$2,$3,100000,'REM','Proyecto','PRINT_ONLY',false,'COMPLETED',
          $4,'Vinilo',2,1.5,now(),$5,$6)
      `, [historicalOrder, historicalClient, 'Trabajo histórico en Vinilo', owner.id, randomUUID(), 'b'.repeat(64)]);

      for (const name of ['005_products.sql', '006_composite_order.sql', '007_product_dimensions.sql']) {
        await historical.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      }

      expect((await historical.query('SELECT id FROM orders WHERE id=$1', [historicalOrder])).rows).toHaveLength(1);
      expect((await historical.query('SELECT id FROM order_products WHERE order_id=$1', [historicalOrder])).rows).toHaveLength(1);
      expect((await historical.query('SELECT id FROM order_product_materials WHERE order_id=$1', [historicalOrder])).rows).toHaveLength(0);
    } finally {
      await historical.close();
    }
  });
});
