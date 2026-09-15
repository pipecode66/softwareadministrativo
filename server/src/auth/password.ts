import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import { z } from 'zod';

// No trim: spaces are part of the user's password, not formatting to remove.
export const passwordSchema = z.string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(128, 'La contraseña debe tener como máximo 128 caracteres.');

export function hashPassword(password: string): Promise<string> {
  return hash(passwordSchema.parse(password), {
    type: argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must not leak implementation details to the client.
    return false;
  }
}

// Unknown accounts still perform an expensive verification to reduce enumeration.
// This is not an account or a usable default credential.
export const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'));
