import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type CookieOptions, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { PublicUser } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { publicUser, type UserRow } from '../db/user-row.js';
import { ApiError } from '../errors.js';
import { dummyPasswordHash, hashPassword, passwordSchema, verifyPassword } from './password.js';

export const SESSION_COOKIE = 'intermedios_session';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(160).email(),
  password: z.string().min(1).max(128),
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).strict();

interface SessionRow extends UserRow {
  token_hash: string;
  csrf_token: string;
}

interface NewSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  user: PublicUser;
}

function sessionHash(request: Request): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const matching = cookies.map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));
  // Ambiguous or malformed cookies never resolve to an authenticated session.
  if (matching.length !== 1) return undefined;
  const value = matching[0].slice(SESSION_COOKIE.length + 1);
  if (!/^[a-f0-9]{64}$/.test(value)) return undefined;
  return createHash('sha256').update(value).digest('hex');
}

function unauthorized(): ApiError {
  return new ApiError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
}

function invalidCredentials(): ApiError {
  return new ApiError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
}

async function lockUserManagement(tx: SqlConnection): Promise<void> {
  const lock = await tx.query("SELECT id FROM system_locks WHERE id = 'user-management' FOR UPDATE");
  if (lock.rows.length !== 1) {
    throw new ApiError(503, 'USER_MANAGEMENT_UNAVAILABLE', 'La gestión de cuentas no está disponible.');
  }
}

export async function createAuth(db: Database, config: AppConfig): Promise<{
  router: Router;
  requireAuth: RequestHandler;
  requireCsrf: RequestHandler;
  requirePasswordReady: RequestHandler;
}> {
  // Finish the dummy hash at startup, not on the first unknown-account request.
  const dummyHash = await dummyPasswordHash;
  const router = Router();
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: 'strict',
    path: '/api/v1',
  };

  async function newSession(tx: SqlConnection, user: UserRow): Promise<NewSession> {
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
    await tx.query(
      'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)',
      [createHash('sha256').update(token).digest('hex'), user.id, csrfToken, expiresAt],
    );
    return { token, csrfToken, expiresAt, user: publicUser(user) };
  }

  function respondWithSession(response: Response, session: NewSession): void {
    response.cookie(SESSION_COOKIE, session.token, {
      ...cookieOptions,
      expires: session.expiresAt,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.json({ user: session.user, csrfToken: session.csrfToken });
  }

  const requireAuth: RequestHandler = async (request, response, next) => {
    const tokenHash = sessionHash(request);
    if (!tokenHash) throw unauthorized();
    const { rows } = await db.query<SessionRow>(
      `SELECT u.*, s.token_hash, s.csrf_token
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND u.is_active = true`,
      [tokenHash],
    );
    const session = rows[0];
    if (!session) {
      response.clearCookie(SESSION_COOKIE, cookieOptions);
      throw unauthorized();
    }
    request.auth = { user: publicUser(session), tokenHash: session.token_hash, csrfToken: session.csrf_token };
    response.setHeader('Cache-Control', 'no-store');
    next();
  };

  const requireCsrf: RequestHandler = (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
    if (!request.auth) throw unauthorized();
    const provided = request.get('X-CSRF-Token');
    const expected = request.auth.csrfToken;
    if (!provided || !/^[a-f0-9]{64}$/.test(provided) || expected.length !== 64
      || !timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))) {
      throw new ApiError(403, 'CSRF_INVALID', 'La solicitud no es válida. Actualiza la sesión e inténtalo de nuevo.');
    }
    next();
  };

  const requirePasswordReady: RequestHandler = (request, _response, next) => {
    if (!request.auth) throw unauthorized();
    if (request.auth.user.mustChangePassword) {
      throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Debes cambiar tu contraseña antes de continuar.');
    }
    next();
  };

  router.post('/login', async (request, response) => {
    const input = loginSchema.parse(request.body);
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE email = $1', [input.email]);
    const candidate = rows[0];
    const valid = await verifyPassword(candidate?.password_hash ?? dummyHash, input.password);
    if (!valid || !candidate?.is_active) throw invalidCredentials();

    const session = await db.transaction(async tx => {
      await lockUserManagement(tx);
      const { rows: currentRows } = await tx.query<UserRow>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [candidate.id]);
      const current = currentRows[0];
      // A reset/deactivation during Argon2 verification must not mint a stale session.
      if (!current?.is_active || current.password_hash !== candidate.password_hash) throw invalidCredentials();
      const previousHash = sessionHash(request);
      if (previousHash) await tx.query('DELETE FROM sessions WHERE token_hash = $1', [previousHash]);
      await tx.query('DELETE FROM sessions WHERE expires_at <= now()');
      return newSession(tx, current);
    });
    respondWithSession(response, session);
  });

  router.get('/session', requireAuth, (request, response) => {
    response.json({ user: request.auth!.user, csrfToken: request.auth!.csrfToken });
  });

  router.post('/logout', requireAuth, requireCsrf, async (request, response) => {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [request.auth!.tokenHash]);
    response.clearCookie(SESSION_COOKIE, cookieOptions);
    response.status(204).end();
  });

  router.post('/password', requireAuth, requireCsrf, async (request, response) => {
    const input = changePasswordSchema.parse(request.body);
    if (input.newPassword === input.currentPassword) {
      throw new ApiError(400, 'PASSWORD_UNCHANGED', 'La contraseña nueva debe ser diferente de la actual.', 'newPassword');
    }
    const auth = request.auth!;
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [auth.user.id]);
    const candidate = rows[0];
    const valid = await verifyPassword(candidate?.password_hash ?? dummyHash, input.currentPassword);
    if (!valid || !candidate?.is_active) throw invalidCredentials();
    const passwordHash = await hashPassword(input.newPassword);

    const session = await db.transaction(async tx => {
      await lockUserManagement(tx);
      const { rows: currentRows } = await tx.query<UserRow>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [candidate.id]);
      const current = currentRows[0];
      if (!current?.is_active || current.password_hash !== candidate.password_hash) throw unauthorized();
      const { rows: activeSessions } = await tx.query(
        'SELECT token_hash FROM sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > clock_timestamp() FOR UPDATE',
        [auth.tokenHash, current.id],
      );
      // requireAuth ran before hashing: logout/reset may already have revoked it.
      if (!activeSessions.length) throw unauthorized();
      const { rows: updatedRows } = await tx.query<UserRow>(
        `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [passwordHash, current.id],
      );
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [current.id]);
      return newSession(tx, updatedRows[0]);
    });
    respondWithSession(response, session);
  });

  return { router, requireAuth, requireCsrf, requirePasswordReady };
}
