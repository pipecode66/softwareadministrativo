import type { AuthSession, Role } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { ApiError } from '../errors.js';
import { categories, isAdmin, iso, materials } from '../orders/domain.js';
import type { MaterialQuery, PortfolioQuery, SalesQuery } from './schemas.js';

type NumericRow = Record<string, string | number>;
const moneyKeys = ['count', 'base', 'iva', 'factGross', 'retentions', 'collectible', 'received', 'balance'] as const;
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
// The user's agreed business rule ADDS manual FACT retention amounts; this does not issue tax invoices.
const scopedOrders = `
  scoped AS (
    SELECT o.*, (o.created_at AT TIME ZONE 'America/Bogota')::date AS created_on,
      o.value AS base,
      CASE WHEN o.document_type = 'FACT' THEN round(o.value * 0.19, 2) ELSE 0 END AS iva,
      CASE WHEN o.document_type = 'FACT' THEN o.rete_fuente + o.rete_iva + o.ica ELSE 0 END AS retentions
    FROM orders o WHERE ($3::text IS NULL OR o.category = $3)
      AND ($4::text IS NULL OR o.document_type = $4)
      AND (o.created_at AT TIME ZONE 'America/Bogota')::date <= $2::date
  ), money AS (
    SELECT scoped.*, base + iva AS gross, base + iva + retentions AS collectible FROM scoped
  ), paid AS (
    SELECT p.order_id, sum(p.amount) AS amount FROM payments p JOIN money m ON m.id = p.order_id
    WHERE p.date <= $2::date GROUP BY p.order_id
  ), facts AS (
    SELECT m.*, coalesce(p.amount, 0) AS paid, greatest(m.collectible - coalesce(p.amount, 0), 0) AS balance
    FROM money m LEFT JOIN paid p ON p.order_id = m.id
  )`;

const periodSums = `
  count(*) FILTER (WHERE created_on BETWEEN $1::date AND $2::date) AS count,
  coalesce(sum(base) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS base,
  coalesce(sum(iva) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS iva,
  coalesce(sum(gross) FILTER (WHERE created_on BETWEEN $1::date AND $2::date AND document_type = 'FACT'), 0) AS "factGross",
  coalesce(sum(retentions) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS retentions,
  coalesce(sum(collectible) FILTER (WHERE created_on BETWEEN $1::date AND $2::date), 0) AS collectible,
  coalesce(sum(balance), 0) AS balance`;

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
        coalesce(sum(iva), 0) AS iva, coalesce(sum(gross), 0) AS gross,
        coalesce(sum(retentions), 0) AS retentions, coalesce(sum(collectible), 0) AS collectible
      FROM money WHERE created_on BETWEEN $1::date AND $2::date GROUP BY document_type`, params)).rows;

    const unit = input.groupBy === 'month' ? 'month' : 'day';
    const pattern = unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const timeline = (await tx.query<NumericRow>(`WITH ${scopedOrders},
      periods AS (
        SELECT generate_series(date_trunc('${unit}', $1::date::timestamp), date_trunc('${unit}', $2::date::timestamp), interval '1 ${unit}') AS period
      ), sales AS (
        SELECT date_trunc('${unit}', created_on::timestamp) AS period, count(*) AS count,
          sum(base) AS base, sum(iva) AS iva, sum(retentions) AS retentions, sum(collectible) AS collectible,
          coalesce(sum(gross) FILTER (WHERE document_type = 'FACT'), 0) AS "factGross"
        FROM money WHERE created_on BETWEEN $1::date AND $2::date GROUP BY period
      ), receipts AS (
        SELECT date_trunc('${unit}', p.date::timestamp) AS period, sum(p.amount) AS received
        FROM payments p JOIN money m ON m.id = p.order_id
        WHERE p.date BETWEEN $1::date AND $2::date GROUP BY period
      ) SELECT to_char(d.period, '${pattern}') AS period, s.count, s.base, s.iva, s.retentions, s.collectible, s."factGross", r.received
      FROM periods d LEFT JOIN sales s ON s.period = d.period LEFT JOIN receipts r ON r.period = d.period ORDER BY d.period`, params)).rows;
    return {
      from: input.from, to: input.to, groupBy: input.groupBy,
      totals: numbers(totals, moneyKeys),
      categories: categories.map(category => ({ category, ...numbers(categoryRows.find(row => row.category === category), moneyKeys) })),
      documents: (['REM', 'FACT'] as const).map(documentType => ({ documentType,
        ...numbers(documentRows.find(row => row.documentType === documentType), ['count', 'base', 'iva', 'gross', 'retentions', 'collectible']) })),
      timeline: timeline.map(row => ({ period: String(row.period), ...numbers(row, moneyKeys.filter(key => key !== 'balance')) })),
    };
  });
}

type PortfolioRow = NumericRow & {
  id: string; number: number; client_id: string; client_name: string; status: string; created_at: string; closed_at: string;
};

export async function portfolioReport(db: Database, auth: AuthSession, input: PortfolioQuery) {
  return snapshot(db, auth, async tx => {
    // $1 is deliberately the cutoff too: the shared CTE only uses $2 through $4.
    const params = [input.cutoff, input.cutoff, input.category ?? null, input.documentType ?? null];
    const source = `WITH ${scopedOrders}, outstanding AS (SELECT * FROM facts WHERE balance > 0)`;
    const summary = (await tx.query<NumericRow>(`${source}
      SELECT count(*) AS total, coalesce(sum(balance), 0) AS "totalBalance", coalesce(sum(paid), 0) AS "totalPaid",
        coalesce(sum(collectible), 0) AS "totalCollectible" FROM outstanding
      WHERE $1::date = $2::date`, params)).rows[0];
    const clientRows = (await tx.query<NumericRow>(`${source}
      SELECT c.id AS "clientId", c.name AS "clientName", count(*) AS count,
        sum(o.balance) AS balance, sum(o.paid) AS paid, sum(o.collectible) AS collectible
      FROM outstanding o JOIN clients c ON c.id = o.client_id WHERE $1::date = $2::date
      GROUP BY c.id, c.name ORDER BY sum(o.balance) DESC, lower(c.name), c.id`, params)).rows;
    const rows = (await tx.query<PortfolioRow>(`${source}
      SELECT o.id, o.number, o.client_id, c.name AS client_name, o.status, o.created_at, o.closed_at,
        o.balance, o.paid, o.collectible FROM outstanding o JOIN clients c ON c.id = o.client_id
      WHERE $1::date = $2::date ORDER BY o.created_at, o.number, o.id LIMIT $5 OFFSET $6`,
    [...params, input.pageSize, (input.page - 1) * input.pageSize])).rows;
    return {
      cutoff: input.cutoff, page: input.page, pageSize: input.pageSize,
      ...numbers(summary, ['total', 'totalBalance', 'totalPaid', 'totalCollectible']),
      clients: clientRows.map(row => ({ clientId: String(row.clientId), clientName: String(row.clientName),
        ...numbers(row, ['count', 'balance', 'paid', 'collectible']) })),
      items: rows.map(row => ({
        order: { id: row.id, number: Number(row.number), clientId: row.client_id, status: row.status,
          createdAt: iso(row.created_at), ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}) },
        clientName: row.client_name, ...numbers(row, ['balance', 'paid', 'collectible']),
      })),
    };
  });
}

export async function materialReport(db: Database, auth: AuthSession, input: MaterialQuery) {
  return snapshot(db, auth, async tx => {
    const params = [input.from, input.to, input.material ?? null];
    const source = `WITH consumed AS (
      SELECT material, round(length * width, 3) AS m2,
        (printing_completed_at AT TIME ZONE 'America/Bogota')::date AS consumed_on
      FROM orders WHERE printing_completed_at IS NOT NULL AND material IS NOT NULL
        AND ($3::text IS NULL OR material = $3)
        AND (printing_completed_at AT TIME ZONE 'America/Bogota')::date BETWEEN $1::date AND $2::date
    )`;
    const summary = (await tx.query<NumericRow>(`${source}
      SELECT count(*) AS "totalOrders", coalesce(sum(m2), 0) AS "totalM2" FROM consumed`, params)).rows[0];
    const grouped = (await tx.query<NumericRow>(`${source}
      SELECT material, count(*) AS count, sum(m2) AS m2 FROM consumed GROUP BY material`, params)).rows;
    const unit = input.groupBy === 'month' ? 'month' : 'day';
    const pattern = unit === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const timeline = (await tx.query<NumericRow>(`${source}, periods AS (
      SELECT generate_series(date_trunc('${unit}', $1::date::timestamp), date_trunc('${unit}', $2::date::timestamp), interval '1 ${unit}') AS period
    ), totals AS (
      SELECT date_trunc('${unit}', consumed_on::timestamp) AS period, count(*) AS count, sum(m2) AS m2 FROM consumed GROUP BY period
    ) SELECT to_char(p.period, '${pattern}') AS period, t.count, t.m2 FROM periods p LEFT JOIN totals t ON t.period = p.period ORDER BY p.period`, params)).rows;
    return {
      from: input.from, to: input.to, groupBy: input.groupBy,
      ...numbers(summary, ['totalOrders', 'totalM2']),
      materials: materials.map(material => ({ material, ...numbers(grouped.find(row => row.material === material), ['count', 'm2']) })),
      timeline: timeline.map(row => ({ period: String(row.period), ...numbers(row, ['count', 'm2']) })),
    };
  });
}
