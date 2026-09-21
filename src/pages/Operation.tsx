import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardCheck, Hammer, MapPin, Plus, Printer, Workflow } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { apiDesignerLoad, usingApi } from '../data/api';
import type { OrderAction, WorkOrder, WorkStatus } from '../domain/types';
import { areaOf, formatDate, formatMeasure, isAdmin, normalize, ROUTE_LABELS } from '../domain/utils';
import { Button, Card, EmptyState, KpiCard, PageHeader, SearchInput } from '../components/ui';
import { OrderActionDialog, workflowAction } from './Queues';
import './operations.css';

const stages: { key: string; title: string; description: string; statuses: WorkStatus[]; icon: typeof ClipboardCheck; link: string }[] = [
  { key: 'review', title: 'Por enviar', description: 'Distribución administrativa', statuses: ['NEW', 'PENDING_ADMIN_REVIEW'], icon: ClipboardCheck, link: '/orders' },
  { key: 'production', title: 'Por producto / Externo', description: 'Actividades en varias áreas', statuses: ['IN_PRODUCTION', 'IN_EXTERNAL'], icon: Workflow, link: '/orders' },
  { key: 'printing', title: 'Impresión', description: 'Producción gráfica', statuses: ['IN_PRINTING'], icon: Printer, link: '/printing' },
  { key: 'workshop', title: 'Taller', description: 'Fabricación y ensamble', statuses: ['IN_WORKSHOP'], icon: Hammer, link: '/workshop' },
  { key: 'installation', title: 'Instalación', description: 'Trabajos listos para instalar', statuses: ['PENDING_INSTALLATION'], icon: MapPin, link: '/workshop' },
];

function DesignerLoadPanel() {
  const [load, setLoad] = useState<Awaited<ReturnType<typeof apiDesignerLoad>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await apiDesignerLoad();
        if (active) { setLoad(result); setError(''); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'No fue posible consultar la carga de Diseño.');
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <Card className="ops-designer-load"><div className="ops-activity-header"><div><span className="eyebrow">Distribución de trabajo</span><h2>Carga de Diseño</h2><p className="muted">Actividades asignadas, pendientes y en proceso por diseñador.</p></div><Link className="link ops-detail-link" to="/design">Abrir bandeja <ArrowRight size={14} /></Link></div>
    {error && <p className="notice notice-warning" role="alert">{error}</p>}
    {!load && !error ? <p className="muted ops-activity-loading">Cargando carga de trabajo…</p> : load && <><p className="ops-designer-unassigned">{load.unassigned} tareas de Diseño sin asignar</p><div className="ops-designer-grid">{load.items.map(designer => <div key={designer.id} className="ops-designer-card"><strong>{designer.name}</strong><span>{designer.pending} pendientes · {designer.inProgress} en proceso</span><b>{designer.total} activas</b></div>)}</div></>}
  </Card>;
}

export function OperationPage() {
  const { data, user } = useApp();
  const [search, setSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState('all');
  const [selectedAction, setSelectedAction] = useState<{ order: WorkOrder; action: OrderAction; label: string } | null>(null);
  if (!user?.active || !isAdmin(user.role)) return <EmptyState title="Vista administrativa" description="El tablero general de operación está disponible para Administración." />;
  const active = data.orders.filter(order => !['COMPLETED', 'INSTALLED'].includes(order.status));
  const filtered = active.filter(order => {
    const client = data.clients.find(item => item.id === order.clientId);
    return normalize(`OT #${String(order.number).padStart(4, '0')} ${order.number} ${client?.name ?? ''} ${order.description}`).includes(normalize(search.trim())) && (routeFilter === 'all' || order.route === routeFilter);
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number);
  const finished = data.orders.filter(order => ['COMPLETED', 'INSTALLED'].includes(order.status)).length;

  return <div className="page-stack">
    <PageHeader eyebrow="Control operativo" title="Operación" description="Cada orden en su etapa. Una vista compartida de todo el trabajo." actions={<Link className="ops-button-link" to="/orders/new"><Plus size={17} /> Nueva OT</Link>} />
    <div className="grid-3"><KpiCard label="Órdenes en curso" value={active.length} icon={Workflow} meta="Desde el envío hasta instalación" tone="orange" /><KpiCard label="Por enviar" value={active.filter(order => ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status)).length} icon={ClipboardCheck} meta="Pendientes de distribución" tone="amber" /><KpiCard label="Trabajos terminados" value={finished} icon={CheckCircle2} meta="Finalizados o instalados" tone="green" /></div>
    {usingApi && <DesignerLoadPanel />}
    <Card className="ops-board-controls"><SearchInput value={search} onChange={setSearch} placeholder="Buscar OT, cliente o trabajo…" label="Buscar en operación" /><label className="ops-inline-field"><span className="ops-sr-only">Filtrar por recorrido</span><select className="select" value={routeFilter} onChange={event => setRouteFilter(event.target.value)}><option value="all">Todos los recorridos</option><option value="PRINT_ONLY">Solo Impresión</option><option value="WORKSHOP_ONLY">Solo Taller</option><option value="PRINT_WORKSHOP">Impresión y Taller</option><option value="EXTERNO">Externo</option><option value="MULTI_AREA">Varias áreas</option></select></label><span className="muted ops-board-results" role="status">{filtered.length} órdenes visibles</span></Card>
    <div className="ops-board">
      {stages.map(stage => {
        const orders = filtered.filter(order => stage.statuses.includes(order.status));
        const Icon = stage.icon;
        return <section className={`ops-lane ops-lane-${stage.key}`} key={stage.key} aria-labelledby={`stage-${stage.key}`}>
          <header className="ops-lane-header"><div className="ops-lane-title"><Icon size={18} /><h2 id={`stage-${stage.key}`}>{stage.title}</h2><span className="ops-lane-count">{orders.length}</span></div><p>{stage.description}</p></header>
          <div className="ops-lane-body">
            {orders.map(order => {
              const client = data.clients.find(item => item.id === order.clientId);
              const action = workflowAction(order, user?.role);
              return <article key={order.id} className="ops-board-order">
                <div className="ops-board-order-top"><Link className="link ops-order-number" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link><span className="ops-category-label">{order.category}</span></div>
                <h3>{client?.name ?? 'Cliente no disponible'}</h3><p className="ops-board-description">{order.description}</p>
                {stage.key === 'printing' && order.printing && <div className="ops-board-material"><Printer size={14} /><span>{order.printing.material}</span><strong>{formatMeasure(areaOf(order.printing))} m²</strong></div>}
                {stage.key !== 'printing' && <p className="ops-board-route">{stage.key === 'workshop' ? order.workshopStartedAt ? 'En fabricación' : 'Por iniciar fabricación' : stage.key === 'installation' ? 'Pendiente de confirmar instalación' : ROUTE_LABELS[order.route]}</p>}
                <div className="ops-board-order-date">Actualizada {formatDate(order.updatedAt)}</div>
                <div className="ops-board-order-actions">{action && <Button variant={stage.key === 'review' ? 'primary' : 'secondary'} onClick={() => setSelectedAction({ order, ...action })}>{action.label}</Button>}<Link className="ops-card-open" to={`/orders/${order.id}`} aria-label={`Abrir OT ${order.number}`}><ArrowRight size={17} /></Link></div>
              </article>;
            })}
            {!orders.length && <div className="ops-lane-empty"><Icon size={25} /><p>{search || routeFilter !== 'all' ? 'Sin resultados en esta etapa' : 'Sin órdenes pendientes'}</p></div>}
          </div>
          <Link className="ops-lane-footer" to={stage.link}>{stage.key === 'review' ? 'Ver órdenes' : `Abrir ${stage.key === 'installation' ? 'Taller' : stage.title}`}<ArrowRight size={14} /></Link>
        </section>;
      })}
    </div>
    {(search || routeFilter !== 'all') && !filtered.length && <Button variant="secondary" onClick={() => { setSearch(''); setRouteFilter('all'); }}>Limpiar filtros</Button>}
    {selectedAction && <OrderActionDialog key={`${selectedAction.order.id}-${selectedAction.action}`} {...selectedAction} onClose={() => setSelectedAction(null)} />}
  </div>;
}
