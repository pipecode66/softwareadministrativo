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

const API = '/api/v1';
const ORIGIN = 'http://127.0.0.1:5173';
const EMAIL = 'laser-master@example.test';
const PASSWORD = 'Una clave ficticia para laser 2026!';
const config = readConfig({ NODE_ENV: 'test', APP_ORIGINS: ORIGIN, LOGIN_RATE_LIMIT: '100' });
type Session = { cookie: string; csrf: string; user: PublicUser };
type Activity = {
  id: string;
  area: 'DESIGN' | 'PRINTING' | 'WORKSHOP' | 'EXTERNAL';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  assignedUserId: string | null;
  printingType?: 'PRINT' | 'LASER';
  laserMinutes?: number | null;
  laserRate?: number;
  laserCharge?: number;
};

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

function get(path: string, session = admin) {
  return request(app).get(`${API}${path}`).set('Cookie', session.cookie);
}
function post(path: string, payload: object, session = admin) {
  return request(app).post(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload);
}
function patch(path: string, payload: object, session = admin) {
  return request(app).patch(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload);
}
function put(path: string, payload: object, session = admin) {
  return request(app).put(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload);
}
function remove(path: string, session = admin) {
  return request(app).delete(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
}

function orderInput(products: object[], value: number, overrides: Record<string, unknown> = {}) {
  const areas = products.flatMap(product => (product as { activities: { area: string }[] }).activities.map(activity => activity.area));
  const printing = areas.includes('PRINTING');
  const workshop = areas.includes('WORKSHOP');
  const external = areas.includes('EXTERNAL');
  const route = external && (printing || workshop) ? 'MULTI_AREA'
    : external ? 'EXTERNO' : printing && workshop ? 'PRINT_WORKSHOP'
      : printing ? 'PRINT_ONLY' : workshop ? 'WORKSHOP_ONLY' : 'MULTI_AREA';
  return {
    clientId, description: 'Trabajo de prueba', value, documentType: 'REM', category: 'Proyecto',
    route, requiresInstallation: false, products, requestId: randomUUID(), ...overrides,
  };
}

async function activities(orderId: string, session = admin): Promise<Activity[]> {
  const response = await get(`/work/activities?orderId=${orderId}`, session);
  expect(response.status).toBe(200);
  return response.body.items as Activity[];
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
});
beforeEach(async () => {
  await db.exec('TRUNCATE order_events, payments, orders, clients, users RESTART IDENTITY CASCADE');
  await bootstrapAdmin(db, { name: 'Admin laser', email: EMAIL, password: PASSWORD });
  app = await createApp(db, config);
  admin = await login(EMAIL);
  clientId = randomUUID();
  await db.query(`
    INSERT INTO clients (id,name,identification,phone,special_payment)
    VALUES ($1,'Cliente laser','NIT-900000001','3001234567',false)
  `, [clientId]);
});
afterAll(async () => { await db?.close(); });

describe('Borrador propio de OT', () => {
  it('guarda un único payload incompleto, lo reemplaza y permite eliminarlo', async () => {
    expect((await get('/orders/draft')).body).toEqual({ draft: null });
    const first = await put('/orders/draft', { payload: {
      clientId: '', documentType: 'REM', products: [{ description: '', quantity: '1', materials: [] }],
    } });
    expect(first.status).toBe(200);
    expect(first.body.draft.payload.products[0].description).toBe('');
    const createdAt = first.body.draft.createdAt;

    const second = await put('/orders/draft', { payload: { clientId, note: 'segundo autosave' } });
    expect(second.status).toBe(200);
    expect(second.body.draft).toMatchObject({ payload: { clientId, note: 'segundo autosave' }, createdAt });
    expect((await db.query('SELECT created_by FROM order_drafts')).rows).toHaveLength(1);
    expect((await get('/orders/draft')).body.draft.payload.note).toBe('segundo autosave');

    expect((await remove('/orders/draft')).status).toBe(204);
    expect((await get('/orders/draft')).body).toEqual({ draft: null });
  });

  it('aísla el borrador por creador y niega los roles de producción', async () => {
    const designer = await actor('DISENO');
    const printer = await actor('IMPRESION');
    await put('/orders/draft', { payload: { owner: 'admin' } });
    await put('/orders/draft', { payload: { owner: 'designer' } }, designer);
    expect((await get('/orders/draft')).body.draft.payload.owner).toBe('admin');
    expect((await get('/orders/draft', designer)).body.draft.payload.owner).toBe('designer');
    expect((await get('/orders/draft', printer)).status).toBe(403);
    expect((await put('/orders/draft', { payload: {} }, printer)).status).toBe(403);
    expect((await remove('/orders/draft', printer)).status).toBe(403);
    await remove('/orders/draft', designer);
    expect((await get('/orders/draft')).body.draft.payload.owner).toBe('admin');
    expect((await db.query('SELECT created_by FROM order_drafts')).rows).toHaveLength(1);
  });

  it('valida que el payload sea un objeto y confirma RLS en la tabla', async () => {
    expect((await put('/orders/draft', { payload: [] })).status).toBe(400);
    expect((await put('/orders/draft', { payload: {}, extra: true })).status).toBe(400);
    const relation = (await db.query<{ relrowsecurity: boolean }>(`
      SELECT relrowsecurity FROM pg_class WHERE oid='order_drafts'::regclass
    `)).rows[0];
    expect(relation.relrowsecurity).toBe(true);
  });

  it('elimina el borrador únicamente después de crear la OT correctamente', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    await put('/orders/draft', { payload: { description: 'por crear' } });
    const invalid = await post('/orders', orderInput([
      { description: 'Sin área', quantity: 1, unitValue: 1000, materials: [], activities: [] },
    ], 1000));
    expect(invalid.status).toBe(400);
    expect((await get('/orders/draft')).body.draft).not.toBeNull();

    const created = await post('/orders', orderInput([
      { description: 'Externo', quantity: 1, unitValue: 1000, materials: [], activities: [{ area: 'EXTERNAL' }] },
    ], 1000));
    expect(created.status).toBe(201);
    expect(created.body.order.number).toBe(1);
    expect((await get('/orders/draft')).body).toEqual({ draft: null });
  });
});

describe('Corte Láser y total comercial', () => {
  const laserProduct = (unitValue = 0) => ({
    description: 'Corte de pieza', quantity: 1, unitValue,
    materials: [], activities: [{ area: 'PRINTING', printingType: 'LASER' }],
  });

  it('permite FACT solo láser en cero sin abono y aplica minutos, IVA y tarifa una sola vez', async () => {
    const created = await post('/orders', orderInput([laserProduct()], 0, { documentType: 'FACT' }));
    expect(created.status).toBe(201);
    expect(created.body.order.financials).toMatchObject({ base: 0, iva: 0, retentions: 0, collectible: 0 });
    expect(created.body.order.payments).toEqual([]);
    const orderId = created.body.order.id as string;
    const printer = await actor('IMPRESION');
    let laser = (await activities(orderId, printer))[0];
    expect(laser).toMatchObject({ area: 'PRINTING', printingType: 'LASER', laserMinutes: null, laserRate: 1000, laserCharge: 0 });
    expect((await post(`/work/activities/${laser.id}/start`, {}, printer)).status).toBe(200);
    expect((await post(`/work/activities/${laser.id}/complete`, {}, printer)).status).toBe(409);
    expect((await patch(`/work/activities/${laser.id}/laser`, { minutes: 1.5 }, printer)).status).toBe(400);
    expect((await patch(`/work/activities/${laser.id}/laser`, { minutes: 7 }, await actor('TALLER'))).status).toBe(403);
    const saved = await patch(`/work/activities/${laser.id}/laser`, { minutes: 7 }, printer);
    expect(saved.status).toBe(200);
    expect(saved.body.activity).toMatchObject({ laserMinutes: 7, laserRate: 1000, laserCharge: 7000 });
    expect((await post(`/work/activities/${laser.id}/complete`, {}, printer)).status).toBe(200);

    const order = (await get(`/orders/${orderId}`)).body.order;
    expect(order).toMatchObject({ value: 7000, status: 'COMPLETED', reteFuente: 0, reteIva: 0, ica: 0 });
    expect(order.financials).toMatchObject({ base: 7000, iva: 1330, retentions: 0, collectible: 8330, balance: 8330 });
    expect((await post(`/work/activities/${laser.id}/complete`, {}, printer)).status).toBe(200);
    expect((await get(`/orders/${orderId}`)).body.order.value).toBe(7000);
    expect((await patch(`/work/activities/${laser.id}/laser`, { minutes: 8 }, printer)).status).toBe(409);

    const today = dateOnly();
    expect((await get(`/reports/sales?from=${today}&to=${today}`)).body.totals)
      .toMatchObject({ base: 7000, iva: 1330 });
    expect((await get(`/reports/materials?from=${today}&to=${today}`)).body.totalM2).toBe(0);
  });

  it('recompone la base con todos los láser completados sin sumar pendientes ni reevaluar retenciones', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const created = await post('/orders', orderInput([
      laserProduct(250000),
      { ...laserProduct(250000), description: 'Segundo corte' },
    ], 500000, { documentType: 'FACT' }));
    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;
    const laserActivities = await activities(orderId);
    expect(laserActivities).toHaveLength(2);

    await post(`/work/activities/${laserActivities[0].id}/start`, {});
    await patch(`/work/activities/${laserActivities[0].id}/laser`, { minutes: 10 });
    await post(`/work/activities/${laserActivities[0].id}/complete`, {});
    let order = (await get(`/orders/${orderId}`)).body.order;
    expect(order.financials).toMatchObject({ base: 510000, iva: 96900, retentions: 0 });

    await patch(`/work/activities/${laserActivities[1].id}/laser`, { minutes: 20 });
    expect((await get(`/orders/${orderId}`)).body.order.value).toBe(510000);
    await post(`/work/activities/${laserActivities[1].id}/start`, {});
    await post(`/work/activities/${laserActivities[1].id}/complete`, {});
    order = (await get(`/orders/${orderId}`)).body.order;
    expect(order).toMatchObject({ value: 530000, reteFuente: 0, reteIva: 0, ica: 0 });
    expect(order.financials).toMatchObject({ base: 530000, iva: 100700, retentions: 0, collectible: 630700 });
  });

  it('actualiza IVA sin recalcular las retenciones existentes al completar Corte Láser', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const created = await post('/orders', orderInput([laserProduct(600000)], 600000, { documentType: 'FACT' }));
    expect(created.status).toBe(201);
    expect(created.body.order).toMatchObject({ reteFuente: 24000, reteIva: 17100, ica: 4200 });
    const laser = (await activities(created.body.order.id))[0];
    expect((await patch(`/work/activities/${laser.id}/laser`, { minutes: 5 })).status).toBe(200);
    expect((await post(`/work/activities/${laser.id}/start`, {})).status).toBe(200);
    expect((await post(`/work/activities/${laser.id}/complete`, {})).status).toBe(200);
    const after = (await get(`/orders/${created.body.order.id}`)).body.order;
    expect(after).toMatchObject({ value: 605000, reteFuente: 24000, reteIva: 17100, ica: 4200 });
    expect(after.financials).toMatchObject({ base: 605000, iva: 114950, retentions: 45300, collectible: 674650 });
  });

  it('permite a Administración iniciar y completar actividades de todas las áreas', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const product = {
      description: 'Flujo completo', quantity: 1, unitValue: 600000,
      materials: [{ material: 'Banner', length: 1, width: 1 }],
      activities: [
        { area: 'DESIGN' }, { area: 'PRINTING', printingType: 'PRINT' },
        { area: 'WORKSHOP' }, { area: 'EXTERNAL' },
      ],
    };
    const created = await post('/orders', orderInput([product], 600000, { documentType: 'FACT' }));
    expect(created.status).toBe(201);
    const before = created.body.order;
    expect(before).toMatchObject({ reteFuente: 24000, reteIva: 17100, ica: 4200 });
    const queue = await activities(before.id);
    for (const activity of queue) {
      expect((await post(`/work/activities/${activity.id}/start`, {})).status).toBe(200);
      expect((await post(`/work/activities/${activity.id}/complete`, {})).status).toBe(200);
    }
    const after = (await get(`/orders/${before.id}`)).body.order;
    expect(after).toMatchObject({ status: 'COMPLETED', value: 600000, reteFuente: 24000, reteIva: 17100, ica: 4200 });
  });

  it('rechaza base cero sin láser, material en láser y cantidades fraccionarias', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const externalZero = await post('/orders', orderInput([
      { description: 'Externo', quantity: 1, unitValue: 0, materials: [], activities: [{ area: 'EXTERNAL' }] },
    ], 0));
    expect(externalZero.status).toBe(400);
    const remLaser = await post('/orders', orderInput([laserProduct()], 0));
    expect(remLaser.status).toBe(400);
    const mixedFact = await post('/orders', orderInput([
      laserProduct(),
      { description: 'Externo en cero', quantity: 1, unitValue: 0, materials: [], activities: [{ area: 'EXTERNAL' }] },
    ], 0, { documentType: 'FACT' }));
    expect(mixedFact.status).toBe(400);
    const laserMaterial = await post('/orders', orderInput([{
      ...laserProduct(), materials: [{ material: 'Banner', length: 1, width: 1 }],
    }], 0, { documentType: 'FACT' }));
    expect(laserMaterial.status).toBe(400);
    const fractional = await post('/orders', orderInput([{
      description: 'Cantidad inválida', quantity: 1.5, unitValue: 1000,
      materials: [], activities: [{ area: 'EXTERNAL' }],
    }], 1500));
    expect(fractional.status).toBe(400);
    const printWithoutPreparation = await post('/orders', orderInput([{
      description: 'Impresión sin material ni diseño', quantity: 1, unitValue: 1000,
      materials: [], activities: [{ area: 'PRINTING', printingType: 'PRINT' }],
    }], 1000));
    expect(printWithoutPreparation.status).toBe(400);
    expect(printWithoutPreparation.body.error.code).toBe('PRINT_MATERIAL_REQUIRED');
  });
});

describe('Diseño autoasignado y edición técnica', () => {
  it('fuerza una sola actividad de Diseño, primera y asignada al diseñador creador', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const designer = await actor('DISENO', 'Diseñador creador');
    const other = await actor('DISENO', 'Diseñador ajeno');
    const response = await post('/orders', orderInput([{
      description: 'Preparación pendiente', quantity: 1, unitValue: 10000, materials: [],
      activities: [
        { area: 'DESIGN', assignedUserId: other.user.id },
        { area: 'DESIGN' },
        { area: 'PRINTING', printingType: 'PRINT' },
      ],
    }], 10000), designer);
    expect(response.status).toBe(201);
    const queue = await activities(response.body.order.id);
    expect(queue.map(item => item.area)).toEqual(['DESIGN', 'PRINTING']);
    expect(queue[0].assignedUserId).toBe(designer.user.id);
    const row = await db.query<{ count: number; position: number; assigned_user_id: string }>(`
      SELECT count(*) OVER () AS count,position,assigned_user_id FROM order_activities
      WHERE order_id=$1 AND area='DESIGN'
    `, [response.body.order.id]);
    expect(row.rows[0]).toMatchObject({ count: 1, position: 1, assigned_user_id: designer.user.id });
  });

  it('solo el diseñador asignado edita descripción y materiales antes de completar Diseño', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const designer = await actor('DISENO', 'Diseñador asignado');
    const other = await actor('DISENO', 'Otro diseñador');
    const created = await post('/orders', orderInput([
      {
        description: 'Descripción inicial', quantity: 1, unitValue: 50000, materials: [],
        activities: [{ area: 'DESIGN', assignedUserId: designer.user.id }, { area: 'PRINTING', printingType: 'PRINT' }],
      },
      {
        description: 'Trabajo externo conservado', quantity: 1, unitValue: 10000, materials: [],
        activities: [{ area: 'EXTERNAL' }],
      },
    ], 60000));
    expect(created.status).toBe(201);
    const design = (await activities(created.body.order.id)).find(item => item.area === 'DESIGN')!;
    const endpoint = `/work/activities/${design.id}/design-details`;
    expect((await patch(endpoint, { description: 'Ajena' }, other)).status).toBe(404);
    expect((await patch(endpoint, { description: 'Administrativa' })).status).toBe(403);
    expect((await patch(endpoint, { description: 'Inválida', unitValue: 1 }, designer)).status).toBe(400);

    expect((await post(`/work/activities/${design.id}/start`, {}, designer)).status).toBe(200);
    expect((await post(`/work/activities/${design.id}/complete`, {}, designer)).status).toBe(409);
    const edited = await patch(endpoint, {
      description: 'Descripción técnica final',
      materials: [
        { material: 'Banner', length: 2, width: 1.5 },
        { material: 'V. Corte', length: 1, width: 0.5 },
      ],
    }, designer);
    expect(edited.status).toBe(200);
    expect(edited.body.activity).toMatchObject({ productDescription: 'Descripción técnica final' });
    expect(edited.body.activity.materials).toHaveLength(2);
    const order = (await get(`/orders/${created.body.order.id}`)).body.order;
    expect(order).toMatchObject({
      description: '1. Descripción técnica final\n2. Trabajo externo conservado', value: 60000,
    });
    expect((await post(`/work/activities/${design.id}/complete`, {}, designer)).status).toBe(200);
    expect((await patch(endpoint, { description: 'Tardía' }, designer)).status).toBe(409);

    const work = await get(`/work/orders/${created.body.order.id}`);
    expect(work.body.products[0]).not.toHaveProperty('specifications');
    expect(work.body.products[0]).not.toHaveProperty('length');
    expect(work.body.products[0]).not.toHaveProperty('width');
    expect(work.body.products[0].materials[0]).toMatchObject({ length: 2, width: 1.5 });
  });

  it('no exige materiales al completar Diseño cuando la impresión posterior es Corte Láser', async () => {
    await db.query('UPDATE clients SET special_payment=true WHERE id=$1', [clientId]);
    const designer = await actor('DISENO');
    const created = await post('/orders', orderInput([{
      description: 'Diseño para láser', quantity: 1, unitValue: 10000, materials: [],
      activities: [{ area: 'DESIGN', assignedUserId: designer.user.id }, { area: 'PRINTING', printingType: 'LASER' }],
    }], 10000));
    const design = (await activities(created.body.order.id)).find(item => item.area === 'DESIGN')!;
    await post(`/work/activities/${design.id}/start`, {}, designer);
    expect((await post(`/work/activities/${design.id}/complete`, {}, designer)).status).toBe(200);
  });
});

describe('Migración 008 sobre trabajo existente', () => {
  it('convierte Impresión histórica en PRINT y protege láser completado sin minutos', async () => {
    const historical = await createPgliteDatabase();
    try {
      for (const name of [
        '001_access.sql', '002_clients.sql', '003_orders.sql', '004_finance.sql',
        '005_products.sql', '006_composite_order.sql', '007_product_dimensions.sql',
      ]) {
        await historical.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      }
      const owner = await bootstrapAdmin(historical, {
        name: 'Admin migración', email: 'migration-laser@example.test', password: PASSWORD,
      });
      const oldClient = randomUUID();
      const orderId = randomUUID();
      const productId = randomUUID();
      const printId = randomUUID();
      await historical.query(`
        INSERT INTO clients (id,name,identification,phone,special_payment)
        VALUES ($1,'Cliente previo','NIT-1','3000000000',true)
      `, [oldClient]);
      await historical.query(`
        INSERT INTO orders (id,client_id,description,value,document_type,category,route,requires_installation,
          status,created_by,creation_key,creation_fingerprint)
        VALUES ($1,$2,'OT previa',1000,'REM','Proyecto','MULTI_AREA',false,
          'IN_PRODUCTION',$3,$4,$5)
      `, [orderId, oldClient, owner.id, randomUUID(), 'd'.repeat(64)]);
      await historical.query(`
        INSERT INTO order_products (id,order_id,position,description,quantity,unit_value)
        VALUES ($1,$2,1,'Producto previo',1,1000)
      `, [productId, orderId]);
      await historical.query(`
        INSERT INTO order_activities (id,order_id,product_id,position,area)
        VALUES ($1,$2,$3,1,'PRINTING')
      `, [printId, orderId, productId]);

      await historical.exec(await readFile(new URL('../migrations/008_laser_drafts.sql', import.meta.url), 'utf8'));
      expect((await historical.query<{ printing_type: string }>(
        'SELECT printing_type FROM order_activities WHERE id=$1', [printId],
      )).rows[0].printing_type).toBe('PRINT');
      expect((await historical.query<{ relrowsecurity: boolean }>(`
        SELECT relrowsecurity FROM pg_class WHERE oid='order_drafts'::regclass
      `)).rows[0].relrowsecurity).toBe(true);

      const laserId = randomUUID();
      await historical.query(`
        INSERT INTO order_activities (id,order_id,product_id,position,area,printing_type)
        VALUES ($1,$2,$3,2,'PRINTING','LASER')
      `, [laserId, orderId, productId]);
      await expect(historical.query(
        "UPDATE order_activities SET status='COMPLETED',completed_at=now() WHERE id=$1", [laserId],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await historical.close();
    }
  });
});
