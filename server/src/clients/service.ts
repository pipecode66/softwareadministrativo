import { randomUUID } from 'node:crypto';
import type { AuthSession, Role } from '../contracts.js';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { cents, financials, isAdmin, orderDto, type OrderRow, type PaymentRow } from '../orders/domain.js';
import { requireCurrentActor } from '../security/actor.js';
import type { CreateClientInput, ListClientOrdersInput, ListClientsInput, UpdateClientInput } from './schemas.js';

export const CLIENT_READ_ROLES: readonly Role[] = ['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO'];
export const CLIENT_WRITE_ROLES: readonly Role[] = ['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO'];

export interface PublicClient {
  id: string;
  name: string;
  identification: string;
  phone: string;
  specialPayment: boolean;
  createdAt: string;
}

interface ClientRow {
  id: string;
  name: string;
  identification: string;
  phone: string;
  special_payment: boolean;
  created_at: Date | string;
}

function publicClient(row: ClientRow): PublicClient {
  return {
    id: row.id, name: row.name, identification: row.identification, phone: row.phone,
    specialPayment: row.special_payment,
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
    SELECT id, name, identification, phone, special_payment, created_at FROM clients WHERE ${filter}
    ORDER BY lower(name), id LIMIT $2 OFFSET $3
  `, [input.q, input.pageSize, (input.page - 1) * input.pageSize]);
  return {
    items: result.rows.map(publicClient), page: input.page, pageSize: input.pageSize,
    total: Number(count.rows[0].total),
  };
}

export async function getClient(db: Database, id: string): Promise<PublicClient> {
  const result = await db.query<ClientRow>(
    'SELECT id, name, identification, phone, special_payment, created_at FROM clients WHERE id = $1', [id],
  );
  if (!result.rows[0]) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'El cliente no existe.');
  return publicClient(result.rows[0]);
}

/**
 * Client history intentionally has a distinct privacy contract:
 * Administration receives commercial values, payments and an aggregate summary;
 * Design receives every operational OT for the client without commercial totals.
 */
export async function listClientOrders(
  db: Database, auth: AuthSession, clientId: string, input: ListClientOrdersInput,
) {
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const client = (await tx.query<{ id: string }>('SELECT id FROM clients WHERE id=$1', [clientId])).rows[0];
    if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'El cliente no existe.');

    const administrative = isAdmin(auth.user.role);
    const limit = administrative ? input.pageSize : input.pageSize + 1;
    const rows = (await tx.query<OrderRow>(`
      SELECT o.*,c.special_payment FROM orders o JOIN clients c ON c.id=o.client_id
      WHERE o.client_id=$1 ORDER BY o.number DESC LIMIT $2 OFFSET $3
    `, [clientId, limit, (input.page - 1) * input.pageSize])).rows;
    const visibleRows = rows.slice(0, input.pageSize);
    const ids = visibleRows.map(row => row.id);
    const payments = administrative && ids.length
      ? (await tx.query<PaymentRow>('SELECT * FROM payments WHERE order_id=ANY($1::uuid[]) ORDER BY date,recorded_at,id', [ids])).rows
      : [];
    const response = {
      items: visibleRows.map(row => orderDto(row, payments.filter(payment => payment.order_id === row.id), auth.user.role, false)),
      page: input.page,
      pageSize: input.pageSize,
      hasMore: administrative
        ? false
        : rows.length > input.pageSize,
    };
    if (!administrative) return response;

    const allRows = (await tx.query<OrderRow>(`
      SELECT o.*,c.special_payment FROM orders o JOIN clients c ON c.id=o.client_id
      WHERE o.client_id=$1 ORDER BY o.number DESC
    `, [clientId])).rows;
    const allIds = allRows.map(row => row.id);
    const allPayments = allIds.length
      ? (await tx.query<PaymentRow>('SELECT * FROM payments WHERE order_id=ANY($1::uuid[])', [allIds])).rows
      : [];
    const money = allRows.map(row => financials(row, allPayments.filter(payment => payment.order_id === row.id)));
    const total = allRows.length;
    return {
      ...response,
      hasMore: input.page * input.pageSize < total,
      total,
      summary: {
        orders: total,
        received: money.reduce((sum, item) => sum + cents(item.paid), 0) / 100,
        balance: money.reduce((sum, item) => sum + Math.max(cents(item.balance), 0), 0) / 100,
      },
    };
  });
}

export async function createClient(db: Database, auth: AuthSession, input: CreateClientInput): Promise<PublicClient> {
  return db.transaction(async tx => {
    await requireCurrentActor(tx, auth, CLIENT_WRITE_ROLES);
    const result = await tx.query<ClientRow>(`
      INSERT INTO clients (id, name, identification, phone, special_payment)
      VALUES ($1, $2, $3, $4, $5) RETURNING id, name, identification, phone, special_payment, created_at
    `, [randomUUID(), input.name, input.identification, input.phone, input.specialPayment]);
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
    const phone = input.phone ?? current.phone;
    if (!phone.trim()) throw new ApiError(422, 'CLIENT_PHONE_REQUIRED', 'Escribe el celular del cliente.', 'phone');
    const result = await tx.query<ClientRow>(`
      UPDATE clients SET name = $2, identification = $3, phone = $4, special_payment = $5, updated_at = now()
      WHERE id = $1 RETURNING id, name, identification, phone, special_payment, created_at
    `, [id, input.name ?? current.name, input.identification ?? current.identification, phone, input.specialPayment ?? current.special_payment]);
    return publicClient(result.rows[0]);
  });
}
