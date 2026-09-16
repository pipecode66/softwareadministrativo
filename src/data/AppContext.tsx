import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import type { AppData, Client, OrderAction, OrderInput, User, WorkOrder } from '../domain/types';
import { createWorkOrder, editWorkOrder, recordPayment, transitionWorkOrder, validateClient } from '../domain/service';
import { isAdmin, ROLE_LABELS } from '../domain/utils';
import {
  apiAddPayment, apiChangePassword, apiCreateOrder, apiCreateUser, apiListClients, apiListOrders, apiListUsers, apiLogin, apiLogout, apiResetPassword,
  apiMaterialReport, apiPortfolioReport, apiSalesReport, apiSaveClient, apiSession, apiTransitionOrder, apiUpdateOrder, apiUpdateUser,
  ApiRequestError, forgetApiSession, usingApi,
} from './api';
import type { MaterialReport, PortfolioReport, SalesReport } from './api';
import { DEMO_PASSWORD } from './seed';
import { parseData, readData, SESSION_KEY, STORAGE_KEY, writeData } from './repository';

type ClientInput = Pick<Client, 'name' | 'identification' | 'phone'>;
export type UserInput = Pick<User, 'name' | 'email' | 'role' | 'active'> & { password?: string };
interface AppContextValue {
  data: AppData; user: User | null; accounts: User[]; sessionReady: boolean; usingApi: boolean;
  dataLoading: boolean; dataError: string; refreshData: () => Promise<void>;
  loadSalesReport: (query: Parameters<typeof apiSalesReport>[0]) => Promise<SalesReport>;
  loadPortfolioReport: (query: Parameters<typeof apiPortfolioReport>[0]) => Promise<PortfolioReport>;
  loadMaterialReport: (query: Parameters<typeof apiMaterialReport>[0]) => Promise<MaterialReport>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  createOrder: (input: OrderInput) => Promise<WorkOrder>; updateOrder: (id: string, input: OrderInput) => Promise<void>;
  addPayment: (id: string, payment: { date: string; amount: number }) => Promise<void>;
  transitionOrder: (id: string, action: OrderAction, details?: { date?: string; note?: string }) => Promise<void>;
  saveClient: (input: ClientInput, id?: string) => Promise<Client>;
  saveUser: (input: UserInput, id?: string) => Promise<User>;
  resetPassword: (id: string, password: string) => Promise<void>;
  refreshAccounts: () => Promise<void>;
  toast: (message: string, type?: 'success' | 'error') => void;
}
const AppContext = createContext<AppContextValue | null>(null);
function emptyData(): AppData { return { version: 1, users: [], clients: [], orders: [] }; }
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => usingApi ? emptyData() : readData());
  const dataRef = useRef(data);
  const [userId, setUserId] = useState(() => usingApi ? null : sessionStorage.getItem(SESSION_KEY));
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const sessionRef = useRef<User | null>(null);
  const sessionEpoch = useRef(0);
  const [accounts, setAccounts] = useState<User[]>([]);
  const [sessionReady, setSessionReady] = useState(!usingApi);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [messages, setMessages] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const localUser = data.users.find(u => u.id === userId && u.active) || null;
  const user = usingApi ? sessionUser : localUser;
  function toast(message: string, type: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.random();
    setMessages(current => [...current.slice(-2), { id, message, type }]);
    timers.current.push(setTimeout(() => setMessages(current => current.filter(item => item.id !== id)), 6000));
  }
  useEffect(() => {
    function receive(event: StorageEvent) {
      if (usingApi) return;
      if (event.key === STORAGE_KEY && event.newValue) {
        try { const next = parseData(event.newValue); dataRef.current = next; setData(next); }
        catch { toast('No se pudieron actualizar los datos de otra pestaña.', 'error'); }
      }
    }
    window.addEventListener('storage', receive);
    return () => { window.removeEventListener('storage', receive); timers.current.forEach(clearTimeout); };
  }, []);
  useEffect(() => {
    if (!usingApi) { setAccounts(data.users); return; }
    const epoch = ++sessionEpoch.current;
    (async () => {
      try {
        const current = await apiSession();
        if (epoch !== sessionEpoch.current) return;
        acceptSession(current);
      } catch (error) {
        if (epoch === sessionEpoch.current) setDataError(error instanceof Error ? error.message : 'No se pudo restaurar la sesión.');
      } finally {
        if (epoch === sessionEpoch.current) setSessionReady(true);
      }
    })();
    return () => { sessionEpoch.current += 1; };
  }, []);
  useEffect(() => {
    if (!usingApi || !sessionUser || sessionUser.mustChangePassword) return;
    void refreshData().catch(() => { /* The visible error is set by refreshData. */ });
  }, [sessionUser?.id, sessionUser?.role, sessionUser?.mustChangePassword]);
  function replaceData(next: AppData) { dataRef.current = next; setData(next); }
  function acceptSession(current: User | null) {
    if (current?.id !== sessionRef.current?.id) replaceData(emptyData());
    sessionRef.current = current;
    setSessionUser(current);
    setAccounts(current ? [current] : []);
    setDataError('');
  }
  async function remote<T>(run: () => Promise<T>): Promise<T> {
    const epoch = sessionEpoch.current;
    try { return await run(); }
    catch (error) {
      if (epoch === sessionEpoch.current && error instanceof ApiRequestError && error.status === 401) {
        sessionEpoch.current += 1; forgetApiSession(); acceptSession(null);
      }
      throw error;
    }
  }
  function requireLocalOrders() {
    if (usingApi) throw new Error('Las órdenes, pagos y etapas productivas todavía no están conectados al servidor. No se guardaron cambios locales.');
  }
  function latest() {
    if (usingApi) throw new Error('Los datos de revisión local no se utilizan en una sesión del servidor.');
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseData(raw) : dataRef.current;
  }
  function actor(current: AppData): User {
    if (usingApi) {
      if (!sessionUser?.active) throw new Error('Tu sesión ya no está disponible. Ingresa de nuevo.');
      return sessionUser;
    }
    const result = current.users.find(u => u.id === userId && u.active);
    if (!result) throw new Error('Tu sesión ya no está disponible. Ingresa de nuevo.');
    return result;
  }
  function commit(next: AppData) { writeData(next); dataRef.current = next; setData(next); }
  function modifyOrder(id: string, fn: (order: WorkOrder, current: AppData, actor: User) => WorkOrder) {
    requireLocalOrders();
    const current = latest();
    const order = current.orders.find(o => o.id === id);
    if (!order) throw new Error('No encontramos esta orden.');
    const next = fn(order, current, actor(current));
    commit({ ...current, orders: current.orders.map(o => o.id === id ? next : o) });
  }
  async function refreshAccounts() {
    if (!usingApi) { setAccounts(latest().users); return; }
    const current = sessionRef.current, epoch = sessionEpoch.current;
    if (current?.role !== 'ADMINMASTER' || current.mustChangePassword) return;
    const next = await remote(() => apiListUsers());
    if (epoch !== sessionEpoch.current) return;
    setAccounts(next);
    replaceData({ ...dataRef.current, users: next });
  }
  async function refreshData() {
    if (!usingApi) { replaceData(latest()); return; }
    const current = sessionRef.current, epoch = sessionEpoch.current;
    if (!current || current.mustChangePassword) return;
    setDataLoading(true); setDataError('');
    try {
      const [users, clients, remoteOrders] = await remote(() => Promise.all([
        current.role === 'ADMINMASTER' ? apiListUsers() : Promise.resolve([current]),
        isAdmin(current.role) || current.role === 'DISENO' ? apiListClients() : Promise.resolve([]),
        apiListOrders(),
      ]));
      if (epoch !== sessionEpoch.current) return;
      const previousOrders = dataRef.current.orders;
      const previousById = new Map(previousOrders.map(order => [order.id, order]));
      for (const order of remoteOrders.orders) {
        const previous = previousById.get(order.id);
        const enteredAdminReview = isAdmin(current.role) && (!previous || previous.status !== order.status) && order.status === 'PENDING_ADMIN_REVIEW';
        const enteredPrinting = current.role === 'IMPRESION' && (!previous || previous.status !== order.status) && order.status === 'IN_PRINTING';
        const enteredWorkshop = current.role === 'TALLER' && (!previous || previous.status !== order.status) && ['IN_WORKSHOP', 'PENDING_INSTALLATION'].includes(order.status);
        if (enteredAdminReview) toast(`Nueva OT #${String(order.number).padStart(4, '0')} pendiente de revisión.`);
        else if (enteredPrinting) toast(`La OT #${String(order.number).padStart(4, '0')} llegó a Impresión.`);
        else if (enteredWorkshop) toast(`La OT #${String(order.number).padStart(4, '0')} llegó a Taller.`);
      }
      setAccounts(users);
      const mergedClients = [...new Map([...clients, ...remoteOrders.clients].map(client => [client.id, client])).values()];
      replaceData({ ...dataRef.current, users, clients: mergedClients, orders: remoteOrders.orders });
    } catch (error) {
      if (epoch === sessionEpoch.current) setDataError(error instanceof Error ? error.message : 'No se pudieron cargar los datos del servidor.');
      throw error;
    } finally { if (epoch === sessionEpoch.current) setDataLoading(false); }
  }
  useEffect(() => {
    if (!usingApi || !sessionUser || sessionUser.mustChangePassword) return;
    const timer = window.setInterval(() => { void refreshData().catch(() => { /* Keep the current data if polling fails. */ }); }, 10000);
    return () => window.clearInterval(timer);
  }, [sessionUser?.id, sessionUser?.role, sessionUser?.mustChangePassword]);
  const value: AppContextValue = {
    data, user, accounts: usingApi ? accounts : data.users, sessionReady, usingApi, dataLoading, dataError, refreshData, refreshAccounts,
    loadSalesReport: query => remote(() => apiSalesReport(query)),
    loadPortfolioReport: query => remote(() => apiPortfolioReport(query)),
    loadMaterialReport: query => remote(() => apiMaterialReport(query)), toast,
    async login(email, password) {
      if (usingApi) {
        const epoch = ++sessionEpoch.current;
        const current = await apiLogin(email.trim(), password);
        if (epoch !== sessionEpoch.current) return;
        acceptSession(current); setSessionReady(true);
        return;
      }
      const current = latest();
      const account = current.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase() && u.active);
      if (!account || password !== DEMO_PASSWORD) throw new Error('Usuario o contraseña incorrectos. Revisa los accesos de revisión.');
      sessionStorage.setItem(SESSION_KEY, account.id);
      dataRef.current = current; setData(current); setUserId(account.id);
    },
    async logout() {
      if (usingApi) {
        // Keep the session visible and retryable unless the server confirms logout.
        await apiLogout(); sessionEpoch.current += 1; acceptSession(null); setDataLoading(false);
      } else { setUserId(null); sessionStorage.removeItem(SESSION_KEY); }
    },
    async changePassword(currentPassword, newPassword) {
      if (!usingApi) throw new Error('El cambio de contraseña corresponde a la API.');
      const epoch = sessionEpoch.current;
      const current = await remote(() => apiChangePassword(currentPassword, newPassword));
      if (epoch !== sessionEpoch.current) return;
      acceptSession(current);
    },
    async createOrder(input) {
      if (usingApi) {
        const order = await remote(() => apiCreateOrder(input, crypto.randomUUID()));
        replaceData({ ...dataRef.current, orders: [...dataRef.current.orders, order] });
        return order;
      }
      requireLocalOrders();
      const current = latest();
      const order = createWorkOrder(current, actor(current), input);
      commit({ ...current, orders: [...current.orders, order] });
      return order;
    },
    async updateOrder(id, input) {
      if (usingApi) {
        const order = dataRef.current.orders.find(item => item.id === id);
        if (!order) throw new Error('No encontramos esta orden.');
        const updated = await remote(() => apiUpdateOrder(id, input, order.version ?? 1));
        replaceData({ ...dataRef.current, orders: dataRef.current.orders.map(item => item.id === id ? updated : item) });
        return;
      }
      modifyOrder(id, (order, current, account) => editWorkOrder(current, account, order, input));
    },
    async addPayment(id, payment) {
      if (usingApi) {
        const updated = await remote(() => apiAddPayment(id, payment, crypto.randomUUID()));
        replaceData({ ...dataRef.current, orders: dataRef.current.orders.map(item => item.id === id ? updated : item) });
        return;
      }
      modifyOrder(id, (order, _current, account) => recordPayment(account, order, payment));
    },
    async transitionOrder(id, action, details) {
      if (usingApi) {
        const order = dataRef.current.orders.find(item => item.id === id);
        if (!order) throw new Error('No encontramos esta orden.');
        const updated = await remote(() => apiTransitionOrder(id, action, order.version ?? 1, details));
        replaceData({ ...dataRef.current, orders: dataRef.current.orders.map(item => item.id === id ? updated : item) });
        return;
      }
      modifyOrder(id, (order, _current, account) => transitionWorkOrder(account, order, action, details));
    },
    async saveClient(input, id) {
      if (usingApi) {
        const epoch = sessionEpoch.current;
        const client = await remote(() => apiSaveClient(input, id));
        if (epoch === sessionEpoch.current) {
          const current = dataRef.current;
          replaceData({ ...current, clients: current.clients.some(c => c.id === client.id) ? current.clients.map(c => c.id === client.id ? client : c) : [...current.clients, client] });
        }
        return client;
      }
      const current = latest();
      if (!['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO'].includes(actor(current).role)) throw new Error('Solo Administración y Diseño pueden gestionar clientes.');
      validateClient(input);
      if (id && !current.clients.some(c => c.id === id)) throw new Error('No encontramos este cliente.');
      const existing = current.clients.find(c => c.id === id);
      const client: Client = { id: id || crypto.randomUUID(), name: input.name.trim(), identification: input.identification.trim(), phone: input.phone.trim(), createdAt: existing?.createdAt || new Date().toISOString() };
      commit({ ...current, clients: id ? current.clients.map(c => c.id === id ? client : c) : [...current.clients, client] });
      return client;
    },
    async saveUser(input, id) {
      if (usingApi) {
        if (!sessionUser || sessionUser.role !== 'ADMINMASTER') throw new Error('Solo Adminmaster puede gestionar usuarios.');
        const epoch = sessionEpoch.current;
        const payload = { name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, active: input.active };
        const saved = await remote(() => id ? apiUpdateUser(id, payload) : apiCreateUser({ ...payload, password: input.password || '' }));
        if (epoch !== sessionEpoch.current) return saved;
        const next = accounts.some(u => u.id === saved.id) ? accounts.map(u => u.id === saved.id ? saved : u) : [...accounts, saved];
        setAccounts(next); replaceData({ ...dataRef.current, users: next });
        if (saved.id === sessionRef.current?.id) { sessionRef.current = saved; setSessionUser(saved); }
        return saved;
      }
      const current = latest();
      const account = actor(current);
      if (account.role !== 'ADMINMASTER') throw new Error('Solo Adminmaster puede gestionar usuarios.');
      if (!input.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || !(input.role in ROLE_LABELS)) throw new Error('Completa nombre, correo y perfil válidos.');
      if (id && !current.users.some(u => u.id === id)) throw new Error('No encontramos este usuario.');
      if (current.users.some(u => u.email.toLowerCase() === input.email.trim().toLowerCase() && u.id !== id)) throw new Error('Este correo ya está registrado.');
      if (input.active && current.users.filter(u => u.active && u.id !== id).length >= 15) throw new Error('La empresa puede tener hasta 15 usuarios activos.');
      if (id === account.id && (!input.active || input.role !== 'ADMINMASTER')) throw new Error('No puedes desactivar tu propio acceso ni cambiar tu perfil.');
      const next: User = { id: id || crypto.randomUUID(), name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, active: input.active };
      commit({ ...current, users: id ? current.users.map(u => u.id === id ? next : u) : [...current.users, next] });
      return next;
    },
    async resetPassword(id, password) {
      if (!usingApi) throw new Error('El restablecimiento de contraseña corresponde a la API.');
      if (id === sessionRef.current?.id) throw new Error('Utiliza Cambiar contraseña para actualizar tu propio acceso.');
      await remote(() => apiResetPassword(id, password));
      setAccounts(current => current.map(account => account.id === id ? { ...account, mustChangePassword: true } : account));
    },
  };
  return <AppContext.Provider value={value}>{children}<div className="toast-stack" aria-live="polite" aria-relevant="additions">{messages.map(item => <div className={`toast toast-${item.type}`} key={item.id} role={item.type === 'error' ? 'alert' : 'status'}>{item.type === 'error' ? <CircleAlert size={20} /> : <CheckCircle2 size={20} />}<span>{item.message}</span><button aria-label="Cerrar mensaje" onClick={() => setMessages(all => all.filter(x => x.id !== item.id))}><X size={16} /></button></div>)}</div></AppContext.Provider>;
}
export function useApp() { const context = useContext(AppContext); if (!context) throw new Error('Falta el contexto del aplicativo.'); return context; }
