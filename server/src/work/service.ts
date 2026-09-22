import { randomUUID } from 'node:crypto';
import type { AuthSession, Role } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { ApiError } from '../errors.js';
import { requireCurrentActor } from '../security/actor.js';
import { activityListSchema, designDetailsSchema, laserMinutesSchema, productsSchema, type ParsedProduct, type ProductInput } from './schemas.js';
import type { z } from 'zod';

type Area = 'DESIGN' | 'PRINTING' | 'WORKSHOP' | 'EXTERNAL';
type Status = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
type PrintingType = 'PRINT' | 'LASER';
export const LASER_RATE = 1000;
interface ActivityRow {
  id: string; order_id: string; product_id: string; position: number;
  area: Area; status: Status; assigned_user_id: string | null;
  printing_type: PrintingType | null; laser_minutes: number | null;
  started_at: Date | string | null; completed_at: Date | string | null;
  created_at: Date | string; updated_at: Date | string;
}
interface ListedActivityRow extends ActivityRow {
  order_number: number; product_position: number; product_description: string;
  ready: boolean;
}
interface MaterialRow {
  id: string; product_id: string; position: number; material: string;
  length: string; width: string; consumed_at: Date | string | null;
}
interface ProductRow {
  id: string; order_id: string; position: number; description: string;
  quantity: string; unit_value: string; line_total: string;
}

const date = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
const missing = () => new ApiError(404, 'ACTIVITY_NOT_FOUND', 'No encontramos esta actividad.');
const conflict = (message: string) => new ApiError(409, 'ACTIVITY_CONFLICT', message);
const admin = (role: Role) => role === 'ADMINMASTER' || role === 'ADMIN_GENERAL';

function lineCents(quantity: number, unitValue: number): number {
  const units = Math.round(quantity);
  const unitCents = Math.round(unitValue * 100);
  const raw = units * unitCents;
  if (!Number.isSafeInteger(raw)) throw new ApiError(400, 'PRODUCT_VALUE_RANGE', 'El importe del producto excede el límite permitido.');
  return raw;
}

function normalizeProducts(
  products: ProductInput[], creator: { id: string; role: Role },
): ParsedProduct[] {
  const parsed = productsSchema.parse(products);
  const normalized = parsed.map(product => ({
    ...product,
    activities: creator.role === 'DISENO'
      ? [
          { area: 'DESIGN' as const, assignedUserId: creator.id },
          ...product.activities.filter(activity => activity.area !== 'DESIGN'),
        ]
      : product.activities,
  }));
  for (const product of normalized) {
    const printing = product.activities.find(activity => activity.area === 'PRINTING');
    const hasDesign = product.activities.some(activity => activity.area === 'DESIGN');
    if (printing && (printing.printingType ?? 'PRINT') === 'PRINT' && !product.materials.length && !hasDesign) {
      throw new ApiError(400, 'PRINT_MATERIAL_REQUIRED',
        'La impresión requiere un material o una actividad previa de Diseño.', 'products.materials');
    }
  }
  return normalized;
}

/** Call inside the order creation transaction, after inserting its parent row. */
export async function createOrderProducts(
  tx: SqlConnection, orderId: string, products: ProductInput[],
  creator?: { id: string; role: Role },
): Promise<void> {
  const parent = (await tx.query<{ value: string; created_by: string; creator_role: Role }>(`
    SELECT o.value,o.created_by,u.role AS creator_role FROM orders o
    JOIN users u ON u.id=o.created_by WHERE o.id=$1 FOR UPDATE OF o
  `, [orderId])).rows[0];
  if (!parent) throw new ApiError(404, 'ORDER_NOT_FOUND', 'La orden no existe.');
  const parsed = normalizeProducts(products, creator ?? { id: parent.created_by, role: parent.creator_role });
  const existing = await tx.query('SELECT id FROM order_products WHERE order_id = $1 LIMIT 1', [orderId]);
  if (existing.rows.length) throw conflict('La orden ya tiene productos registrados.');
  const expected = Math.round(Number(parent.value) * 100);
  let subtotal = 0;
  for (const product of parsed) {
    subtotal += lineCents(product.quantity, product.unitValue);
    if (!Number.isSafeInteger(subtotal) || subtotal > expected) {
      throw new ApiError(400, 'PRODUCT_SUBTOTAL', 'La suma de productos debe coincidir con el valor base de la OT.', 'products');
    }
  }
  if (subtotal !== expected) throw new ApiError(400, 'PRODUCT_SUBTOTAL', 'La suma de productos debe coincidir con el valor base de la OT.', 'products');

  const assigned = [...new Set(parsed.flatMap(product => product.activities
    .map(activity => activity.assignedUserId).filter((id): id is string => !!id)))];
  for (const id of assigned) {
    const designer = await tx.query('SELECT id FROM users WHERE id = $1 AND role = $2 AND is_active = true FOR SHARE', [id, 'DISENO']);
    if (!designer.rows.length) throw new ApiError(400, 'DESIGNER_UNAVAILABLE', 'Selecciona un diseñador activo.', 'assignedUserId');
  }

  for (const [index, product] of parsed.entries()) {
    const productId = randomUUID();
    await tx.query(`
      INSERT INTO order_products (id, order_id, position, description, quantity, unit_value)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [productId, orderId, index + 1, product.description, product.quantity, product.unitValue]);
    for (const [position, material] of product.materials.entries()) {
      await tx.query(`
        INSERT INTO order_product_materials (id,order_id,product_id,position,material,length,width)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [randomUUID(), orderId, productId, position + 1, material.material, material.length, material.width]);
    }
    for (const [position, activity] of product.activities.entries()) {
      await tx.query(`
        INSERT INTO order_activities (id,order_id,product_id,position,area,assigned_user_id,printing_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [randomUUID(), orderId, productId, position + 1, activity.area,
        activity.assignedUserId ?? null, activity.area === 'PRINTING' ? activity.printingType ?? 'PRINT' : null]);
    }
  }
}

/** Replaces a draft's internal work under the parent OT lock held by the caller. */
export async function replaceOrderProducts(tx: SqlConnection, orderId: string, products: ProductInput[]): Promise<void> {
  productsSchema.parse(products);
  const parent = await tx.query<{ status: string }>('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
  if (!parent.rows.length) throw new ApiError(404, 'ORDER_NOT_FOUND', 'La orden no existe.');
  if (parent.rows[0].status !== 'IN_PRODUCTION') throw conflict('Solo se pueden cambiar los productos de una OT compuesta en produccion pendiente.');
  const started = await tx.query<{ exists: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM order_activities WHERE order_id=$1 AND status<>'PENDING')
      OR EXISTS (SELECT 1 FROM order_product_materials WHERE order_id=$1 AND consumed_at IS NOT NULL) AS exists
  `, [orderId]);
  if (started.rows[0].exists) throw conflict('No se pueden cambiar los productos cuando una actividad ya comenzo o se consumio material.');
  await tx.query('DELETE FROM order_activities WHERE order_id=$1', [orderId]);
  await tx.query('DELETE FROM order_product_materials WHERE order_id=$1', [orderId]);
  await tx.query('DELETE FROM order_products WHERE order_id=$1', [orderId]);
  await createOrderProducts(tx, orderId, products);
}

function visibleActivity(role: Role, userId: string, row: ActivityRow): boolean {
  if (admin(role)) return true;
  if (role === 'DISENO') return row.area === 'DESIGN' && (!row.assigned_user_id || row.assigned_user_id === userId);
  if (role === 'IMPRESION') return row.area === 'PRINTING';
  return role === 'TALLER' && row.area === 'WORKSHOP';
}

async function activityMaterials(tx: SqlConnection, productIds: string[]): Promise<Map<string, MaterialRow[]>> {
  const result = productIds.length ? await tx.query<MaterialRow>(`
    SELECT id,product_id,position,material,length,width,consumed_at
    FROM order_product_materials WHERE product_id = ANY($1::uuid[]) ORDER BY product_id,position
  `, [productIds]) : { rows: [] as MaterialRow[] };
  const map = new Map<string, MaterialRow[]>();
  for (const item of result.rows) map.set(item.product_id, [...(map.get(item.product_id) ?? []), item]);
  return map;
}

function activityDto(row: ListedActivityRow, materials: MaterialRow[]) {
  return {
    id: row.id, orderId: row.order_id, orderNumber: Number(row.order_number),
    productId: row.product_id, productPosition: Number(row.product_position),
    productDescription: row.product_description,
    position: Number(row.position), area: row.area, status: row.status,
    assignedUserId: row.assigned_user_id, ready: row.ready,
    startedAt: date(row.started_at), completedAt: date(row.completed_at),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at),
    ...(row.area === 'PRINTING' ? { printingType: row.printing_type } : {}),
    ...(row.printing_type === 'LASER' ? {
      laserMinutes: row.laser_minutes === null ? null : Number(row.laser_minutes),
      laserRate: LASER_RATE,
      laserCharge: row.laser_minutes === null ? 0 : Number(row.laser_minutes) * LASER_RATE,
    } : {}),
    materials: materials.map(material => ({ id: material.id, material: material.material,
      length: Number(material.length), width: Number(material.width),
      areaM2: Math.round(Number(material.length) * Number(material.width) * 1000) / 1000,
      consumedAt: date(material.consumed_at) })),
  };
}

async function listedById(tx: SqlConnection, id: string): Promise<ListedActivityRow> {
  const row = (await tx.query<ListedActivityRow>(`
    SELECT a.*,o.number AS order_number,p.position AS product_position,
      p.description AS product_description,
      NOT EXISTS (SELECT 1 FROM order_activities prior WHERE prior.product_id=a.product_id
        AND prior.position<a.position AND prior.status<>'COMPLETED') AS ready
    FROM order_activities a JOIN order_products p ON p.id=a.product_id
    JOIN orders o ON o.id=a.order_id WHERE a.id=$1
  `, [id])).rows[0];
  if (!row) throw missing();
  return row;
}

export async function listActivities(db: Database, auth: AuthSession, query: z.input<typeof activityListSchema>) {
  const input = activityListSchema.parse(query);
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (input.orderId) { params.push(input.orderId); conditions.push(`a.order_id=$${params.length}`); }
    if (input.area) { params.push(input.area); conditions.push(`a.area=$${params.length}`); }
    if (auth.user.role === 'DISENO') {
      params.push(auth.user.id);
      conditions.push(`a.area='DESIGN' AND (a.assigned_user_id IS NULL OR a.assigned_user_id=$${params.length})`);
    } else if (auth.user.role === 'IMPRESION') conditions.push("a.area='PRINTING'");
    else if (auth.user.role === 'TALLER') conditions.push("a.area='WORKSHOP'");
    const where = conditions.length ? `WHERE ${conditions.map(condition => `(${condition})`).join(' AND ')}` : '';
    const total = Number((await tx.query<{ count: string }>(`SELECT count(*) AS count FROM order_activities a ${where}`, params)).rows[0].count);
    const rows = (await tx.query<ListedActivityRow>(`
      SELECT a.*,o.number AS order_number,p.position AS product_position,
        p.description AS product_description,
        NOT EXISTS (SELECT 1 FROM order_activities prior WHERE prior.product_id=a.product_id
          AND prior.position<a.position AND prior.status<>'COMPLETED') AS ready
      FROM order_activities a JOIN order_products p ON p.id=a.product_id
      JOIN orders o ON o.id=a.order_id ${where}
      ORDER BY CASE a.status WHEN 'PENDING' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
        o.number DESC,p.position,a.position
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, input.pageSize, (input.page - 1) * input.pageSize])).rows;
    const materials = await activityMaterials(tx, [...new Set(rows.map(row => row.product_id))]);
    return { items: rows.map(row => activityDto(row, materials.get(row.product_id) ?? [])),
      page: input.page, pageSize: input.pageSize, total };
  });
}

/** A product-oriented work view. Production never receives commercial prices. */
export async function workOrder(db: Database, auth: AuthSession, orderId: string) {
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const parent = (await tx.query<{ id: string; number: number; created_by: string; status: string; route: string }>(
      'SELECT id,number,created_by,status,route FROM orders WHERE id=$1', [orderId],
    )).rows[0];
    if (!parent) throw new ApiError(404, 'ORDER_NOT_FOUND', 'No encontramos esta orden.');
    const products = (await tx.query<ProductRow>(
      'SELECT id,order_id,position,description,quantity,unit_value,line_total FROM order_products WHERE order_id=$1 ORDER BY position',
      [orderId],
    )).rows;
    const activities = (await tx.query<ListedActivityRow>(`
      SELECT a.*,o.number AS order_number,p.position AS product_position,
        p.description AS product_description,
        NOT EXISTS (SELECT 1 FROM order_activities prior WHERE prior.product_id=a.product_id
          AND prior.position<a.position AND prior.status<>'COMPLETED') AS ready
      FROM order_activities a JOIN order_products p ON p.id=a.product_id
      JOIN orders o ON o.id=a.order_id WHERE a.order_id=$1
      ORDER BY p.position,a.position
    `, [orderId])).rows;
    const commercial = admin(auth.user.role) || auth.user.role === 'DISENO' && parent.created_by === auth.user.id;
    const visible = products.filter(product => commercial || activities.some(activity =>
      activity.product_id === product.id && visibleActivity(auth.user.role, auth.user.id, activity)));
    if (!commercial && !visible.length) throw new ApiError(404, 'ORDER_NOT_FOUND', 'No encontramos esta orden o no esta disponible para tu perfil.');
    const materials = await activityMaterials(tx, visible.map(product => product.id));
    return {
      orderId: parent.id, orderNumber: Number(parent.number), status: parent.status, route: parent.route,
      products: visible.map(product => ({
        id: product.id, position: Number(product.position), description: product.description,
        quantity: Number(product.quantity),
        ...(commercial ? { unitValue: Number(product.unit_value), lineTotal: Number(product.line_total) } : {}),
        materials: (materials.get(product.id) ?? []).map(material => ({
          id: material.id, position: Number(material.position), material: material.material,
          length: Number(material.length), width: Number(material.width),
          areaM2: Math.round(Number(material.length) * Number(material.width) * 1000) / 1000,
          consumedAt: date(material.consumed_at),
        })),
        activities: activities.filter(activity => activity.product_id === product.id).map(activity => ({
          id: activity.id, position: Number(activity.position), area: activity.area,
          status: activity.status, assignedUserId: activity.assigned_user_id,
          ready: activity.ready, startedAt: date(activity.started_at), completedAt: date(activity.completed_at),
          ...(activity.area === 'PRINTING' ? { printingType: activity.printing_type } : {}),
          ...(activity.printing_type === 'LASER' ? {
            laserMinutes: activity.laser_minutes === null ? null : Number(activity.laser_minutes),
            laserRate: LASER_RATE,
            laserCharge: activity.laser_minutes === null ? 0 : Number(activity.laser_minutes) * LASER_RATE,
          } : {}),
        })),
      })),
    };
  });
}

export async function saveLaserMinutes(
  db: Database, auth: AuthSession, id: string, input: z.input<typeof laserMinutesSchema>,
) {
  const parsed = laserMinutesSchema.parse(input);
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, ['ADMINMASTER', 'ADMIN_GENERAL', 'IMPRESION']);
    const target = (await tx.query<{ order_id: string }>(
      'SELECT order_id FROM order_activities WHERE id=$1', [id],
    )).rows[0];
    if (!target) throw missing();
    const parent = (await tx.query<{ status: string }>(
      'SELECT status FROM orders WHERE id=$1 FOR UPDATE', [target.order_id],
    )).rows[0];
    const current = (await tx.query<ActivityRow>(
      'SELECT * FROM order_activities WHERE id=$1 FOR UPDATE', [id],
    )).rows[0];
    if (!parent || !current) throw missing();
    if (current.area !== 'PRINTING' || current.printing_type !== 'LASER') {
      throw conflict('Los minutos solo corresponden a una actividad de Corte Láser.');
    }
    if (current.status === 'COMPLETED') throw conflict('La actividad de Corte Láser ya terminó.');
    if (parent.status !== 'IN_PRODUCTION') throw conflict('La OT no está en producción.');
    await tx.query('UPDATE order_activities SET laser_minutes=$2,updated_at=clock_timestamp() WHERE id=$1',
      [id, parsed.minutes]);
    const updated = await listedById(tx, id);
    return activityDto(updated, []);
  });
}

export async function editDesignDetails(
  db: Database, auth: AuthSession, id: string, input: z.input<typeof designDetailsSchema>,
) {
  const parsed = designDetailsSchema.parse(input);
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, ['DISENO']);
    const target = (await tx.query<{ order_id: string }>(
      'SELECT order_id FROM order_activities WHERE id=$1', [id],
    )).rows[0];
    if (!target) throw missing();
    const parent = (await tx.query<{ status: string }>(
      'SELECT status FROM orders WHERE id=$1 FOR UPDATE', [target.order_id],
    )).rows[0];
    const current = (await tx.query<ActivityRow>(
      'SELECT * FROM order_activities WHERE id=$1 FOR UPDATE', [id],
    )).rows[0];
    if (!parent || !current || current.area !== 'DESIGN' || current.assigned_user_id !== actor.id) throw missing();
    if (current.status === 'COMPLETED') throw conflict('Diseño ya completó esta actividad.');
    if (parent.status !== 'IN_PRODUCTION') throw conflict('La OT no está en producción.');

    if (parsed.materials !== undefined) {
      const printing = (await tx.query<{ printing_type: PrintingType | null }>(`
        SELECT printing_type FROM order_activities
        WHERE product_id=$1 AND area='PRINTING' FOR UPDATE
      `, [current.product_id])).rows[0];
      if (!printing || printing.printing_type !== 'PRINT') {
        throw new ApiError(400, 'PRINT_MATERIAL_NOT_APPLICABLE',
          'Los materiales solo corresponden a una actividad de Impresión.', 'materials');
      }
      await tx.query('DELETE FROM order_product_materials WHERE product_id=$1', [current.product_id]);
      for (const [position, material] of parsed.materials.entries()) {
        await tx.query(`
          INSERT INTO order_product_materials (id,order_id,product_id,position,material,length,width)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
        `, [randomUUID(), current.order_id, current.product_id, position + 1,
          material.material, material.length, material.width]);
      }
    }
    if (parsed.description !== undefined) {
      await tx.query('UPDATE order_products SET description=$2,updated_at=clock_timestamp() WHERE id=$1',
        [current.product_id, parsed.description]);
    }
    await tx.query('UPDATE order_activities SET updated_at=clock_timestamp() WHERE id=$1', [current.id]);
    await tx.query(`
      UPDATE orders SET description=(SELECT string_agg(
          p.position::text || '. ' || p.description, E'\n' ORDER BY p.position
        ) FROM order_products p WHERE p.order_id=orders.id),
        version=version+1,updated_at=clock_timestamp() WHERE id=$1
    `, [current.order_id]);
    await tx.query(`
      INSERT INTO order_events (id,order_id,actor_id,action,from_status,to_status)
      VALUES ($1,$2,$3,'designDetails',$4,$4)
    `, [randomUUID(), current.order_id, actor.id, parent.status]);
    const updated = await listedById(tx, id);
    const materials = await activityMaterials(tx, [updated.product_id]);
    return activityDto(updated, materials.get(updated.product_id) ?? []);
  });
}

export async function designerLoad(db: Database, auth: AuthSession) {
  if (!admin(auth.user.role)) throw new ApiError(403, 'FORBIDDEN', 'Solo Administración consulta la carga de Diseño.');
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = await tx.query<{ id: string; name: string; pending: string; in_progress: string }>(`
      SELECT u.id,u.name,
        count(a.id) FILTER (WHERE a.status='PENDING') AS pending,
        count(a.id) FILTER (WHERE a.status='IN_PROGRESS') AS in_progress
      FROM users u LEFT JOIN order_activities a ON a.assigned_user_id=u.id AND a.area='DESIGN'
        AND a.status IN ('PENDING','IN_PROGRESS')
      WHERE u.role='DISENO' AND u.is_active=true
      GROUP BY u.id,u.name ORDER BY lower(u.name),u.id
    `);
    const unassigned = Number((await tx.query<{ count: string }>(`
      SELECT count(*) AS count FROM order_activities
      WHERE area='DESIGN' AND status='PENDING' AND assigned_user_id IS NULL
    `)).rows[0].count);
    return { items: rows.rows.map(row => ({ id: row.id, name: row.name,
      pending: Number(row.pending), inProgress: Number(row.in_progress),
      total: Number(row.pending) + Number(row.in_progress) })), unassigned };
  });
}

export async function changeActivity(
  db: Database, auth: AuthSession, id: string,
  action: 'claim' | 'assign' | 'start' | 'complete', assignedUserId?: string,
) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, ['ADMINMASTER','ADMIN_GENERAL','DISENO','IMPRESION','TALLER']);
    // Lock parent before activity, consistently with order edits/replacements.
    const target = (await tx.query<{ order_id: string }>('SELECT order_id FROM order_activities WHERE id=$1', [id])).rows[0];
    if (!target) throw missing();
    const parent = (await tx.query<{ status: string; requires_installation: boolean }>(
      'SELECT status,requires_installation FROM orders WHERE id=$1 FOR UPDATE', [target.order_id],
    )).rows[0];
    if (!parent) throw missing();
    const current = (await tx.query<ActivityRow>('SELECT * FROM order_activities WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!current || !visibleActivity(actor.role, actor.id, current) && action !== 'assign') throw missing();
    if (action === 'claim') {
      if (actor.role !== 'DISENO' || current.area !== 'DESIGN') throw new ApiError(403, 'FORBIDDEN', 'Solo Diseño puede tomar tareas de Diseño.');
      if (current.status === 'COMPLETED') throw conflict('La actividad ya terminó.');
      if (current.assigned_user_id && current.assigned_user_id !== actor.id) throw conflict('Otro diseñador ya tiene esta tarea.');
      if (!current.assigned_user_id) await tx.query('UPDATE order_activities SET assigned_user_id=$2,updated_at=now() WHERE id=$1', [id, actor.id]);
    } else if (action === 'assign') {
      if (!admin(actor.role) || current.area !== 'DESIGN') throw new ApiError(403, 'FORBIDDEN', 'Solo Administración asigna tareas de Diseño.');
      if (current.status !== 'PENDING') throw conflict('Solo se pueden asignar tareas pendientes.');
      const designer = await tx.query('SELECT id FROM users WHERE id=$1 AND role=$2 AND is_active=true FOR SHARE', [assignedUserId, 'DISENO']);
      if (!designer.rows.length) throw new ApiError(400, 'DESIGNER_UNAVAILABLE', 'Selecciona un diseñador activo.', 'assignedUserId');
      if (current.assigned_user_id !== assignedUserId) {
        await tx.query('UPDATE order_activities SET assigned_user_id=$2,updated_at=now() WHERE id=$1', [id, assignedUserId]);
      }
    } else {
      const roleForArea: Record<Area, Role[]> = {
        DESIGN: ['DISENO'], PRINTING: ['IMPRESION'], WORKSHOP: ['TALLER'], EXTERNAL: ['ADMINMASTER','ADMIN_GENERAL'],
      };
      const actorIsAdmin = admin(actor.role);
      if (!actorIsAdmin && !roleForArea[current.area].includes(actor.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Tu perfil no opera esta actividad.');
      }
      if (!actorIsAdmin && current.area === 'DESIGN' && current.assigned_user_id !== actor.id) {
        throw conflict('Debes tomar o recibir esta tarea antes de trabajarla.');
      }
      if (current.status !== 'COMPLETED' && parent.status !== 'IN_PRODUCTION') {
        throw conflict('La OT no esta en produccion.');
      }
      if (action === 'start') {
        if (current.status === 'COMPLETED') throw conflict('La actividad ya terminó.');
        if (current.status === 'PENDING') {
          const blockers = await tx.query<{ count: string }>(`
            SELECT count(*) AS count FROM order_activities
            WHERE product_id=$1 AND position<$2 AND status<>'COMPLETED'
          `, [current.product_id, current.position]);
          if (Number(blockers.rows[0].count)) throw conflict('Finaliza las actividades previas del producto antes de iniciar esta tarea.');
          await tx.query("UPDATE order_activities SET status='IN_PROGRESS',started_at=now(),updated_at=now() WHERE id=$1", [id]);
        }
      } else {
        if (current.status === 'PENDING') throw conflict('Primero inicia la actividad.');
        if (current.status === 'IN_PROGRESS') {
          if (current.printing_type === 'LASER' && current.laser_minutes === null) {
            throw conflict('Indica los minutos consumidos antes de finalizar Corte Láser.');
          }
          if (current.area === 'DESIGN') {
            const normalPrinting = (await tx.query<{ exists: boolean }>(`
              SELECT EXISTS (SELECT 1 FROM order_activities
                WHERE product_id=$1 AND area='PRINTING' AND printing_type='PRINT') AS exists
            `, [current.product_id])).rows[0].exists;
            if (normalPrinting) {
              const materialCount = Number((await tx.query<{ count: string }>(`
                SELECT count(*) AS count FROM order_product_materials WHERE product_id=$1
              `, [current.product_id])).rows[0].count);
              if (!materialCount) throw conflict('Agrega al menos un material antes de completar Diseño.');
            }
          }
          const stamp = (await tx.query<{ at: Date | string }>('SELECT now() AS at')).rows[0].at;
          await tx.query(`
            UPDATE order_activities SET status='COMPLETED',completed_at=$2,updated_at=$2 WHERE id=$1
          `, [id, stamp]);
          if (current.area === 'PRINTING') await tx.query(`
            UPDATE order_product_materials SET consumed_at=$2 WHERE product_id=$1 AND consumed_at IS NULL
          `, [current.product_id, stamp]);
          const pending = await tx.query<{ count: string }>(`
            SELECT count(*) AS count FROM order_activities WHERE order_id=$1 AND status<>'COMPLETED'
          `, [current.order_id]);
          let laserValue: number | null = null;
          if (current.printing_type === 'LASER') {
            const total = (await tx.query<{ value: string }>(`
              SELECT coalesce((SELECT sum(line_total) FROM order_products WHERE order_id=$1),0)
                + coalesce((SELECT sum(laser_minutes::numeric * $2) FROM order_activities
                  WHERE order_id=$1 AND printing_type='LASER' AND status='COMPLETED'),0) AS value
            `, [current.order_id, LASER_RATE])).rows[0].value;
            laserValue = Number(total);
            if (!Number.isFinite(laserValue) || laserValue > 999999999999.99) {
              throw conflict('El total de la OT supera el límite permitido.');
            }
          }
          if (Number(pending.rows[0].count) === 0) {
            const next = parent.requires_installation ? 'PENDING_INSTALLATION' : 'COMPLETED';
            await tx.query(`
              UPDATE orders SET status=$2,version=version+1,updated_at=$3,
                ready_for_installation_at=CASE WHEN $4 THEN $3 ELSE ready_for_installation_at END,
                value=coalesce($5,value)
              WHERE id=$1
            `, [current.order_id, next, stamp, parent.requires_installation, laserValue]);
            await tx.query(`
              INSERT INTO order_events (id,order_id,actor_id,action,from_status,to_status)
              VALUES ($1,$2,$3,$4,$5,$6)
            `, [randomUUID(), current.order_id, actor.id, 'finishProduction', parent.status, next]);
          } else if (laserValue !== null) {
            await tx.query(`
              UPDATE orders SET value=$2,version=version+1,updated_at=$3 WHERE id=$1
            `, [current.order_id, laserValue, stamp]);
          }
        }
      }
    }
    const updated = await listedById(tx, id);
    const materials = await activityMaterials(tx, [updated.product_id]);
    return activityDto(updated, materials.get(updated.product_id) ?? []);
  });
}
