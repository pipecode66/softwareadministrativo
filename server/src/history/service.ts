import type { AuthSession, Role } from '../contracts.js';
import type { Database } from '../db/types.js';
import { requireCurrentActor } from '../security/actor.js';
import { visibility } from '../orders/service.js';
import { ApiError } from '../errors.js';

interface HistoryRow {
  id: string; order_id: string; order_number: number; action: string;
  actor_id: string; actor_name: string; actor_role: Role;
  from_status: string | null; to_status: string; occurred_at: Date | string;
  details: { summary?: string; changes?: Array<{ label: string; before?: string | number | boolean | null; after?: string | number | boolean | null; sensitive?: boolean }> } | null;
}

const admin = (role: Role) => role === 'ADMINMASTER' || role === 'ADMIN_GENERAL';

export async function listHistory(db: Database, auth: AuthSession, input: { page: number; pageSize: number; orderId?: string }) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, ['ADMINMASTER','ADMIN_GENERAL','DISENO','IMPRESION','TALLER']);
    if (!input.orderId && !admin(actor.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'El módulo general de Historial corresponde a Administración.');
    }
    const params: unknown[] = [];
    const conditions = [visibility(actor, params)];
    if (input.orderId) { params.push(input.orderId); conditions.push(`o.id=$${params.length}`); }
    const where = conditions.map(item => `(${item})`).join(' AND ');
    const total = Number((await tx.query<{ count: string }>(`
      SELECT count(*) AS count FROM order_events e JOIN orders o ON o.id=e.order_id WHERE ${where}
    `, params)).rows[0].count);
    params.push(input.pageSize, (input.page - 1) * input.pageSize);
    const rows = (await tx.query<HistoryRow>(`
      SELECT e.id,e.order_id,o.number AS order_number,e.action,e.actor_id,u.name AS actor_name,u.role AS actor_role,
        e.from_status,e.to_status,e.occurred_at,e.details
      FROM order_events e JOIN orders o ON o.id=e.order_id JOIN users u ON u.id=e.actor_id
      WHERE ${where} ORDER BY e.occurred_at DESC,e.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params)).rows;
    return { page: input.page, pageSize: input.pageSize, total, items: rows.map(row => {
      const changes = (row.details?.changes ?? []).filter(change => admin(actor.role) || !change.sensitive);
      return {
        id: row.id, orderId: row.order_id, orderNumber: Number(row.order_number), action: row.action,
        actor: { id: row.actor_id, name: row.actor_name, role: row.actor_role },
        fromStatus: row.from_status, toStatus: row.to_status,
        occurredAt: new Date(row.occurred_at).toISOString(),
        details: { summary: row.details?.summary, changes },
      };
    }) };
  });
}
