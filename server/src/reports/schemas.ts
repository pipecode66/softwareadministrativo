import { z } from 'zod';
import { categories, dateSchema, materials } from '../orders/domain.js';

// PostgreSQL does not accept year zero, although JavaScript's ISO calendar does.
const reportDate = dateSchema.refine(value => !value.startsWith('0000-'), 'La fecha no es válida.');
const commercialFilters = {
  category: z.enum(categories).optional(),
  documentType: z.enum(['REM', 'FACT']).optional(),
};
const rangeFields = {
  from: reportDate,
  to: reportDate,
  groupBy: z.enum(['day', 'month']).default('day'),
};

function checkRange(input: { from: string; to: string }, ctx: z.RefinementCtx): void {
  if (input.from > input.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'El final del período debe ser igual o posterior al inicio.' });
  }
  const limit = new Date(`${input.from}T12:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + 10);
  if (new Date(`${input.to}T12:00:00Z`) > limit) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Consulta períodos de hasta diez años.' });
  }
}

export const salesSchema = z.object({ ...rangeFields, ...commercialFilters }).strict().superRefine(checkRange);
export const materialSchema = z.object({ ...rangeFields, material: z.enum(materials).optional() }).strict().superRefine(checkRange);
export const portfolioSchema = z.object({
  cutoff: reportDate,
  ...commercialFilters,
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000)).default(1),
  pageSize: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).default(50),
}).strict();

export type SalesQuery = z.infer<typeof salesSchema>;
export type PortfolioQuery = z.infer<typeof portfolioSchema>;
export type MaterialQuery = z.infer<typeof materialSchema>;
