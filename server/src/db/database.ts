import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';
import type { AppConfig } from '../config.js';
import type { Database, SqlConnection } from './types.js';

function liteConnection(client: PGlite | Transaction): SqlConnection {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async exec(sql) { await client.exec(sql); },
  };
}

// PGlite must have a single owning process. Never open the same data directory twice.
// A lock left by a crash is deliberately not removed automatically: inspect its PID first.
export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  const lockPath = dataDir ? `${dataDir}.lock` : undefined;
  if (dataDir && lockPath) {
    await mkdir(dirname(dataDir), { recursive: true });
    try {
      lock = await open(lockPath, 'wx', 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } catch {
      throw new Error('La base PGlite está ocupada o tiene un bloqueo pendiente. Detén el otro proceso y revisa el archivo .lock; no borres el directorio de datos.');
    }
  }
  try {
    const client = await PGlite.create(dataDir ? { dataDir } : {});
    let closed = false;
    return {
      ...liteConnection(client),
      transaction: run => client.transaction(tx => run(liteConnection(tx))),
      async close() {
        if (closed) return;
        closed = true;
        try { await client.close(); }
        finally { await lock?.close(); if (lockPath) await unlink(lockPath); }
      },
    };
  } catch (error) {
    await lock?.close();
    if (lockPath) await unlink(lockPath);
    throw error;
  }
}

function postgresConnection(client: Pool | PoolClient): SqlConnection {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
    async exec(sql) { await client.query(sql); },
  };
}

export function createPostgresDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000, statement_timeout: 15_000 });
  // Do not print connection strings or raw errors containing credentials/SQL values.
  pool.on('error', () => console.error('API: conexión PostgreSQL interrumpida.'));
  return {
    ...postgresConnection(pool),
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(postgresConnection(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

export function openDatabase(config: AppConfig): Promise<Database> {
  return config.databaseMode === 'postgres'
    ? Promise.resolve(createPostgresDatabase(config.databaseUrl!))
    : createPgliteDatabase(config.dataDir);
}
