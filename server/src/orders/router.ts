import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import { categories, createSchema, dateSchema, editSchema, paymentSchema, statuses, transitionSchema } from './domain.js';
import { createOrder, editOrder, getOrder, listOrders, recordPayment, transitionOrder } from './service.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).optional(), status: z.enum(statuses).optional(), documentType: z.enum(['REM','FACT']).optional(),
  category: z.enum(categories).optional(), paymentStatus: z.enum(['PENDING','PARTIAL','PAID','OUTSTANDING']).optional(),
  from: dateSchema.optional(), to: dateSchema.optional(),
}).strict().refine(input => !input.from || !input.to || input.from <= input.to, 'El inicio del período debe ser anterior al final.');
export function createOrdersRouter(db: Database) {
  const router = Router();
  router.get('/', async (req,res) => { res.json(await listOrders(db, req.auth!, listSchema.parse(req.query))); });
  router.get('/:id', async (req,res) => { res.json(await getOrder(db, req.auth!, z.uuid().parse(req.params.id))); });
  router.post('/', async (req,res) => { const result = await createOrder(db, req.auth!, createSchema.parse(req.body)); res.status(result.replayed ? 200 : 201).json(result); });
  router.patch('/:id', async (req,res) => { res.json({ order: await editOrder(db, req.auth!, z.uuid().parse(req.params.id), editSchema.parse(req.body)) }); });
  router.post('/:id/payments', async (req,res) => { const result = await recordPayment(db, req.auth!, z.uuid().parse(req.params.id), paymentSchema.parse(req.body)); res.status(result.replayed ? 200 : 201).json(result); });
  router.post('/:id/transitions', async (req,res) => { res.json({ order: await transitionOrder(db, req.auth!, z.uuid().parse(req.params.id), transitionSchema.parse(req.body)) }); });
  return router;
}
