import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, passwordSchema } from './auth/password.js';
import type { Database } from './db/types.js';
import { publicUser, type UserRow } from './db/user-row.js';
import { ApiError } from './errors.js';

const schema = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email().max(160), password: passwordSchema }).strict();

export async function bootstrapAdmin(db: Database, input: { name: string; email: string; password: string }) {
  const fields = schema.parse(input);
  const passwordHash = await hashPassword(fields.password);
  return db.transaction(async tx => {
    await tx.query("SELECT id FROM system_locks WHERE id = 'user-management' FOR UPDATE");
    const existing = await tx.query('SELECT id FROM users LIMIT 1');
    if (existing.rows.length) throw new ApiError(409, 'BOOTSTRAP_ALREADY_DONE', 'Ya existen usuarios. El aprovisionamiento inicial no sobrescribe cuentas ni contraseñas.');
    const result = await tx.query<UserRow>(
      `INSERT INTO users (id, name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, 'ADMINMASTER', true, false) RETURNING *`,
      [randomUUID(), fields.name, fields.email, passwordHash],
    );
    return publicUser(result.rows[0]);
  });
}
