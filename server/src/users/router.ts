import { Router } from 'express';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { createUserSchema, listUsersSchema, resetPasswordSchema, updateUserSchema, userParamsSchema } from './schemas.js';
import { createUser, listUsers, resetUserPassword, updateUser } from './service.js';

/** Mounted after authentication, password-change enforcement and CSRF middleware. */
export function createUsersRouter(db: Database): Router {
  const router = Router();

  router.use((req, _res, next) => {
    if (!req.auth) throw new ApiError(401, 'AUTH_REQUIRED', 'Debes iniciar sesión.');
    if (req.auth.user.role !== 'ADMINMASTER') {
      throw new ApiError(403, 'FORBIDDEN', 'Solo ADMINMASTER puede administrar las cuentas.');
    }
    next();
  });

  router.get('/', async (req, res) => {
    const input = listUsersSchema.parse(req.query);
    res.json(await listUsers(db, input));
  });

  router.post('/', async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await createUser(db, req.auth!, input);
    res.status(201).json({ user });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = userParamsSchema.parse(req.params);
    const input = updateUserSchema.parse(req.body);
    const user = await updateUser(db, req.auth!, id, input);
    res.json({ user });
  });

  router.post('/:id/password', async (req, res) => {
    const { id } = userParamsSchema.parse(req.params);
    const { password } = resetPasswordSchema.parse(req.body);
    await resetUserPassword(db, req.auth!, id, password);
    res.status(204).end();
  });

  return router;
}
