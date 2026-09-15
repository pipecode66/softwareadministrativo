import { get } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { createPgliteDatabase } from '../src/db/database.js';
import type { Database } from '../src/db/types.js';
import { startServer } from '../src/main.js';

const config = { ...readConfig({ NODE_ENV: 'test' }), port: 0 };

describe('HTTP lifecycle with isolated in-memory data', () => {
  it('closes its owned database when startup migration fails', async () => {
    const close = vi.fn(async () => {});
    const broken: Database = {
      query: async () => { throw new Error('unavailable'); },
      exec: async () => { throw new Error('unavailable'); },
      transaction: async () => { throw new Error('unavailable'); },
      close,
    };
    await expect(startServer(config, broken)).rejects.toThrow('unavailable');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for an active request before closing the database and closes only once', async () => {
    const memory = await createPgliteDatabase();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(done => { entered = done; });
    const gate = new Promise<void>(done => { release = done; });
    const close = vi.fn(() => memory.close());
    const wrapper: Database = {
      ...memory,
      query: async (sql, params) => {
        if (sql.includes("AS ready")) {
          entered();
          await gate;
        }
        return memory.query(sql, params);
      },
      close,
    };
    const runtime = await startServer(config, wrapper);
    try {
      const address = runtime.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing TCP listener');
      const response = new Promise<number | undefined>((done, reject) => {
        get(`http://127.0.0.1:${address.port}/api/v1/health/ready`, received => {
          received.resume();
          received.on('end', () => done(received.statusCode));
        }).on('error', reject);
      });
      await started;
      const closing = runtime.close();
      expect(close).not.toHaveBeenCalled();
      release();
      expect(await response).toBe(200);
      await closing;
      await runtime.close();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await runtime.close();
    }
  });

  it('releases the database if another listener already owns the configured port', async () => {
    const first = await startServer(config, await createPgliteDatabase());
    const secondDatabase = await createPgliteDatabase();
    const close = vi.fn(() => secondDatabase.close());
    try {
      const address = first.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing TCP listener');
      await expect(startServer({ ...config, port: address.port }, { ...secondDatabase, close })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await first.close();
      await secondDatabase.close();
    }
  });
});
