import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCheck, ClipboardList, FilterX, Plus, Trash2, Wallet } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { WorkOrder } from '../domain/types';
import { deleteOrderDraft, loadOrderDraft, ORDER_DRAFT_EVENT, type OrderFormDraft } from '../data/orderDraft';
import type { OrderDraftRecord } from '../data/api';
import { canCreate, dateOnly, financials, formatCOP, formatDate, isAdmin, STATUS_LABELS, visibleOrders } from '../domain/utils';
import { Button, Card, DataTable, DocumentBadge, EmptyState, Field, KpiCard, PageHeader, Pagination, PaymentBadge, SearchInput, WorkBadge } from '../components/ui';
import './orders.css';

type OrderTab = 'all' | 'pending' | 'production' | 'finished' | 'balance';
const completed = (order: WorkOrder) => ['COMPLETED', 'INSTALLED'].includes(order.status);
const awaitingReview = (order: WorkOrder) => ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status);

export function OrdersPage() {
  const { data, user } = useApp();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const [tab, setTab] = useState<OrderTab>(params.get('tab') === 'balance' ? 'balance' : 'all');
  const [status, setStatus] = useState(params.get('status') || '');
  const [documentType, setDocumentType] = useState(params.get('type') || '');
  const [payment, setPayment] = useState(params.get('payment') || '');
  const [from, setFrom] = useState(params.get('from') || '');
  const [to, setTo] = useState(params.get('to') || '');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<OrderDraftRecord<OrderFormDraft> | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState('');
  const admin = isAdmin(user?.role);
  const clientId = params.get('client') || params.get('clientId');
  const orders = useMemo(() => user ? visibleOrders(user, data.orders) : [], [user, data.orders]);
  const clientName = (order: WorkOrder) => data.clients.find(client => client.id === order.clientId)?.name || 'Cliente no disponible';
  const active = orders.filter(order => !completed(order));
  const balances = orders.reduce((sum, order) => sum + financials(order).balance, 0);
  const filtered = orders.filter(order => {
    const term = query.trim().toLocaleLowerCase('es');
    const matchesText = !term || `${order.number} ${String(order.number).padStart(4, '0')} ${clientName(order)} ${order.description}`.toLocaleLowerCase('es').includes(term);
    const date = dateOnly(order.createdAt);
    const tabMatch = tab === 'all'
      || (tab === 'pending' && !completed(order))
      || (tab === 'production' && ['IN_PRINTING', 'IN_WORKSHOP'].includes(order.status))
      || (tab === 'finished' && completed(order))
      || (tab === 'balance' && admin && financials(order).balance > 0);
    return matchesText && tabMatch && (!clientId || order.clientId === clientId)
      && (!status || order.status === status) && (!documentType || order.documentType === documentType)
      && (!admin || !payment || financials(order).paymentStatus === payment)
      && (!from || date >= from) && (!to || date <= to);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
  const pageSize = 8;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const tabs: { id: OrderTab; label: string; count: number }[] = [
    { id: 'all', label: 'Todas', count: orders.length },
    { id: 'pending', label: 'Trabajo pendiente', count: active.length },
    { id: 'production', label: 'En producción', count: orders.filter(order => ['IN_PRINTING', 'IN_WORKSHOP'].includes(order.status)).length },
    { id: 'finished', label: 'Terminadas', count: orders.filter(completed).length },
    ...(admin ? [{ id: 'balance' as OrderTab, label: 'Cobro pendiente', count: orders.filter(order => financials(order).balance > 0).length }] : []),
  ];
  function resetFilters() {
    setQuery(''); setTab('all'); setStatus(''); setDocumentType(''); setPayment(''); setFrom(''); setTo(''); setPage(1); setParams({});
  }
  const columns = [
    { key: 'number', label: 'OT / Fecha', render: (order: WorkOrder) => <><Link className="order-number" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link><span className="cell-subtitle">{formatDate(order.createdAt)}</span></> },
    { key: 'client', label: 'Cliente / Trabajo', render: (order: WorkOrder) => <div className="order-description-cell"><span className="cell-title">{clientName(order)}</span><span className="cell-subtitle order-ellipsis">{order.description}</span></div> },
    { key: 'type', label: 'Tipo', render: (order: WorkOrder) => <DocumentBadge type={order.documentType} /> },
    { key: 'status', label: 'Estado del trabajo', render: (order: WorkOrder) => <WorkBadge status={order.status} /> },
    ...(admin ? [
      { key: 'value', label: 'Total por cobrar', className: 'money', render: (order: WorkOrder) => <><span className="cell-title">{formatCOP(financials(order).collectible)}</span><span className="cell-subtitle">Saldo: {formatCOP(financials(order).balance)}</span></> },
      { key: 'payment', label: 'Pago', render: (order: WorkOrder) => <PaymentBadge status={financials(order).paymentStatus} /> },
    ] : []),
    { key: 'view', label: '', render: (order: WorkOrder) => <Link className="order-view-link" to={`/orders/${order.id}`} aria-label={`Ver orden ${order.number}`}><ArrowRight size={18} /></Link> },
  ];
  const selectedClient = data.clients.find(client => client.id === clientId);

  useEffect(() => {
    if (!user || !canCreate(user.role)) { setDraft(null); return; }
    let active = true;
    const load = () => void loadOrderDraft<OrderFormDraft>(user.id).then(result => {
      if (active) { setDraft(result); setDraftError(''); }
    }).catch(reason => {
      if (active) setDraftError(reason instanceof Error ? reason.message : 'No fue posible cargar el borrador.');
    });
    load();
    window.addEventListener(ORDER_DRAFT_EVENT, load);
    window.addEventListener('storage', load);
    return () => { active = false; window.removeEventListener(ORDER_DRAFT_EVENT, load); window.removeEventListener('storage', load); };
  }, [user?.id, user?.role]);

  async function removeDraft() {
    if (!user || draftBusy) return;
    setDraftBusy(true); setDraftError('');
    try { await deleteOrderDraft(user.id); setDraft(null); }
    catch (reason) { setDraftError(reason instanceof Error ? reason.message : 'No fue posible eliminar el borrador.'); }
    finally { setDraftBusy(false); }
  }

  return <div className="page-stack orders-page">
    <PageHeader eyebrow="CONTROL DE PRODUCCIÓN" title="Órdenes de trabajo" description={user?.role === 'DISENO' ? 'Consulta el avance de los trabajos que has registrado.' : 'Cada trabajo, su recorrido y su estado en un solo lugar.'} actions={canCreate(user?.role) ? <Link className="btn btn-primary" to="/orders/new"><Plus size={18} /> Nueva orden</Link> : undefined} />
    <div className="metrics-grid">
      <KpiCard label="Órdenes registradas" value={orders.length} icon={ClipboardList} meta={`${active.length} con trabajo pendiente`} tone="blue" />
      <KpiCard label="Pendientes de revisión" value={orders.filter(awaitingReview).length} icon={CheckCheck} meta="Antes de pasar a producción" tone="amber" />
      {admin ? <KpiCard label="Cartera por recaudar" value={formatCOP(balances)} icon={Wallet} meta="Saldo de las órdenes visibles" tone="orange" /> : <KpiCard label="Trabajos terminados" value={orders.filter(completed).length} icon={CheckCheck} meta="Producción completada" tone="green" />}
    </div>
    <Card className="orders-list-card">
      {draft && <section className="orders-draft" aria-label="Borrador de orden"><div className="orders-draft-copy"><span className="eyebrow">BORRADORES</span><strong>{draft.payload.products.find(product => product.description.trim())?.description || 'Orden de trabajo sin descripción'}</strong><span>{data.clients.find(item => item.id === draft.payload.clientId)?.name || 'Cliente por seleccionar'} · Guardado {formatDate(draft.updatedAt, true)}</span></div><div className="orders-draft-actions"><Link className="order-view-link" to="/orders/new" aria-label="Abrir borrador"><ArrowRight size={18} /></Link><button className="order-draft-delete" type="button" aria-label="Eliminar borrador" disabled={draftBusy} onClick={() => void removeDraft()}><Trash2 size={17} /></button></div></section>}
      {draftError && <p className="notice notice-warning orders-draft-error" role="alert">{draftError}</p>}
      <div className="order-tabs" aria-label="Filtrar órdenes por situación">
        {tabs.map(item => <button key={item.id} type="button" className={`order-tab ${tab === item.id ? 'is-active' : ''}`} aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setPage(1); }}>{item.label}<span>{item.count}</span></button>)}
      </div>
      <div className="orders-filter-area">
        <div className="orders-search-row"><SearchInput value={query} onChange={value => { setQuery(value); setPage(1); }} label="Buscar órdenes" placeholder="Buscar por OT, cliente o descripción…" /><Button variant="ghost" onClick={resetFilters}><FilterX size={17} /> Limpiar filtros</Button></div>
        <div className="orders-filter-grid">
          <Field label="Estado del trabajo" htmlFor="filter-status"><select className="select" id="filter-status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">Todos los estados</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Documento" htmlFor="filter-type"><select className="select" id="filter-type" value={documentType} onChange={event => { setDocumentType(event.target.value); setPage(1); }}><option value="">REM y FACT</option><option value="REM">Remisión · REM</option><option value="FACT">Facturación · FACT</option></select></Field>
          {admin && <Field label="Estado de pago" htmlFor="filter-payment"><select className="select" id="filter-payment" value={payment} onChange={event => { setPayment(event.target.value); setPage(1); }}><option value="">Todos los pagos</option><option value="PENDING">Sin pagos</option><option value="PARTIAL">Pago parcial</option><option value="PAID">Pagada</option></select></Field>}
          <Field label="Creada desde" htmlFor="filter-from"><input className="input" id="filter-from" type="date" value={from} max={to || undefined} onChange={event => { setFrom(event.target.value); setPage(1); }} /></Field>
          <Field label="Creada hasta" htmlFor="filter-to"><input className="input" id="filter-to" type="date" value={to} min={from || undefined} onChange={event => { setTo(event.target.value); setPage(1); }} /></Field>
        </div>
        {selectedClient && <p className="order-filter-note">Mostrando trabajos de <strong>{selectedClient.name}</strong>. <button className="link" type="button" onClick={() => { const next = new URLSearchParams(params); next.delete('client'); next.delete('clientId'); setParams(next); }}>Ver todos los clientes</button></p>}
        {from && to && from > to && <p className="order-field-error" role="alert">La fecha inicial debe ser anterior o igual a la fecha final.</p>}
      </div>
      {filtered.length ? <>
        <DataTable<WorkOrder> columns={columns} rows={pageRows} rowKey={order => order.id} renderCard={order => <article className="order-mobile-card">
          <div className="order-card-heading"><Link className="order-number" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link><DocumentBadge type={order.documentType} /></div>
          <h3>{clientName(order)}</h3><p className="muted order-ellipsis">{order.description}</p>
          <div className="order-card-badges"><WorkBadge status={order.status} />{admin && <PaymentBadge status={financials(order).paymentStatus} />}</div>
          {admin && <div className="order-card-amount"><span>Saldo pendiente</span><strong>{formatCOP(financials(order).balance)}</strong></div>}
          <div className="order-card-footer"><span className="muted">{formatDate(order.createdAt)}</span><Link className="link" to={`/orders/${order.id}`}>Ver orden <ArrowRight size={15} /></Link></div>
        </article>} />
        <Pagination page={currentPage} pageSize={pageSize} total={filtered.length} onChange={setPage} />
      </> : <EmptyState title="No hay órdenes para estos filtros" description="Prueba con otro cliente, fecha o estado del trabajo." action={<Button variant="secondary" onClick={resetFilters}>Limpiar filtros</Button>} />}
    </Card>
    <div className="order-flow-note"><ClipboardList size={22} /><div><strong>Producción y cobros, cada uno con su estado</strong><p>Una orden terminada puede conservar un saldo pendiente. Consulta cada estado por separado.</p></div></div>
  </div>;
}
