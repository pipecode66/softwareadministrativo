import { z } from 'zod';

export const installationStatuses = ['PENDING','ASSIGNED','IN_PROGRESS','PAUSED','POSTPONED','COMPLETED'] as const;
const instant = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(1, 'Escribe el motivo.').max(2000);
const common = { requestId: z.uuid(), version: z.number().int().positive() };
const memberIds = z.array(z.uuid()).min(1).max(15).refine(ids=>new Set(ids).size===ids.length,'No repitas instaladores.');
const assignment={installerId:z.uuid().optional(),installerIds:memberIds.optional(),teamId:z.uuid().optional()};
export const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100000),
  capturedAt: instant,
}).strict();
export const installationListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum([...installationStatuses,'CHECKED_OUT']).optional(), installerId: z.uuid().optional(),
  q: z.string().trim().max(200).default(''),
}).strict();
export const createInstallationSchema = z.object({
  requestId: z.uuid(), orderId: z.uuid(), ...assignment,
  scheduledStartAt: instant, scheduledEndAt: instant,
  address: z.string().trim().min(1, 'Escribe la dirección de instalación.').max(1000),
  contactName: z.string().trim().max(120).default(''),
  contactPhone: z.string().trim().max(80).default(''),
  instructions: z.string().trim().max(4000).default(''),
}).strict().refine(input => new Date(input.scheduledEndAt) > new Date(input.scheduledStartAt), {
  message: 'La finalización programada debe ser posterior al inicio.', path: ['scheduledEndAt'],
});
export const installationActionSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('assign'), ...assignment, reason }).strict(),
  z.object({ ...common, action: z.literal('reschedule'), scheduledStartAt: instant, scheduledEndAt: instant, reason }).strict(),
  z.object({ ...common, action: z.literal('arrive'), location: locationSchema.optional() }).strict(),
  z.object({ ...common, action: z.literal('pause'), kind: z.enum(['REST','LUNCH']), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ ...common, action: z.literal('resume') }).strict(),
  z.object({ ...common, action: z.literal('checkout'), location:locationSchema.optional(), note:z.string().trim().max(2000).optional() }).strict(),
  z.object({ ...common, action: z.literal('postpone'), reason }).strict(),
  z.object({ ...common, action: z.literal('complete'), location: locationSchema.optional(),
    result: z.string().trim().min(1, 'Describe el resultado de la instalación.').max(4000), photoId: z.uuid(),
    absentMembersReason:z.string().trim().min(1).max(2000).optional(),
    checklist: z.object({ mounted: z.literal(true), electrical: z.enum(['VERIFIED','NOT_APPLICABLE']) }).strict(),
  }).strict(),
  z.object({ ...common, action: z.literal('note'), note: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ ...common, action: z.literal('authorize-location-exception'), reason }).strict(),
]);
export const installationEvidenceSchema = z.object({ ...common,
  imageBase64: z.string().min(8).max(218456, 'La foto supera 160 KiB. Redúcela antes de guardarla.'),
}).strict();
export const installationParamsSchema = z.object({ id: z.uuid() }).strict();
export const evidenceParamsSchema = z.object({ id: z.uuid(), evidenceId: z.uuid() }).strict();
export const createTeamSchema=z.object({requestId:z.uuid(),name:z.string().trim().min(1).max(120),
  memberIds,leaderId:z.uuid(),active:z.boolean().default(true)}).strict()
  .refine(input=>input.memberIds.includes(input.leaderId),{message:'El responsable debe pertenecer al equipo.',path:['leaderId']});
export const updateTeamSchema=z.object({...common,name:z.string().trim().min(1).max(120).optional(),
  memberIds:memberIds.optional(),leaderId:z.uuid().optional(),active:z.boolean().optional()}).strict()
  .refine(input=>input.name!==undefined||input.memberIds!==undefined||input.leaderId!==undefined||input.active!==undefined,'Indica al menos un cambio.');
export type InstallationActionInput = z.infer<typeof installationActionSchema>;
