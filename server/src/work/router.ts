import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db/types.js';
import { activityListSchema, activityParamsSchema, assignSchema, workOrderParamsSchema } from './schemas.js';
import { changeActivity, designerLoad, listActivities, workOrder } from './service.js';

const emptyBody = z.object({}).strict();

/** Mount after requireAuth, requirePasswordReady and requireCsrf at /api/v1. */
export function createWorkRouter(db: Database): Router {
  const router = Router();
  router.get('/activities', async (req, res) => {
    res.json(await listActivities(db, req.auth!, activityListSchema.parse(req.query)));
  });
  router.get('/designers/load', async (req, res) => {
    res.json(await designerLoad(db, req.auth!));
  });
  router.get('/orders/:orderId', async (req, res) => {
    const { orderId } = workOrderParamsSchema.parse(req.params);
    res.json(await workOrder(db, req.auth!, orderId));
  });
  router.post('/activities/:id/claim', async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    emptyBody.parse(req.body);
    res.json({ activity: await changeActivity(db, req.auth!, id, 'claim') });
  });
  router.patch('/activities/:id/assign', async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    const { assignedUserId } = assignSchema.parse(req.body);
    res.json({ activity: await changeActivity(db, req.auth!, id, 'assign', assignedUserId) });
  });
  router.post('/activities/:id/start', async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    emptyBody.parse(req.body);
    res.json({ activity: await changeActivity(db, req.auth!, id, 'start') });
  });
  router.post('/activities/:id/complete', async (req, res) => {
    const { id } = activityParamsSchema.parse(req.params);
    emptyBody.parse(req.body);
    res.json({ activity: await changeActivity(db, req.auth!, id, 'complete') });
  });
  return router;
}
