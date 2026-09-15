import { createHash } from 'node:crypto';
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

// This suite owns only an in-memory database. It never opens .data or a database URL.
const ORIGIN = 'http://127.0.0.1:5173';
const MASTER_EMAIL = 'master@example.test';
const PASSWORD = 'Frase inicial segura 2026!';
const NEW_PASSWORD = 'Otra frase totalmente nueva 2026!';
const THIRD_PASSWORD = 'Tercera frase diferente 2026!';
const API = '/api/v1';
const config = readConfig({ NODE_ENV: 'test', APP_ORIGINS: ORIGIN, LOGIN_RATE_LIMIT: '100' });
interface Session { cookie: string; csrf: string; user: PublicUser }
let db: Database;
let app: Express;
let master: PublicUser;
let admin: Session;

function cookies(response: Response): string[] {
  const header = response.headers['set-cookie'] as string[] | string | undefined;
  return !header ? [] : Array.isArray(header) ? header : [header];
}

function sessionOf(response: Response): Session {
  return {
    cookie: cookies(response).map(cookie => cookie.split(';')[0]).join('; '),
    csrf: response.body.csrfToken as string,
    user: response.body.user as PublicUser,
  };
}

function login(email = MASTER_EMAIL, password = PASSWORD, target = app) {
  return request(target).post(`${API}/auth/login`).set('Origin', ORIGIN).send({ email, password });
}

function post(path: string, session = admin) {
  return request(app).post(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
}

function patch(path: string, session = admin) {
  return request(app).patch(`${API}${path}`).set('Origin', ORIGIN)
    .set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
}

function get(path: string, session = admin) {
  return request(app).get(`${API}${path}`).set('Cookie', session.cookie);
}

async function createUser(overrides: Record<string, unknown> = {}): Promise<PublicUser> {
  const response = await post('/users').send({
    name: 'Persona de prueba', email: 'persona@example.test', role: 'DISENO', active: true,
    password: PASSWORD, ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.user as PublicUser;
}

async function activeSession(email: string): Promise<Session> {
  const signed = await login(email);
  expect(signed.status).toBe(200);
  const initial = sessionOf(signed);
  const changed = await post('/auth/password', initial).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
  expect(changed.status).toBe(200);
  return sessionOf(changed);
}

function expectPublic(user: unknown) {
  expect(user).toEqual(expect.objectContaining({
    id: expect.any(String), name: expect.any(String), email: expect.any(String),
    role: expect.any(String), active: expect.any(Boolean), mustChangePassword: expect.any(Boolean),
    createdAt: expect.any(String), updatedAt: expect.any(String),
  }));
  const encoded = JSON.stringify(user);
  expect(encoded).not.toMatch(/password_hash|passwordHash|token_hash|tokenHash|\$argon2/);
  expect(encoded).not.toContain(PASSWORD);
}

beforeAll(async () => {
  db = await createPgliteDatabase();
  await migrate(db);
});

beforeEach(async () => {
  // Isolated, ephemeral instance created above, never the user's application database.
  await db.exec('TRUNCATE users CASCADE');
  master = await bootstrapAdmin(db, { name: 'Administración principal', email: MASTER_EMAIL, password: PASSWORD });
  app = await createApp(db, config);
  const signed = await login();
  expect(signed.status).toBe(200);
  admin = sessionOf(signed);
});

afterAll(async () => { await db?.close(); });

describe('API infrastructure and migrations', () => {
  it('reports liveness and database readiness without authentication', async () => {
    for (const path of ['/health', '/health/ready']) {
      const response = await request(app).get(`${API}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.text).not.toMatch(/password|DATABASE_URL|\.data/);
    }
  });

  it('reapplies migrations without deleting an account or session', async () => {
    await migrate(db);
    await migrate(db);
    const response = await get('/auth/session');
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(master.id);
    expect((await get('/users')).body.total).toBe(1);
  });

  it('does not report an unmigrated database as ready', async () => {
    const empty = await createPgliteDatabase();
    try {
      const unmigrated = await createApp(empty, config);
      expect((await request(unmigrated).get(`${API}/health`)).status).toBe(200);
      const response = await request(unmigrated).get(`${API}/health/ready`);
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('NOT_READY');
      expect(response.text).not.toMatch(/schema_migrations|relation|SELECT/);
    } finally { await empty.close(); }
  });

  it('reports database outages as unavailable without driver details', async () => {
    const offline = await createApp({ ...db, query: async () => { throw new Error('private-driver-details'); } }, config);
    const response = await request(offline).get(`${API}/health/ready`);
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('private-driver-details');
  });

  it('does not cache public or private API responses', async () => {
    for (const path of ['/health', '/users', '/does-not-exist']) {
      const response = await get(path);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.etag).toBeUndefined();
    }
  });

  it('does not replace an existing administrator during bootstrap', async () => {
    await expect(bootstrapAdmin(db, { name: 'Otra persona', email: 'other@example.test', password: NEW_PASSWORD })).rejects.toThrow();
    expect((await get('/users')).body.total).toBe(1);
    expect((await login()).status).toBe(200);
  });

  it('returns JSON 404 without an HTML page or stack trace', async () => {
    const response = await request(app).get(`${API}/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.text).not.toMatch(/<!DOCTYPE|<html|node_modules|\bat \S+ \(/);
    expect(response.body.stack).toBeUndefined();
  });

  it('rejects malformed JSON without exposing parser internals', async () => {
    const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN)
      .set('Content-Type', 'application/json').send('{invalid json');
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.text).not.toContain('SyntaxError');
    expect(response.body.stack).toBeUndefined();
  });

  it('rejects non-JSON writes before processing credentials', async () => {
    const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN)
      .type('form').send({ email: MASTER_EMAIL, password: PASSWORD });
    expect(response.status).toBe(415);
  });

  it.each(['text/application/json', 'application/json-invalid'])('rejects a JSON-looking but invalid media type: %s', async contentType => {
    const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN)
      .set('Content-Type', contentType).send(JSON.stringify({ email: MASTER_EMAIL, password: PASSWORD }));
    expect(response.status).toBe(415);
  });

  it('limits oversized request bodies', async () => {
    const response = await request(app).post(`${API}/auth/login`).set('Origin', ORIGIN)
      .send({ email: MASTER_EMAIL, password: 'x'.repeat(100_000) });
    expect(response.status).toBe(413);
  });

  it('allows only the configured exact CORS origin', async () => {
    const allowed = await request(app).options(`${API}/auth/login`).set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const rejected = await request(app).options(`${API}/auth/login`).set('Origin', `${ORIGIN}.evil.test`)
      .set('Access-Control-Request-Method', 'POST');
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    expect(rejected.status).toBe(403);
  });
});

describe('Authentication and durable server sessions', () => {
  it('authenticates the bootstrap account and exposes only a public DTO', async () => {
    expectPublic(admin.user);
    expect(admin.user.mustChangePassword).toBe(false);
    expect(admin.csrf.length).toBeGreaterThanOrEqual(32);
    const response = await get('/auth/session');
    expect(response.status).toBe(200);
    expect(response.body.csrfToken).toBe(admin.csrf);
    expect(response.body.user).toEqual(admin.user);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('normalizes email case and surrounding whitespace at login', async () => {
    expect((await login('  MASTER@EXAMPLE.TEST  ')).status).toBe(200);
  });

  it('uses an HttpOnly SameSite cookie and stores only a digest of its token', async () => {
    const response = await login();
    const cookie = cookies(response)[0];
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=(Lax|Strict)/i);
    expect(cookie).toMatch(/; Path=\//i);
    expect(cookie).toMatch(/; (Max-Age|Expires)=/i);
    const pair = sessionOf(response).cookie;
    const rawToken = decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
    const digest = createHash('sha256').update(rawToken).digest('hex');
    const sessions = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE user_id = $1', [master.id]);
    expect(sessions.rows.some(row => row.token_hash === digest)).toBe(true);
    expect(sessions.rows.every(row => row.token_hash !== rawToken)).toBe(true);
    const users = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [master.id]);
    expect(users.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(users.rows[0].password_hash).not.toContain(PASSWORD);
  });

  it('sets Secure on production session cookies', async () => {
    const productionApp = await createApp(db, { ...config, production: true });
    const response = await login(MASTER_EMAIL, PASSWORD, productionApp);
    expect(response.status).toBe(200);
    expect(cookies(response)[0]).toMatch(/; Secure/i);
    expect(cookies(response)[0]).toMatch(/; SameSite=Strict/i);
  });

  it('rejects ambiguous duplicate session cookies', async () => {
    const response = await request(app).get(`${API}/auth/session`).set('Cookie', `${admin.cookie}; ${admin.cookie}`);
    expect(response.status).toBe(401);
  });

  it('replaces the previous cookie session on a fresh login', async () => {
    const response = await login().set('Cookie', admin.cookie);
    expect(response.status).toBe(200);
    expect((await get('/auth/session')).status).toBe(401);
    expect((await get('/auth/session', sessionOf(response))).status).toBe(200);
  });

  it('fails closed if the transactional account lock is missing', async () => {
    await db.query("DELETE FROM system_locks WHERE id = 'user-management'");
    try {
      expect((await login()).status).toBe(503);
      expect((await request(app).get(`${API}/health/ready`)).status).toBe(503);
    } finally {
      await db.query("INSERT INTO system_locks (id) VALUES ('user-management') ON CONFLICT DO NOTHING");
    }
  });

  it('can resolve the same stored session in a recreated application', async () => {
    const restarted = await createApp(db, config);
    const response = await request(restarted).get(`${API}/auth/session`).set('Cookie', admin.cookie);
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(master.id);
  });

  it('does not disclose whether incorrect credentials refer to an existing account', async () => {
    const wrong = await login(MASTER_EMAIL, 'Una clave que no coincide');
    const absent = await login('missing@example.test', 'Una clave que no coincide');
    expect(wrong.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(wrong.body).toEqual(absent.body);
    expect(cookies(wrong)).toHaveLength(0);
  });

  it('denies an inactive account at login', async () => {
    const user = await createUser({ active: false });
    const response = await login(user.email);
    expect(response.status).toBe(401);
    expect(cookies(response)).toHaveLength(0);
  });

  it('requires a valid session for protected reads and writes', async () => {
    expect((await request(app).get(`${API}/auth/session`)).status).toBe(401);
    expect((await request(app).get(`${API}/users`)).status).toBe(401);
    const response = await request(app).post(`${API}/users`).set('Origin', ORIGIN)
      .set('X-CSRF-Token', admin.csrf).send({ name: 'Intruso' });
    expect(response.status).toBe(401);
    expect((await request(app).get(`${API}/auth/session`).set('Cookie', 'intermedios_session=forged')).status).toBe(401);
  });

  it('rejects expired sessions based on the persisted expiry', async () => {
    await db.query('UPDATE sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL \'1 minute\' WHERE user_id = $1', [master.id]);
    expect((await get('/auth/session')).status).toBe(401);
    expect((await get('/users')).status).toBe(401);
  });

  it('revokes a session on logout even if its cookie is replayed', async () => {
    const response = await post('/auth/logout').send({});
    expect(response.status).toBe(204);
    expect(cookies(response).join(' ')).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    expect((await get('/auth/session')).status).toBe(401);
    expect((await get('/users')).status).toBe(401);
  });

  it('rate-limits repeated login attempts independently of the main fixture', async () => {
    const limited = await createApp(db, { ...config, loginRateLimit: 2 });
    expect((await login(MASTER_EMAIL, 'incorrecta', limited)).status).toBe(401);
    expect((await login(MASTER_EMAIL, 'incorrecta', limited)).status).toBe(401);
    const response = await login(MASTER_EMAIL, 'incorrecta', limited);
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('does not count successful logins against the failed-attempt allowance', async () => {
    const limited = await createApp(db, { ...config, loginRateLimit: 2 });
    for (let index = 0; index < 3; index++) expect((await login(MASTER_EMAIL, PASSWORD, limited)).status).toBe(200);
    expect((await login(MASTER_EMAIL, 'incorrecta', limited)).status).toBe(401);
    expect((await login(MASTER_EMAIL, 'incorrecta', limited)).status).toBe(401);
    expect((await login(MASTER_EMAIL, 'incorrecta', limited)).status).toBe(429);
  });
});

describe('Revalidation of access during concurrent account changes', () => {
  function pausedTransactions() {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const pending = new Promise<void>(done => { entered = done; });
    const wrapped: Database = {
      ...db,
      transaction: async run => {
        entered();
        await gate;
        return db.transaction(run);
      },
    };
    return { wrapped, pending, release };
  }

  it('does not create a login session after concurrent deactivation', async () => {
    const paused = pausedTransactions();
    const racing = await createApp(paused.wrapped, config);
    const attempt = login(MASTER_EMAIL, PASSWORD, racing).then(response => response);
    await paused.pending;
    try { await db.query('UPDATE users SET is_active = false WHERE id = $1', [master.id]); }
    finally { paused.release(); }
    expect((await attempt).status).toBe(401);
  });

  it('does not change a password after the submitting session was revoked', async () => {
    const paused = pausedTransactions();
    const racing = await createApp(paused.wrapped, config);
    const attempt = request(racing).post(`${API}/auth/password`).set('Origin', ORIGIN)
      .set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).then(response => response);
    await paused.pending;
    try { await db.query('DELETE FROM sessions WHERE user_id = $1', [master.id]); }
    finally { paused.release(); }
    expect((await attempt).status).toBe(401);
    expect((await login()).status).toBe(200);
  });

  it('rechecks master permissions after expensive account password hashing', async () => {
    const paused = pausedTransactions();
    const racing = await createApp(paused.wrapped, config);
    const attempt = request(racing).post(`${API}/users`).set('Origin', ORIGIN)
      .set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf)
      .send({ name: 'Race', email: 'race@example.test', role: 'DISENO', active: true, password: PASSWORD })
      .then(response => response);
    await paused.pending;
    try { await db.query("UPDATE users SET role = 'DISENO' WHERE id = $1", [master.id]); }
    finally { paused.release(); }
    expect((await attempt).status).toBe(403);
    expect((await db.query('SELECT id FROM users')).rows).toHaveLength(1);
  });
});

describe('CSRF and origin protections', () => {
  it.each([undefined, 'incorrect-csrf-token'])('rejects an absent or incorrect CSRF token: %s', async csrf => {
    let pending = request(app).post(`${API}/auth/logout`).set('Origin', ORIGIN).set('Cookie', admin.cookie);
    if (csrf) pending = pending.set('X-CSRF-Token', csrf);
    expect((await pending.send({})).status).toBe(403);
    expect((await get('/auth/session')).status).toBe(200);
  });

  it.each([undefined, 'null', 'https://evil.example', `${ORIGIN}.evil.test`])('rejects missing or foreign write origins: %s', async origin => {
    let pending = request(app).post(`${API}/auth/login`);
    if (origin) pending = pending.set('Origin', origin);
    expect((await pending.send({ email: MASTER_EMAIL, password: PASSWORD })).status).toBe(403);
  });

  it('rejects an origin forgery even with a valid session and CSRF token', async () => {
    const response = await request(app).patch(`${API}/users/${master.id}`).set('Origin', 'https://evil.example')
      .set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf).send({ name: 'Cambio no autorizado' });
    expect(response.status).toBe(403);
    expect((await get('/auth/session')).body.user.name).toBe(master.name);
  });

  it('binds the CSRF token to its own session', async () => {
    const second = sessionOf(await login());
    expect(second.csrf).not.toBe(admin.csrf);
    const response = await request(app).post(`${API}/auth/logout`).set('Origin', ORIGIN)
      .set('Cookie', admin.cookie).set('X-CSRF-Token', second.csrf).send({});
    expect(response.status).toBe(403);
  });
});

describe('Password changes and forced first change', () => {
  it('requires new users to change their password before accessing management', async () => {
    const user = await createUser({ role: 'ADMINMASTER' });
    expect(user.mustChangePassword).toBe(true);
    const initial = sessionOf(await login(user.email));
    expect((await get('/auth/session', initial)).status).toBe(200);
    expect((await get('/users', initial)).status).toBe(403);
    expect((await post('/users', initial).send({})).status).toBe(403);
    const changed = await post('/auth/password', initial).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    const current = sessionOf(changed);
    expect(current.user.mustChangePassword).toBe(false);
    expectPublic(current.user);
    expect((await get('/users', current)).status).toBe(200);
    expect((await get('/auth/session', initial)).status).toBe(401);
  });

  it('allows logout while a first password change is pending', async () => {
    const user = await createUser();
    const initial = sessionOf(await login(user.email));
    expect((await post('/auth/logout', initial).send({})).status).toBe(204);
  });

  it('rotates the current session and revokes all older sessions after a password change', async () => {
    const second = sessionOf(await login());
    const response = await post('/auth/password').send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    const replacement = sessionOf(response);
    expect(replacement.cookie).not.toBe(admin.cookie);
    expect(replacement.csrf).not.toBe(admin.csrf);
    expect((await get('/auth/session', replacement)).status).toBe(200);
    expect((await get('/auth/session', admin)).status).toBe(401);
    expect((await get('/auth/session', second)).status).toBe(401);
    expect((await login()).status).toBe(401);
    expect((await login(MASTER_EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  it('requires the current password and keeps the session after a rejected change', async () => {
    const response = await post('/auth/password').send({ currentPassword: 'Incorrecta', newPassword: NEW_PASSWORD });
    expect([400, 401, 422]).toContain(response.status);
    expect((await get('/auth/session')).status).toBe(200);
    expect((await login()).status).toBe(200);
  });

  it.each(['short', PASSWORD])('rejects an inadequate or unchanged new password: %s', async newPassword => {
    const response = await post('/auth/password').send({ currentPassword: PASSWORD, newPassword });
    expect([400, 422]).toContain(response.status);
    expect((await get('/auth/session')).status).toBe(200);
  });

  it('allows an admin reset, revokes sessions, and requires another first change', async () => {
    const user = await createUser();
    const previous = await activeSession(user.email);
    const response = await post(`/users/${user.id}/password`).send({ password: THIRD_PASSWORD });
    expect(response.status).toBe(204);
    expect((await get('/auth/session', previous)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(401);
    const fresh = await login(user.email, THIRD_PASSWORD);
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.mustChangePassword).toBe(true);
  });
});

describe('Administration accounts and server-side authorization', () => {
  it('creates, lists, searches, edits and deactivates a user', async () => {
    const user = await createUser({ name: '  Ana Diseño  ', email: '  ANA@EXAMPLE.TEST  ' });
    expect(user.name).toBe('Ana Diseño');
    expect(user.email).toBe('ana@example.test');
    expectPublic(user);
    const all = await get('/users?page=1&pageSize=1');
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(all.body.items).toHaveLength(1);
    all.body.items.forEach(expectPublic);
    const searched = await get('/users?q=ANA');
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].id).toBe(user.id);
    const modified = await patch(`/users/${user.id}`).send({ name: 'Ana Taller', role: 'TALLER', active: false });
    expect(modified.status).toBe(200);
    expect(modified.body.user).toMatchObject({ id: user.id, name: 'Ana Taller', role: 'TALLER', active: false });
    expect((await login(user.email)).status).toBe(401);
  });

  it('returns user data without secret material in every account listing', async () => {
    await createUser();
    const response = await get('/users');
    expect(response.body.items).toHaveLength(2);
    response.body.items.forEach(expectPublic);
    expect(response.text).not.toMatch(/password_hash|csrfToken|token_hash/);
  });

  it.each(['ADMIN_GENERAL', 'DISENO', 'IMPRESION', 'TALLER'] as Role[])('denies account management to %s even via direct requests', async role => {
    const user = await createUser({ role });
    const actor = await activeSession(user.email);
    expect((await get('/users', actor)).status).toBe(403);
    expect((await post('/users', actor).send({ name: 'No permitido' })).status).toBe(403);
    expect((await patch(`/users/${master.id}`, actor).send({ role: 'DISENO' })).status).toBe(403);
    expect((await post(`/users/${master.id}/password`, actor).send({ password: NEW_PASSWORD })).status).toBe(403);
  });

  it('revokes a user session immediately on deactivation', async () => {
    const user = await createUser();
    const actor = await activeSession(user.email);
    expect((await patch(`/users/${user.id}`).send({ active: false })).status).toBe(200);
    expect((await get('/auth/session', actor)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(401);
  });

  it('does not retain old admin permissions after a role change', async () => {
    const user = await createUser({ role: 'ADMINMASTER' });
    const actor = await activeSession(user.email);
    expect((await get('/users', actor)).status).toBe(200);
    expect((await patch(`/users/${user.id}`).send({ role: 'DISENO' })).status).toBe(200);
    expect([401, 403]).toContain((await get('/users', actor)).status);
    const fresh = sessionOf(await login(user.email, NEW_PASSWORD));
    expect((await get('/users', fresh)).status).toBe(403);
  });

  it('enforces case-insensitive unique emails on creation and edit', async () => {
    const user = await createUser();
    const duplicate = await post('/users').send({ name: 'Duplicado', email: 'PERSONA@EXAMPLE.TEST', role: 'TALLER', active: true, password: PASSWORD });
    expect(duplicate.status).toBe(409);
    expect((await patch(`/users/${user.id}`).send({ email: 'MASTER@EXAMPLE.TEST' })).status).toBe(409);
    expect((await get('/users')).body.total).toBe(2);
  });

  it.each([
    { name: '' }, { name: '   ' }, { email: 'not-an-email' }, { role: 'ROOT' },
    { password: 'short' }, { active: 'true' }, { passwordHash: 'injected' }, { mustChangePassword: false },
  ])('rejects invalid or mass-assigned creation fields %j', async override => {
    const response = await post('/users').send({ name: 'Valid name', email: 'valid@example.test', role: 'DISENO', active: true, password: PASSWORD, ...override });
    expect([400, 422]).toContain(response.status);
    expect((await get('/users')).body.total).toBe(1);
  });

  it.each([{}, { id: 'replacement-id' }, { password: NEW_PASSWORD }, { mustChangePassword: false }, { role: 'ROOT' }, { active: 'false' }])('rejects invalid or mass-assigned update fields %j', async input => {
    const response = await patch(`/users/${master.id}`).send(input);
    expect([400, 422]).toContain(response.status);
    expect((await get('/auth/session')).body.user.id).toBe(master.id);
  });

  it.each([{ active: false }, { role: 'ADMIN_GENERAL' }])('prevents the master from disabling or downgrading its own account: %j', async update => {
    expect((await patch(`/users/${master.id}`).send(update)).status).toBe(409);
    expect((await get('/auth/session')).body.user).toMatchObject({ active: true, role: 'ADMINMASTER' });
  });

  it('returns 404 for a well-formed missing user and rejects malformed IDs', async () => {
    expect((await patch('/users/00000000-0000-4000-8000-000000000099').send({ name: 'Missing' })).status).toBe(404);
    expect([400, 422]).toContain((await patch('/users/not-a-uuid').send({ name: 'Missing' })).status);
  });

  it('treats search input as data, not SQL or a wildcard expression', async () => {
    for (const query of ["' OR 1=1 --", '%', '_']) {
      const response = await get(`/users?q=${encodeURIComponent(query)}`);
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
    }
    expect((await get('/users')).body.total).toBe(1);
  });

  it('enforces the 15-active-user cap during concurrent creation and activation', async () => {
    for (let index = 0; index < 13; index++) await createUser({ email: `cap${index}@example.test` });
    const inactive = await createUser({ email: 'inactive@example.test', active: false });
    const responses = await Promise.all([
      patch(`/users/${inactive.id}`).send({ active: true }),
      post('/users').send({ name: 'Concurrent', email: 'concurrent@example.test', role: 'TALLER', active: true, password: PASSWORD }),
    ]);
    expect(responses.filter(response => response.status === 200 || response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
    const count = await db.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM users WHERE is_active = true');
    expect(count.rows[0].count).toBe(15);
    const anotherInactive = await createUser({ email: 'another-inactive@example.test', active: false });
    expect(anotherInactive.active).toBe(false);
    expect((await patch(`/users/${anotherInactive.id}`).send({ active: true })).status).toBe(409);
  });
});
