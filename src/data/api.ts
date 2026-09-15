import type { Client, OrderAction, OrderInput, Role, User, WorkOrder } from '../domain/types';

export const usingApi = import.meta.env.VITE_USE_API !== 'false';
const API = '/api/v1';

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface SessionUser extends User {
  mustChangePassword: boolean;
}

interface ErrorPayload { code?: string; message?: string; field?: string }
interface SessionResponse { user: SessionUser; csrfToken: string }
interface UserResponse { user: SessionUser }
interface UsersListResponse { items: SessionUser[]; page: number; pageSize: number; total: number }

let csrfToken = '';
let sessionRevision = 0;

export function forgetApiSession(): void { sessionRevision += 1; csrfToken = ''; }

function asUser(value: SessionUser): SessionUser {
  return {
    id: value.id, name: value.name, email: value.email, role: value.role, active: value.active,
    mustChangePassword: Boolean(value.mustChangePassword),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (csrfToken && method !== 'GET' && method !== 'HEAD') headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, method, credentials: 'include', headers });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'No hay conexión con el servidor. Comprueba que la API esté en marcha.');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try { body = JSON.parse(text) as Record<string, unknown>; }
    catch { throw new ApiRequestError(response.status, 'INVALID_RESPONSE', 'El servidor devolvió una respuesta ilegible.'); }
  }
  if (!response.ok) {
    const error = (body.error ?? body) as ErrorPayload;
    throw new ApiRequestError(response.status, error.code || 'REQUEST_FAILED', error.message || 'No se pudo completar la solicitud.', error.field);
  }
  return body as T;
}

export async function apiLogin(email: string, password: string): Promise<SessionUser> {
  const revision = ++sessionRevision;
  const body = await request<SessionResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (revision === sessionRevision) csrfToken = body.csrfToken;
  return asUser(body.user);
}

export async function apiSession(): Promise<SessionUser | null> {
  const revision = sessionRevision;
  try {
    const body = await request<SessionResponse>('/auth/session');
    if (revision === sessionRevision) csrfToken = body.csrfToken;
    return asUser(body.user);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      if (revision === sessionRevision) csrfToken = '';
      return null;
    }
    throw error;
  }
}

export async function apiLogout(): Promise<void> {
  const revision = ++sessionRevision;
  try { await request<void>('/auth/logout', { method: 'POST', body: '{}' }); }
  catch (error) {
    // An expired/revoked session is already signed out; network failures are not.
    if (!(error instanceof ApiRequestError && error.status === 401)) throw error;
  }
  if (revision === sessionRevision) csrfToken = '';
}

export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<SessionUser> {
  const revision = ++sessionRevision;
  const body = await request<SessionResponse>('/auth/password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (revision === sessionRevision) csrfToken = body.csrfToken;
  return asUser(body.user);
}

export async function apiListUsers(query = ''): Promise<SessionUser[]> {
  const items: SessionUser[] = [];
  let total = 1;
  for (let page = 1; (page - 1) * 100 < total; page++) {
    const params = new URLSearchParams({ page: String(page), pageSize: '100' });
    if (query.trim()) params.set('q', query.trim());
    const body = await request<UsersListResponse>(`/users?${params}`);
    items.push(...body.items.map(asUser));
    total = body.total;
    if (!body.items.length) break;
  }
  return [...new Map(items.map(item => [item.id, item])).values()];
}

export async function apiCreateUser(input: { name: string; email: string; role: Role; active: boolean; password: string }): Promise<SessionUser> {
  const body = await request<UserResponse>('/users', { method: 'POST', body: JSON.stringify(input) });
  return asUser(body.user);
}

export async function apiUpdateUser(id: string, input: { name?: string; email?: string; role?: Role; active?: boolean }): Promise<SessionUser> {
  const body = await request<UserResponse>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  return asUser(body.user);
}

export async function apiResetPassword(id: string, password: string): Promise<void> {
  await request<void>(`/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
}

export async function apiListClients(): Promise<Client[]> {
  const items: Client[] = [];
  let total = 1;
  for (let page = 1; (page - 1) * 100 < total; page++) {
    const body = await request<{ items: Client[]; total: number }>(`/clients?page=${page}&pageSize=100`);
    items.push(...body.items);
    total = body.total;
    if (!body.items.length) break;
  }
  return [...new Map(items.map(item => [item.id, item])).values()];
}

export async function apiSaveClient(input: Pick<Client, 'name' | 'identification' | 'phone'>, id?: string): Promise<Client> {
  const body = await request<{ client: Client }>(id ? `/clients/${encodeURIComponent(id)}` : '/clients', {
    method: id ? 'PATCH' : 'POST', body: JSON.stringify(input),
  });
  return body.client;
}

type RestrictedOrder = Omit<WorkOrder, 'value' | 'reteFuente' | 'reteIva' | 'ica' | 'payments'> & Partial<Pick<WorkOrder, 'value' | 'reteFuente' | 'reteIva' | 'ica' | 'payments'>>;
function asOrder(order: RestrictedOrder): WorkOrder {
  // Production roles never receive financial data. Zero defaults only support
  // the existing shared UI model; those roles must not display financial views.
  return { ...order, value: order.value ?? 0, reteFuente: order.reteFuente ?? 0, reteIva: order.reteIva ?? 0, ica: order.ica ?? 0, payments: order.payments ?? [] };
}
function orderFields(input: OrderInput) {
  return { clientId: input.clientId, description: input.description, value: input.value,
    documentType: input.documentType, category: input.category, route: input.route,
    requiresInstallation: input.requiresInstallation, printing: input.printing,
    reteFuente: input.reteFuente, reteIva: input.reteIva, ica: input.ica };
}
export async function apiListOrders(): Promise<{ orders: WorkOrder[]; clients: Client[] }> {
  const items: WorkOrder[] = [], clients: Client[] = [];
  let total = 1;
  for (let page = 1; (page - 1) * 100 < total; page++) {
    const body = await request<{ items: RestrictedOrder[]; clients: Client[]; total: number }>(`/orders?page=${page}&pageSize=100`);
    items.push(...body.items.map(asOrder)); clients.push(...body.clients);
    total = body.total;
    if (!body.items.length) break;
  }
  return { orders: [...new Map(items.map(item => [item.id, item])).values()], clients: [...new Map(clients.map(item => [item.id, item])).values()] };
}
export async function apiCreateOrder(input: OrderInput, requestId: string): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>('/orders', { method: 'POST', body: JSON.stringify({ ...orderFields(input), requestId }) });
  return asOrder(body.order);
}
export async function apiUpdateOrder(id: string, input: OrderInput, expectedVersion: number): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>(`/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...orderFields(input), expectedVersion }) });
  return asOrder(body.order);
}
export async function apiAddPayment(id: string, payment: { date: string; amount: number }, requestId: string): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>(`/orders/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify({ ...payment, requestId }) });
  return asOrder(body.order);
}
export async function apiTransitionOrder(id: string, action: OrderAction, expectedVersion: number, details?: { date?: string; note?: string }): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>(`/orders/${encodeURIComponent(id)}/transitions`, { method: 'POST', body: JSON.stringify({ action, expectedVersion, ...details }) });
  return asOrder(body.order);
}

export interface SalesReport {
  from: string; to: string; groupBy: 'day' | 'month';
  totals: { count: number; base: number; iva: number; factGross: number; retentions: number; collectible: number; received: number; balance: number };
  categories: Array<{ category: string; count: number; base: number; iva: number; factGross: number; retentions: number; collectible: number; received: number; balance: number }>;
  documents: Array<{ documentType: 'REM' | 'FACT'; count: number; base: number; iva: number; gross: number; retentions: number; collectible: number }>;
  timeline: Array<{ period: string; count: number; base: number; iva: number; factGross: number; retentions: number; collectible: number; received: number }>;
}
export interface PortfolioReport {
  cutoff: string; page: number; pageSize: number; total: number; totalBalance: number; totalPaid: number; totalCollectible: number;
  clients: Array<{ clientId: string; clientName: string; count: number; balance: number; paid: number; collectible: number }>;
  items: Array<{ order: { id: string; number: number; clientId: string; status: string; createdAt: string; closedAt?: string }; clientName: string; balance: number; paid: number; collectible: number }>;
}
export interface MaterialReport {
  from: string; to: string; groupBy: 'day' | 'month'; totalOrders: number; totalM2: number;
  materials: Array<{ material: string; count: number; m2: number }>;
  timeline: Array<{ period: string; count: number; m2: number }>;
}
function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  return params.toString();
}
export function apiSalesReport(query: { from: string; to: string; groupBy?: 'day' | 'month'; category?: string; documentType?: 'REM' | 'FACT' }): Promise<SalesReport> {
  return request<SalesReport>(`/reports/sales?${queryString(query)}`);
}
export function apiPortfolioReport(query: { cutoff: string; page?: number; pageSize?: number; category?: string; documentType?: 'REM' | 'FACT' }): Promise<PortfolioReport> {
  return request<PortfolioReport>(`/reports/portfolio?${queryString(query)}`);
}
export function apiMaterialReport(query: { from: string; to: string; groupBy?: 'day' | 'month'; material?: string }): Promise<MaterialReport> {
  return request<MaterialReport>(`/reports/materials?${queryString(query)}`);
}
