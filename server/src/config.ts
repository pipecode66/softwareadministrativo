import { resolve } from 'node:path';
import { z } from 'zod';

export interface AppConfig {
  production: boolean;
  host: string;
  port: number;
  allowedOrigins: string[];
  databaseMode: 'pglite' | 'postgres';
  databaseUrl?: string;
  dataDir: string;
  sessionHours: number;
  trustProxyHops: number;
  loginRateLimit: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173'),
    DATABASE_MODE: z.enum(['pglite', 'postgres']).default('pglite'),
    DATABASE_URL: z.string().optional(),
    PGLITE_DATA_DIR: z.string().default('.data/intermedios'),
    SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  }).parse(env);
  const production = values.NODE_ENV === 'production';
  const allowedOrigins = values.APP_ORIGINS.split(',').map(origin => origin.trim());
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) {
      throw new Error('APP_ORIGINS requiere orígenes exactos; HTTPS es obligatorio en producción.');
    }
  }
  if (production && values.DATABASE_MODE !== 'postgres') throw new Error('Producción requiere PostgreSQL externo. PGlite es solo para desarrollo.');
  if (values.DATABASE_MODE === 'postgres' && !values.DATABASE_URL) throw new Error('Falta DATABASE_URL para PostgreSQL.');
  return {
    production, host: values.API_HOST, port: values.API_PORT, allowedOrigins,
    databaseMode: values.DATABASE_MODE, databaseUrl: values.DATABASE_URL,
    dataDir: resolve(values.PGLITE_DATA_DIR), sessionHours: values.SESSION_HOURS,
    trustProxyHops: values.TRUST_PROXY_HOPS, loginRateLimit: values.LOGIN_RATE_LIMIT,
  };
}
