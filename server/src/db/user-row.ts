import type { PublicUser, Role } from '../contracts.js';

export interface UserRow {
  id: string; name: string; email: string; role: Role; is_active: boolean;
  password_hash: string; must_change_password: boolean;
  created_at: Date | string; updated_at: Date | string;
}
export function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role, active: row.is_active,
    mustChangePassword: row.must_change_password,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}
