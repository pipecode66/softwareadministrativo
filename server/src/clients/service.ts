import { randomUUID } from 'node:crypto';
import type { AuthSession, Role } from '../contracts.js';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { requireCurrentActor } from '../security/actor.js';
import type { CreateClientInput, ListClientsInput, UpdateClientInput } from './schemas.js';

export const CLIENT_READ_ROLES: readonly Role[] = ['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO'];
export const CLIENT_WRITE_ROLES: readonly Role[] = ['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO'];

export interface PublicClient {
  id: string;
  name: string;
  identification: string;
  phone: string;
  createdAt: string;
}

interface ClientRow {
  id: string;
  name: string;
  identification: string;
  phone: string;
  created_at: Date | string;
}

function publicClient(row: ClientRow): PublicClient {
  return {
    id: row.id, name: row.name, identification: row.identification, phone: row.phone,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listClients(db: Database, input: ListClientsInput): Promise<{
  items: PublicClient[]; page: number; pageSize: number; total: number;
}> {
  // POSITION searches literal text, so %, _ and SQL-like text are not operators.
  const filter = `($1 = '' OR position(lower($1) in lower(name)) > 0
    OR position(lower($1) in lower(identification)) > 0
    OR position(lower($1) in lower(phone)) > 0)`;
  const count = await db.query<{ total: string | number }>(
    `SELECT count(*) AS total FROM clients WHERE ${filter}`, [input.q],
  );
  const result = await db.query<ClientRow>(`
    SELECT id, name, identification, phone, created_at FROM clients WHERE ${filter}
    ORDER BY lower(name), id LIMIT $2 OFFSET $3
  `, [input.q, input.pageSize, (input.page - 1) * input.pageSize]);
  return {
    items: result.rows.map(publicClient), page: input.page, pageSize: input.pageSize,
    total: Number(count.rows[0].total),
  };
}

export async function getClient(db: Database, id: string): Promise<PublicClient> {
  const result = await db.query<ClientRow>(
    'SELECT id, name, identification, phone, created_at FROM clients WHERE id = $1', [id],
  );
  if (!result.rows[0]) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'El cliente no existe.');
  return publicClient(result.rows[0]);
}

export async function createClient(db: Database, auth: AuthSession, input: CreateClientInput): Promise<PublicClient> {
  return db.transaction(async tx => {
    await requireCurrentActor(tx, auth, CLIENT_WRITE_ROLES);
    const result = await tx.query<ClientRow>(`
      INSERT INTO clients (id, name, identification, phone)
      VALUES ($1, $2, $3, $4) RETURNING id, name, identification, phone, created_at
    `, [randomUUID(), input.name, input.identification, input.phone]);
    return publicClient(result.rows[0]);
  });
}

export async function updateClient(
  db: Database, auth: AuthSession, id: string, input: UpdateClientInput,
): Promise<PublicClient> {
  return db.transaction(async tx => {
    await requireCurrentActor(tx, auth, CLIENT_WRITE_ROLES);
    const existing = await tx.query<ClientRow>('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [id]);
    const current = existing.rows[0];
    if (!current) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'El cliente no existe.');
    const result = await tx.query<ClientRow>(`
      UPDATE clients SET name = $2, identification = $3, phone = $4, updated_at = now()
      WHERE id = $1 RETURNING id, name, identification, phone, created_at
    `, [id, input.name ?? current.name, input.identification ?? current.identification, input.phone ?? current.phone]);
    return publicClient(result.rows[0]);
  });
}
