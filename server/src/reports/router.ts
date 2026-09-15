import { Router } from 'express';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { isAdmin } from '../orders/domain.js';
import { materialSchema, portfolioSchema, salesSchema } from './schemas.js';
import { materialReport, portfolioReport, salesReport } from './service.js';

/** Mounted after real authentication and mandatory password-change enforcement. */
export function createReportsRouter(db: Database): Router {
  const router = Router();
  router.use((request, _response, next) => {
    if (!request.auth) throw new ApiError(401, 'AUTH_REQUIRED', 'Debes iniciar sesión.');
    if (!isAdmin(request.auth.user.role)) throw new ApiError(403, 'FORBIDDEN', 'Los reportes corresponden a Administración.');
    next();
  });
  router.get('/sales', async (request, response) => {
    response.json(await salesReport(db, request.auth!, salesSchema.parse(request.query)));
  });
  router.get('/portfolio', async (request, response) => {
    response.json(await portfolioReport(db, request.auth!, portfolioSchema.parse(request.query)));
  });
  router.get('/materials', async (request, response) => {
    response.json(await materialReport(db, request.auth!, materialSchema.parse(request.query)));
  });
  return router;
}
