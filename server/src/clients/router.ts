import { Router, type RequestHandler } from 'express';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { clientParamsSchema, createClientSchema, listClientOrdersSchema, listClientsSchema, updateClientSchema } from './schemas.js';
import { CLIENT_READ_ROLES, CLIENT_WRITE_ROLES, createClient, getClient, listClientOrders, listClients, updateClient } from './service.js';

/** Mount after requireAuth, requirePasswordReady and requireCsrf. */
export function createClientsRouter(db: Database): Router {
  const router = Router();
  router.use((req, _res, next) => {
    if (!req.auth) throw new ApiError(401, 'AUTH_REQUIRED', 'Debes iniciar sesión.');
    if (!CLIENT_READ_ROLES.includes(req.auth.user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tu perfil no tiene acceso al directorio de clientes.');
    }
    next();
  });

  const requireWriteRole: RequestHandler = (req, _res, next) => {
    if (!CLIENT_WRITE_ROLES.includes(req.auth!.user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Solo Administración y Diseño pueden registrar o editar clientes.');
    }
    next();
  };

  router.get('/', async (req, res) => {
    res.json(await listClients(db, listClientsSchema.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    res.json({ client: await getClient(db, id) });
  });

  router.get('/:id/orders', async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    res.json(await listClientOrders(db, req.auth!, id, listClientOrdersSchema.parse(req.query)));
  });

  router.post('/', requireWriteRole, async (req, res) => {
    const input = createClientSchema.parse(req.body);
    res.status(201).json({ client: await createClient(db, req.auth!, input) });
  });

  router.patch('/:id', requireWriteRole, async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    const input = updateClientSchema.parse(req.body);
    res.json({ client: await updateClient(db, req.auth!, id, input) });
  });

  return router;
}
