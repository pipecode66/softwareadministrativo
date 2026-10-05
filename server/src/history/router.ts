import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import { listHistory } from './service.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderId: z.uuid().optional(),
}).strict();

export function createHistoryRouter(db: Database) {
  const router = Router();
  router.get('/', async (req, res) => res.json(await listHistory(db, req.auth!, querySchema.parse(req.query))));
  return router;
}
