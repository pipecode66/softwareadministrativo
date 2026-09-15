import { createHash, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { createClient, updateClient } from '../src/clients/service.js';
import { readConfig } from '../src/config.js';
import type { AuthSession, PublicUser, Role } from '../src/contracts.js';
import { createPgliteDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';

// Only this suite's in-memory PGlite is truncated. No filesystem or external DB is opened.
const ORIGIN = 'http://127.0.0.1:5173';
const API = '/api/v1';
const EMAIL = 'clients-master@example.test';
const PASSWORD = 'Clave ficticia para pruebas 2026!';
const config = readConfig({ NODE_ENV: 'test', APP_ORIGINS: ORIGIN, LOGIN_RATE_LIMIT: '100' });
const missingId = '00000000-0000-4000-8000-000000000099';
interface Session { cookie: string; csrf: string; user: PublicUser }
let db: Database;
let app: Express;
let admin: Session;

function sessionOf(response: Response): Session {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  const cookies = !header ? [] : Array.isArray(header) ? header : [header];
  return {
    cookie: cookies.map(cookie => cookie.split(';')[0]).join('; '),
    csrf: response.body.csrfToken as string,
    user: response.body.user as PublicUser,
  };
}

function capturedAuth(session = admin): AuthSession {
  const token = session.cookie.slice(session.cookie.indexOf('=') + 1);
  return { user: session.user, csrfToken: session.csrf, tokenHash: createHash('sha256').update(token).digest('hex') };
}

async function login(email = EMAIL): Promise<Session> {
  const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return sessionOf(response);
}

function get(path = '/clients', session = admin) {
  return request(app).get(`${API}${path}`).set('Cookie', session.cookie);
}

function post(payload: unknown, session = admin) {
  return request(app).post(`${API}/clients`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload as object);
}

function patch(id: string, payload: unknown, session = admin) {
  return request(app).patch(`${API}/clients/${id}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(payload as object);
}

async function actorWithRole(role: Role, mustChangePassword = false): Promise<Session> {
  // Trusted test seed only: production accounts are created through the protected users API.
  const email = `${role.toLowerCase()}-${randomUUID()}@example.test`;
  await db.query(`
    INSERT INTO users (id, name, email, role, password_hash, must_change_password)
    SELECT $1, $2, $3, $4, password_hash, $5 FROM users WHERE id = $6
  `, [randomUUID(), `Persona ${role}`, email, role, mustChangePassword, admin.user.id]);
  return login(email);
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
});

beforeEach(async () => {
  await db.exec('TRUNCATE clients, users CASCADE');
  await bootstrapAdmin(db, { name: 'Administración de prueba', email: EMAIL, password: PASSWORD });
  app = await createApp(db, config);
  admin = await login();
});

afterAll(async () => { await db?.close(); });

describe('Clientes: registros persistidos y búsqueda', () => {
  it('crea, consulta y actualiza un cliente con un DTO compatible con el frontend', async () => {
    const created = await post({ name: '  Cliente Central  ', identification: '  NIT 900123456  ', phone: '  +57 300 123 4567  ' });
    expect(created.status).toBe(201);
    const client = created.body.client;
    expect(client).toEqual({
      id: expect.any(String), name: 'Cliente Central', identification: 'NIT 900123456', phone: '+57 300 123 4567',
      createdAt: expect.any(String),
    });
    expect(new Date(client.createdAt).toISOString()).toBe(client.createdAt);
    const saved = await db.query('SELECT * FROM clients WHERE id = $1', [client.id]);
    expect(saved.rows).toHaveLength(1);
    expect((await get(`/clients/${client.id}`)).body.client).toEqual(client);
    const changed = await patch(client.id, { name: '  Cliente Norte  ' });
    expect(changed.status).toBe(200);
    expect(changed.body.client).toEqual({ ...client, name: 'Cliente Norte' });
    const cleared = await patch(client.id, { identification: '', phone: ' ' });
    expect(cleared.body.client).toMatchObject({ name: 'Cliente Norte', identification: '', phone: '', createdAt: client.createdAt });
  });

  it('permite omitir identificación y teléfono, sin inventar valores ni imponer unicidad no acordada', async () => {
    const first = await post({ name: 'Cliente sin contacto' });
    const second = await post({ name: 'Cliente sin contacto' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.client).toMatchObject({ identification: '', phone: '' });
    expect(first.body.client.id).not.toBe(second.body.client.id);
  });

  it('lista por nombre y conserva total y página aunque la página solicitada esté vacía', async () => {
    await post({ name: 'Zeta' });
    await post({ name: 'Alfa' });
    await post({ name: 'Beta' });
    const first = await get('/clients?page=1&pageSize=2');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(first.body.items.map((item: { name: string }) => item.name)).toEqual(['Alfa', 'Beta']);
    const last = await get('/clients?page=2&pageSize=2');
    expect(last.body.items.map((item: { name: string }) => item.name)).toEqual(['Zeta']);
    expect((await get('/clients?page=3&pageSize=2')).body).toEqual({ items: [], page: 3, pageSize: 2, total: 3 });
  });

  it('busca sin distinguir mayúsculas por nombre, identificación o teléfono', async () => {
    const created = await post({ name: 'Empresa Andina', identification: 'NIT-7788', phone: '+57 300 9988' });
    await post({ name: 'Otro cliente' });
    for (const q of ['  aNDinA  ', 'nit-7788', '300 9988']) {
      const found = await get(`/clients?q=${encodeURIComponent(q)}`);
      expect(found.status).toBe(200);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0].id).toBe(created.body.client.id);
    }
  });

  it('interpreta %, guion bajo, barras y fragmentos SQL como texto literal', async () => {
    await post({ name: 'Normal' });
    const special = await post({ name: "Taller 100%_\\' OR 1=1 --" });
    for (const q of ['%', '_', '\\', "' OR 1=1 --"]) {
      const found = await get(`/clients?q=${encodeURIComponent(q)}`);
      expect(found.status).toBe(200);
      expect(found.body.total).toBe(1);
      expect(found.body.items[0].id).toBe(special.body.client.id);
    }
    expect((await get()).body.total).toBe(2);
  });

  it('no depende del estado en memoria de una instancia de Express', async () => {
    const created = await post({ name: 'Persistido en base de datos' });
    const recreated = await createApp(db, config);
    const response = await request(recreated).get(`${API}/clients/${created.body.client.id}`).set('Cookie', admin.cookie);
    expect(response.status).toBe(200);
    expect(response.body.client).toEqual(created.body.client);
  });

  it('conserva cambios de campos distintos enviados al mismo tiempo', async () => {
    const created = await post({ name: 'Edición compartida' });
    const id = created.body.client.id as string;
    const results = await Promise.all([
      patch(id, { phone: '3001234567' }),
      patch(id, { identification: 'NIT-123' }),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect((await get(`/clients/${id}`)).body.client).toMatchObject({
      name: 'Edición compartida', phone: '3001234567', identification: 'NIT-123',
    });
  });

  it('la migración es repetible sin borrar clientes existentes', async () => {
    const created = await post({ name: 'Conservar registro' });
    expect(await migrate(db)).toEqual([]);
    expect((await get(`/clients/${created.body.client.id}`)).body.client).toEqual(created.body.client);
  });
});

describe('Clientes: permisos y sesiones', () => {
  it('rechaza consulta y escritura anónimas', async () => {
    expect((await request(app).get(`${API}/clients`)).status).toBe(401);
    expect((await request(app).get(`${API}/clients/${missingId}`)).status).toBe(401);
    const response = await request(app).post(`${API}/clients`).set('Origin', ORIGIN).send({ name: 'No autorizado' });
    expect(response.status).toBe(401);
  });

  it('Administración General puede registrar y editar clientes', async () => {
    const actor = await actorWithRole('ADMIN_GENERAL');
    const created = await post({ name: 'Desde administración general' }, actor);
    expect(created.status).toBe(201);
    expect((await get('/clients', actor)).body.total).toBe(1);
    expect((await patch(created.body.client.id, { phone: '3001234567' }, actor)).status).toBe(200);
  });

  it('Diseño puede seleccionar clientes existentes pero no crearlos ni editarlos', async () => {
    const created = await post({ name: 'Cliente para seleccionar' });
    const actor = await actorWithRole('DISENO');
    expect((await get('/clients', actor)).status).toBe(200);
    expect((await get(`/clients/${created.body.client.id}`, actor)).status).toBe(200);
    expect((await post({ name: 'No permitido' }, actor)).status).toBe(403);
    expect((await patch(created.body.client.id, { name: 'No permitido' }, actor)).status).toBe(403);
    expect((await get()).body.total).toBe(1);
  });

  it.each(['IMPRESION', 'TALLER'] as Role[])('%s no obtiene el directorio ni fichas de contacto', async role => {
    const created = await post({ name: 'Cliente reservado', phone: '3001234567' });
    const actor = await actorWithRole(role);
    expect((await get('/clients', actor)).status).toBe(403);
    const denied = await get(`/clients/${created.body.client.id}`, actor);
    expect(denied.status).toBe(403);
    expect(denied.text).not.toContain('3001234567');
    expect((await post({ name: 'No permitido' }, actor)).status).toBe(403);
    expect((await patch(created.body.client.id, { name: 'No permitido' }, actor)).status).toBe(403);
  });

  it('exige cambio de contraseña antes de consultar o escribir', async () => {
    const actor = await actorWithRole('ADMIN_GENERAL', true);
    for (const response of [await get('/clients', actor), await post({ name: 'Bloqueado' }, actor)]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });

  it('no acepta escritura sin CSRF válido', async () => {
    const response = await request(app).post(`${API}/clients`).set('Origin', ORIGIN)
      .set('Cookie', admin.cookie).send({ name: 'CSRF omitido' });
    expect(response.status).toBe(403);
    expect((await get()).body.total).toBe(0);
  });

  it.each(['revoked', 'expired', 'inactive', 'role', 'password', 'csrf'])(
    'revalida dentro de la transacción un actor obsoleto: %s', async reason => {
      const auth = capturedAuth();
      if (reason === 'revoked') await db.query('DELETE FROM sessions WHERE token_hash = $1', [auth.tokenHash]);
      if (reason === 'expired') await db.query("UPDATE sessions SET expires_at = now() - INTERVAL '1 minute' WHERE token_hash = $1", [auth.tokenHash]);
      if (reason === 'inactive') await db.query('UPDATE users SET is_active = false WHERE id = $1', [auth.user.id]);
      if (reason === 'role') await db.query("UPDATE users SET role = 'DISENO' WHERE id = $1", [auth.user.id]);
      if (reason === 'password') await db.query('UPDATE users SET must_change_password = true WHERE id = $1', [auth.user.id]);
      if (reason === 'csrf') auth.csrfToken = '0'.repeat(64);
      await expect(createClient(db, auth, { name: 'No debe guardarse', identification: '', phone: '' }))
        .rejects.toMatchObject({ status: ['role', 'password'].includes(reason) ? 403 : 401 });
      const count = await db.query<{ total: number }>('SELECT count(*)::integer AS total FROM clients');
      expect(count.rows[0].total).toBe(0);
    },
  );

  it('no actualiza el cliente si se revoca la sesión tras pasar el middleware', async () => {
    const created = await post({ name: 'Nombre conservado' });
    const auth = capturedAuth();
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [auth.tokenHash]);
    await expect(updateClient(db, auth, created.body.client.id, { name: 'Cambio rechazado' }))
      .rejects.toMatchObject({ status: 401 });
    const result = await db.query<{ name: string }>('SELECT name FROM clients WHERE id = $1', [created.body.client.id]);
    expect(result.rows[0].name).toBe('Nombre conservado');
  });
});

describe('Clientes: validación y límites', () => {
  it.each([
    {}, { name: '' }, { name: '   ' }, { name: null }, { name: 123 }, { name: 'x'.repeat(181) },
    { name: 'Cliente', identification: 'x'.repeat(61) }, { name: 'Cliente', identification: null },
    { name: 'Cliente', phone: 'x'.repeat(41) }, { name: 'Cliente', phone: 123 },
    { name: 'Cliente', id: missingId }, { name: 'Cliente', createdAt: '2021-01-01' }, { name: 'Cliente', active: true },
  ])('rechaza creación inválida o asignación de campos internos: %j', async payload => {
    const response = await post(payload);
    expect([400, 422]).toContain(response.status);
    expect((await get()).body.total).toBe(0);
  });

  it('acepta los límites de longitud acordados', async () => {
    const response = await post({ name: 'n'.repeat(180), identification: 'i'.repeat(60), phone: 'p'.repeat(40) });
    expect(response.status).toBe(201);
  });

  it.each([{}, { name: ' ' }, { phone: null }, { id: missingId }, { createdAt: '2021-01-01' }, { updated_at: '2021-01-01' }])(
    'rechaza actualización vacía, inválida o con campos internos: %j', async payload => {
      const created = await post({ name: 'Original' });
      expect([400, 422]).toContain((await patch(created.body.client.id, payload)).status);
      expect((await get(`/clients/${created.body.client.id}`)).body.client).toEqual(created.body.client);
    },
  );

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=1000001', 'pageSize=0', 'pageSize=101', 'pageSize=abc', 'page=1&page=2', 'unknown=true']) (
    'valida paginación y consultas estrictas: %s', async query => {
      expect([400, 422]).toContain((await get(`/clients?${query}`)).status);
    },
  );

  it('responde 404 para UUID inexistente y rechaza identificadores mal formados', async () => {
    expect((await get(`/clients/${missingId}`)).status).toBe(404);
    expect((await patch(missingId, { name: 'Inexistente' })).status).toBe(404);
    expect([400, 422]).toContain((await get('/clients/not-a-uuid')).status);
    expect([400, 422]).toContain((await patch('not-a-uuid', { name: 'Inválido' })).status);
  });

  it('no expone una operación de eliminación', async () => {
    const created = await post({ name: 'Debe conservarse' });
    const response = await request(app).delete(`${API}/clients/${created.body.client.id}`).set('Origin', ORIGIN)
      .set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({});
    expect([404, 405]).toContain(response.status);
    expect((await get(`/clients/${created.body.client.id}`)).status).toBe(200);
  });

  it('la base de datos también rechaza nombres vacíos y campos sobredimensionados', async () => {
    await expect(db.query('INSERT INTO clients (id, name) VALUES ($1, $2)', [randomUUID(), '']))
      .rejects.toMatchObject({ code: '23514' });
    await expect(db.query('INSERT INTO clients (id, name, phone) VALUES ($1, $2, $3)', [randomUUID(), 'Cliente', '1'.repeat(41)]))
      .rejects.toMatchObject({ code: '22001' });
    expect((await get()).body.total).toBe(0);
  });
});
