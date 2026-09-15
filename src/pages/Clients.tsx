import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Building2, CheckCircle2, ClipboardList, Pencil, Phone, Plus, Users, Wallet } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { Client, WorkOrder } from '../domain/types';
import { financials, formatCOP, formatDate, initials, isAdmin, normalize } from '../domain/utils';
import { Button, Card, CardHeader, DataTable, DocumentBadge, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, PaymentBadge, SearchInput, WorkBadge } from '../components/ui';
import './operations.css';

function ClientEditor({ open, client, onClose, onSaved }: { open: boolean; client?: Client; onClose: () => void; onSaved: (client: Client) => void }) {
  const { saveClient } = useApp();
  const [name, setName] = useState(client?.name ?? '');
  const [identification, setIdentification] = useState(client?.identification ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      const result = await saveClient({ name: name.trim(), identification: identification.trim(), phone: phone.trim() }, client?.id);
      onSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el cliente.');
    } finally {
      setSaving(false);
    }
  }

  return <Modal open={open} onClose={onClose} title={client ? 'Editar cliente' : 'Nuevo cliente'}>
    <form onSubmit={submit} className="stack">
      <p className="muted">Estos datos identificarán al cliente en sus órdenes de trabajo.</p>
      <Field label="Nombre o razón social" htmlFor="client-name">
        <input id="client-name" className="input" autoComplete="organization" value={name} onChange={event => setName(event.target.value)} maxLength={120} required autoFocus />
      </Field>
      <Field label="NIT o identificación" htmlFor="client-identification" hint="Opcional">
        <input id="client-identification" className="input" value={identification} onChange={event => setIdentification(event.target.value)} maxLength={35} />
      </Field>
      <Field label="Teléfono" htmlFor="client-phone" hint="Opcional">
        <input id="client-phone" className="input" type="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={30} />
      </Field>
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      <div className="actions ops-form-actions"><Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cliente'}</Button></div>
    </form>
  </Modal>;
}

export function ClientsPage() {
  const { data, user, toast } = useApp();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Client | 'new' | null>(null);
  if (!user?.active || !isAdmin(user.role)) return <EmptyState title="Directorio administrativo" description="Este directorio está disponible para los perfiles de Administración." />;

  const rows = data.clients.map(client => {
    const orders = data.orders.filter(order => order.clientId === client.id);
    return { ...client, orderCount: orders.length, balance: orders.reduce((total, order) => total + financials(order).balance, 0), activeCount: orders.filter(order => !['COMPLETED', 'INSTALLED'].includes(order.status)).length };
  });
  const filtered = rows.filter(client => normalize(`${client.name} ${client.identification} ${client.phone}`).includes(normalize(search.trim())) && (filter === 'all' || (filter === 'balance' ? client.balance > 0 : client.activeCount > 0))).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 8)));
  const pageRows = filtered.slice((safePage - 1) * 8, safePage * 8);

  return <div className="page-stack">
    <PageHeader eyebrow="Administración / Clientes" title="Directorio de clientes" description="La información de tus clientes, conectada con cada trabajo." actions={<Button onClick={() => setEditor('new')}><Plus size={17} /> Nuevo cliente</Button>} />
    <div className="grid-3">
      <KpiCard label="Clientes registrados" value={rows.length} icon={Users} meta="Directorio de la empresa" tone="orange" />
      <KpiCard label="Con trabajos en curso" value={rows.filter(client => client.activeCount > 0).length} icon={ClipboardList} meta="Órdenes con trabajo pendiente" tone="blue" />
      <KpiCard label="Clientes con cartera" value={rows.filter(client => client.balance > 0).length} icon={Wallet} meta="Con saldo pendiente de pago" tone="amber" />
    </div>
    <Card>
      <div className="toolbar ops-toolbar">
        <SearchInput value={search} onChange={value => { setSearch(value); setPage(1); }} placeholder="Buscar por nombre, identificación o teléfono…" label="Buscar clientes" />
        <label className="ops-inline-field"><span className="ops-sr-only">Filtrar clientes</span><select className="select" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">Todos los clientes</option><option value="active">Con trabajos en curso</option><option value="balance">Con saldo pendiente</option></select></label>
      </div>
      {!filtered.length ? <EmptyState title={search || filter !== 'all' ? 'No encontramos clientes' : 'Tu directorio está listo'} description={search || filter !== 'all' ? 'Prueba otro nombre o cambia el filtro.' : 'Registra el primer cliente para asociar sus órdenes.'} action={<Button variant="secondary" onClick={() => search || filter !== 'all' ? (setSearch(''), setFilter('all'), setPage(1)) : setEditor('new')}>{search || filter !== 'all' ? 'Limpiar filtros' : 'Crear cliente'}</Button>} /> : <>
        <DataTable columns={[
          { key: 'name', label: 'Cliente', render: row => <div className="ops-client-cell"><span className="ops-avatar" aria-hidden="true">{initials(row.name)}</span><div><Link className="cell-title link" to={`/clients/${row.id}`}>{row.name}</Link><span className="cell-subtitle">{row.identification}</span></div></div> },
          { key: 'phone', label: 'Contacto', render: row => row.phone ? <a className="ops-phone" href={`tel:${row.phone.replace(/[^\d+]/g, '')}`}><Phone size={14} />{row.phone}</a> : <span className="muted">Sin teléfono</span> },
          { key: 'orders', label: 'Órdenes', render: row => <span className="ops-tabular">{row.orderCount}</span> },
          { key: 'balance', label: 'Saldo pendiente', render: row => <span className={`money ${row.balance > 0 ? 'ops-amount-pending' : ''}`}>{formatCOP(row.balance)}</span> },
          { key: 'actions', label: 'Acciones', render: row => <div className="actions"><Button variant="ghost" onClick={() => navigate(`/clients/${row.id}`)} aria-label={`Ver detalle de ${row.name}`}><ArrowUpRight size={17} /></Button><Button variant="ghost" onClick={() => setEditor(row)} aria-label={`Editar ${row.name}`}><Pencil size={16} /></Button></div> },
        ]} rows={pageRows} rowKey={row => row.id} renderCard={row => <div className="ops-mobile-record"><div className="ops-client-cell"><span className="ops-avatar" aria-hidden="true">{initials(row.name)}</span><div><Link className="cell-title link" to={`/clients/${row.id}`}>{row.name}</Link><span className="cell-subtitle">{row.identification}</span></div></div><div className="ops-mobile-record-stats"><span>{row.orderCount} órdenes</span><span className="money">{formatCOP(row.balance)} por cobrar</span></div><div className="ops-record-footer"><span className="muted">{row.phone || 'Sin teléfono'}</span><Button variant="secondary" onClick={() => setEditor(row)}><Pencil size={14} /> Editar</Button></div></div>} />
        <Pagination page={safePage} pageSize={8} total={filtered.length} onChange={setPage} />
      </>}
    </Card>
    {editor && <ClientEditor key={editor === 'new' ? 'new' : editor.id} open client={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={() => { toast(editor === 'new' ? 'Cliente creado.' : 'Cliente actualizado.'); setEditor(null); }} />}
  </div>;
}

export function ClientDetailPage() {
  const { id } = useParams();
  const { data, user, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const client = data.clients.find(item => item.id === id);
  if (!user?.active || !isAdmin(user.role)) return <EmptyState title="Acceso administrativo" description="La consulta de clientes está disponible para Administración." />;
  if (!client) return <EmptyState title="No encontramos este cliente" action={<Link className="link" to="/clients">Volver al directorio</Link>} />;

  const orders = data.orders.filter(order => order.clientId === client.id);
  const balance = orders.reduce((sum, order) => sum + financials(order).balance, 0);
  const paid = orders.reduce((sum, order) => sum + financials(order).paid, 0);
  const filtered = orders.filter(order => normalize(`OT #${String(order.number).padStart(4, '0')} ${order.number} ${order.description}`).includes(normalize(search.trim())) && (filter === 'all' || (filter === 'balance' ? financials(order).balance > 0 : ['COMPLETED', 'INSTALLED'].includes(order.status)))).sort((a, b) => b.number - a.number);
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 6)));
  const statusCell = (order: WorkOrder) => <div className="ops-status-stack"><WorkBadge status={order.status} /><PaymentBadge status={financials(order).paymentStatus} /></div>;

  return <div className="page-stack">
    <Link className="ops-back-link" to="/clients"><ArrowLeft size={16} /> Directorio de clientes</Link>
    <PageHeader eyebrow="Ficha de cliente" title={client.name} description={`NIT / Identificación: ${client.identification || 'Sin registrar'}`} actions={<Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> Editar cliente</Button>} />
    <div className="grid-3">
      <KpiCard label="Órdenes registradas" value={orders.length} icon={ClipboardList} meta={`${orders.filter(order => !['COMPLETED', 'INSTALLED'].includes(order.status)).length} trabajos en curso`} tone="blue" />
      <KpiCard label="Pagos recibidos" value={formatCOP(paid)} icon={CheckCircle2} meta="Suma de sus abonos registrados" tone="green" />
      <KpiCard label="Saldo pendiente" value={formatCOP(balance)} icon={Wallet} meta={`${orders.filter(order => financials(order).balance > 0).length} órdenes por cobrar`} tone="amber" />
    </div>
    <Card className="ops-contact-card"><div className="ops-client-cell"><span className="ops-avatar ops-avatar-large" aria-hidden="true"><Building2 size={24} /></span><div><h2 className="ops-section-title">Datos de contacto</h2><p className="muted">Registrado el {formatDate(client.createdAt)}</p></div></div>{client.phone ? <a className="ops-phone ops-contact-number" href={`tel:${client.phone.replace(/[^\d+]/g, '')}`}><Phone size={17} />{client.phone}</a> : <span className="muted">No se ha registrado un teléfono.</span>}</Card>
    <Card>
      <CardHeader title="Órdenes de trabajo" description="Consulta el estado operativo y de pago de cada trabajo." />
      <div className="toolbar ops-toolbar"><SearchInput value={search} onChange={value => { setSearch(value); setPage(1); }} placeholder="Buscar OT o descripción…" label="Buscar órdenes del cliente" /><label className="ops-inline-field"><span className="ops-sr-only">Filtrar órdenes del cliente</span><select className="select" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">Todas las órdenes</option><option value="balance">Con saldo pendiente</option><option value="completed">Terminadas o instaladas</option></select></label></div>
      {!filtered.length ? <EmptyState title="Sin órdenes para mostrar" description={orders.length ? 'Prueba otra búsqueda o filtro.' : 'Las órdenes de este cliente aparecerán aquí.'} /> : <><DataTable columns={[
        { key: 'number', label: 'Orden', render: order => <Link className="cell-title link" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link> },
        { key: 'createdAt', label: 'Fecha', render: order => formatDate(order.createdAt) },
        { key: 'description', label: 'Trabajo', render: order => <div className="ops-order-description"><span className="cell-title">{order.description}</span><span className="cell-subtitle">{order.category}</span></div> },
        { key: 'document', label: 'Tipo', render: order => <DocumentBadge type={order.documentType} /> },
        { key: 'status', label: 'Estados', render: statusCell },
        { key: 'balance', label: 'Saldo', render: order => <span className="money">{formatCOP(financials(order).balance)}</span> },
      ]} rows={filtered.slice((safePage - 1) * 6, safePage * 6)} rowKey={order => order.id} renderCard={order => <div className="ops-mobile-record"><div className="ops-record-footer"><Link className="cell-title link" to={`/orders/${order.id}`}>OT #{String(order.number).padStart(4, '0')}</Link><DocumentBadge type={order.documentType} /></div><p>{order.description}</p>{statusCell(order)}<div className="ops-mobile-record-stats"><span>{formatDate(order.createdAt)}</span><span className="money">{formatCOP(financials(order).balance)} por cobrar</span></div></div>} /><Pagination page={safePage} pageSize={6} total={filtered.length} onChange={setPage} /></>}
    </Card>
    {editing && <ClientEditor open client={client} onClose={() => setEditing(false)} onSaved={() => { toast('Cliente actualizado.'); setEditing(false); }} />}
  </div>;
}
