import { Router } from 'express';
import type { Database } from '../db/types.js';
import { ApiError } from '../errors.js';
import { createInstallationSchema, evidenceParamsSchema, installationActionSchema, installationEvidenceSchema,
  installationListSchema, installationParamsSchema } from './schemas.js';
import { createTeamSchema, updateTeamSchema } from './schemas.js';
import { changeInstallation, createInstallation, getInstallation, getInstallationEvidence,
  listInstallations, saveInstallationEvidence, listInstallationTeams, saveInstallationTeam } from './service.js';

/** Mount after session, password-change and CSRF enforcement. */
export function createInstallationsRouter(db:Database):Router {
  const router=Router();
  router.use((req,_res,next)=>{
    if(!req.auth || !['ADMINMASTER','ADMIN_GENERAL','INSTALADOR'].includes(req.auth.user.role)) {
      throw new ApiError(403,'FORBIDDEN','Tu perfil no tiene acceso al módulo Instalaciones.');
    }
    next();
  });
  router.get('/',async(req,res)=>{res.json(await listInstallations(db,req.auth!,installationListSchema.parse(req.query)));});
  router.get('/teams',async(req,res)=>{res.json(await listInstallationTeams(db,req.auth!));});
  router.post('/teams',async(req,res)=>{
    const result=await saveInstallationTeam(db,req.auth!,null,createTeamSchema.parse(req.body));
    res.status(result.replayed?200:201).json(result);
  });
  router.patch('/teams/:id',async(req,res)=>{
    const {id}=installationParamsSchema.parse(req.params);
    res.json(await saveInstallationTeam(db,req.auth!,id,updateTeamSchema.parse(req.body)));
  });
  router.post('/',async(req,res)=>{
    const result=await createInstallation(db,req.auth!,createInstallationSchema.parse(req.body));
    res.status(result.replayed?200:201).json(result);
  });
  router.get('/:id',async(req,res)=>{
    const {id}=installationParamsSchema.parse(req.params);res.json(await getInstallation(db,req.auth!,id));
  });
  router.post('/:id/actions',async(req,res)=>{
    const {id}=installationParamsSchema.parse(req.params);
    res.json(await changeInstallation(db,req.auth!,id,installationActionSchema.parse(req.body)));
  });
  router.post('/:id/evidence',async(req,res)=>{
    const {id}=installationParamsSchema.parse(req.params);
    const result=await saveInstallationEvidence(db,req.auth!,id,installationEvidenceSchema.parse(req.body));
    res.status(result.replayed?200:201).json(result);
  });
  router.get('/:id/evidence/:evidenceId',async(req,res)=>{
    const {id,evidenceId}=evidenceParamsSchema.parse(req.params);
    const bytes=await getInstallationEvidence(db,req.auth!,id,evidenceId);
    res.set({'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Disposition':'inline; filename="evidencia-instalacion.jpg"'}).send(bytes);
  });
  return router;
}
