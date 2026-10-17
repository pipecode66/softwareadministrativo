import { Router, type RequestHandler } from 'express';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { clientParamsSchema, createClientSchema, listClientOrdersSchema, listClientsSchema, updateClientSchema } from './schemas.js';
import { CLIENT_CREATE_ROLES, CLIENT_READ_ROLES, CLIENT_WRITE_ROLES, createClient, deleteClient, getClient, listClientOrders, listClients, updateClient } from './service.js';

/** Mount after requireAuth, requirePasswordReady and requireCsrf. */
export function createClientsRouter(db: Database): Router {
  const router = Router();
  router.use((req, _res, next) => {
    if (!req.auth) throw new ApiError(401, 'AUTH_REQUIRED', 'Debes iniciar sesión.');
    if (![...CLIENT_READ_ROLES, 'APOYO_COMERCIAL'].includes(req.auth.user.role)) {
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

  const requireDirectoryRole: RequestHandler = (req, _res, next) => {
    if (!CLIENT_READ_ROLES.includes(req.auth!.user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tu perfil no tiene acceso a las fichas de clientes.');
    }
    next();
  };

  const requireCreateRole: RequestHandler = (req, _res, next) => {
    if (!CLIENT_CREATE_ROLES.includes(req.auth!.user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tu perfil no puede registrar clientes.');
    }
    next();
  };

  router.get('/', async (req, res) => {
    res.json(await listClients(db, listClientsSchema.parse(req.query)));
  });

  router.get('/:id', requireDirectoryRole, async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    res.json({ client: await getClient(db, id) });
  });

  router.get('/:id/orders', requireDirectoryRole, async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    res.json(await listClientOrders(db, req.auth!, id, listClientOrdersSchema.parse(req.query)));
  });

  router.post('/', requireCreateRole, async (req, res) => {
    const input = createClientSchema.parse(req.body);
    res.status(201).json({ client: await createClient(db, req.auth!, input) });
  });

  router.patch('/:id', requireWriteRole, async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    const input = updateClientSchema.parse(req.body);
    res.json({ client: await updateClient(db, req.auth!, id, input) });
  });

  router.delete('/:id', requireDirectoryRole, async (req, res) => {
    const { id } = clientParamsSchema.parse(req.params);
    await deleteClient(db, req.auth!, id);
    res.status(204).end();
  });

  return router;
}
