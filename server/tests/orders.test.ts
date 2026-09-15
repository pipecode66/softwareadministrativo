import { createHash, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import type { AuthSession, PublicUser, Role } from '../src/contracts.js';
import { createPgliteDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';
import { calendarDate, createSchema, dateOnly, financials, moneySchema, type OrderInput } from '../src/orders/domain.js';
import { createOrder, recordPayment } from '../src/orders/service.js';

// Every fixture owns an in-memory database. No persistent/user database is opened or reset.
const API = '/api/v1';
const ORIGIN = 'http://127.0.0.1:5173';
const EMAIL = 'orders-master@example.test';
const PASSWORD = 'Una clave ficticia para OT 2026!';
const config = readConfig({ NODE_ENV: 'test', APP_ORIGINS: ORIGIN, LOGIN_RATE_LIMIT: '100' });
const missingId = '00000000-0000-4000-8000-000000000099';
interface Session { cookie: string; csrf: string; user: PublicUser }
interface OrderView {
  id: string; number: number; version: number; status: string;
  value?: number; financials?: ReturnType<typeof financials>; payments?: unknown[];
  printingCompletedAt?: string; workshopStartedAt?: string; installedAt?: string;
  installationNote?: string; closedAt?: string; areaM2?: number;
}
let db: Database;
let app: Express;
let admin: Session;
let clientId: string;
let actors: Map<Role, Session>;

function sessionOf(response: Response): Session {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const cookies = !header ? [] : Array.isArray(header) ? header : [header];
  return { cookie: cookies.map(cookie => cookie.split(';')[0]).join('; '), csrf: response.body.csrfToken, user: response.body.user };
}

function capturedAuth(session = admin): AuthSession {
  const token = session.cookie.slice(session.cookie.indexOf('=') + 1);
  return { user: session.user, tokenHash: createHash('sha256').update(token).digest('hex'), csrfToken: session.csrf };
}

async function login(email = EMAIL): Promise<Session> {
  const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return sessionOf(response);
}

async function actor(role: Role, separate = false): Promise<Session> {
  const existing = actors.get(role);
  if (existing && !separate) return existing;
  const email = `${role.toLowerCase()}-${randomUUID()}@example.test`;
  await db.query(`
    INSERT INTO users (id, name, email, role, password_hash, must_change_password)
    SELECT $1,$2,$3,$4,password_hash,false FROM users WHERE id=$5
  `, [randomUUID(), `Persona ${role}`, email, role, admin.user.id]);
  const signed = await login(email);
  if (!separate) actors.set(role, signed);
  return signed;
}

function input(overrides: Record<string, unknown> = {}): OrderInput {
  return {
    clientId, description: 'Trabajo de prueba', value: 100000, documentType: 'REM', category: 'Proyecto',
    route: 'PRINT_WORKSHOP', requiresInstallation: false,
    printing: { material: 'Banner', length: 2.5, width: 1.2 }, reteFuente: 0, reteIva: 0, ica: 0,
    ...overrides,
  } as OrderInput;
}

function post(path: string, payload: object, session = admin) {
  return request(app).post(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload);
}

function get(path: string, session = admin) {
  return request(app).get(`${API}${path}`).set('Cookie', session.cookie);
}

function createRequest(payload = { ...input(), requestId: randomUUID() }, session = admin) {
  return post('/orders', payload, session);
}

async function create(overrides: Record<string, unknown> = {}, session = admin): Promise<OrderView> {
  const response = await createRequest({ ...input(overrides), requestId: randomUUID() }, session);
  expect(response.status).toBe(201);
  return response.body.order as OrderView;
}

function edit(order: OrderView, overrides: Record<string, unknown>, session = admin, fields = input()) {
  return request(app).patch(`${API}/orders/${order.id}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf)
    .send({ ...fields, expectedVersion: order.version, ...overrides });
}

function payment(order: OrderView, amount: number, session = admin, options: Record<string, unknown> = {}) {
  return post(`/orders/${order.id}/payments`, { date: dateOnly(), amount, requestId: randomUUID(), ...options }, session);
}

function transition(order: OrderView, action: string, session = admin, details: Record<string, unknown> = {}) {
  return post(`/orders/${order.id}/transitions`, { action, expectedVersion: order.version, ...details }, session);
}

async function move(order: OrderView, action: string, session = admin, details: Record<string, unknown> = {}): Promise<OrderView> {
  const response = await transition(order, action, session, details);
  expect(response.status).toBe(200);
  return response.body.order as OrderView;
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
});

beforeEach(async () => {
  await db.exec('TRUNCATE order_events, payments, orders, clients, users RESTART IDENTITY CASCADE');
  await bootstrapAdmin(db, { name: 'Administración OT de prueba', email: EMAIL, password: PASSWORD });
  app = await createApp(db, config);
  admin = await login();
  actors = new Map([['ADMINMASTER', admin]]);
  clientId = randomUUID();
  await db.query('INSERT INTO clients (id,name,identification,phone) VALUES ($1,$2,$3,$4)',
    [clientId, 'Cliente Andino', 'NIT-900888777', '+57 300 987 6543']);
});

afterAll(async () => { await db?.close(); });

describe('OT: creación automática e idempotencia', () => {
  it('numera desde 1 en una base nueva y conserva registro y evento en el servidor', async () => {
    const first = await create();
    const second = await create();
    expect(first).toMatchObject({ number: 1, version: 1, status: 'NEW', areaM2: 3 });
    expect(second.number).toBe(2);
    const persisted = await get(`/orders/${first.id}`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.order).toEqual(first);
    expect(persisted.body.client).toEqual({ id: clientId, name: 'Cliente Andino' });
    const events = await db.query<{ action: string; actor_id: string }>('SELECT action,actor_id FROM order_events WHERE order_id=$1', [first.id]);
    expect(events.rows).toEqual([{ action: 'create', actor_id: admin.user.id }]);
  });

  it('produce números únicos durante creaciones simultáneas', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      createRequest({ ...input({ description: `Concurrente ${index}` }), requestId: randomUUID() })));
    expect(results.every(result => result.status === 201)).toBe(true);
    const numbers = results.map(result => result.body.order.number).sort((a: number, b: number) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(results.map(result => result.body.order.id)).size).toBe(8);
  });

  it('reintenta una creación sin duplicar OT, consumir número ni registrar evento adicional', async () => {
    const payload = { ...input(), requestId: randomUUID() };
    const first = await createRequest(payload);
    const repeat = await createRequest(payload);
    expect(first.status).toBe(201);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({ order: first.body.order, replayed: true });
    expect((await create()).number).toBe(2);
    const events = await db.query('SELECT id FROM order_events WHERE order_id=$1', [first.body.order.id]);
    expect(events.rows).toHaveLength(1);
  });

  it('un doble envío concurrente crea una sola OT', async () => {
    const payload = { ...input(), requestId: randomUUID() };
    const results = await Promise.all([createRequest(payload), createRequest(payload)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 201]);
    expect(results[0].body.order.id).toBe(results[1].body.order.id);
    expect((await get('/orders')).body.total).toBe(1);
  });

  it('rechaza reutilizar la clave de creación con otros datos', async () => {
    const payload = { ...input(), requestId: randomUUID() };
    await createRequest(payload);
    const conflict = await createRequest({ ...payload, value: 500000 });
    expect(conflict.status).toBe(409);
    expect((await get('/orders')).body.total).toBe(1);
  });

  it('las claves de creación pertenecen al usuario creador', async () => {
    const payload = { ...input(), requestId: randomUUID() };
    const first = await createRequest(payload);
    const second = await createRequest(payload, await actor('ADMIN_GENERAL'));
    expect(second.status).toBe(201);
    expect(second.body.order.id).not.toBe(first.body.order.id);
  });

  it.each(['ADMIN_GENERAL', 'DISENO'] as Role[])('%s puede crear, respetando revisión de Diseño', async role => {
    const created = await create({}, await actor(role));
    expect(created.status).toBe(role === 'DISENO' ? 'PENDING_ADMIN_REVIEW' : 'NEW');
    expect((await get(`/orders/${created.id}`)).status).toBe(200);
  });

  it.each(['IMPRESION', 'TALLER'] as Role[])('%s no puede crear órdenes', async role => {
    expect((await createRequest({ ...input(), requestId: randomUUID() }, await actor(role))).status).toBe(403);
    expect((await get('/orders')).body.total).toBe(0);
  });

  it('revalida una sesión revocada después de la autenticación', async () => {
    const auth = capturedAuth();
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [auth.tokenHash]);
    await expect(createOrder(db, auth, createSchema.parse({ ...input(), requestId: randomUUID() })))
      .rejects.toMatchObject({ status: 401 });
    expect((await db.query('SELECT id FROM orders')).rows).toHaveLength(0);
  });
});

describe('OT: finanzas y abonos', () => {
  it('FACT suma base, IVA y retenciones manuales; REM mantiene solo la base', async () => {
    const fact = await create({ documentType: 'FACT', reteFuente: 5000, reteIva: 3000, ica: 2000 });
    expect(fact.financials).toEqual({ base: 100000, iva: 19000, gross: 119000, retentions: 10000,
      collectible: 129000, paid: 0, balance: 129000, paymentStatus: 'PENDING' });
    expect((await create()).financials).toMatchObject({ iva: 0, retentions: 0, collectible: 100000 });
  });

  it('redondea el IVA a centavos sin alterar la precisión de varios pagos', async () => {
    const order = await create({ value: 1, documentType: 'FACT' });
    expect(order.financials).toMatchObject({ iva: 0.19, collectible: 1.19 });
    const first = await payment(order, 0.01);
    const second = await payment(order, 0.02);
    const third = await payment(order, 1.16);
    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    expect(third.body.order.financials).toMatchObject({ paid: 1.19, balance: 0, paymentStatus: 'PAID' });
    expect(third.body.order.payments).toHaveLength(3);
    expect(third.body.order.payments.every((p: { recordedBy: string }) => p.recordedBy === admin.user.id)).toBe(true);
    expect((await payment(order, 0.01)).status).toBe(409);
  });

  it('repetir un pago no lo duplica ni incrementa versión', async () => {
    const order = await create();
    const requestId = randomUUID();
    const first = await payment(order, 25000, admin, { requestId });
    const second = await payment(order, 25000, admin, { requestId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ order: first.body.order, replayed: true });
    expect(second.body.order.version).toBe(2);
    expect(second.body.order.payments).toHaveLength(1);
  });

  it('un doble abono concurrente con la misma clave produce un solo pago', async () => {
    const order = await create();
    const options = { requestId: randomUUID() };
    const results = await Promise.all([payment(order, 100000, admin, options), payment(order, 100000, admin, options)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 201]);
    expect((await get(`/orders/${order.id}`)).body.order.payments).toHaveLength(1);
  });

  it('rechaza colisiones de clave de pago con otro importe o registrador', async () => {
    const order = await create();
    const options = { requestId: randomUUID() };
    expect((await payment(order, 10000, admin, options)).status).toBe(201);
    expect((await payment(order, 10001, admin, options)).status).toBe(409);
    expect((await payment(order, 10000, await actor('ADMIN_GENERAL'), options)).status).toBe(409);
    expect((await get(`/orders/${order.id}`)).body.order.financials.paid).toBe(10000);
  });

  it('serializa dos abonos que juntos superarían el saldo', async () => {
    const order = await create({ value: 100 });
    const results = await Promise.all([payment(order, 70), payment(order, 70, await actor('ADMIN_GENERAL'))]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const saved = (await get(`/orders/${order.id}`)).body.order;
    expect(saved.financials).toMatchObject({ paid: 70, balance: 30, paymentStatus: 'PARTIAL' });
    expect(saved.payments).toHaveLength(1);
  });

  it.each(['DISENO', 'IMPRESION', 'TALLER'] as Role[])('%s no registra pagos', async role => {
    const order = await create();
    expect((await payment(order, 1000, await actor(role))).status).toBe(403);
  });

  it('rechaza fechas anteriores a la OT, futuras o inexistentes', async () => {
    const order = await create();
    for (const date of ['2000-01-01', '9999-12-31', '2026-02-30', '0000-01-01']) {
      expect([400, 422]).toContain((await payment(order, 100, admin, { date })).status);
    }
    expect((await get(`/orders/${order.id}`)).body.order.payments).toHaveLength(0);
  });

  it('la fecha inicial del pago usa el día de Bogotá y no el UTC', async () => {
    const order = await create();
    await db.query("UPDATE orders SET created_at='2024-03-02T03:00:00Z' WHERE id=$1", [order.id]);
    expect((await payment(order, 100, admin, { date: '2024-03-01' })).status).toBe(201);
    expect([400, 422]).toContain((await payment(order, 100, admin, { date: '2024-02-29' })).status);
  });

  it('rechaza registrar un pago con sesión revocada después del middleware', async () => {
    const order = await create();
    const auth = capturedAuth();
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [auth.tokenHash]);
    await expect(recordPayment(db, auth, order.id, { requestId: randomUUID(), date: dateOnly(), amount: 100 }))
      .rejects.toMatchObject({ status: 401 });
    expect((await db.query('SELECT id FROM payments')).rows).toHaveLength(0);
  });
});

describe('OT: edición, versiones y flujo productivo', () => {
  it('solo Administración modifica campos estructurales antes de producción', async () => {
    const designer = await actor('DISENO');
    const order = await create({}, designer);
    expect((await edit(order, { description: 'Diseño no edita' }, designer)).status).toBe(403);
    const changed = await edit(order, { description: 'Revisado por administración' }, await actor('ADMIN_GENERAL'));
    expect(changed.status).toBe(200);
    expect(changed.body.order.version).toBe(2);
    const sent = await move(changed.body.order, 'send');
    expect(sent.status).toBe('IN_PRINTING');
    expect((await edit(sent, { description: 'No cambia en producción' })).status).toBe(409);
  });

  it('evita perder cambios al recibir dos ediciones con la misma versión', async () => {
    const order = await create();
    const results = await Promise.all([edit(order, { description: 'A' }), edit(order, { description: 'B' })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await get(`/orders/${order.id}`)).body.order.version).toBe(2);
  });

  it('un pago invalida versiones antiguas y la edición no reduce el total por debajo de lo abonado', async () => {
    const order = await create();
    const paid = (await payment(order, 80000)).body.order as OrderView;
    expect((await edit(order, { value: 120000 })).status).toBe(409);
    expect((await edit(paid, { value: 79999 })).status).toBe(409);
    const exact = await edit(paid, { value: 80000 });
    expect(exact.status).toBe(200);
    expect(exact.body.order.financials).toMatchObject({ paid: 80000, balance: 0 });
  });

  it('protege el total frente a una edición concurrente con un abono', async () => {
    const order = await create({ value: 100 });
    const responses = await Promise.all([edit(order, { value: 50 }), payment(order, 80)]);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
    const saved = (await get(`/orders/${order.id}`)).body.order;
    expect(saved.financials.balance).toBeGreaterThanOrEqual(0);
  });

  it.each(['PRINT_ONLY', 'WORKSHOP_ONLY', 'PRINT_WORKSHOP'] as const)('recorre %s sin instalación', async route => {
    const overrides = { route, ...(route === 'WORKSHOP_ONLY' ? { printing: undefined } : {}) };
    let order = await create(overrides);
    order = await move(order, 'send');
    if (route !== 'WORKSHOP_ONLY') {
      expect(order.status).toBe('IN_PRINTING');
      order = await move(order, 'finishPrinting', await actor('IMPRESION'));
      expect(order.printingCompletedAt).toBeDefined();
    }
    if (route !== 'PRINT_ONLY') {
      expect(order.status).toBe('IN_WORKSHOP');
      order = await move(order, 'startWorkshop', await actor('TALLER'));
      expect(order.workshopStartedAt).toBeDefined();
      expect((await transition(order, 'startWorkshop', await actor('TALLER'))).status).toBe(409);
      order = await move(order, 'finishWorkshop', await actor('TALLER'));
    }
    expect(order.status).toBe('COMPLETED');
    const closed = await move(order, 'close');
    expect(closed.closedAt).toBeDefined();
    expect(closed.financials?.balance).toBe(100000);
    expect((await transition(closed, 'close')).status).toBe(409);
  });

  it.each(['PRINT_ONLY', 'WORKSHOP_ONLY', 'PRINT_WORKSHOP'] as const)('recorre %s con instalación simple', async route => {
    let order = await create({ route, requiresInstallation: true, ...(route === 'WORKSHOP_ONLY' ? { printing: undefined } : {}) });
    order = await move(order, 'send');
    if (route !== 'WORKSHOP_ONLY') order = await move(order, 'finishPrinting', await actor('IMPRESION'));
    if (route !== 'PRINT_ONLY') order = await move(order, 'finishWorkshop', await actor('TALLER'));
    expect(order.status).toBe('PENDING_INSTALLATION');
    expect((await transition(order, 'install', await actor('TALLER'))).status).toBe(400);
    expect((await transition(order, 'install', await actor('TALLER'), { date: '2000-01-01' })).status).toBe(400);
    expect((await transition(order, 'install', await actor('TALLER'), { date: '9999-12-31' })).status).toBe(400);
    order = await move(order, 'install', await actor('TALLER'), { date: dateOnly(), note: '  Instalación revisada  ' });
    expect(order.status).toBe('INSTALLED');
    expect(dateOnly(order.installedAt!)).toBe(dateOnly());
    expect(order.installationNote).toBe('Instalación revisada');
    expect((await move(order, 'close')).closedAt).toBeDefined();
  });

  it('el cierre productivo no borra la cartera ni impide abonos posteriores', async () => {
    let order = await create({ route: 'WORKSHOP_ONLY', printing: undefined });
    order = await move(order, 'send');
    order = await move(order, 'finishWorkshop');
    order = await move(order, 'close');
    const owed = await get('/orders?paymentStatus=OUTSTANDING');
    expect(owed.body.items.map((item: OrderView) => item.id)).toContain(order.id);
    const settled = await payment(order, 100000);
    expect(settled.status).toBe(201);
    expect(settled.body.order.closedAt).toBe(order.closedAt);
    expect(settled.body.order.financials).toMatchObject({ balance: 0, paymentStatus: 'PAID' });
    expect((await get('/orders?paymentStatus=OUTSTANDING')).body.total).toBe(0);
  });

  it('no duplica impresión ni eventos con dos transiciones de la misma versión', async () => {
    const order = await move(await create(), 'send');
    const operator = await actor('IMPRESION');
    const results = await Promise.all([transition(order, 'finishPrinting', operator), transition(order, 'finishPrinting', operator)]);
    expect(results.filter(response => response.status === 200)).toHaveLength(1);
    expect(results.filter(response => [404, 409].includes(response.status))).toHaveLength(1);
    const events = await db.query("SELECT id FROM order_events WHERE order_id=$1 AND action='finishPrinting'", [order.id]);
    expect(events.rows).toHaveLength(1);
  });

  it('no permite saltarse estados o usar acciones de otro perfil', async () => {
    const designer = await actor('DISENO');
    const order = await create({}, designer);
    expect((await transition(order, 'send', designer)).status).toBe(403);
    expect((await transition(order, 'close')).status).toBe(409);
    expect((await transition(order, 'finishWorkshop')).status).toBe(409);
    const sent = await move(order, 'send');
    expect((await transition(sent, 'finishWorkshop', await actor('IMPRESION'))).status).toBe(403);
    expect((await transition(sent, 'finishPrinting', designer)).status).toBe(403);
    expect((await transition(sent, 'finishPrinting', admin, { date: dateOnly() })).status).toBe(400);
  });
});

describe('OT: alcance de datos y filtros', () => {
  it('Diseño solo consulta sus propias órdenes y no obtiene pagos ni retenciones', async () => {
    const owner = await actor('DISENO');
    const other = await actor('DISENO', true);
    const own = await create({}, owner);
    const foreign = await create({}, other);
    await create();
    const list = await get('/orders', owner);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(own.id);
    expect(list.body.items[0].value).toBe(100000);
    expect(list.body.items[0]).not.toHaveProperty('payments');
    expect(list.body.items[0]).not.toHaveProperty('financials');
    expect(list.body.items[0]).not.toHaveProperty('reteFuente');
    expect((await get(`/orders/${foreign.id}`, owner)).status).toBe(404);
    expect((await get('/orders?paymentStatus=PENDING', owner)).status).toBe(403);
  });

  it('Impresión recibe solo su cola, con área y sin importes, pagos ni contactos', async () => {
    const hidden = await create();
    const shown = await move(await create({ documentType: 'FACT', reteFuente: 3000 }), 'send');
    const operator = await actor('IMPRESION');
    const list = await get('/orders', operator);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id: shown.id, areaM2: 3, status: 'IN_PRINTING' });
    for (const field of ['value', 'payments', 'financials', 'reteFuente', 'reteIva', 'ica']) expect(list.body.items[0]).not.toHaveProperty(field);
    expect(list.text).not.toContain('NIT-900888777');
    expect(list.text).not.toContain('+57 300 987 6543');
    expect((await get(`/orders/${hidden.id}`, operator)).status).toBe(404);
    const detail = await get(`/orders/${shown.id}`, operator);
    expect(detail.body.client).toEqual({ id: clientId, name: 'Cliente Andino' });
    expect(detail.body.order).not.toHaveProperty('value');
    await move(shown, 'finishPrinting', operator);
    expect((await get('/orders', operator)).body.total).toBe(0);
  });

  it('Taller solo recibe trabajo de Taller o instalaciones pendientes, incluso de solo impresión', async () => {
    await move(await create({ route: 'PRINT_ONLY' }), 'send');
    const workshop = await move(await create({ route: 'WORKSHOP_ONLY', printing: undefined }), 'send');
    let install = await move(await create({ route: 'PRINT_ONLY', requiresInstallation: true }), 'send');
    install = await move(install, 'finishPrinting');
    const operator = await actor('TALLER');
    const list = await get('/orders', operator);
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((item: OrderView) => item.id).sort()).toEqual([workshop.id, install.id].sort());
    expect(list.text).not.toMatch(/"value"|"payments"|"financials"|"reteFuente"/);
  });

  it('filtra por cobros pendientes, parciales y pagados tanto REM como FACT', async () => {
    const pending = await create();
    const partial = await create({ documentType: 'FACT', category: 'SuperGiros' });
    const paid = await create({ documentType: 'FACT', category: 'Carro Vallas' });
    await payment(partial, 10000);
    await payment(paid, 119000);
    for (const [status, id] of [['PENDING', pending.id], ['PARTIAL', partial.id], ['PAID', paid.id]]) {
      const list = await get(`/orders?paymentStatus=${status}`);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].id).toBe(id);
    }
    expect((await get('/orders?paymentStatus=OUTSTANDING')).body.total).toBe(2);
    expect((await get('/orders?documentType=FACT&category=SuperGiros')).body.items[0].id).toBe(partial.id);
  });

  it('busca OT, nombre o descripción literalmente y pagina sin perder el total', async () => {
    const first = await create({ description: 'Banner 100% especial' });
    await create({ description: 'Pancarta' });
    expect((await get('/orders?q=0001')).body.items[0].id).toBe(first.id);
    expect((await get('/orders?q=andino')).body.total).toBe(2);
    expect((await get('/orders?q=%25')).body.total).toBe(1);
    expect((await get(`/orders?q=${encodeURIComponent("' OR 1=1 --")}`)).body.total).toBe(0);
    const paged = await get('/orders?page=1&pageSize=1');
    expect(paged.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(paged.body.items).toHaveLength(1);
    expect((await get('/orders?page=3&pageSize=1')).body).toMatchObject({ items: [], total: 2 });
  });

  it('filtra fechas de creación en Bogotá y valida rangos invertidos o inexistentes', async () => {
    const first = await create();
    const second = await create();
    await db.query("UPDATE orders SET created_at='2024-03-02T03:00:00Z' WHERE id=$1", [first.id]);
    await db.query("UPDATE orders SET created_at='2024-03-02T06:00:00Z' WHERE id=$1", [second.id]);
    const list = await get('/orders?from=2024-03-01&to=2024-03-01');
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: OrderView) => item.id)).toEqual([first.id]);
    for (const query of ['from=2024-03-02&to=2024-03-01', 'from=2024-02-30', 'from=0000-01-01']) {
      expect([400, 422]).toContain((await get(`/orders?${query}`)).status);
    }
  });
});

describe('OT: validación server-side', () => {
  it.each([
    { number: 50 }, { id: missingId }, { status: 'COMPLETED' }, { createdBy: missingId }, { createdAt: '2020-01-01' },
    { role: 'ADMINMASTER' }, { financials: { balance: 0 } }, { payments: [] }, { version: 99 },
    { value: 0 }, { value: -1 }, { value: '' }, { value: null }, { value: '100' }, { value: 1.001 }, { value: 1.00001 },
    { value: 1000000000000 }, { description: '' }, { category: 'Inventario' }, { route: 'OTHER' },
    { requiresInstallation: 'false' }, { requestId: 'non-uuid' }, { clientId: missingId },
    { documentType: 'REM', reteFuente: 100 }, { documentType: 'FACT', reteIva: -1 },
    { printing: undefined }, { printing: { material: 'Papel', length: 1, width: 1 } },
    { printing: { material: 'Banner', length: 0, width: 1 } },
    { printing: { material: 'Banner', length: 1.00000001, width: 1 } },
    { route: 'WORKSHOP_ONLY' },
  ])('rechaza valores inválidos o campos privilegiados: %j', async override => {
    const response = await createRequest({ ...input(), requestId: randomUUID(), ...override } as Parameters<typeof createRequest>[0]);
    expect([400, 422]).toContain(response.status);
    expect((await get('/orders')).body.total).toBe(0);
  });

  it('Diseño no registra retenciones manuales', async () => {
    const response = await createRequest({ ...input({ documentType: 'FACT', reteFuente: 10 }), requestId: randomUUID() }, await actor('DISENO'));
    expect(response.status).toBe(403);
  });

  it.each(['Panaflex', 'Vinilo', 'V. Corte', 'V. Impresión', 'Banner'] as const)('acepta el material %s y muestra metros cuadrados', async material => {
    const order = await create({ printing: { material, length: 1.234, width: 0.567 } });
    expect(order.areaM2).toBe(0.7);
  });

  it.each([{ amount: 0 }, { amount: -1 }, { amount: 0.00001 }, { amount: 1000.00001 }, { amount: '100' },
    { recordedBy: missingId }, { balance: 0 }, { date: '2026-01-01T00:00:00Z' }, { requestId: '' }])('rechaza abonos inválidos o manipulados: %j', async override => {
    const order = await create();
    expect([400, 422]).toContain((await payment(order, 1000, admin, override)).status);
    expect((await get(`/orders/${order.id}`)).body.order.payments).toHaveLength(0);
  });

  it('no permite consultas ni mutaciones sin sesión y protege las escrituras con CSRF', async () => {
    expect((await request(app).get(`${API}/orders`)).status).toBe(401);
    expect((await request(app).get(`${API}/orders/${missingId}`)).status).toBe(401);
    expect((await request(app).post(`${API}/orders`).set('Origin', ORIGIN).send({ ...input(), requestId: randomUUID() })).status).toBe(401);
    expect((await request(app).post(`${API}/orders`).set('Origin', ORIGIN).set('Cookie', admin.cookie)
      .send({ ...input(), requestId: randomUUID() })).status).toBe(403);
  });

  it('no expone DELETE, devuelve 404 para OT inexistente y rechaza UUID mal formado', async () => {
    const order = await create();
    expect((await get(`/orders/${missingId}`)).status).toBe(404);
    expect([400, 422]).toContain((await get('/orders/not-uuid')).status);
    const deletion = await request(app).delete(`${API}/orders/${order.id}`).set('Origin', ORIGIN)
      .set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({});
    expect([404, 405]).toContain(deletion.status);
    expect((await get(`/orders/${order.id}`)).status).toBe(200);
  });
});

describe('Cálculos y fechas de negocio', () => {
  it('acepta centavos válidos y rechaza precisión adicional, incluso valores pequeños', () => {
    for (const amount of [0, 0.01, 0.07, 0.1, 0.29, 1.23, 1000000.99, 999999999999.99]) expect(moneySchema.safeParse(amount).success).toBe(true);
    for (const amount of [0.00001, 1.00001, 1.001, 10.999, Infinity, NaN]) expect(moneySchema.safeParse(amount).success).toBe(false);
  });

  it('distingue fecha comercial de Bogotá, años bisiestos y año cero no soportado por PostgreSQL', () => {
    expect(dateOnly('2026-09-15T04:59:59Z')).toBe('2026-09-14');
    expect(dateOnly('2026-09-15T05:00:00Z')).toBe('2026-09-15');
    expect(calendarDate('2024-02-29')).toBe(true);
    expect(calendarDate('2026-02-29')).toBe(false);
    expect(calendarDate('0000-01-01')).toBe(false);
  });
});
