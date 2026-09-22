import { z } from 'zod';

const precise = (places: number) => (value: number) => Number(value.toFixed(places)) === value;
const dimension = z.number().finite().min(0.001).max(100000)
  .refine(precise(3), 'Usa hasta tres decimales.');
const quantity = z.number().int().min(1).max(999999999);
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
  printingType: z.enum(['PRINT', 'LASER']).optional(),
}).strict().superRefine((activity, context) => {
  if (activity.assignedUserId && activity.area !== 'DESIGN') {
    context.addIssue({ code: 'custom', path: ['assignedUserId'], message: 'Solo las tareas de Diseño admiten diseñador asignado.' });
  }
  if (activity.area !== 'PRINTING' && activity.printingType) {
    context.addIssue({ code: 'custom', path: ['printingType'], message: 'El tipo de impresión solo corresponde al área de Impresión.' });
  }
});

export const productSchema = z.object({
  description: z.string().trim().min(1).max(10000),
  quantity,
  unitValue,
  materials: z.array(materialSchema).max(50).default([]),
  activities: z.array(activitySchema).max(20).default([]),
}).strict().superRefine((product, context) => {
  const areas = product.activities.map(activity => activity.area);
  const printing = areas.indexOf('PRINTING');
  const printingActivity = product.activities.find(activity => activity.area === 'PRINTING');
  const printingType = printingActivity?.printingType ?? 'PRINT';
  if (product.materials.length && printing < 0) {
    context.addIssue({ code: 'custom', path: ['activities'], message: 'Los materiales requieren una tarea de Impresión.' });
  }
  if (printing >= 0 && printingType === 'LASER' && product.materials.length) {
    context.addIssue({ code: 'custom', path: ['materials'], message: 'Corte Láser no usa materiales de impresión.' });
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
export const laserMinutesSchema = z.object({
  minutes: z.number().int().min(1).max(999999999),
}).strict();
export const designDetailsSchema = z.object({
  description: z.string().trim().min(1).max(10000).optional(),
  materials: z.array(materialSchema).max(50).optional(),
}).strict().refine(value => value.description !== undefined || value.materials !== undefined,
  'Indica la descripción o los materiales que deseas actualizar.');
