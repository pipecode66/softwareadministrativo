export const ROLES = ['ADMINMASTER', 'ADMIN_GENERAL', 'APOYO_COMERCIAL', 'DISENO', 'IMPRESION', 'TALLER', 'INSTALADOR', 'ADMIN_INSTALADORES'] as const;
export type Role = typeof ROLES[number];

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  user: PublicUser;
  tokenHash: string;
  csrfToken: string;
}

declare global {
  namespace Express {
    interface Request { auth?: AuthSession }
  }
}
