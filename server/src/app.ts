import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { createAuth } from './auth/module.js';
import type { AppConfig } from './config.js';
import type { Database } from './db/types.js';
import { ApiError } from './errors.js';
import { createUsersRouter } from './users/router.js';
import { createClientsRouter } from './clients/router.js';
import { createOrdersRouter } from './orders/router.js';
import { createReportsRouter } from './reports/router.js';

const JSON_LIMIT = '32kb';

function errorBody(code: string, message: string, field?: string) {
  return { error: { code, message, ...(field ? { field } : {}) } };
}

function corsMiddleware(config: AppConfig): RequestHandler {
  return (request, response, next) => {
    const origin = request.get('Origin');
    response.vary('Origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Headers', 'content-type,x-csrf-token');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      if (!origin || !config.allowedOrigins.includes(origin)) {
        response.status(403).json(errorBody('ORIGIN_FORBIDDEN', 'Origen no permitido.'));
        return;
      }
      response.status(204).end();
      return;
    }
    next();
  };
}

function requireJsonWrites(): RequestHandler {
  return (request, _response, next) => {
    if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
      next();
      return;
    }
    const type = request.get('Content-Type');
    if (type?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo debe enviarse como JSON.');
    }
    next();
  };
}

function requireAllowedOrigin(config: AppConfig): RequestHandler {
  return (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      next();
      return;
    }
    const origin = request.get('Origin');
    if (!origin || !config.allowedOrigins.includes(origin)) {
      throw new ApiError(403, 'ORIGIN_FORBIDDEN', 'Origen no permitido.');
    }
    next();
  };
}

const handleError: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  response.setHeader('Cache-Control', 'no-store');
  if (error instanceof ApiError) {
    response.status(error.status).json(errorBody(error.code, error.message, error.field));
    return;
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.map(String).join('.') || undefined;
    response.status(400).json(errorBody('VALIDATION_ERROR', issue?.message || 'Revisa los datos enviados.', field));
    return;
  }
  if (error instanceof SyntaxError || (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed')) {
    response.status(400).json(errorBody('INVALID_JSON', 'El cuerpo de la solicitud no es JSON válido.'));
    return;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
    response.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'La solicitud supera el tamaño permitido.'));
    return;
  }
  response.status(500).json(errorBody('INTERNAL_ERROR', 'No se pudo completar la solicitud.'));
};

export async function createApp(db: Database, config: AppConfig): Promise<Express> {
  const app = express();
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use('/api/v1', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(corsMiddleware(config));
  app.use('/api/v1', requireAllowedOrigin(config));
  app.use('/api/v1', requireJsonWrites());
  app.use(express.json({ limit: JSON_LIMIT }));

  const auth = await createAuth(db, config);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    // Shared office IPs must not exhaust the failure allowance through valid logins.
    skipSuccessfulRequests: true,
    handler: (_request, response) => {
      response.setHeader('Retry-After', '900');
      response.status(429).json(errorBody('RATE_LIMITED', 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'));
    },
  });

  const api = express.Router();
  api.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  api.get('/health/ready', async (_request, response) => {
    try {
      const result = await db.query<{ ready: boolean }>(`
        SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '001_access.sql')
          AND EXISTS (SELECT 1 FROM system_locks WHERE id = 'user-management')
          AND to_regclass('users') IS NOT NULL
          AND to_regclass('sessions') IS NOT NULL AS ready
      `);
      if (!result.rows[0]?.ready) throw new Error('Schema not ready');
      response.json({ status: 'ready' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const schemaMissing = message === 'Schema not ready' || databaseCode === '42P01';
      if (!schemaMissing) console.error('DATABASE_READY_CHECK_FAILED', databaseCode || 'UNKNOWN', message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]'));
      response.status(503).json(errorBody('NOT_READY', schemaMissing
        ? 'La conexión funciona, pero faltan las migraciones de la base de datos.'
        : 'No se pudo consultar la base de datos configurada.'));
    }
  });
  api.use('/auth/login', loginLimiter);
  api.use('/auth', auth.router);
  api.use('/users', auth.requireAuth, auth.requirePasswordReady, auth.requireCsrf, createUsersRouter(db));
  api.use('/clients', auth.requireAuth, auth.requirePasswordReady, auth.requireCsrf, createClientsRouter(db));
  api.use('/orders', auth.requireAuth, auth.requirePasswordReady, auth.requireCsrf, createOrdersRouter(db));
  api.use('/reports', auth.requireAuth, auth.requirePasswordReady, createReportsRouter(db));
  api.use((request: Request) => {
    throw new ApiError(404, 'NOT_FOUND', `No existe ${request.method} ${request.path}.`);
  });

  app.use('/api/v1', api);
  app.use(handleError);
  return app;
}
