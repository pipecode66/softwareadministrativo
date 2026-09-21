import { randomUUID } from 'node:crypto';
import type { AuthSession, Role } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { ApiError } from '../errors.js';
import { categories, isAdmin, iso, materials } from '../orders/domain.js';
import { requireCurrentActor } from '../security/actor.js';
import type { CertificateQuery, CertificateUpdate, MaterialQuery, PortfolioQuery, SalesQuery } from './schemas.js';

type NumericRow = Record<string, string | number>;
const moneyKeys = ['count', 'base', 'factBase', 'iva', 'factGross', 'reteFuente', 'reteIva', 'ica', 'retentions', 'collectible', 'collectibleWithoutIva', 'received', 'balance', 'balanceWithIva', 'balanceWithoutIva', 'ivaDue'] as const;
function numbers(row: NumericRow | undefined, keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map(key => [key, Number(row?.[key] ?? 0)]));
}

async function snapshot<T>(db: Database, auth: AuthSession, run: (tx: SqlConnection) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Reads use the same snapshot for permission revalidation, totals, groups and rows.
    const actor = (await tx.query<{ role: Role; must_change_password: boolean }>(`
      SELECT u.role, u.must_change_password FROM users u JOIN sessions s ON s.user_id = u.id
      WHERE u.id = $1 AND s.token_hash = $2 AND s.csrf_token = $3
        AND u.is_active = true AND s.expires_at > clock_timestamp()
    `, [auth.user.id, auth.tokenHash, auth.csrfToken])).rows[0];
    if (!actor) throw new ApiError(401, 'AUTH_REQUIRED', 'La sesión ya no es válida.');
    if (!isAdmin(actor.role)) throw new ApiError(403, 'FORBIDDEN', 'Los reportes corresponden a Administración.');
    if (actor.must_change_password) throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Debes cambiar tu contraseña antes de continuar.');
    return run(tx);
  });
}

// Values remain PostgreSQL numeric throughout calculation and aggregation.
// Legacy orders keep their original additive rule; new orders deduct retentions.
const scopedOrders = `
  scoped AS (
    SELECT o.*, (o.created_at AT TIME ZONE 'America/Bogota')::date AS created_on,
      o.value AS base,
      CASE WHEN o.document_type = 'FACT' THEN round(o.value * 0.19, 2) ELSE 0 END AS iva,
      CASE WHEN o.document_type = 'FACT' THEN o.rete_fuente ELSE 0 END AS "reteFuente",
      CASE WHEN o.document_type = 'FACT' THEN o.rete_iva ELSE 0 END AS "reteIva",
      CASE WHEN o.document_type = 'FACT' THEN o.ica ELSE 0 END AS icaAmount,
      CASE WHEN o.document_type = 'FACT' THEN o.rete_fuente + o.rete_iva + o.ica ELSE 0 END AS retentions
    FROM orders o WHERE ($3::text IS NULL OR o.category = $3)
      AND ($4::text IS NULL OR o.document_type = $4)
      AND (o.created_at AT TIME ZONE 'America/Bogota')::date <= $2::date
  ), money AS (
    SELECT scoped.*, base + iva AS gross,
      base + iva + CASE WHEN financial_rule = 'NEW' THEN -retentions ELSE retentions END AS collectible,
      base + CASE WHEN financial_rule = 'NEW' THEN -retentions ELSE retentions END AS "collectibleWithoutIva"
    FROM scoped
  ), paid AS (
    SELECT p.order_id, sum(p.amount) AS amount FROM payments p JOIN money m ON m.id = p.order_id
    WHERE p.date <= $2::date GROUP BY p.order_id
  ), facts AS (
    SELECT m.*, coalesce(p.amount, 0) AS paid, greatest(m.collectible - coalesce(p.amount, 0), 0) AS balance,
      greatest(m."collectibleWithoutIva" - coalesce(p.amount, 0), 0) AS "balanceWithoutIva",
      CASE WHEN m.document_type = 'FACT' AND m.rete_fuente > 0 AND NOT m.certificate_rete_fuente THEN m.rete_fuente ELSE 0 END AS "pendingReteFuente",
      CASE WHEN m.document_type = 'FACT' AND m.rete_iva > 0 AND NOT m.certificate_rete_iva THEN m.rete_iva ELSE 0 END AS "pendingReteIva",
      CASE WHEN m.document_type = 'FACT' AND m.ica > 0 AND NOT m.certificate_ica THEN m.ica ELSE 0 END AS "pendingIca"
    FROM money m LEFT JOIN paid p ON p.order_id = m.id
  )`;

const periodSums = `
  count(*) FILTER (WHERE created_on BETWEEN $1::date AND $2::date) AS count,
  coalesce(sum(base) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS base,
  coalesce(sum(base) FILTER (WHERE created_on BETWEEN $1::date AND $2::date AND document_type = 'FACT'), 0) AS "factBase",
  coalesce(sum(iva) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS iva,
  coalesce(sum(gross) FILTER (WHERE created_on BETWEEN $1::date AND $2::date AND document_type = 'FACT'), 0) AS "factGross",
  coalesce(sum("reteFuente") FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS "reteFuente",
  coalesce(sum("reteIva") FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS "reteIva",
  coalesce(sum(icaAmount) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS ica,
  coalesce(sum(retentions) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS retentions,
  coalesce(sum(collectible) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS collectible,
  coalesce(sum("collectibleWithoutIva") FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS "collectibleWithoutIva",
  coalesce(sum(balance), 0) AS balance,
  coalesce(sum(balance), 0) AS "balanceWithIva",
  coalesce(sum("balanceWithoutIva"), 0) AS "balanceWithoutIva",
  coalesce(sum(balance - "balanceWithoutIva"), 0) AS "ivaDue"`;

export async function salesReport(db: Database, auth: AuthSession, input: SalesQuery) {
  return snapshot(db, auth, async tx => {
    const params = [input.from, input.to, input.category ?? null, input.documentType ?? null];
    const totals = (await tx.query<NumericRow>(`WITH ${scopedOrders}
      SELECT ${periodSums},
        (SELECT coalesce(sum(p.amount), 0) FROM payments p JOIN money m ON m.id = p.order_id
          WHERE p.date BETWEEN $1::date AND $2::date) AS received
      FROM facts`, params)).rows[0];
    const categoryRows = (await tx.query<NumericRow>(`WITH ${scopedOrders},
      sales AS (SELECT category, ${periodSums} FROM facts GROUP BY category),
      receipts AS (
        SELECT m.category, sum(p.amount) AS received FROM payments p JOIN money m ON m.id = p.order_id
        WHERE p.date BETWEEN $1::date AND $2::date GROUP BY m.category
      ) SELECT s.*, coalesce(r.received, 0) AS received FROM sales s LEFT JOIN receipts r ON r.category = s.category`, params)).rows;
    const documentRows = (await tx.query<NumericRow>(`WITH ${scopedOrders}
      SELECT document_type AS "documentType", count(*) AS count, coalesce(sum(base), 0) AS base,
        coalesce(sum(base) FILTER (WHERE document_type = 'FACT'), 0) AS "factBase",
        coalesce(sum(iva), 0) AS iva, coalesce(sum(gross), 0) AS gross,
        coalesce(sum("reteFuente"), 0) AS "reteFuente",
        coalesce(sum("reteIva"), 0) AS "reteIva", coalesce(sum(icaAmount), 0) AS ica,
        coalesce(sum(retentions), 0) AS retentions, coalesce(sum(collectible), 0) AS collectible,
        coalesce(sum("collectibleWithoutIva"), 0) AS "collectibleWithoutIva"
      FROM money WHERE created_on BETWEEN $1::date AND $2::date GROUP BY document_type`, params)).rows;

    const unit = input.groupBy === 'month' ? 'month' : 'day';
    const pattern = unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const timeline = (await tx.query<NumericRow>(`WITH ${scopedOrders},
      periods AS (
        SELECT generate_series(date_trunc('${unit}', $1::date::timestamp), date_trunc('${unit}', $2::date::timestamp), interval '1 ${unit}') AS period
      ), sales AS (
        SELECT date_trunc('${unit}', created_on::timestamp) AS period, count(*) AS count,
          sum(base) AS base,
          coalesce(sum(base) FILTER (WHERE document_type = 'FACT'), 0) AS "factBase",
          sum(iva) AS iva, sum("reteFuente") AS "reteFuente",
          sum("reteIva") AS "reteIva", sum(icaAmount) AS ica,
          sum(retentions) AS retentions, sum(collectible) AS collectible,
          sum("collectibleWithoutIva") AS "collectibleWithoutIva",
          coalesce(sum(gross) FILTER (WHERE document_type = 'FACT'), 0) AS "factGross"
        FROM money WHERE created_on BETWEEN $1::date AND $2::date GROUP BY period
      ), receipts AS (
        SELECT date_trunc('${unit}', p.date::timestamp) AS period, sum(p.amount) AS received
        FROM payments p JOIN money m ON m.id = p.order_id
        WHERE p.date BETWEEN $1::date AND $2::date GROUP BY period
      ) SELECT to_char(d.period, '${pattern}') AS period, s.count, s.base, s."factBase", s.iva,
          s."reteFuente", s."reteIva", s.ica, s.retentions, s.collectible,
          s."collectibleWithoutIva", s."factGross", r.received
      FROM periods d LEFT JOIN sales s ON s.period = d.period LEFT JOIN receipts r ON r.period = d.period ORDER BY d.period`, params)).rows;
    return {
      from: input.from, to: input.to, groupBy: input.groupBy,
      totals: numbers(totals, moneyKeys),
      categories: categories.map(category => ({ category, ...numbers(categoryRows.find(row => row.category === category), moneyKeys) })),
      documents: (['REM', 'FACT'] as const).map(documentType => ({ documentType,
        ...numbers(documentRows.find(row => row.documentType === documentType),
          ['count', 'base', 'factBase', 'iva', 'gross', 'reteFuente', 'reteIva', 'ica', 'retentions', 'collectible', 'collectibleWithoutIva']) })),
      timeline: timeline.map(row => ({ period: String(row.period),
        ...numbers(row, moneyKeys.filter(key => !['balance', 'balanceWithIva', 'balanceWithoutIva', 'ivaDue'].includes(key))) })),
    };
  });
}

type PortfolioRow = NumericRow & {
  id: string; number: number; version: number; client_id: string; client_name: string; status: string; created_at: string; closed_at: string;
  document_type: string; financial_rule: string; certificate_rete_fuente: boolean; certificate_rete_iva: boolean; certificate_ica: boolean;
};

export async function portfolioReport(db: Database, auth: AuthSession, input: PortfolioQuery) {
  return snapshot(db, auth, async tx => {
    // $1 is deliberately the cutoff too: the shared CTE only uses $2 through $4.
    const params = [input.cutoff, input.cutoff, input.category ?? null, input.documentType ?? null];
    const source = `WITH ${scopedOrders}, outstanding AS (SELECT * FROM facts WHERE balance > 0)`;
    const summary = (await tx.query<NumericRow>(`${source}
      SELECT count(*) AS total, coalesce(sum(balance), 0) AS "totalBalance", coalesce(sum(paid), 0) AS "totalPaid",
        coalesce(sum("balanceWithoutIva"), 0) AS "totalBalanceWithoutIva",
        coalesce(sum(balance - "balanceWithoutIva"), 0) AS "ivaDue",
        coalesce(sum(collectible), 0) AS "totalCollectible",
        coalesce(sum("collectibleWithoutIva"), 0) AS "totalCollectibleWithoutIva" FROM outstanding
      WHERE $1::date = $2::date`, params)).rows[0];
    // Certificates are tracked separately from cash debt and remain visible even when an OT is paid.
    const certificates = (await tx.query<NumericRow>(`WITH ${scopedOrders}
      SELECT coalesce(sum("pendingReteFuente"), 0) AS "reteFuente",
        coalesce(sum("pendingReteIva"), 0) AS "reteIva",
        coalesce(sum("pendingIca"), 0) AS ica
      FROM facts WHERE document_type = 'FACT' AND $1::date = $2::date`, params)).rows[0];
    const clientRows = (await tx.query<NumericRow>(`${source}
      SELECT c.id AS "clientId", c.name AS "clientName", count(*) AS count,
        sum(o.balance) AS balance, sum(o."balanceWithoutIva") AS "balanceWithoutIva",
        sum(o.balance - o."balanceWithoutIva") AS "ivaDue",
        sum(o.paid) AS paid, sum(o.collectible) AS collectible,
        sum(o."collectibleWithoutIva") AS "collectibleWithoutIva"
      FROM outstanding o JOIN clients c ON c.id = o.client_id WHERE $1::date = $2::date
      GROUP BY c.id, c.name ORDER BY sum(o.balance) DESC, lower(c.name), c.id`, params)).rows;
    const rows = (await tx.query<PortfolioRow>(`${source}
      SELECT o.id, o.number, o.client_id, c.name AS client_name, o.status, o.created_at, o.closed_at,
        o.document_type, o.financial_rule, o.certificate_rete_fuente, o.certificate_rete_iva, o.certificate_ica,
        o.balance, o."balanceWithoutIva", o.paid, o.collectible, o."collectibleWithoutIva",
        (o.balance - o."balanceWithoutIva") AS "ivaDue",
        o.iva, o."reteFuente", o."reteIva", o.icaAmount AS ica,
        o."pendingReteFuente", o."pendingReteIva", o."pendingIca"
      FROM outstanding o JOIN clients c ON c.id = o.client_id
      WHERE $1::date = $2::date ORDER BY o.created_at, o.number, o.id LIMIT $5 OFFSET $6`,
    [...params, input.pageSize, (input.page - 1) * input.pageSize])).rows;
    return {
      cutoff: input.cutoff, page: input.page, pageSize: input.pageSize,
      ...numbers(summary, ['total', 'totalBalance', 'totalPaid', 'totalCollectible', 'totalBalanceWithoutIva', 'totalCollectibleWithoutIva', 'ivaDue']),
      totalBalanceWithIva: Number(summary?.totalBalance ?? 0),
      certificates: { statusAsOf: 'current' as const, ...numbers(certificates, ['reteFuente', 'reteIva', 'ica']) },
      clients: clientRows.map(row => ({ clientId: String(row.clientId), clientName: String(row.clientName),
        ...numbers(row, ['count', 'balance', 'balanceWithoutIva', 'ivaDue', 'paid', 'collectible', 'collectibleWithoutIva']) })),
      items: rows.map(row => ({
        order: { id: row.id, number: Number(row.number), clientId: row.client_id, status: row.status,
          createdAt: iso(row.created_at), documentType: row.document_type, financialRule: row.financial_rule,
          ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}) },
        clientName: row.client_name,
        ...numbers(row, ['balance', 'balanceWithoutIva', 'ivaDue', 'paid', 'collectible', 'collectibleWithoutIva', 'iva', 'reteFuente', 'reteIva', 'ica', 'pendingReteFuente', 'pendingReteIva', 'pendingIca']),
        certificates: { reteFuente: row.certificate_rete_fuente, reteIva: row.certificate_rete_iva, ica: row.certificate_ica },
      })),
    };
  });
}

export async function certificateReport(db: Database, auth: AuthSession, input: CertificateQuery) {
  return snapshot(db, auth, async tx => {
    const params = [input.cutoff, input.cutoff, null, 'FACT'];
    const source = `WITH ${scopedOrders}, certificates AS (
      SELECT f.*, c.name AS client_name FROM facts f JOIN clients c ON c.id = f.client_id
      WHERE f.document_type = 'FACT' AND f.retentions > 0 AND $1::date = $2::date
    )`;
    const summary = (await tx.query<NumericRow>(`${source}
      SELECT count(*) AS total,
        coalesce(sum("pendingReteFuente"), 0) AS "pendingReteFuente",
        coalesce(sum("pendingReteIva"), 0) AS "pendingReteIva",
        coalesce(sum("pendingIca"), 0) AS "pendingIca"
      FROM certificates`, params)).rows[0];
    const rows = (await tx.query<PortfolioRow>(`${source}
      SELECT id, number, client_id, client_name, status, created_at, closed_at,
        document_type, financial_rule, certificate_rete_fuente, certificate_rete_iva, certificate_ica,
        "reteFuente", "reteIva", icaAmount AS ica, "pendingReteFuente", "pendingReteIva", "pendingIca",
        iva, collectible, "collectibleWithoutIva", paid, balance, "balanceWithoutIva", version
      FROM certificates ORDER BY created_at, number, id LIMIT $5 OFFSET $6`,
    [...params, input.pageSize, (input.page - 1) * input.pageSize])).rows;
    return {
      cutoff: input.cutoff,
      certificateStatusAsOf: 'current' as const,
      page: input.page,
      pageSize: input.pageSize,
      ...numbers(summary, ['total', 'pendingReteFuente', 'pendingReteIva', 'pendingIca']),
      items: rows.map(row => ({
        orderId: row.id,
        number: Number(row.number),
        clientId: row.client_id,
        clientName: row.client_name,
        documentType: row.document_type,
        financialRule: row.financial_rule,
        createdAt: iso(row.created_at),
        version: Number(row.version),
        ...numbers(row, ['reteFuente', 'reteIva', 'ica', 'pendingReteFuente', 'pendingReteIva', 'pendingIca',
          'iva', 'collectible', 'collectibleWithoutIva', 'paid', 'balance', 'balanceWithoutIva']),
        certificates: { reteFuente: row.certificate_rete_fuente, reteIva: row.certificate_rete_iva, ica: row.certificate_ica },
      })),
    };
  });
}

export async function updateCertificates(db: Database, auth: AuthSession, input: CertificateUpdate) {
  return db.transaction(async tx => {
    const actor = await requireCurrentActor(tx, auth, ['ADMINMASTER', 'ADMIN_GENERAL']);
    const row = (await tx.query<{
      id: string; status: string; version: number; document_type: string;
      rete_fuente: string; rete_iva: string; ica: string;
      certificate_rete_fuente: boolean; certificate_rete_iva: boolean; certificate_ica: boolean;
    }>('SELECT id,status,version,document_type,rete_fuente,rete_iva,ica,certificate_rete_fuente,certificate_rete_iva,certificate_ica FROM orders WHERE id=$1 FOR UPDATE',
    [input.orderId])).rows[0];
    if (!row) throw new ApiError(404, 'ORDER_NOT_FOUND', 'No encontramos esta orden.');
    if (row.version !== input.expectedVersion) throw new ApiError(409, 'ORDER_CONFLICT', 'Otra persona actualizó esta orden. Recarga sus datos antes de continuar.');
    if (row.document_type !== 'FACT') throw new ApiError(409, 'CERTIFICATE_NOT_APPLICABLE', 'Los certificados de retención corresponden únicamente a FACT.');
    const requested = input.certificates;
    if ((requested.reteFuente && Number(row.rete_fuente) <= 0) ||
        (requested.reteIva && Number(row.rete_iva) <= 0) ||
        (requested.ica && Number(row.ica) <= 0)) {
      throw new ApiError(400, 'CERTIFICATE_NOT_APPLICABLE', 'No se puede marcar como recibido un certificado sin valor de retención.');
    }
    if (row.certificate_rete_fuente === requested.reteFuente &&
        row.certificate_rete_iva === requested.reteIva && row.certificate_ica === requested.ica) {
      return { orderId: row.id, certificates: requested, version: row.version };
    }
    const updated = (await tx.query<{ version: number }>(`
      UPDATE orders SET certificate_rete_fuente=$2,certificate_rete_iva=$3,certificate_ica=$4,
        updated_at=clock_timestamp(),version=version+1 WHERE id=$1 RETURNING version`,
    [row.id, requested.reteFuente, requested.reteIva, requested.ica])).rows[0];
    await tx.query(`INSERT INTO order_events (id,order_id,actor_id,action,from_status,to_status)
      VALUES ($1,$2,$3,'certificates',$4,$4)`, [randomUUID(), row.id, actor.id, row.status]);
    return { orderId: row.id, certificates: requested, version: updated.version };
  });
}

export async function materialReport(db: Database, auth: AuthSession, input: MaterialQuery) {
  return snapshot(db, auth, async tx => {
    const params = [input.from, input.to, input.material ?? null];
    const source = `WITH consumed AS (
      SELECT order_id, material, round(length * width, 3) AS m2,
        (consumed_at AT TIME ZONE 'America/Bogota')::date AS consumed_on
      FROM order_product_materials WHERE consumed_at IS NOT NULL
        AND ($3::text IS NULL OR material = $3)
        AND (consumed_at AT TIME ZONE 'America/Bogota')::date BETWEEN $1::date AND $2::date
    )`;
    const summary = (await tx.query<NumericRow>(`${source}
      SELECT count(DISTINCT order_id) AS "totalOrders", coalesce(sum(m2), 0) AS "totalM2" FROM consumed`, params)).rows[0];
    const grouped = (await tx.query<NumericRow>(`${source}
      SELECT material, count(*) AS count, sum(m2) AS m2 FROM consumed GROUP BY material`, params)).rows;
    const unit = input.groupBy === 'month' ? 'month' : 'day';
    const pattern = unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const timeline = (await tx.query<NumericRow>(`${source}, periods AS (
      SELECT generate_series(date_trunc('${unit}', $1::date::timestamp), date_trunc('${unit}', $2::date::timestamp), interval '1 ${unit}') AS period
    ), totals AS (
      SELECT date_trunc('${unit}', consumed_on::timestamp) AS period, count(DISTINCT order_id) AS count, sum(m2) AS m2 FROM consumed GROUP BY period
    ) SELECT to_char(p.period, '${pattern}') AS period, t.count, t.m2 FROM periods p LEFT JOIN totals t ON t.period = p.period ORDER BY p.period`, params)).rows;
    return {
      from: input.from, to: input.to, groupBy: input.groupBy,
      ...numbers(summary, ['totalOrders', 'totalM2']),
      materials: materials.map(material => ({ material, ...numbers(grouped.find(row => row.material === material), ['count', 'm2']) })),
      timeline: timeline.map(row => ({ period: String(row.period), ...numbers(row, ['count', 'm2']) })),
    };
  });
}
