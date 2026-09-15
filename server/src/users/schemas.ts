import { z } from 'zod';
import { passwordSchema } from '../auth/password.js';
import { ROLES } from '../contracts.js';

const nameSchema = z.string().trim().min(1, 'Escribe el nombre.').max(120);
const emailSchema = z.string().trim().toLowerCase().max(160).email('Escribe un correo válido.');

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(ROLES),
  active: z.boolean(),
  password: passwordSchema,
}).strict();

export const updateUserSchema = createUserSchema.omit({ password: true }).partial().strict()
  .refine(value => Object.keys(value).length > 0, 'Indica al menos un campo para actualizar.');

export const resetPasswordSchema = z.object({ password: passwordSchema }).strict();
export const userParamsSchema = z.object({ id: z.string().uuid() }).strict();

const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000));
const pageSize = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100));

export const listUsersSchema = z.object({
  page: pageNumber.default(1),
  pageSize: pageSize.default(25),
  q: z.string().trim().max(160).default(''),
}).strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
