import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ROLES, type AuthSession, type Role } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { ApiError } from '../errors.js';
import { requireCurrentActor } from '../security/actor.js';
import { createOrderProducts, replaceOrderProducts } from '../work/service.js';
import { cents, dateOnly, financials, isAdmin, orderDto, type OrderInput, type OrderRow, type PaymentRow, type bulkPaymentSchema, type createSchema, type editSchema, type paymentSchema, type transitionSchema } from './domain.js';

const admins: Role[] = ['ADMINMASTER', 'ADMIN_GENERAL'];
const creators: Role[] = [...admins, 'DISENO'];
const missing = () => new ApiError(404, 'ORDER_NOT_FOUND', 'No encontramos esta orden o no está disponible para tu perfil.');
const conflict = (message: string) => new ApiError(409, 'ORDER_CONFLICT', message);
export function canRead(user: { role: Role; id: string }, row: OrderRow): boolean {
  if (isAdmin(user.role)) return true;
  if (user.role === 'DISENO') return row.created_by === user.id || Boolean(row.has_visible_activity);
  if (row.closed_at) return false;
  if (row.has_visible_activity) return true;
  if (user.role === 'IMPRESION') return ['PRINT_ONLY','PRINT_WORKSHOP','IMPRENTA'].includes(row.route) && row.status === 'IN_PRINTING';
  return user.role === 'TALLER' && ((['IMPRENTA', 'PRINT_WORKSHOP', 'WORKSHOP_ONLY'].includes(row.route) && row.status === 'IN_WORKSHOP') || row.status === 'PENDING_INSTALLATION');
}
export function visibility(user: { role: Role; id: string }, params: unknown[]): string {
  if (isAdmin(user.role)) return 'true';
  if (user.role === 'DISENO') {
    params.push(user.id);
    return `(o.created_by = $${params.length} OR EXISTS (
      SELECT 1 FROM order_activities a WHERE a.order_id=o.id AND a.area='DESIGN'
        AND (a.assigned_user_id IS NULL OR a.assigned_user_id=$${params.length})))`;
  }
  if (user.role === 'IMPRESION') return `o.closed_at IS NULL AND
    ((o.route IN ('PRINT_ONLY','PRINT_WORKSHOP','IMPRENTA') AND o.status='IN_PRINTING')
      OR EXISTS (SELECT 1 FROM order_activities a WHERE a.order_id=o.id AND a.area='PRINTING'))`;
  return `o.closed_at IS NULL AND
    (((o.route IN ('IMPRENTA','PRINT_WORKSHOP','WORKSHOP_ONLY') AND o.status='IN_WORKSHOP')
      OR o.status='PENDING_INSTALLATION')
      OR EXISTS (SELECT 1 FROM order_activities a WHERE a.order_id=o.id AND a.area='WORKSHOP'))`;
}
async function paymentsOf(tx: SqlConnection, id: string) {
  return (await tx.query<PaymentRow>('SELECT * FROM payments WHERE order_id = $1 ORDER BY date, recorded_at, id', [id])).rows;
}
async function lockedOrder(tx: SqlConnection, id: string): Promise<OrderRow> {
  const row = (await tx.query<OrderRow>('SELECT o.*,c.special_payment FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.id = $1 FOR UPDATE OF o', [id])).rows[0];
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
async function checkClient(tx: SqlConnection, id: string, documentType?: string) {
  const client = (await tx.query<{ identification:string; special_payment:boolean }>('SELECT identification,special_payment FROM clients WHERE id = $1', [id])).rows[0];
  if (!client) throw new ApiError(400, 'CLIENT_NOT_FOUND', 'Selecciona un cliente registrado.', 'clientId');
  if (documentType === 'FACT' && !client.identification.trim()) throw new ApiError(400, 'CLIENT_IDENTIFICATION_REQUIRED', 'El cliente de una FACT necesita identificación.', 'clientId');
  return client;
}
function normalizedInput(input: OrderInput, existing?: OrderRow): OrderInput {
  const automatic = input.value > 524000 && input.documentType === 'FACT' && (!existing || existing.financial_rule === 'NEW');
  const auto = (rate: number) => automatic ? Math.round(input.value * rate * 100) / 100 : 0;
  const keepLegacy = existing?.financial_rule === 'LEGACY' && input.documentType === 'FACT';
  const firstMaterial = input.products?.flatMap(product => product.materials)[0];
  return { ...input,
    printing: input.products && ['PRINT_ONLY','PRINT_WORKSHOP'].includes(input.route) && firstMaterial
      ? { material: firstMaterial.material, length: firstMaterial.length, width: firstMaterial.width } : input.printing,
    reteFuente: input.reteFuente ?? (keepLegacy ? Number(existing.rete_fuente) : auto(0.04)),
    reteIva: input.reteIva ?? (keepLegacy ? Number(existing.rete_iva) : auto(0.0285)),
    ica: input.ica ?? (keepLegacy ? Number(existing.ica) : auto(0.007)),
  };
}

export async function createOrder(db: Database, auth: AuthSession, input: z.infer<typeof createSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, creators);
    if (!isAdmin(actor.role) && (input.reteFuente || input.reteIva || input.ica)) throw new ApiError(403, 'FORBIDDEN', 'Solo Administración registra importes de retenciones.');
    const normalized = normalizedInput(input);
    const fingerprint = createHash('sha256').update(JSON.stringify({ fields: inputParams(normalized), products: input.products ?? null, initialPayment: input.initialPayment ?? null })).digest('hex');
    const previous = (await tx.query<OrderRow>('SELECT o.*,c.special_payment FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.created_by = $1 AND o.creation_key = $2', [actor.id, input.requestId])).rows[0];
    if (previous) {
      if (previous.creation_fingerprint !== fingerprint) throw conflict('Este identificador de solicitud ya se utilizó con otros datos.');
      return { order: orderDto(previous, await paymentsOf(tx, previous.id), actor.role), replayed: true };
    }
    const client = await checkClient(tx, input.clientId, input.documentType);
    if (!client.special_payment && !input.initialPayment) throw new ApiError(400, 'INITIAL_PAYMENT_REQUIRED', 'Indica un abono inicial para este cliente.', 'initialPayment');
    if (input.initialPayment && input.initialPayment.date !== dateOnly()) throw new ApiError(400, 'INITIAL_PAYMENT_DATE', 'El abono inicial debe registrarse con la fecha de hoy.', 'initialPayment.date');
    const total = financials({ value:String(normalized.value), document_type:normalized.documentType,
      rete_fuente:String(normalized.reteFuente), rete_iva:String(normalized.reteIva), ica:String(normalized.ica), financial_rule:'NEW' }, []);
    if (total.collectible <= 0) throw new ApiError(400, 'INVALID_COLLECTIBLE', 'El total a cobrar debe ser mayor que cero.', 'value');
    if (input.initialPayment && cents(input.initialPayment.amount) > cents(total.collectible)) throw conflict('El abono inicial supera el total a cobrar.');
    const row = (await tx.query<OrderRow>(`
      INSERT INTO orders (client_id,description,value,document_type,category,route,requires_installation,
        material,length,width,rete_fuente,rete_iva,ica,id,created_by,status,creation_key,creation_fingerprint,financial_rule)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'NEW') RETURNING *
    `, [...inputParams(normalized), randomUUID(), actor.id, input.products ? 'IN_PRODUCTION' : 'NEW', input.requestId, fingerprint])).rows[0];
    if (input.products) await createOrderProducts(tx, row.id, input.products);
    else {
      const productId = randomUUID();
      await tx.query(`INSERT INTO order_products (id,order_id,position,description,quantity,unit_value,is_legacy)
        VALUES ($1,$2,1,$3,1,$4,true)`, [productId,row.id,row.description,row.value]);
      if (row.material) await tx.query(`INSERT INTO order_product_materials
        (id,order_id,product_id,position,material,length,width)
        VALUES ($1,$2,$3,1,$4,$5,$6)`, [randomUUID(),row.id,productId,row.material,row.length,row.width]);
    }
    await event(tx, row, actor.id, 'create');
    if (input.initialPayment) {
      await tx.query('INSERT INTO payments (id,order_id,date,amount,method,recorded_by,request_key) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(),row.id,input.initialPayment.date,input.initialPayment.amount,input.initialPayment.method,actor.id,randomUUID()]);
      await event(tx,row,actor.id,'payment',row.status);
    }
    return { order: orderDto({ ...row, special_payment: client.special_payment }, await paymentsOf(tx,row.id), actor.role), replayed: false };
  });
}

export async function editOrder(db: Database, auth: AuthSession, id: string, input: z.infer<typeof editSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, admins);
    const row = await lockedOrder(tx, id);
    checkVersion(row, input.expectedVersion);
    if (row.closed_at || !['NEW','PENDING_ADMIN_REVIEW','IN_PRODUCTION'].includes(row.status)) throw conflict('La orden ya está en producción y sus datos están protegidos.');
    const existingComposite = (await tx.query<{ composite: boolean }>(
      'SELECT coalesce(bool_or(NOT is_legacy),false) AS composite FROM order_products WHERE order_id=$1', [id])).rows[0]?.composite;
    if (existingComposite && !input.products) throw new ApiError(400, 'PRODUCTS_REQUIRED', 'Incluye los productos de esta orden en la edición.', 'products');
    if (row.status === 'IN_PRODUCTION' && !input.products) throw conflict('La orden compuesta requiere productos para editarse.');
    if (input.initialPayment) throw new ApiError(400, 'INITIAL_PAYMENT_EDIT', 'Los abonos se registran en pagos, no en edición de OT.', 'initialPayment');
    const client = await checkClient(tx, input.clientId, input.documentType);
    const payments = await paymentsOf(tx, id);
    if (!client.special_payment && payments.length === 0) throw new ApiError(400, 'INITIAL_PAYMENT_REQUIRED', 'Registra primero un abono antes de asignar esta OT a un cliente no especial.', 'clientId');
    const normalized = normalizedInput(input, row);
    const money = financials({ value: String(normalized.value), document_type: normalized.documentType,
      rete_fuente: String(normalized.reteFuente), rete_iva: String(normalized.reteIva), ica: String(normalized.ica), financial_rule: row.financial_rule }, payments);
    if (money.collectible <= 0) throw new ApiError(400, 'INVALID_COLLECTIBLE', 'El total a cobrar debe ser mayor que cero.', 'value');
    if (money.balance < 0) throw conflict('El total cobrable no puede ser inferior a los abonos registrados.');
    const updated = (await tx.query<OrderRow>(`
      UPDATE orders SET client_id=$1,description=$2,value=$3,document_type=$4,category=$5,route=$6,requires_installation=$7,
        material=$8,length=$9,width=$10,rete_fuente=$11,rete_iva=$12,ica=$13,
        status=$15,certificate_rete_fuente=CASE WHEN rete_fuente=$11 THEN certificate_rete_fuente ELSE false END,
        certificate_rete_iva=CASE WHEN rete_iva=$12 THEN certificate_rete_iva ELSE false END,
        certificate_ica=CASE WHEN ica=$13 THEN certificate_ica ELSE false END,
        updated_at=clock_timestamp(),version=version+1
      WHERE id=$14 RETURNING *`, [...inputParams(normalized), id, input.products ? 'IN_PRODUCTION' : row.status])).rows[0];
    if (input.products) await replaceOrderProducts(tx, id, input.products);
    else {
      const legacy = (await tx.query<{ id: string }>('SELECT id FROM order_products WHERE order_id=$1 AND is_legacy=true', [id])).rows[0];
      if (legacy) {
        await tx.query(`UPDATE order_products SET description=$2,unit_value=$3,updated_at=clock_timestamp()
          WHERE id=$1`, [legacy.id, normalized.description, normalized.value]);
        await tx.query('DELETE FROM order_product_materials WHERE product_id=$1', [legacy.id]);
        if (normalized.printing) await tx.query(`INSERT INTO order_product_materials
          (id,order_id,product_id,position,material,length,width) VALUES ($1,$2,$3,1,$4,$5,$6)`,
        [randomUUID(),id,legacy.id,normalized.printing.material,normalized.printing.length,normalized.printing.width]);
      }
    }
    await event(tx, updated, actor.id, 'edit', row.status);
    return orderDto({ ...updated, special_payment: client.special_payment }, payments, actor.role);
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
      if (cents(previous.amount) !== cents(input.amount) || previousDate !== input.date || previous.method !== input.method || previous.recorded_by !== actor.id) throw conflict('Este identificador de abono ya se utilizó con otros datos.');
      return { order: orderDto(row, payments, actor.role), replayed: true };
    }
    if (input.date < dateOnly(row.created_at) || input.date > dateOnly()) throw new ApiError(400, 'PAYMENT_DATE', 'La fecha del abono debe estar entre la creación de la OT y hoy.', 'date');
    if (cents(input.amount) > cents(financials(row, payments).balance)) throw conflict('El abono supera el saldo actual de la orden.');
    await tx.query('INSERT INTO payments (id,order_id,date,amount,method,recorded_by,request_key) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), id, input.date, input.amount, input.method, actor.id, input.requestId]);
    const updated = (await tx.query<OrderRow>('UPDATE orders SET updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *', [id])).rows[0];
    await event(tx, updated, actor.id, 'payment', row.status);
    return { order: orderDto({ ...updated, special_payment: row.special_payment }, await paymentsOf(tx, id), actor.role), replayed: false };
  });
}

export async function allocateBulkPayment(db: Database, auth: AuthSession, input: z.infer<typeof bulkPaymentSchema>) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx,auth,admins);
    const fingerprint = createHash('sha256').update(JSON.stringify({
      clientId:input.clientId, ids:[...input.selectedOrderIds].sort(),
      date:input.date, amount:input.amount, method:input.method,
    })).digest('hex');
    const previous = (await tx.query<{id:string;fingerprint:string;amount:string}>(
      'SELECT id,fingerprint,amount FROM bulk_payment_batches WHERE created_by=$1 AND request_key=$2',
      [actor.id,input.requestId])).rows[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw conflict('Este identificador de pago grupal ya se utilizó con otros datos.');
      const saved = (await tx.query<{order_id:string;amount:string}>(
        'SELECT order_id,amount FROM payments WHERE bulk_batch_id=$1 ORDER BY amount,order_id',[previous.id])).rows;
      return { batchId:previous.id, clientId:input.clientId, amount:Number(previous.amount),
        allocations:saved.map(item => ({orderId:item.order_id,amount:Number(item.amount)})), remaining:0, replayed:true };
    }
    if (input.date > dateOnly()) throw new ApiError(400,'PAYMENT_DATE','La fecha del pago no puede ser futura.','date');
    const rows = (await tx.query<OrderRow>(`
      SELECT o.*,c.special_payment FROM orders o JOIN clients c ON c.id=o.client_id
      WHERE o.id=ANY($1::uuid[]) AND o.client_id=$2 ORDER BY o.id FOR UPDATE OF o
    `,[input.selectedOrderIds,input.clientId])).rows;
    if (rows.length !== input.selectedOrderIds.length) throw new ApiError(400,'INVALID_ORDER_SELECTION','Selecciona solo órdenes del cliente indicado.','selectedOrderIds');
    const withBalance = [] as {row:OrderRow;balanceCents:number}[];
    for (const row of rows) {
      if (input.date < dateOnly(row.created_at)) throw new ApiError(400,'PAYMENT_DATE','La fecha es anterior a la creación de una OT seleccionada.','date');
      const balanceCents = cents(financials(row,await paymentsOf(tx,row.id)).balance);
      if (balanceCents <= 0) throw conflict(`La OT #${row.number} ya está pagada.`);
      withBalance.push({row,balanceCents});
    }
    const due = withBalance.reduce((sum,item) => sum+item.balanceCents,0);
    let remaining = cents(input.amount);
    if (remaining > due) throw conflict('El pago supera el saldo de las órdenes seleccionadas.');
    const batchId = randomUUID();
    await tx.query(`INSERT INTO bulk_payment_batches (id,client_id,created_by,request_key,fingerprint,date,amount,method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[batchId,input.clientId,actor.id,input.requestId,fingerprint,input.date,input.amount,input.method]);
    withBalance.sort((a,b) => a.balanceCents-b.balanceCents || a.row.number-b.row.number || a.row.id.localeCompare(b.row.id));
    const allocations: {orderId:string;amount:number}[] = [];
    for (const {row,balanceCents} of withBalance) {
      if (remaining <= 0) break;
      const allocated = Math.min(remaining,balanceCents);
      await tx.query(`INSERT INTO payments (id,order_id,date,amount,method,recorded_by,request_key,bulk_batch_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),row.id,input.date,allocated/100,input.method,actor.id,randomUUID(),batchId]);
      const updated = (await tx.query<OrderRow>('UPDATE orders SET updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING *',[row.id])).rows[0];
      await event(tx,updated,actor.id,'payment',row.status);
      allocations.push({orderId:row.id,amount:allocated/100});
      remaining -= allocated;
    }
    return {batchId,clientId:input.clientId,amount:input.amount,allocations,remaining:remaining/100,replayed:false};
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
        next.status = row.route === 'WORKSHOP_ONLY' ? 'IN_WORKSHOP' : row.route === 'EXTERNO' ? 'IN_EXTERNAL' : 'IN_PRINTING'; break;
      case 'finishPrinting':
        if (actor.role !== 'IMPRESION') throw new ApiError(403, 'FORBIDDEN', 'Solo Impresión puede finalizar esta fase.');
        requireStatus('IN_PRINTING');
        next.printing_completed_at = now;
        next.status = row.route === 'PRINT_WORKSHOP' ? 'IN_WORKSHOP' : row.requires_installation ? 'PENDING_INSTALLATION' : 'COMPLETED'; break;
      case 'finishExternal':
        requireRole(); requireStatus('IN_EXTERNAL');
        next.status = row.requires_installation ? 'PENDING_INSTALLATION' : 'COMPLETED'; break;
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
    if (input.action === 'finishPrinting') await tx.query(`UPDATE order_product_materials
      SET consumed_at=$2 WHERE order_id=$1 AND consumed_at IS NULL`, [id, next.printing_completed_at]);
    await event(tx, updated, actor.id, input.action, row.status);
    return orderDto({ ...updated, special_payment: row.special_payment }, isAdmin(actor.role) ? await paymentsOf(tx, id) : [], actor.role);
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
    const collectible = "(o.value + CASE WHEN o.document_type='FACT' THEN round(o.value*0.19,2)+CASE WHEN o.financial_rule='NEW' THEN -(o.rete_fuente+o.rete_iva+o.ica) ELSE o.rete_fuente+o.rete_iva+o.ica END ELSE 0 END)";
    if (input.paymentStatus === 'PENDING') conditions.push(`c.special_payment=false AND ${paid}=0 AND ${collectible}>0`);
    if (input.paymentStatus === 'PARTIAL') conditions.push(`c.special_payment=false AND ${paid}>0 AND ${paid}<${collectible}`);
    if (input.paymentStatus === 'PAID') conditions.push(`${paid}>=${collectible}`);
    if (input.paymentStatus === 'OUTSTANDING') conditions.push(`${paid}<${collectible}`);
    if (input.paymentStatus === 'SPECIAL') conditions.push(`c.special_payment=true AND ${paid}<${collectible}`);
    const where = conditions.map(s => `(${s})`).join(' AND ');
    const total = Number((await tx.query<{ total: string }>(`SELECT count(*) AS total FROM orders o JOIN clients c ON c.id=o.client_id WHERE ${where}`, params)).rows[0].total);
    const rows = (await tx.query<OrderRow>(`SELECT o.*,c.special_payment FROM orders o JOIN clients c ON c.id=o.client_id WHERE ${where} ORDER BY o.number DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, input.pageSize, (input.page-1)*input.pageSize])).rows;
    const ids = rows.map(row => row.id);
    const payments = isAdmin(auth.user.role) && ids.length ? (await tx.query<PaymentRow>('SELECT * FROM payments WHERE order_id=ANY($1::uuid[]) ORDER BY date,recorded_at,id', [ids])).rows : [];
    const clientRows = ids.length ? (await tx.query<{ id:string; name:string; created_at:Date|string }>('SELECT DISTINCT c.id,c.name,c.created_at FROM clients c JOIN orders o ON o.client_id=c.id WHERE o.id=ANY($1::uuid[])', [ids])).rows : [];
    return { items: rows.map(row => orderDto(row, payments.filter(p => p.order_id===row.id), auth.user.role,
      row.created_by === auth.user.id)), page: input.page, pageSize: input.pageSize, total,
      clients: clientRows.map(c => ({ id:c.id,name:c.name,identification:'',phone:'',createdAt:new Date(c.created_at).toISOString() })) };
  });
}

export async function getOrder(db: Database, auth: AuthSession, id: string) {
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = (await tx.query<OrderRow>(`SELECT o.*,c.special_payment,
      EXISTS (SELECT 1 FROM order_activities a WHERE a.order_id=o.id AND
        (($2='DISENO' AND a.area='DESIGN' AND (a.assigned_user_id IS NULL OR a.assigned_user_id=$3))
          OR ($2='IMPRESION' AND a.area='PRINTING')
          OR ($2='TALLER' AND a.area='WORKSHOP'))) AS has_visible_activity
      FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.id=$1`,
      [id, auth.user.role, auth.user.id])).rows[0];
    if (!row || !canRead(auth.user, row)) throw missing();
    const client = (await tx.query<{ id: string; name: string }>('SELECT id,name FROM clients WHERE id=$1', [row.client_id])).rows[0];
    const order = orderDto(row, isAdmin(auth.user.role) ? await paymentsOf(tx,id) : [], auth.user.role,
      row.created_by === auth.user.id);
    return { order, client };
  });
}
