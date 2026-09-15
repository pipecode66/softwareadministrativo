import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, ClipboardCheck, Clock3, Hammer, MapPin, Plus, Printer, Ruler, Workflow } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { OrderAction, Role, WorkOrder } from '../domain/types';
import { areaOf, dateOnly, formatDate, formatMeasure, formatNumber, isAdmin, normalize, ROUTE_LABELS, today, visibleOrders } from '../domain/utils';
import { Button, Card, DataTable, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, SearchInput, WorkBadge } from '../components/ui';
import './operations.css';

export type QueueDepartment = 'DISENO' | 'IMPRESION' | 'TALLER';

export function workflowAction(order: WorkOrder, role?: Role): { action: OrderAction; label: string } | null {
  const admin = isAdmin(role);
  if ((order.status === 'NEW' || order.status === 'PENDING_ADMIN_REVIEW') && admin) return { action: 'send', label: 'Aprobar y enviar' };
  if (order.status === 'IN_PRINTING' && (admin || role === 'IMPRESION')) return { action: 'finishPrinting', label: 'Finalizar impresión' };
  if (order.status === 'IN_WORKSHOP' && (admin || role === 'TALLER')) return order.workshopStartedAt ? { action: 'finishWorkshop', label: 'Finalizar taller' } : { action: 'startWorkshop', label: 'Iniciar taller' };
  if (order.status === 'PENDING_INSTALLATION' && (admin || role === 'TALLER')) return { action: 'install', label: 'Registrar instalación' };
  return null;
}

function actionDescription(order: WorkOrder, action: OrderAction) {
  if (action === 'send') return order.route === 'WORKSHOP_ONLY' ? 'La orden aprobada pasará a la bandeja de Taller.' : 'La orden aprobada pasará a la bandeja de Impresión.';
  if (action === 'startWorkshop') return 'La orden quedará en proceso de fabricación dentro de Taller.';
  if (action === 'finishPrinting') {
    if (order.route === 'PRINT_WORKSHOP') return 'La impresión quedará terminada y la orden pasará a Taller.';
    return order.requiresInstallation ? 'La impresión quedará terminada y la orden pasará a pendiente de instalación.' : 'La impresión y el trabajo quedarán terminados.';
  }
  if (action === 'finishWorkshop') return order.requiresInstallation ? 'El trabajo de Taller quedará terminado y la orden pasará a pendiente de instalación.' : 'El trabajo quedará terminado.';
  return 'Se registrará la instalación realizada y la orden quedará instalada.';
}

export function OrderActionDialog({ order, action, label, onClose }: { order: WorkOrder; action: OrderAction; label: string; onClose: () => void }) {
  const { data, transitionOrder, toast } = useApp();
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const currentOrder = data.orders.find(item => item.id === order.id) ?? order;
  const client = data.clients.find(item => item.id === currentOrder.clientId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      await transitionOrder(currentOrder.id, action, action === 'install' ? { date, note: note.trim() } : undefined);
      toast(action === 'install' ? 'Instalación registrada.' : 'Etapa de la orden actualizada.');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible actualizar la orden.');
    } finally {
      setSaving(false);
    }
  }

  return <Modal open onClose={onClose} title={label}>
    <form onSubmit={submit} className="stack">
      <div className="ops-confirm-order"><span className="eyebrow">OT #{String(currentOrder.number).padStart(4, '0')}</span><h3>{client?.name ?? 'Cliente no disponible'}</h3><p>{currentOrder.description}</p><WorkBadge status={currentOrder.status} /></div>
      <p>{actionDescription(currentOrder, action)}</p>
      {action === 'install' && <><Field label="Fecha de instalación" htmlFor="installation-date"><input id="installation-date" className="input" type="date" value={date} min={dateOnly(currentOrder.readyForInstallationAt || currentOrder.updatedAt)} max={today()} onChange={event => setDate(event.target.value)} required /></Field><Field label="Observaciones de instalación" htmlFor="installation-note" hint="Opcional"><textarea id="installation-note" className="textarea" rows={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="Observaciones del trabajo realizado…" /></Field></>}
      <p className="muted ops-small">El estado de pago se conserva independientemente del avance del trabajo.</p>
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      <div className="actions ops-form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}><Check size={16} />{saving ? 'Guardando…' : 'Confirmar'}</Button></div>
    </form>
  </Modal>;
}

const queueCopy = {
  DISENO: { title: 'Bandeja de Diseño', eyebrow: 'Preparación / Diseño', description: 'Tus órdenes y su avance después de la revisión administrativa.', icon: ClipboardCheck },
  IMPRESION: { title: 'Bandeja de Impresión', eyebrow: 'Producción / Impresión', description: 'Trabajos aprobados, materiales y medidas para imprimir.', icon: Printer },
  TALLER: { title: 'Bandeja de Taller', eyebrow: 'Producción / Taller', description: 'Fabricación e instalaciones pendientes, en un solo lugar.', icon: Hammer },
};

function isFinished(order: WorkOrder) { return order.status === 'COMPLETED' || order.status === 'INSTALLED'; }

export function QueuePage({ department }: { department: QueueDepartment }) {
  return <QueueContents key={department} department={department} />;
}

function QueueContents({ department }: { department: QueueDepartment }) {
  const { data, user } = useApp();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [page, setPage] = useState(1);
  const [selectedAction, setSelectedAction] = useState<{ order: WorkOrder; action: OrderAction; label: string } | null>(null);
  const allowed = !!user?.active && (isAdmin(user.role) || user.role === department);
  if (!allowed) return <EmptyState title="Bandeja de otra área" description="Puedes consultar la bandeja que corresponde a tu perfil." />;
  const copy = queueCopy[department];
  const showFinished = isAdmin(user.role) || department === 'DISENO';
  const visible = visibleOrders(user, data.orders);
  const queueOrders = visible.filter(order => {
    if (department === 'DISENO') return isAdmin(user.role) ? data.users.find(person => person.id === order.createdBy)?.role === 'DISENO' : order.createdBy === user.id;
    if (department === 'IMPRESION') return order.route !== 'WORKSHOP_ONLY' && (order.status === 'IN_PRINTING' || !!order.printingCompletedAt);
    return (order.route !== 'PRINT_ONLY' && (!!order.printingCompletedAt || order.route === 'WORKSHOP_ONLY') && !['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status)) || (order.requiresInstallation && ['PENDING_INSTALLATION', 'INSTALLED'].includes(order.status));
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number);
  const active = queueOrders.filter(order => department === 'DISENO' ? !isFinished(order) : department === 'IMPRESION' ? order.status === 'IN_PRINTING' : ['IN_WORKSHOP', 'PENDING_INSTALLATION'].includes(order.status));
  const waiting = queueOrders.filter(order => department === 'DISENO' ? ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status) : department === 'TALLER' ? order.status === 'IN_WORKSHOP' && !order.workshopStartedAt : order.status === 'IN_PRINTING');
  const finished = queueOrders.filter(order => department === 'IMPRESION' ? !!order.printingCompletedAt : isFinished(order));
  const installation = queueOrders.filter(order => order.status === 'PENDING_INSTALLATION');
  const filtered = queueOrders.filter(order => {
    const client = data.clients.find(item => item.id === order.clientId);
    const matchesSearch = normalize(`OT #${String(order.number).padStart(4, '0')} ${order.number} ${order.description} ${client?.name ?? ''} ${order.printing?.material ?? ''}`).includes(normalize(search.trim()));
    const matchesFilter = filter === 'all' || (filter === 'active' && active.includes(order)) || (filter === 'waiting' && waiting.includes(order)) || (filter === 'finished' && finished.includes(order)) || (filter === 'installation' && installation.includes(order));
    return matchesSearch && matchesFilter;
  });
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 6)));
  const materialCell = (order: WorkOrder) => order.printing ? <div className="ops-material-cell"><span className="cell-title">{order.printing.material}</span><span className="cell-subtitle">{formatMeasure(order.printing.length)} × {formatMeasure(order.printing.width)} m</span><strong className="ops-area-chip">{formatMeasure(areaOf(order.printing))} m²</strong></div> : <span className="muted">No requiere impresión</span>;
  const nextAction = (order: WorkOrder) => {
    if (department === 'DISENO') return null;
    const candidate = workflowAction(order, user.role);
    if (department === 'IMPRESION' && candidate?.action !== 'finishPrinting') return null;
    return candidate;
  };
  const actionButtons = (order: WorkOrder) => {
    const candidate = nextAction(order);
    return <div className="ops-queue-actions"><Link className="link ops-detail-link" to={`/orders/${order.id}`}>Ver orden <ArrowRight size={14} /></Link>{candidate && <Button onClick={() => setSelectedAction({ order, ...candidate })}>{candidate.label}</Button>}</div>;
  };
  const tabs = [
    { value: 'active', label: department === 'DISENO' ? 'Órdenes activas' : 'Trabajo pendiente', count: active.length },
    ...(department !== 'IMPRESION' ? [{ value: 'waiting', label: department === 'DISENO' ? 'En revisión' : 'Por iniciar', count: waiting.length }] : []),
    ...(department === 'TALLER' ? [{ value: 'installation', label: 'Por instalar', count: installation.length }] : []),
    ...(showFinished ? [{ value: 'finished', label: department === 'IMPRESION' ? 'Impresión finalizada' : 'Terminadas', count: finished.length }] : []),
    { value: 'all', label: 'Todas', count: queueOrders.length },
  ];

  return <div className={`page-stack ops-queue ops-department-${department.toLowerCase()}`}>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={department === 'DISENO' ? <Link className="ops-button-link" to="/orders/new"><Plus size={17} /> Nueva OT</Link> : undefined} />
    <div className="grid-3">
      <KpiCard label={department === 'DISENO' ? 'Pendientes de revisión' : department === 'IMPRESION' ? 'Por imprimir' : 'Trabajos en Taller'} value={department === 'TALLER' ? active.filter(order => order.status === 'IN_WORKSHOP').length : waiting.length} icon={copy.icon} meta={department === 'DISENO' ? 'Esperando aprobación administrativa' : 'Órdenes disponibles en tu bandeja'} tone={department === 'DISENO' ? 'amber' : department === 'TALLER' ? 'blue' : 'orange'} />
      <KpiCard label={department === 'IMPRESION' ? 'Superficie por imprimir' : department === 'TALLER' ? 'Pendientes de instalación' : 'En producción'} value={department === 'IMPRESION' ? `${formatNumber(active.reduce((sum, order) => sum + areaOf(order.printing), 0), 3)} m²` : department === 'TALLER' ? installation.length : active.length - waiting.length} icon={department === 'IMPRESION' ? Ruler : department === 'TALLER' ? MapPin : Workflow} meta={department === 'IMPRESION' ? 'Área total de los trabajos pendientes' : department === 'TALLER' ? 'Confirmación a cargo de Taller o Administración' : 'Trabajos aprobados y en curso'} tone="blue" />
      {showFinished ? <KpiCard label={department === 'IMPRESION' ? 'Impresiones terminadas' : 'Trabajos terminados'} value={finished.length} icon={CheckCircle2} meta="Trabajos finalizados de esta bandeja" tone="green" /> : <KpiCard label={department === 'IMPRESION' ? 'Materiales requeridos' : 'Por iniciar fabricación'} value={department === 'IMPRESION' ? new Set(active.map(order => order.printing?.material).filter(Boolean)).size : waiting.length} icon={department === 'IMPRESION' ? Printer : Clock3} meta={department === 'IMPRESION' ? 'Tipos de material en los trabajos pendientes' : 'Órdenes disponibles para iniciar en Taller'} tone="slate" />}
    </div>
    {department === 'DISENO' && <div className="notice ops-review-notice"><ClipboardCheck size={21} /><p>Las órdenes creadas por Diseño pasan por revisión de Administración antes de entrar a producción.</p></div>}
    <Card>
      <div className="ops-queue-toolbar"><div className="ops-filter-tabs" role="group" aria-label="Estado de los trabajos">{tabs.map(tab => <button key={tab.value} type="button" className={`ops-filter-tab ${filter === tab.value ? 'active' : ''}`} aria-pressed={filter === tab.value} onClick={() => { setFilter(tab.value); setPage(1); }}>{tab.label}<span>{tab.count}</span></button>)}</div><SearchInput value={search} onChange={value => { setSearch(value); setPage(1); }} label="Buscar trabajos" placeholder="Buscar OT, cliente o material…" /></div>
      {!filtered.length ? <EmptyState title="No hay trabajos en esta vista" description={search ? 'Prueba otro número, cliente o descripción.' : 'Las órdenes aparecerán cuando lleguen a esta etapa.'} action={search || filter !== 'all' ? <Button variant="secondary" onClick={() => { setSearch(''); setFilter('all'); setPage(1); }}>Ver todos los trabajos</Button> : undefined} /> : <><DataTable columns={[
        { key: 'number', label: 'OT / Fecha', render: order => <div><Link className="cell-title link" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link><span className="cell-subtitle">{formatDate(order.createdAt)}</span></div> },
        { key: 'work', label: 'Cliente / Trabajo', render: order => <div className="ops-order-description"><span className="cell-title">{data.clients.find(item => item.id === order.clientId)?.name ?? 'Cliente no disponible'}</span><span className="cell-subtitle">{order.description}</span></div> },
        ...(department !== 'TALLER' ? [{ key: 'printing', label: 'Material / Medidas', render: materialCell }] : [{ key: 'route', label: 'Recorrido', render: (order: WorkOrder) => <div><span className="cell-title">{ROUTE_LABELS[order.route]}</span><span className="cell-subtitle">{order.requiresInstallation ? 'Requiere instalación' : 'Sin instalación'}</span></div> }]),
        { key: 'status', label: 'Estado', render: order => <div className="ops-status-stack"><WorkBadge status={order.status} />{order.status === 'IN_WORKSHOP' && <span className="ops-workshop-substatus"><Clock3 size={12} /> {order.workshopStartedAt ? 'En fabricación' : 'Por iniciar'}</span>}</div> },
        { key: 'actions', label: 'Acciones', render: actionButtons },
      ]} rows={filtered.slice((safePage - 1) * 6, safePage * 6)} rowKey={order => order.id} renderCard={order => <div className="ops-mobile-record"><div className="ops-record-footer"><Link className="cell-title link" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link><WorkBadge status={order.status} /></div><div><strong>{data.clients.find(item => item.id === order.clientId)?.name}</strong><p className="muted ops-mobile-description">{order.description}</p></div>{department !== 'TALLER' ? materialCell(order) : <p className="ops-route-text">{ROUTE_LABELS[order.route]}{order.requiresInstallation ? ' · Con instalación' : ''}</p>}<div className="ops-record-footer"><span className="muted ops-small">{formatDate(order.updatedAt)}</span>{actionButtons(order)}</div></div>} /><Pagination page={safePage} pageSize={6} total={filtered.length} onChange={setPage} /></>}
    </Card>
    {selectedAction && <OrderActionDialog key={`${selectedAction.order.id}-${selectedAction.action}`} {...selectedAction} onClose={() => setSelectedAction(null)} />}
  </div>;
}
