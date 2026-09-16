import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ROLES, type AuthSession, type Role } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { ApiError } from '../errors.js';
import { requireCurrentActor } from '../security/actor.js';
import { cents, dateOnly, financials, isAdmin, orderDto, type OrderInput, type OrderRow, type PaymentRow, type createSchema, type editSchema, type paymentSchema, type transitionSchema } from './domain.js';

const admins: Role[] = ['ADMINMASTER', 'ADMIN_GENERAL'];
const creators: Role[] = [...admins, 'DISENO'];
const missing = () => new ApiError(404, 'ORDER_NOT_FOUND', 'No encontramos esta orden o no está disponible para tu perfil.');
const conflict = (message: string) => new ApiError(409, 'ORDER_CONFLICT', message);
export function canRead(user: { role: Role; id: string }, row: OrderRow): boolean {
  if (isAdmin(user.role)) return true;
  if (user.role === 'DISENO') return row.created_by === user.id;
  if (row.closed_at) return false;
  if (user.role === 'IMPRESION') return row.route !== 'WORKSHOP_ONLY' && row.status === 'IN_PRINTING';
  return user.role === 'TALLER' && ((['IMPRENTA', 'PRINT_WORKSHOP', 'WORKSHOP_ONLY'].includes(row.route) && row.status === 'IN_WORKSHOP') || row.status === 'PENDING_INSTALLATION');
}
export function visibility(user: { role: Role; id: string }, params: unknown[]): string {
  if (isAdmin(user.role)) return 'true';
  if (user.role === 'DISENO') { params.push(user.id); return `o.created_by = $${params.length}`; }
  if (user.role === 'IMPRESION') return "o.closed_at IS NULL AND o.route <> 'WORKSHOP_ONLY' AND o.status = 'IN_PRINTING'";
  return "o.closed_at IS NULL AND ((o.route IN ('IMPRENTA','PRINT_WORKSHOP','WORKSHOP_ONLY') AND o.status = 'IN_WORKSHOP') OR o.status = 'PENDING_INSTALLATION')";
}
async function paymentsOf(tx: SqlConnection, id: string) {
  return (await tx.query<PaymentRow>('SELECT * FROM payments WHERE order_id = $1 ORDER BY date, recorded_at, id', [id])).rows;
}
async function lockedOrder(tx: SqlConnection, id: string): Promise<OrderRow> {
  const row = (await tx.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!row) throw missing();
  return row;
}
function checkVersion(row: OrderRow, version: number) {
  if (row.version !== version) throw conflict('Otra persona actualizó esta orden. Recarga sus datos antes de continuar.');
}
async function event(tx: SqlConnection, row: OrderRow, actor: string, action: string, before?: string) {
  await tx.query('INSERT INTO order_events (id, order_id, actor_id, action, from_status, to_status) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), row.id, actor, action, before ?? null, row.status]);
}
function inputParams(input: OrderInput): unknown[] {
  return [input.clientId, input.description, input.value, input.documentType, input.category, input.route, input.requiresInstallation,
    input.printing?.material ?? null, input.printing?.length ?? null, input.printing?.width ?? null, input.reteFuente, input.reteIva, input.ica];
}
async function checkClient(tx: SqlConnection, id: string) {
  if (!(await tx.query('SELECT id FROM clients WHERE id = $1', [id])).rows.length) throw new ApiError(400, 'CLIENT_NOT_FOUND', 'Selecciona un cliente registrado.', 'clientId');
}

export async function createOrder(db: Database, auth: AuthSession, input: z.infer<typeof createSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, creators);
    if (!isAdmin(actor.role) && (input.reteFuente || input.reteIva || input.ica)) throw new ApiError(403, 'FORBIDDEN', 'Solo Administración registra importes de retenciones.');
    const fingerprint = createHash('sha256').update(JSON.stringify(inputParams(input))).digest('hex');
    const previous = (await tx.query<OrderRow>('SELECT * FROM orders WHERE created_by = $1 AND creation_key = $2', [actor.id, input.requestId])).rows[0];
    if (previous) {
      if (previous.creation_fingerprint !== fingerprint) throw conflict('Este identificador de solicitud ya se utilizó con otros datos.');
      return { order: orderDto(previous, await paymentsOf(tx, previous.id), actor.role), replayed: true };
    }
    await checkClient(tx, input.clientId);
    const row = (await tx.query<OrderRow>(`
      INSERT INTO orders (client_id,description,value,document_type,category,route,requires_installation,
        material,length,width,rete_fuente,rete_iva,ica,id,created_by,status,creation_key,creation_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *
    `, [...inputParams(input), randomUUID(), actor.id, actor.role === 'DISENO' ? 'PENDING_ADMIN_REVIEW' : 'NEW', input.requestId, fingerprint])).rows[0];
    await event(tx, row, actor.id, 'create');
    return { order: orderDto(row, [], actor.role), replayed: false };
  });
}

export async function editOrder(db: Database, auth: AuthSession, id: string, input: z.infer<typeof editSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, admins);
    const row = await lockedOrder(tx, id);
    checkVersion(row, input.expectedVersion);
    if (row.closed_at || !['NEW','PENDING_ADMIN_REVIEW'].includes(row.status)) throw conflict('La orden ya está en producción y sus datos están protegidos.');
    await checkClient(tx, input.clientId);
    const payments = await paymentsOf(tx, id);
    const money = financials({ value: String(input.value), document_type: input.documentType, rete_fuente: String(input.reteFuente), rete_iva: String(input.reteIva), ica: String(input.ica) }, payments);
    if (money.balance < 0) throw conflict('El total cobrable no puede ser inferior a los abonos registrados.');
    const updated = (await tx.query<OrderRow>(`
      UPDATE orders SET client_id=$1,description=$2,value=$3,document_type=$4,category=$5,route=$6,requires_installation=$7,
        material=$8,length=$9,width=$10,rete_fuente=$11,rete_iva=$12,ica=$13,updated_at=clock_timestamp(),version=version+1
      WHERE id=$14 RETURNING *`, [...inputParams(input), id])).rows[0];
    await event(tx, updated, actor.id, 'edit', row.status);
    return orderDto(updated, payments, actor.role);
  });
}

export async function recordPayment(db: Database, auth: AuthSession, id: string, input: z.infer<typeof paymentSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, admins);
    const row = await lockedOrder(tx, id);
    const payments = await paymentsOf(tx, id);
    const previous = payments.find(p => p.request_key === input.requestId);
    if (previous) {
      const previousDate = typeof previous.date === 'string' ? previous.date.slice(0,10) : previous.date.toISOString().slice(0,10);
      if (cents(previous.amount) !== cents(input.amount) || previousDate !== input.date || previous.recorded_by !== actor.id) throw conflict('Este identificador de abono ya se utilizó con otros datos.');
      return { order: orderDto(row, payments, actor.role), replayed: true };
    }
    if (input.date < dateOnly(row.created_at) || input.date > dateOnly()) throw new ApiError(400, 'PAYMENT_DATE', 'La fecha del abono debe estar entre la creación de la OT y hoy.', 'date');
    if (cents(input.amount) > cents(financials(row, payments).balance)) throw conflict('El abono supera el saldo actual de la orden.');
    await tx.query('INSERT INTO payments (id,order_id,date,amount,recorded_by,request_key) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, input.date, input.amount, actor.id, input.requestId]);
    const updated = (await tx.query<OrderRow>('UPDATE orders SET updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *', [id])).rows[0];
    await event(tx, updated, actor.id, 'payment', row.status);
    return { order: orderDto(updated, await paymentsOf(tx, id), actor.role), replayed: false };
  });
}

export async function transitionOrder(db: Database, auth: AuthSession, id: string, input: z.infer<typeof transitionSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, ROLES);
    const row = await lockedOrder(tx, id);
    if (!canRead(actor, row)) throw missing();
    checkVersion(row, input.expectedVersion);
    if (row.closed_at) throw conflict('La orden ya está cerrada administrativamente.');
    const admin = isAdmin(actor.role);
    const requireRole = (...roles: Role[]) => { if (!admin && !roles.includes(actor.role)) throw new ApiError(403, 'FORBIDDEN', 'Tu perfil no puede ejecutar esta acción.'); };
    const requireStatus = (...valid: OrderRow['status'][]) => { if (!valid.includes(row.status)) throw conflict('El estado actual de la orden no permite esta acción.'); };
    const now = new Date().toISOString();
    const next = { ...row };
    switch (input.action) {
      case 'send':
        requireRole(); requireStatus('NEW','PENDING_ADMIN_REVIEW');
        next.status = row.route === 'WORKSHOP_ONLY' ? 'IN_WORKSHOP' : 'IN_PRINTING'; break;
      case 'finishPrinting':
        if (actor.role !== 'IMPRESION') throw new ApiError(403, 'FORBIDDEN', 'Solo Impresión puede finalizar esta fase.');
        requireStatus('IN_PRINTING');
        next.printing_completed_at = now;
        next.status = row.route === 'PRINT_WORKSHOP' ? 'IN_WORKSHOP' : row.requires_installation ? 'PENDING_INSTALLATION' : 'COMPLETED'; break;
      case 'startWorkshop':
        if (actor.role !== 'TALLER') throw new ApiError(403, 'FORBIDDEN', 'Solo Taller puede iniciar esta fase.');
        requireStatus('IN_WORKSHOP');
        if (row.workshop_started_at) throw conflict('El trabajo ya fue iniciado en Taller.');
        next.workshop_started_at = now; break;
      case 'finishWorkshop':
        if (actor.role !== 'TALLER') throw new ApiError(403, 'FORBIDDEN', 'Solo Taller puede finalizar esta fase.');
        requireStatus('IN_WORKSHOP');
        next.status = row.requires_installation ? 'PENDING_INSTALLATION' : 'COMPLETED'; break;
      case 'install':
        requireRole('TALLER'); requireStatus('PENDING_INSTALLATION');
        if (!row.requires_installation || !row.ready_for_installation_at || !input.date || input.date < dateOnly(row.ready_for_installation_at) || input.date > dateOnly()) throw new ApiError(400, 'INSTALLATION_DATE', 'La fecha de instalación debe estar entre el fin de producción y hoy.', 'date');
        next.status = 'INSTALLED'; next.installed_at = `${input.date}T12:00:00-05:00`; next.installation_note = input.note ?? ''; break;
      case 'close': requireRole(); requireStatus('COMPLETED','INSTALLED'); next.closed_at = now; break;
    }
    if (next.status === 'PENDING_INSTALLATION' && row.status !== 'PENDING_INSTALLATION') next.ready_for_installation_at = now;
    if (input.action !== 'install' && (input.date || input.note)) throw new ApiError(400, 'INVALID_DETAILS', 'Fecha y nota solo corresponden a instalación.');
    const updated = (await tx.query<OrderRow>(`
      UPDATE orders SET status=$2,printing_completed_at=$3,workshop_started_at=$4,ready_for_installation_at=$5,
        installed_at=$6,installation_note=$7,closed_at=$8,updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *
    `, [id, next.status, next.printing_completed_at, next.workshop_started_at, next.ready_for_installation_at, next.installed_at, next.installation_note, next.closed_at])).rows[0];
    await event(tx, updated, actor.id, input.action, row.status);
    return orderDto(updated, isAdmin(actor.role) ? await paymentsOf(tx, id) : [], actor.role);
  });
}

export interface ListQuery { page: number; pageSize: number; q?: string; status?: string; documentType?: string; category?: string; paymentStatus?: string; from?: string; to?: string }
export async function listOrders(db: Database, auth: AuthSession, input: ListQuery) {
  if (input.paymentStatus && !isAdmin(auth.user.role)) throw new ApiError(403, 'FORBIDDEN', 'El filtro de cobros corresponde a Administración.');
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const params: unknown[] = [];
    const conditions = [visibility(auth.user, params)];
    const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };
    if (input.q) add("position(lower(?) in lower(concat(o.number::text, ' ', lpad(o.number::text,4,'0'), ' ',c.name,' ',o.description))) > 0", input.q);
    if (input.status) add('o.status = ?', input.status);
    if (input.documentType) add('o.document_type = ?', input.documentType);
    if (input.category) add('o.category = ?', input.category);
    if (input.from) add("(o.created_at AT TIME ZONE 'America/Bogota')::date >= ?::date", input.from);
    if (input.to) add("(o.created_at AT TIME ZONE 'America/Bogota')::date <= ?::date", input.to);
    const paid = '(SELECT coalesce(sum(p.amount),0) FROM payments p WHERE p.order_id=o.id)';
    const collectible = "(o.value + CASE WHEN o.document_type='FACT' THEN round(o.value*0.19,2)+o.rete_fuente+o.rete_iva+o.ica ELSE 0 END)";
    if (input.paymentStatus === 'PENDING') conditions.push(`${paid}=0 AND ${collectible}>0`);
    if (input.paymentStatus === 'PARTIAL') conditions.push(`${paid}>0 AND ${paid}<${collectible}`);
    if (input.paymentStatus === 'PAID') conditions.push(`${paid}>=${collectible}`);
    if (input.paymentStatus === 'OUTSTANDING') conditions.push(`${paid}<${collectible}`);
    const where = conditions.map(s => `(${s})`).join(' AND ');
    const total = Number((await tx.query<{ total: string }>(`SELECT count(*) AS total FROM orders o JOIN clients c ON c.id=o.client_id WHERE ${where}`, params)).rows[0].total);
    const rows = (await tx.query<OrderRow>(`SELECT o.* FROM orders o JOIN clients c ON c.id=o.client_id WHERE ${where} ORDER BY o.number DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, input.pageSize, (input.page-1)*input.pageSize])).rows;
    const ids = rows.map(row => row.id);
    const payments = isAdmin(auth.user.role) && ids.length ? (await tx.query<PaymentRow>('SELECT * FROM payments WHERE order_id=ANY($1::uuid[]) ORDER BY date,recorded_at,id', [ids])).rows : [];
    const clientRows = ids.length ? (await tx.query<{ id:string; name:string; created_at:Date|string }>('SELECT DISTINCT c.id,c.name,c.created_at FROM clients c JOIN orders o ON o.client_id=c.id WHERE o.id=ANY($1::uuid[])', [ids])).rows : [];
    return { items: rows.map(row => orderDto(row, payments.filter(p => p.order_id===row.id), auth.user.role)), page: input.page, pageSize: input.pageSize, total,
      clients: clientRows.map(c => ({ id:c.id,name:c.name,identification:'',phone:'',createdAt:new Date(c.created_at).toISOString() })) };
  });
}

export async function getOrder(db: Database, auth: AuthSession, id: string) {
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = (await tx.query<OrderRow>('SELECT * FROM orders WHERE id=$1', [id])).rows[0];
    if (!row || !canRead(auth.user, row)) throw missing();
    const client = (await tx.query<{ id: string; name: string }>('SELECT id,name FROM clients WHERE id=$1', [row.client_id])).rows[0];
    const order = orderDto(row, isAdmin(auth.user.role) ? await paymentsOf(tx,id) : [], auth.user.role);
    return { order, client };
  });
}
