import type { AppData } from '../domain/types';
import { makeSeed } from './seed';

export const STORAGE_KEY = 'intermedios.frontend.v1';
export const SESSION_KEY = 'intermedios.local-session.v1';

// Adaptador exclusivo de revisión local. Sustituir por la API en la etapa backend.
export function parseData(raw: string): AppData {
  const value = JSON.parse(raw) as AppData;
  if (value.version !== 1 || !Array.isArray(value.users) || !Array.isArray(value.clients) || !Array.isArray(value.orders)
      || value.orders.some(o => !o.id || !Array.isArray(o.payments) || !Number.isFinite(o.value))) {
    throw new Error('Los datos locales no corresponden a esta versión de Intermedios.');
  }
  return value;
}
export function readData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? parseData(raw) : makeSeed();
}
export function writeData(value: AppData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch { throw new Error('No fue posible guardar en este navegador. Revisa el espacio disponible o la configuración de almacenamiento.'); }
}
