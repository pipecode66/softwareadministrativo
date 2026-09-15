import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/password.js';
import type { AuthSession, PublicUser } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { publicUser, type UserRow } from '../db/user-row.js';
import { ApiError } from '../errors.js';
import type { CreateUserInput, ListUsersInput, UpdateUserInput } from './schemas.js';

/** All account mutations share this lock with login/password rotation/bootstrap. */
async function lockAndAuthorize(tx: SqlConnection, auth: AuthSession): Promise<UserRow> {
  const lock = await tx.query("SELECT id FROM system_locks WHERE id = 'user-management' FOR UPDATE");
  if (lock.rows.length !== 1) {
    throw new ApiError(503, 'USER_MANAGEMENT_UNAVAILABLE', 'La gestión de cuentas no está disponible.');
  }
  const result = await tx.query<UserRow>(`
    SELECT u.* FROM users u
    JOIN sessions s ON s.user_id = u.id
    WHERE u.id = $1 AND s.token_hash = $2 AND s.csrf_token = $3
      AND s.expires_at > clock_timestamp() AND u.is_active = true
    FOR UPDATE OF u
  `, [auth.user.id, auth.tokenHash, auth.csrfToken]);
  const actor = result.rows[0];
  if (!actor) throw new ApiError(401, 'AUTH_REQUIRED', 'La sesión ya no es válida. Vuelve a ingresar.');
  if (actor.role !== 'ADMINMASTER') {
    throw new ApiError(403, 'FORBIDDEN', 'Solo ADMINMASTER puede administrar las cuentas.');
  }
  if (actor.must_change_password) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Debes cambiar tu contraseña antes de continuar.');
  }
  return actor;
}

async function ensureActiveCapacity(tx: SqlConnection): Promise<void> {
  const result = await tx.query<{ total: string | number }>('SELECT count(*) AS total FROM users WHERE is_active = true');
  if (Number(result.rows[0].total) >= 15) {
    throw new ApiError(409, 'ACTIVE_USER_LIMIT', 'Se permiten como máximo 15 usuarios activos.', 'active');
  }
}

async function findUser(tx: SqlConnection, id: string): Promise<UserRow> {
  const result = await tx.query<UserRow>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
  if (!result.rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'La cuenta no existe.');
  return result.rows[0];
}

function rethrowUserError(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    throw new ApiError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con este correo.', 'email');
  }
  throw error;
}

export async function listUsers(db: Database, input: ListUsersInput): Promise<{
  items: PublicUser[]; page: number; pageSize: number; total: number;
}> {
  // POSITION treats %, _ and backslashes literally; all inputs remain bound parameters.
  const filter = '($1 = \'\' OR position(lower($1) in lower(name)) > 0 OR position(lower($1) in lower(email)) > 0)';
  const total = await db.query<{ total: string | number }>(`SELECT count(*) AS total FROM users WHERE ${filter}`, [input.q]);
  const result = await db.query<UserRow>(`
    SELECT * FROM users WHERE ${filter}
    ORDER BY lower(name), id LIMIT $2 OFFSET $3
  `, [input.q, input.pageSize, (input.page - 1) * input.pageSize]);
  return { items: result.rows.map(publicUser), page: input.page, pageSize: input.pageSize, total: Number(total.rows[0].total) };
}

export async function createUser(db: Database, auth: AuthSession, input: CreateUserInput): Promise<PublicUser> {
  // Hashing is expensive; do it outside the transaction, then revalidate the session after taking the lock.
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async tx => {
      await lockAndAuthorize(tx, auth);
      if (input.active) await ensureActiveCapacity(tx);
      const result = await tx.query<UserRow>(`
        INSERT INTO users (id, name, email, role, is_active, password_hash, must_change_password)
        VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *
      `, [randomUUID(), input.name, input.email, input.role, input.active, passwordHash]);
      return publicUser(result.rows[0]);
    });
  } catch (error) { return rethrowUserError(error); }
}

export async function updateUser(db: Database, auth: AuthSession, id: string, input: UpdateUserInput): Promise<PublicUser> {
  try {
    return await db.transaction(async tx => {
      const actor = await lockAndAuthorize(tx, auth);
      const target = await findUser(tx, id);
      const active = input.active ?? target.is_active;
      const role = input.role ?? target.role;

      if (target.id === actor.id && (!active || role !== 'ADMINMASTER')) {
        throw new ApiError(409, 'OWN_ACCOUNT_PROTECTED', 'No puedes desactivar ni cambiar el perfil de tu propia cuenta.');
      }
      if (target.is_active && target.role === 'ADMINMASTER' && (!active || role !== 'ADMINMASTER')) {
        const masters = await tx.query<{ total: string | number }>(
          "SELECT count(*) AS total FROM users WHERE is_active = true AND role = 'ADMINMASTER'",
        );
        if (Number(masters.rows[0].total) <= 1) {
          throw new ApiError(409, 'LAST_ADMINMASTER_PROTECTED', 'Debe permanecer al menos un ADMINMASTER activo.');
        }
      }
      if (!target.is_active && active) await ensureActiveCapacity(tx);

      const result = await tx.query<UserRow>(`
        UPDATE users SET name = $2, email = $3, role = $4, is_active = $5, updated_at = now()
        WHERE id = $1 RETURNING *
      `, [id, input.name ?? target.name, input.email ?? target.email, role, active]);
      if (role !== target.role || active !== target.is_active) {
        await tx.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      }
      return publicUser(result.rows[0]);
    });
  } catch (error) { return rethrowUserError(error); }
}

export async function resetUserPassword(db: Database, auth: AuthSession, id: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.transaction(async tx => {
    await lockAndAuthorize(tx, auth);
    await findUser(tx, id);
    await tx.query(`
      UPDATE users SET password_hash = $2, must_change_password = true, updated_at = now()
      WHERE id = $1
    `, [id, passwordHash]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  });
}
