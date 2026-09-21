import { z } from 'zod';

const clientFields = {
  name: z.string().trim().min(1, 'Escribe el nombre del cliente.').max(180),
  identification: z.string().trim().max(60),
  phone: z.string().trim().min(1, 'Escribe el celular del cliente.').max(40),
  specialPayment: z.boolean(),
};

export const createClientSchema = z.object({
  ...clientFields,
  identification: clientFields.identification.default(''),
  specialPayment: clientFields.specialPayment.default(false),
}).strict();

export const updateClientSchema = z.object(clientFields).partial().strict()
  .refine(input => Object.keys(input).length > 0, 'Indica al menos un campo para actualizar.');

export const clientParamsSchema = z.object({ id: z.string().uuid() }).strict();

const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000));
const pageSize = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100));

export const listClientsSchema = z.object({
  page: pageNumber.default(1),
  pageSize: pageSize.default(25),
  q: z.string().trim().max(180).default(''),
}).strict();

export const listClientOrdersSchema = z.object({
  page: pageNumber.default(1),
  pageSize: pageSize.default(25),
}).strict();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsInput = z.infer<typeof listClientsSchema>;
export type ListClientOrdersInput = z.infer<typeof listClientOrdersSchema>;
