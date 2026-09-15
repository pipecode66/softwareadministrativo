import type { Express, Request, Response } from 'express';
import { createApp } from '../server/src/app.js';
import { readConfig } from '../server/src/config.js';
import { createPostgresDatabase } from '../server/src/db/database.js';
import type { Database } from '../server/src/db/types.js';

interface Runtime {
  app: Express;
  db: Database;
}

const processRuntime = globalThis as typeof globalThis & { __intermediosRuntime?: Promise<Runtime> };

async function createRuntime(): Promise<Runtime> {
  const config = readConfig();
  if (config.databaseMode !== 'postgres' || !config.databaseUrl) {
    throw new Error('Vercel requiere DATABASE_MODE=postgres y DATABASE_URL.');
  }
  const db = createPostgresDatabase(config.databaseUrl);
  try {
    return { app: await createApp(db, config), db };
  } catch (error) {
    await db.close();
    throw error;
  }
}

function runtime(): Promise<Runtime> {
  processRuntime.__intermediosRuntime ??= createRuntime();
  return processRuntime.__intermediosRuntime;
}

export default async function handler(request: Request, response: Response): Promise<void> {
  const current = await runtime();
  current.app(request, response);
}