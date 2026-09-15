import type { AuthSession, PublicUser, Role } from '../contracts.js';
import type { SqlConnection } from '../db/types.js';
import { publicUser, type UserRow } from '../db/user-row.js';
import { ApiError } from '../errors.js';

/** Revalidate writes after acquiring the same lock used by account changes. */
export async function requireCurrentActor(
  tx: SqlConnection,
  auth: AuthSession,
  allowedRoles: readonly Role[],
): Promise<PublicUser> {
  const lock = await tx.query("SELECT id FROM system_locks WHERE id = 'user-management' FOR UPDATE");
  if (lock.rows.length !== 1) {
    throw new ApiError(503, 'USER_MANAGEMENT_UNAVAILABLE', 'La gestión de cuentas no está disponible.');
  }

  const result = await tx.query<UserRow>(`
    SELECT u.* FROM users u
    JOIN sessions s ON s.user_id = u.id
    WHERE u.id = $1 AND s.token_hash = $2 AND s.csrf_token = $3
      AND s.expires_at > clock_timestamp() AND u.is_active = true
    FOR UPDATE OF u, s
  `, [auth.user.id, auth.tokenHash, auth.csrfToken]);
  const actor = result.rows[0];
  if (!actor) throw new ApiError(401, 'AUTH_REQUIRED', 'La sesión ya no es válida. Vuelve a ingresar.');
  if (!allowedRoles.includes(actor.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Tu perfil no tiene permiso para realizar esta acción.');
  }
  if (actor.must_change_password) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Debes cambiar tu contraseña antes de continuar.');
  }
  return publicUser(actor);
}
