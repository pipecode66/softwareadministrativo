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
type Activity = { id: string; area: string; status: string; ready: boolean; assignedUserId: string | null;
  receivedByWorkshop?: string; workshopNotes?: string; materials: { consumedAt: string | null }[] };
let db: Database;
let app: Express;
let admin: Session;
let clientId: string;
let defaultDesignerId: string;

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
  { description: 'Pieza impresa a todo color', quantity: 2, unitValue: 30000,
    materials: [{ material: 'Banner', length: 2, width: 1.5 }, { material: 'Panaflex', length: 1, width: 2 }],
    activities: [{ area: 'DESIGN' }, { area: 'PRINTING' }, { area: 'WORKSHOP' }] },
  { description: 'Pieza por proveedor; coordinar entrega', quantity: 1, unitValue: 40000,
    materials: [], activities: [{ area: 'EXTERNAL' }] },
];

async function create(overrides: Record<string, unknown> = {}, session = admin) {
  const requestedProducts = (overrides.products as typeof products | undefined) ?? products;
  const assignedProducts = requestedProducts.map(product => ({ ...product, activities: product.activities.map(activity =>
    activity.area === 'DESIGN' && !('assignedUserId' in activity)
      ? { ...activity, assignedUserId: defaultDesignerId }
      : activity) }));
  const response = await post('/orders', {
    clientId, description: 'OT compuesta', value: 100000, documentType: 'REM', category: 'Proyecto',
    route: 'MULTI_AREA', requiresInstallation: false, ...overrides, products: assignedProducts, requestId: randomUUID(),
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
  defaultDesignerId = randomUUID();
  await db.query(`
    INSERT INTO users (id,name,email,role,password_hash,must_change_password)
    SELECT $1,$2,$3,'DISENO',password_hash,false FROM users WHERE id=$4
  `, [defaultDesignerId, 'Diseñador predeterminado', `default-${defaultDesignerId}@example.test`, admin.user.id]);
  clientId = randomUUID();
  await db.query('INSERT INTO clients (id,name,identification,phone,special_payment) VALUES ($1,$2,$3,$4,true)',
    [clientId, 'Cliente de prueba', 'NIT-800000001', '3001234567']);
});
afterAll(async () => { await db?.close(); });

describe('Productos y trabajo interno', () => {
  it('exige un diseñador específico al incluir Diseño', async () => {
    const response = await post('/orders', {
      clientId, description: 'Diseño sin responsable', value: 40000, documentType: 'REM', category: 'Proyecto',
      route: 'MULTI_AREA', requiresInstallation: false, requestId: randomUUID(), products: [{
        description: 'Arte pendiente', quantity: 1, unitValue: 40000, materials: [], activities: [{ area: 'DESIGN' }],
      }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'DESIGNER_REQUIRED', field: 'products.activities.assignedUserId' });
    expect((await db.query('SELECT id FROM orders')).rows).toHaveLength(0);
    expect((await post('/work/activities/no-existe/claim', {}, await actor('DISENO'))).status).toBe(404);
  });

  it('conserva un solo valor comercial y muestra dos productos y cuatro actividades', async () => {
    const order = await create();
    expect(order.status).toBe('IN_PRODUCTION');
    const read = await get(`/work/orders/${order.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ orderNumber: 1, products: [
      { description: 'Pieza impresa a todo color', quantity: 2, unitValue: 30000, lineTotal: 60000,
        materials: [{ material: 'Banner', areaM2: 3, consumedAt: null },
          { material: 'Panaflex', areaM2: 2, consumedAt: null }],
        activities: [{ area: 'DESIGN' }, { area: 'PRINTING' }, { area: 'WORKSHOP' }] },
      { description: 'Pieza por proveedor; coordinar entrega', lineTotal: 40000, activities: [{ area: 'EXTERNAL' }] },
    ] });
    const printPage = await get('/work/activities?area=PRINTING&pageSize=1');
    expect(printPage.body.total).toBe(1);
    expect(printPage.body.items).toEqual([expect.objectContaining({ area: 'PRINTING', printingType: 'PRINT' })]);
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
    expect((await post(`/work/activities/${design.id}/start`, {}, designer)).status).toBe(404);
    const assignedDesigner = await login(`default-${defaultDesignerId}@example.test`);
    expect((await post(`/work/activities/${design.id}/start`, {}, assignedDesigner)).status).toBe(200);
    expect((await post(`/work/activities/${design.id}/complete`, {}, assignedDesigner)).status).toBe(200);
    expect((await post(`/work/activities/${cutting.id}/start`, {}, workshop)).status).toBe(409);
    expect((await get(`/work/activities?orderId=${order.id}`, printer)).body.items[0].materials[0].consumedAt).toBeNull();
    expect((await post(`/work/activities/${printing.id}/start`, {}, printer)).status).toBe(200);
    const missingRecipient = await post(`/work/activities/${printing.id}/complete`, {}, printer);
    expect(missingRecipient.status).toBe(400);
    expect(missingRecipient.body.error.message).toBe('Por favor, digitar quien recibe en taller.');
    const blankRecipient = await post(`/work/activities/${printing.id}/complete`, { receivedByWorkshop: '   ' }, printer);
    expect(blankRecipient.status).toBe(400);
    expect(blankRecipient.body.error.message).toBe('Por favor, digitar quien recibe en taller.');
    const printed = await post(`/work/activities/${printing.id}/complete`, { receivedByWorkshop: '  Carlos Taller  ' }, printer);
    expect(printed.status).toBe(200);
    expect(printed.body.activity.receivedByWorkshop).toBe('Carlos Taller');
    expect(printed.body.activity.materials[0].consumedAt).toBeTruthy();
    const workshopView = await get(`/work/orders/${order.id}`, workshop);
    expect(workshopView.body.products[0].activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'PRINTING', receivedByWorkshop: 'Carlos Taller' }),
    ]));
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
    const workshopFinished = await post(`/work/activities/${cutting.id}/complete`, { workshopNotes: '  Entregar con cuidado  ' }, workshop);
    expect(workshopFinished.status).toBe(200);
    expect(workshopFinished.body.activity.workshopNotes).toBe('Entregar con cuidado');
    expect((await get(`/work/orders/${order.id}`, workshop)).body.products[0].activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'WORKSHOP', workshopNotes: 'Entregar con cuidado' }),
    ]));
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
    expect(load.body.unassigned).toBe(0);
    expect((await get('/work/designers/load', designer)).status).toBe(403);
    const commercial = await actor('APOYO_COMERCIAL');
    const options = await get('/work/designers/options', commercial);
    expect(options.status).toBe(200);
    expect(options.body.items).toEqual(expect.arrayContaining([
      { id: designer.user.id, name: designer.user.name },
    ]));
    expect(options.body.items[0]).not.toHaveProperty('pending');
    expect((await get('/work/designers/load', commercial)).status).toBe(403);
    const assigned = await patch(`/work/activities/${design.id}/assign`, { assignedUserId: designer.user.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.activity.assignedUserId).toBe(designer.user.id);
    expect((await get('/work/designers/load')).body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: designer.user.id, pending: 1, total: 1 }),
    ]));
    const replacement = [
      { ...products[0], description: 'Pieza corregida', unitValue: 25000,
        activities: products[0].activities.map(activity => activity.area === 'DESIGN' ? { ...activity, assignedUserId: designer.user.id } : activity) },
      { ...products[1], unitValue: 50000 },
    ];
    await db.transaction(tx => replaceOrderProducts(tx, order.id, replacement));
    expect((await get(`/work/orders/${order.id}`)).body.products[0].description).toBe('Pieza corregida');
    const nextDesign = ((await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[])
      .find(item => item.area === 'DESIGN')!;
    expect((await post(`/work/activities/${design.id}/start`, {}, designer)).status).toBe(404);
    await post(`/work/activities/${nextDesign.id}/start`, {}, designer);
    const materialCorrection = [
      { ...replacement[0], materials: [{ material: 'V. Impresión', length: 3, width: 2 }] },
      replacement[1],
    ];
    await expect(db.transaction(tx => replaceOrderProducts(tx, order.id, materialCorrection))).resolves.toBeUndefined();
    const afterCorrection = await get(`/work/orders/${order.id}`);
    expect(afterCorrection.body.products[0].materials).toEqual([
      expect.objectContaining({ material: 'V. Impresión', length: 3, width: 2 }),
    ]);
    expect(afterCorrection.body.products[0].activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: nextDesign.id, status: 'IN_PROGRESS' }),
    ]));
    await expect(db.transaction(tx => replaceOrderProducts(tx, order.id, [
      { ...materialCorrection[0], description: 'Cambio comercial tardío' }, materialCorrection[1],
    ])))
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

  it('retira campos de producto obsoletos y permite Externo junto con Impresión', async () => {
    const valid = await create({ requiresInstallation: false, value: 40000, route: 'EXTERNO', products: [products[1]] });
    expect((await get(`/work/orders/${valid.id}`)).body.products[0]).not.toHaveProperty('length');
    expect((await get(`/work/orders/${valid.id}`)).body.products[0]).not.toHaveProperty('specifications');
    const invalid = await post('/orders', {
      clientId, description: 'Medida incompleta', value: 40000, documentType: 'REM',
      category: 'Proyecto', route: 'EXTERNO', requiresInstallation: false,
      products: [{ ...products[1], length: 2 }], requestId: randomUUID(),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.field).toContain('products.0');
    const externalDimensions = await post('/orders', {
      clientId, description: 'Externo con medidas internas', value: 40000, documentType: 'REM',
      category: 'Proyecto', route: 'EXTERNO', requiresInstallation: false,
      products: [{ ...products[1], length: 2, width: 3 }], requestId: randomUUID(),
    });
    expect(externalDimensions.status).toBe(400);
    expect(externalDimensions.body.error.field).toContain('products.0');
    const obsoleteSpecifications = await post('/orders', {
      clientId, description: 'Campo retirado', value: 40000, documentType: 'REM',
      category: 'Proyecto', route: 'EXTERNO', requiresInstallation: false,
      products: [{ ...products[1], specifications: 'Ya no aplica' }], requestId: randomUUID(),
    });
    expect(obsoleteSpecifications.status).toBe(400);
    expect(obsoleteSpecifications.body.error.field).toContain('products.0');

    const combined = await create({ value: 60000, route: 'MULTI_AREA', products: [{
      description: 'Impresión con gestión externa', quantity: 1, unitValue: 60000,
      materials: [{ material: 'Banner', length: 1, width: 1 }],
      activities: [{ area: 'PRINTING', printingType: 'PRINT' }, { area: 'EXTERNAL' }],
    }] });
    expect((await get(`/work/orders/${combined.id}`)).body.products[0].activities)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ area: 'PRINTING', printingType: 'PRINT' }),
        expect.objectContaining({ area: 'EXTERNAL' }),
      ]));
  });

  it('Administración reabre una OT terminada agregando áreas sin borrar Diseño finalizado', async () => {
    const order = await create({ value:40000, route:'MULTI_AREA', products:[{
      description:'Arte aprobado', quantity:1, unitValue:40000, materials:[],
      activities:[{ area:'DESIGN', assignedUserId:defaultDesignerId }],
    }] });
    const designer = await login(`default-${defaultDesignerId}@example.test`);
    const design = ((await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[])[0];
    await post(`/work/activities/${design.id}/start`, {}, designer);
    await post(`/work/activities/${design.id}/complete`, {}, designer);
    const completed = (await get(`/orders/${order.id}`)).body.order;
    expect(completed.status).toBe('COMPLETED');
    const general = await actor('ADMIN_GENERAL');
    const payload = {
      clientId, description:'Arte aprobado', value:40000, documentType:'REM', category:'Proyecto',
      route:'PRINT_WORKSHOP', requiresInstallation:false, reteFuente:0, reteIva:0, ica:0,
      products:[{ description:'Arte aprobado', quantity:1, unitValue:40000,
        materials:[{ material:'Banner', length:2, width:1 }], activities:[
          { area:'DESIGN', assignedUserId:defaultDesignerId }, { area:'PRINTING', printingType:'PRINT' }, { area:'WORKSHOP' },
        ] }], expectedVersion:completed.version,
    };
    const reopened = await patch(`/orders/${order.id}`, payload, general);
    expect(reopened.status).toBe(200);
    expect(reopened.body.order.status).toBe('IN_PRODUCTION');
    const activities = (await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[];
    expect(activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id:design.id, area:'DESIGN', status:'COMPLETED' }),
      expect.objectContaining({ area:'PRINTING', status:'PENDING' }),
      expect.objectContaining({ area:'WORKSHOP', status:'PENDING' }),
    ]));
    expect(activities).toHaveLength(3);
    await db.query("UPDATE orders SET requires_installation=true,status='INSTALLED',installed_at=now() WHERE id=$1", [order.id]);
    const installed = (await get(`/orders/${order.id}`)).body.order;
    const installedEdit = await patch(`/orders/${order.id}`, {
      ...payload, requiresInstallation:true, description:'Trabajo corregido después de instalar', expectedVersion:installed.version,
    }, general);
    expect(installedEdit.status).toBe(200);
    expect(installedEdit.body.order).toMatchObject({
      status:'INSTALLED', description:'Trabajo corregido después de instalar',
    });
    await db.query('UPDATE orders SET closed_at=now() WHERE id=$1', [order.id]);
    const closed = await get(`/orders/${order.id}`);
    const closedEdit = await patch(`/orders/${order.id}`, {
      ...payload, requiresInstallation:true, expectedVersion:closed.body.order.version, description:'Corrección administrativa posterior al cierre',
    }, general);
    expect(closedEdit.status, JSON.stringify(closedEdit.body)).toBe(200);
    expect(closedEdit.body.order).toMatchObject({
      status:'INSTALLED', description:'Corrección administrativa posterior al cierre',
      closedAt:closed.body.order.closedAt,
    });
  });

  it('edita una OT compuesta activa y permite corregir también materiales consumidos', async () => {
    const order = await create();
    await db.query(`UPDATE order_activities SET status='COMPLETED',completed_at=now()
      WHERE order_id=$1 AND area='DESIGN'`, [order.id]);
    await db.query("UPDATE orders SET status='IN_PRINTING' WHERE id=$1", [order.id]);
    const current = (await get(`/orders/${order.id}`)).body.order;
    expect((await get('/orders?status=IN_PRINTING')).body.items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id:order.id, isComposite:true })]));
    const payload = {
      clientId, description:'OT compuesta corregida en impresión', value:100000, documentType:'REM', category:'Proyecto',
      route:'MULTI_AREA', requiresInstallation:false, reteFuente:0, reteIva:0, ica:0,
      products: products.map(product => ({ ...product, activities:product.activities.map(activity =>
        activity.area === 'DESIGN' ? { ...activity, assignedUserId:defaultDesignerId } : activity) })),
      expectedVersion:current.version,
    };
    const edited = await patch(`/orders/${order.id}`, payload);
    expect(edited.status).toBe(200);
    expect(edited.body.order).toMatchObject({ status:'IN_PRINTING', description:'OT compuesta corregida en impresión' });
    const activities = (await get(`/work/activities?orderId=${order.id}`)).body.items as Activity[];
    expect(activities.find(activity => activity.area === 'DESIGN')?.status).toBe('COMPLETED');

    const first = (await get(`/work/orders/${order.id}`)).body.products[0];
    const changedMaterials = structuredClone(payload.products);
    changedMaterials[0]!.materials[0]!.length = 3;
    const pendingMaterialEdit = await patch(`/orders/${order.id}`, {
      ...payload, expectedVersion:edited.body.order.version, products:changedMaterials,
    });
    expect(pendingMaterialEdit.status).toBe(200);
    await db.query('UPDATE order_product_materials SET consumed_at=now() WHERE product_id=$1',
      [(first as { id:string }).id]);
    changedMaterials[0]!.materials[0]!.length = 4;
    const rejected = await patch(`/orders/${order.id}`, {
      ...payload, expectedVersion:pendingMaterialEdit.body.order.version, products:changedMaterials,
    });
    expect(rejected.status).toBe(200);
    expect((await get(`/work/orders/${order.id}`)).body.products[0].materials[0]).toMatchObject({ length:4, consumedAt:expect.any(String) });
  });

  it('permite editar una OT IN_PRODUCTION con Impresión iniciada sin borrar su avance ni materiales', async () => {
    const order = await create();
    await db.query(`UPDATE order_activities SET status='COMPLETED',completed_at=now()
      WHERE order_id=$1 AND area='DESIGN'`, [order.id]);
    await db.query(`UPDATE order_activities SET status='IN_PROGRESS',started_at=now()
      WHERE order_id=$1 AND area='PRINTING'`, [order.id]);
    await db.query('UPDATE order_product_materials SET consumed_at=now() WHERE order_id=$1', [order.id]);
    await db.query("UPDATE orders SET status='IN_PRODUCTION' WHERE id=$1", [order.id]);

    const current = (await get(`/orders/${order.id}`)).body.order;
    const updatedProducts = products.map((product, index) => ({
      ...product,
      description: index === 0 ? 'Pieza corregida para el cliente' : product.description,
      activities: product.activities.map(activity => activity.area === 'DESIGN'
        ? { ...activity, assignedUserId:defaultDesignerId }
        : activity),
    }));
    const response = await patch(`/orders/${order.id}`, {
      clientId, description:'OT corregida durante producción', value:100000, documentType:'REM',
      category:'Proyecto', route:'MULTI_AREA', requiresInstallation:false, reteFuente:0, reteIva:0, ica:0,
      products:updatedProducts, expectedVersion:current.version,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.order).toMatchObject({ status:'IN_PRODUCTION', description:'OT corregida durante producción' });
    expect((await get(`/work/activities?orderId=${order.id}`)).body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ area:'DESIGN', status:'COMPLETED' }),
      expect.objectContaining({ area:'PRINTING', status:'IN_PROGRESS' }),
    ]));
    const saved = (await get(`/work/orders/${order.id}`)).body.products[0];
    expect(saved.description).toBe('Pieza corregida para el cliente');
    expect(saved.materials).toEqual(expect.arrayContaining([
      expect.objectContaining({ material:'Banner', consumedAt:expect.any(String) }),
      expect.objectContaining({ material:'Panaflex', consumedAt:expect.any(String) }),
    ]));
  });
});

describe('Corrección administrativa integral de materiales', () => {
  it('corrige minutos de Corte Láser finalizado y recompone el valor sin reiniciar el trabajo',async()=>{
    const order=await create({route:'PRINT_ONLY',products:[{description:'Corte',quantity:1,unitValue:100000,
      materials:[],activities:[{area:'PRINTING',printingType:'LASER'}]}]});
    const activity=(await get(`/work/activities?orderId=${order.id}`)).body.items[0];
    expect((await post(`/work/activities/${activity.id}/start`,{})).status).toBe(200);
    expect((await patch(`/work/activities/${activity.id}/laser`,{minutes:10})).status).toBe(200);
    expect((await post(`/work/activities/${activity.id}/complete`,{receivedByWorkshop:'Recepción'})).status).toBe(200);
    const completed=(await get(`/orders/${order.id}`)).body.order;
    expect(completed.value).toBe(110000);
    const product=(await get(`/work/orders/${order.id}`)).body.products[0];
    const result=await patch(`/orders/${order.id}`,{clientId,description:'Corte corregido',value:120000,documentType:'REM',category:'Proyecto',
      route:'PRINT_ONLY',requiresInstallation:false,expectedVersion:completed.version,products:[{id:product.id,description:'Corte',quantity:1,unitValue:100000,
        materials:[],activities:[{area:'PRINTING',printingType:'LASER',laserMinutes:20}]}]});
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(result.body.order).toMatchObject({status:'COMPLETED',value:120000});
    const saved=(await get(`/work/activities?orderId=${order.id}`)).body.items[0];
    expect(saved).toMatchObject({id:activity.id,status:'COMPLETED',laserMinutes:20});
  });
  it.each([
    ['ADMINMASTER','IN_PRODUCTION'],['ADMIN_GENERAL','IN_PRODUCTION'],
    ['ADMINMASTER','COMPLETED'],['ADMIN_GENERAL','COMPLETED'],
    ['ADMINMASTER','INSTALLED'],['ADMIN_GENERAL','INSTALLED'],
  ] as const)('%s corrige consumo en OT %s sin duplicar m² ni cambiar su fecha',async(role,status)=>{
    const order=await create({route:'PRINT_WORKSHOP',products:[{description:'Aviso',quantity:1,unitValue:100000,
      materials:[{material:'Panaflex',length:2,width:4}],activities:[{area:'PRINTING'},{area:'WORKSHOP'}]}]});
    const stamp=new Date().toISOString();
    await db.query("UPDATE order_activities SET status='COMPLETED',completed_at=$2 WHERE order_id=$1 AND area='PRINTING'",[order.id,stamp]);
    if(status!=='IN_PRODUCTION') await db.query("UPDATE order_activities SET status='COMPLETED',completed_at=$2 WHERE order_id=$1",[order.id,stamp]);
    await db.query('UPDATE order_product_materials SET consumed_at=$2 WHERE order_id=$1',[order.id,stamp]);
    await db.query(`UPDATE orders SET status=$2::varchar,requires_installation=($2::varchar='INSTALLED'),
      installed_at=CASE WHEN $2::varchar='INSTALLED' THEN $3::timestamptz ELSE NULL END,
      closed_at=CASE WHEN $2::varchar='IN_PRODUCTION' THEN NULL ELSE $3::timestamptz END WHERE id=$1`,[order.id,status,stamp]);
    const before=(await get(`/orders/${order.id}`)).body.order;
    const items=(await get(`/work/orders/${order.id}`)).body.products;
    const activitiesBefore=(await get(`/work/activities?orderId=${order.id}`)).body.items;
    const updated=await patch(`/orders/${order.id}`,{clientId,description:'Material corregido',value:100000,documentType:'REM',
      category:'Proyecto',route:'PRINT_WORKSHOP',requiresInstallation:status==='INSTALLED',expectedVersion:before.version,
      products:items.map((product:{id:string;description:string;quantity:number;unitValue:number})=>({id:product.id,description:product.description,
        quantity:product.quantity,unitValue:product.unitValue,materials:[{material:'V. Impresión',length:2,width:4}],
        activities:[{area:'PRINTING',printingType:'PRINT'},{area:'WORKSHOP'}]}))},role==='ADMINMASTER'?admin:await actor(role));
    expect(updated.status,JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.order).toMatchObject({status,isComposite:true});
    if(status!=='IN_PRODUCTION') expect(updated.body.order.closedAt).toBe(before.closedAt);
    const consumed=(await db.query<{material:string;consumed_at:string}>('SELECT material,consumed_at FROM order_product_materials WHERE order_id=$1',[order.id])).rows;
    expect(consumed).toHaveLength(1);expect(consumed[0].material).toBe('V. Impresión');
    expect(new Date(consumed[0].consumed_at).toISOString()).toBe(stamp);
    const report=await get(`/reports/materials?from=${dateOnly()}&to=${dateOnly()}`);
    expect(report.status).toBe(200);expect(report.body.totalM2).toBe(8);
    expect(report.body.materials.find((item:{material:string})=>item.material==='Panaflex').m2).toBe(0);
    expect(report.body.materials.find((item:{material:string})=>item.material==='V. Impresión').m2).toBe(8);
    const after=(await get(`/work/activities?orderId=${order.id}`)).body.items;
    expect(after.map((item:Activity)=>({id:item.id,status:item.status}))).toEqual(activitiesBefore.map((item:Activity)=>({id:item.id,status:item.status})));
    const history=(await get(`/history?orderId=${order.id}`)).body.items;
    expect(history[0].details.changes).toEqual(expect.arrayContaining([expect.objectContaining({label:'Producto 1 · Materiales',before:expect.stringContaining('Panaflex'),after:expect.stringContaining('V. Impresión')})]));
  });
  it('permite retirar productos y agregar otros sin trasladar identidades entre trabajos',async()=>{
    const order=await create();
    const original=(await get(`/work/orders/${order.id}`)).body.products;
    const second=original[1];
    const response=await patch(`/orders/${order.id}`,{clientId,description:'Proveedor corregido',value:60000,documentType:'REM',category:'Proyecto',
      route:'MULTI_AREA',requiresInstallation:false,expectedVersion:order.version,products:[
        {id:second.id,description:second.description,quantity:1,unitValue:40000,materials:[],activities:[{area:'EXTERNAL'}]},
        {description:'Trabajo nuevo',quantity:1,unitValue:20000,materials:[],activities:[{area:'WORKSHOP'}]},
      ]});
    expect(response.status,JSON.stringify(response.body)).toBe(200);
    const saved=(await get(`/work/orders/${order.id}`)).body.products;
    expect(saved[0].id).toBe(second.id);expect(saved[1].id).not.toBe(original[0].id);
    expect((await db.query('SELECT id FROM order_products WHERE id=$1',[original[0].id])).rows).toHaveLength(0);
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
      const workshopOrder = randomUUID();
      await historical.query('INSERT INTO clients (id,name,identification,phone) VALUES ($1,$2,$3,$4)',
        [historicalClient, 'Cliente Vinilo previo', 'NIT-800000003', '3001234567']);
      await historical.query(`
        INSERT INTO orders (id,client_id,description,value,document_type,category,route,requires_installation,status,
          created_by,material,length,width,printing_completed_at,creation_key,creation_fingerprint)
        VALUES ($1,$2,$3,100000,'REM','Proyecto','PRINT_ONLY',false,'COMPLETED',
          $4,'Vinilo',2,1.5,now(),$5,$6)
      `, [historicalOrder, historicalClient, 'Trabajo histórico en Vinilo', owner.id, randomUUID(), 'b'.repeat(64)]);
      await historical.query(`
        INSERT INTO orders (id,client_id,description,value,document_type,category,route,requires_installation,status,
          created_by,material,length,width,creation_key,creation_fingerprint)
        VALUES ($1,$2,$3,100000,'REM','Proyecto','WORKSHOP_ONLY',false,'COMPLETED',
          $4,null,null,null,$5,$6)
      `, [workshopOrder, historicalClient, 'Trabajo histórico sin material', owner.id, randomUUID(), 'c'.repeat(64)]);

      for (const name of ['005_products.sql', '006_composite_order.sql', '007_product_dimensions.sql']) {
        await historical.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      }

      expect((await historical.query('SELECT id FROM orders WHERE id=$1', [historicalOrder])).rows).toHaveLength(1);
      expect((await historical.query('SELECT id FROM order_products WHERE order_id=$1', [historicalOrder])).rows).toHaveLength(1);
      expect((await historical.query('SELECT id FROM order_product_materials WHERE order_id=$1', [historicalOrder])).rows).toHaveLength(0);
      expect((await historical.query('SELECT id FROM order_products WHERE order_id=$1', [workshopOrder])).rows).toHaveLength(1);
      expect((await historical.query('SELECT id FROM order_product_materials WHERE order_id=$1', [workshopOrder])).rows).toHaveLength(0);
    } finally {
      await historical.close();
    }
  });
});
