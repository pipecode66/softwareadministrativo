import type { Client, OrderAction, OrderActivity, OrderInput, OrderProduct, OrderProductInput, PaymentMethod, ProductMaterial, Role, User, WorkOrder } from '../domain/types';

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

export async function apiSaveClient(input: Pick<Client, 'name' | 'identification' | 'phone' | 'specialPayment'>, id?: string): Promise<Client> {
  const body = await request<{ client: Client }>(id ? `/clients/${encodeURIComponent(id)}` : '/clients', {
    method: id ? 'PATCH' : 'POST', body: JSON.stringify(input),
  });
  return body.client;
}

type RestrictedOrder = Omit<WorkOrder, 'value' | 'reteFuente' | 'reteIva' | 'ica' | 'payments'> & Partial<Pick<WorkOrder, 'value' | 'reteFuente' | 'reteIva' | 'ica' | 'payments'>>;
function asOrder(order: RestrictedOrder): WorkOrder {
  // Production roles never receive financial data. Zero defaults only support
  // the existing shared UI model; those roles must not display financial views.
  return { ...order, serverVisible: true, value: order.value ?? 0, reteFuente: order.reteFuente ?? 0, reteIva: order.reteIva ?? 0, ica: order.ica ?? 0, payments: order.payments ?? [] };
}
function orderFields(input: OrderInput) {
  return { clientId: input.clientId, description: input.description, value: input.value,
    documentType: input.documentType, category: input.category, route: input.route,
    requiresInstallation: input.requiresInstallation, printing: input.printing,
    reteFuente: input.reteFuente, reteIva: input.reteIva, ica: input.ica };
}
function productFields(products: OrderProductInput[] | undefined) {
  return products?.map(product => ({ description: product.description, quantity: product.quantity,
    unitValue: product.unitValue,
    materials: product.materials.map(material => ({ material: material.material, length: material.length, width: material.width })),
    activities: product.activities.map(activity => ({ area: activity.area,
      ...(activity.area === 'PRINTING' ? { printingType: activity.printingType ?? 'PRINT' } : {}),
      ...(activity.assignedUserId ? { assignedUserId: activity.assignedUserId } : {}) })),
  }));
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
export interface ClientOrderHistoryPage {
  items: WorkOrder[]; page: number; pageSize: number; hasMore: boolean;
  total?: number;
  summary?: { orders: number; received: number; balance: number };
}
export async function apiClientOrderHistory(clientId: string, page = 1, pageSize = 100): Promise<ClientOrderHistoryPage> {
  const body = await request<Omit<ClientOrderHistoryPage, 'items'> & { items: RestrictedOrder[] }>(
    `/clients/${encodeURIComponent(clientId)}/orders?${queryString({ page, pageSize })}`,
  );
  return { ...body, items: body.items.map(asOrder) };
}
export async function apiCreateOrder(input: OrderInput, requestId: string): Promise<WorkOrder> {
  const { reteFuente: _reteFuente, reteIva: _reteIva, ica: _ica, ...fields } = orderFields(input);
  const retentions = input.documentType === 'FACT' && (input.reteFuente || input.reteIva || input.ica)
    ? { reteFuente: input.reteFuente, reteIva: input.reteIva, ica: input.ica } : {};
  const body = await request<{ order: RestrictedOrder }>('/orders', { method: 'POST', body: JSON.stringify({ ...fields,
    ...retentions, ...(input.initialPayment ? { initialPayment: input.initialPayment } : {}),
    ...(input.products ? { products: productFields(input.products) } : {}), requestId }) });
  return asOrder(body.order);
}
export async function apiUpdateOrder(id: string, input: OrderInput, expectedVersion: number): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>(`/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...orderFields(input),
    ...(input.products ? { products: productFields(input.products) } : {}), expectedVersion }) });
  return asOrder(body.order);
}
export type NewPayment = { date: string; amount: number; method: Exclude<PaymentMethod, 'LEGACY'> };
export async function apiAddPayment(id: string, payment: NewPayment, requestId: string): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>(`/orders/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify({ ...payment, requestId }) });
  return asOrder(body.order);
}
export interface BulkPaymentResult { batchId: string; clientId: string; amount: number; allocations: Array<{ orderId: string; amount: number }>; remaining: number; replayed: boolean }
export function apiBulkPayment(input: { clientId: string; selectedOrderIds: string[] } & NewPayment, requestId: string): Promise<BulkPaymentResult> {
  return request<BulkPaymentResult>('/orders/bulk-payments', { method: 'POST', body: JSON.stringify({ ...input, requestId }) });
}
export async function apiTransitionOrder(id: string, action: OrderAction, expectedVersion: number, details?: { date?: string; note?: string }): Promise<WorkOrder> {
  const body = await request<{ order: RestrictedOrder }>(`/orders/${encodeURIComponent(id)}/transitions`, { method: 'POST', body: JSON.stringify({ action, expectedVersion, ...details }) });
  return asOrder(body.order);
}
export function apiWorkOrder(id: string): Promise<{ products: OrderProduct[] }> {
  return request<{ products: OrderProduct[] }>(`/work/orders/${encodeURIComponent(id)}`);
}
export function apiListActivities(query: { orderId?: string; area?: import('../domain/types').WorkArea; page?: number; pageSize?: number } = {}) {
  return request<{ items: OrderActivity[]; page: number; pageSize: number; total: number }>(`/work/activities?${queryString(query)}`);
}
export function apiDesignerLoad() {
  return request<{ items: Array<{ id: string; name: string; pending: number; inProgress: number; total: number }>; unassigned: number }>('/work/designers/load');
}
export function apiChangeActivity(id: string, action: 'claim' | 'start' | 'complete' | 'assign', assignedUserId?: string) {
  return request<{ activity: OrderActivity }>(`/work/activities/${encodeURIComponent(id)}/${action}`, {
    method: action === 'assign' ? 'PATCH' : 'POST', body: JSON.stringify(assignedUserId ? { assignedUserId } : {}),
  }).then(result => result.activity);
}

export interface OrderDraftRecord<T = unknown> { payload: T; createdAt: string; updatedAt: string }
export function apiOrderDraft<T = unknown>(): Promise<{ draft: OrderDraftRecord<T> | null }> {
  return request<{ draft: OrderDraftRecord<T> | null }>('/orders/draft');
}
export function apiSaveOrderDraft<T>(payload: T): Promise<{ draft: OrderDraftRecord<T> }> {
  return request<{ draft: OrderDraftRecord<T> }>('/orders/draft', { method: 'PUT', body: JSON.stringify({ payload }) });
}
export function apiDeleteOrderDraft(): Promise<void> {
  return request<void>('/orders/draft', { method: 'DELETE' });
}
export function apiSaveLaserMinutes(id: string, minutes: number): Promise<OrderActivity> {
  return request<{ activity: OrderActivity }>(`/work/activities/${encodeURIComponent(id)}/laser`, {
    method: 'PATCH', body: JSON.stringify({ minutes }),
  }).then(result => result.activity);
}
export function apiUpdateDesignDetails(id: string, input: { description?: string; materials?: Array<Pick<ProductMaterial, 'material' | 'length' | 'width'>> }): Promise<OrderActivity> {
  return request<{ activity: OrderActivity }>(`/work/activities/${encodeURIComponent(id)}/design-details`, {
    method: 'PATCH', body: JSON.stringify(input),
  }).then(result => result.activity);
}

export interface SalesReport {
  from: string; to: string; groupBy: 'day' | 'month';
  totals: { count: number; base: number; factBase: number; iva: number; factGross: number; reteFuente: number; reteIva: number; ica: number; retentions: number; collectible: number; collectibleWithoutIva: number; received: number; balance: number; balanceWithIva: number; balanceWithoutIva: number; ivaDue: number };
  categories: Array<{ category: string; count: number; base: number; factBase: number; iva: number; factGross: number; reteFuente: number; reteIva: number; ica: number; retentions: number; collectible: number; received: number; balance: number; balanceWithoutIva: number; ivaDue: number }>;
  documents: Array<{ documentType: 'REM' | 'FACT'; count: number; base: number; factBase: number; iva: number; gross: number; reteFuente: number; reteIva: number; ica: number; retentions: number; collectible: number }>;
  timeline: Array<{ period: string; count: number; base: number; factBase: number; iva: number; factGross: number; reteFuente: number; reteIva: number; ica: number; retentions: number; collectible: number; received: number }>;
}
export interface PortfolioReport {
  cutoff: string; page: number; pageSize: number; total: number; totalBalance: number; totalBalanceWithIva: number; totalBalanceWithoutIva: number; ivaDue: number; totalPaid: number; totalCollectible: number; totalCollectibleWithoutIva: number;
  certificates: { statusAsOf: 'current'; reteFuente: number; reteIva: number; ica: number };
  clients: Array<{ clientId: string; clientName: string; count: number; balance: number; balanceWithoutIva: number; ivaDue: number; paid: number; collectible: number; collectibleWithoutIva: number }>;
  items: Array<{ order: { id: string; number: number; clientId: string; status: string; createdAt: string; closedAt?: string; documentType: 'REM' | 'FACT'; financialRule: 'LEGACY' | 'NEW' }; clientName: string; balance: number; balanceWithoutIva: number; ivaDue: number; paid: number; collectible: number; collectibleWithoutIva: number; iva: number; reteFuente: number; reteIva: number; ica: number; pendingReteFuente: number; pendingReteIva: number; pendingIca: number; certificates: { reteFuente: boolean; reteIva: boolean; ica: boolean } }>;
}
export interface CertificateReport {
  cutoff: string; certificateStatusAsOf: 'current'; page: number; pageSize: number; total: number;
  pendingReteFuente: number; pendingReteIva: number; pendingIca: number;
  items: Array<{ orderId: string; number: number; clientId: string; clientName: string; documentType: 'FACT'; financialRule: 'LEGACY' | 'NEW'; createdAt: string; version: number; reteFuente: number; reteIva: number; ica: number; pendingReteFuente: number; pendingReteIva: number; pendingIca: number; iva: number; collectible: number; collectibleWithoutIva: number; paid: number; balance: number; balanceWithoutIva: number; certificates: { reteFuente: boolean; reteIva: boolean; ica: boolean } }>;
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
export function apiCertificateReport(query: { cutoff: string; page?: number; pageSize?: number }): Promise<CertificateReport> {
  return request<CertificateReport>(`/reports/certificates?${queryString(query)}`);
}
export function apiSetCertificates(input: { orderId: string; expectedVersion: number; certificates: { reteFuente: boolean; reteIva: boolean; ica: boolean } }): Promise<{ orderId: string; version: number; certificates: { reteFuente: boolean; reteIva: boolean; ica: boolean } }> {
  return request('/reports/certificates', { method: 'POST', body: JSON.stringify(input) });
}
export function apiMaterialReport(query: { from: string; to: string; groupBy?: 'day' | 'month'; material?: string }): Promise<MaterialReport> {
  return request<MaterialReport>(`/reports/materials?${queryString(query)}`);
}
