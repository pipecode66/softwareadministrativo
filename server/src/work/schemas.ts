import { z } from 'zod';

const precise = (places: number) => (value: number) => Number(value.toFixed(places)) === value;
const dimension = z.number().finite().min(0.001).max(100000)
  .refine(precise(3), 'Usa hasta tres decimales.');
const quantity = z.number().finite().min(0.001).max(999999999.999)
  .refine(precise(3), 'Usa hasta tres decimales.');
const unitValue = z.number().finite().min(0).max(999999999999.99)
  .refine(precise(2), 'Usa hasta dos decimales.');

export const materialSchema = z.object({
  material: z.enum(['Panaflex', 'V. Corte', 'V. Impresión', 'Banner']),
  length: dimension,
  width: dimension,
}).strict();

export const activitySchema = z.object({
  area: z.enum(['DESIGN', 'PRINTING', 'WORKSHOP', 'EXTERNAL']),
  assignedUserId: z.uuid().optional(),
}).strict().superRefine((activity, context) => {
  if (activity.assignedUserId && activity.area !== 'DESIGN') {
    context.addIssue({ code: 'custom', path: ['assignedUserId'], message: 'Solo las tareas de Diseño admiten diseñador asignado.' });
  }
});

export const productSchema = z.object({
  description: z.string().trim().min(1).max(10000),
  quantity,
  unitValue,
  length: dimension.optional(),
  width: dimension.optional(),
  specifications: z.string().trim().max(10000).default(''),
  materials: z.array(materialSchema).max(50).default([]),
  activities: z.array(activitySchema).max(20).default([]),
}).strict().superRefine((product, context) => {
  if ((product.length === undefined) !== (product.width === undefined)) {
    context.addIssue({ code: 'custom', path: ['length'], message: 'Indica largo y ancho juntos o deja ambos vacios.' });
  }
  const areas = product.activities.map(activity => activity.area);
  const printing = areas.indexOf('PRINTING');
  if (printing >= 0 && !product.materials.length) {
    context.addIssue({ code: 'custom', path: ['materials'], message: 'Una tarea de Impresión requiere al menos un material.' });
  }
  if (product.materials.length && printing < 0) {
    context.addIssue({ code: 'custom', path: ['activities'], message: 'Los materiales requieren una tarea de Impresión.' });
  }
  if (areas.includes('EXTERNAL') && product.materials.length) {
    context.addIssue({ code: 'custom', path: ['materials'], message: 'Un producto de trabajo Externo no usa materiales de impresión internos.' });
  }
  if (areas.includes('EXTERNAL') && (product.length !== undefined || product.width !== undefined)) {
    context.addIssue({ code: 'custom', path: ['length'], message: 'Un producto de trabajo Externo no usa medidas de producción internas.' });
  }
  if (printing >= 0 && areas.lastIndexOf('DESIGN') > printing) {
    context.addIssue({ code: 'custom', path: ['activities'], message: 'Diseño debe terminar antes de Impresión.' });
  }
  if (areas.filter(area => area === 'PRINTING').length > 1) {
    context.addIssue({ code: 'custom', path: ['activities'], message: 'Cada producto admite una sola tarea de Impresión.' });
  }
});

export const productsSchema = z.array(productSchema).min(1, 'Agrega al menos un producto.').max(100);
export type ProductInput = z.input<typeof productSchema>;
export type ParsedProduct = z.output<typeof productSchema>;

const page = z.coerce.number().int().min(1).max(1000000);
export const activityListSchema = z.object({
  orderId: z.uuid().optional(),
  area: z.enum(['DESIGN', 'PRINTING', 'WORKSHOP', 'EXTERNAL']).optional(),
  page: page.default(1),
  pageSize: page.max(100).default(50),
}).strict();
export const activityParamsSchema = z.object({ id: z.uuid() }).strict();
export const workOrderParamsSchema = z.object({ orderId: z.uuid() }).strict();
export const assignSchema = z.object({ assignedUserId: z.uuid() }).strict();
