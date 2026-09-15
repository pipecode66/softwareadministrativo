import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Banknote, Check, CheckCircle2, ClipboardList, Clock3, FileText, Hammer, MapPin, Pencil, Plus, Printer, Ruler, Wallet } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { OrderAction, Role, WorkOrder } from '../domain/types';
import { areaOf, dateOnly, financials, formatCOP, formatDate, formatNumber, isAdmin, ROLE_LABELS, roundMoney, ROUTE_LABELS, STATUS_LABELS, today, visibleOrders } from '../domain/utils';
import { Button, Card, CardHeader, DataTable, DocumentBadge, EmptyState, Field, Modal, PageHeader, PaymentBadge, WorkBadge } from '../components/ui';
import './orders.css';

function availableAction(order: WorkOrder, role?: Role): { action: OrderAction; label: string } | undefined {
  if (order.closedAt) return undefined;
  const admin = isAdmin(role);
  if (admin && ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status)) return { action: 'send', label: 'Aprobar y enviar' };
  if ((admin || role === 'IMPRESION') && order.status === 'IN_PRINTING') return { action: 'finishPrinting', label: 'Finalizar impresión' };
  if ((admin || role === 'TALLER') && order.status === 'IN_WORKSHOP') return order.workshopStartedAt ? { action: 'finishWorkshop', label: 'Finalizar taller' } : { action: 'startWorkshop', label: 'Iniciar taller' };
  if ((admin || role === 'TALLER') && order.status === 'PENDING_INSTALLATION') return { action: 'install', label: 'Registrar instalación' };
  if (admin && ['COMPLETED', 'INSTALLED'].includes(order.status)) return { action: 'close', label: 'Cerrar orden' };
  return undefined;
}

function ProductionSteps({ order }: { order: WorkOrder }) {
  const steps = [
    { id: 'created', label: 'Creada', icon: ClipboardList, detail: formatDate(order.createdAt), complete: true, active: false },
    { id: 'review', label: 'Administración', icon: CheckCircle2, detail: ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status) ? 'Pendiente de aprobación' : 'Revisión completada', complete: !['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status), active: ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status) },
    ...(order.route !== 'WORKSHOP_ONLY' ? [{ id: 'printing', label: 'Impresión', icon: Printer, detail: order.printingCompletedAt ? formatDate(order.printingCompletedAt) : order.status === 'IN_PRINTING' ? 'Etapa actual' : 'Siguiente etapa', complete: !!order.printingCompletedAt, active: order.status === 'IN_PRINTING' }] : []),
    ...(order.route !== 'PRINT_ONLY' ? [{ id: 'workshop', label: 'Taller', icon: Hammer, detail: order.status === 'IN_WORKSHOP' ? order.workshopStartedAt ? 'Trabajo en proceso' : 'Pendiente de iniciar' : ['PENDING_INSTALLATION', 'COMPLETED', 'INSTALLED'].includes(order.status) ? 'Trabajo finalizado' : 'Siguiente etapa', complete: ['PENDING_INSTALLATION', 'COMPLETED', 'INSTALLED'].includes(order.status), active: order.status === 'IN_WORKSHOP' }] : []),
    ...(order.requiresInstallation ? [{ id: 'installation', label: 'Instalación', icon: MapPin, detail: order.installedAt ? formatDate(order.installedAt) : order.status === 'PENDING_INSTALLATION' ? 'Por instalar' : 'Al finalizar producción', complete: order.status === 'INSTALLED', active: order.status === 'PENDING_INSTALLATION' }] : [{ id: 'finished', label: 'Terminada', icon: CheckCircle2, detail: order.status === 'COMPLETED' ? 'Producción finalizada' : 'Al finalizar producción', complete: order.status === 'COMPLETED', active: false }]),
  ];
  return <ol className="order-production-steps">{steps.map((step, index) => <li key={step.id} className={`${step.complete ? 'is-complete' : ''} ${step.active ? `is-current is-${step.id}` : ''}`} aria-current={step.active ? 'step' : undefined}><span className="order-step-icon">{step.complete ? <Check size={17} /> : <step.icon size={17} />}</span><div><span className="order-step-number">{String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol>;
}

function FinancialSummary({ order }: { order: WorkOrder }) {
  const money = financials(order);
  return <dl className="order-financial-list">
    <div><dt>Valor del trabajo</dt><dd>{formatCOP(money.base)}</dd></div>
    {order.documentType === 'FACT' && <><div><dt>IVA 19 %</dt><dd>+ {formatCOP(money.iva)}</dd></div><div className="order-financial-subtotal"><dt>Subtotal con IVA</dt><dd>{formatCOP(money.gross)}</dd></div><div><dt>RETE FUENTE</dt><dd>+ {formatCOP(order.reteFuente)}</dd></div><div><dt>RETE IVA 15</dt><dd>+ {formatCOP(order.reteIva)}</dd></div><div><dt>ICA 7 × 1000</dt><dd>+ {formatCOP(order.ica)}</dd></div></>}
    <div className="order-financial-subtotal"><dt>Total por cobrar</dt><dd>{formatCOP(money.collectible)}</dd></div>
    <div className="order-paid-value"><dt>Pagos registrados</dt><dd>− {formatCOP(money.paid)}</dd></div>
    <div className="order-financial-balance"><dt>Saldo pendiente</dt><dd>{formatCOP(money.balance)}</dd></div>
  </dl>;
}

export function OrderDetailPage() {
  const { id } = useParams();
  const { data, user, addPayment, transitionOrder, toast } = useApp();
  const navigate = useNavigate();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [installationDate, setInstallationDate] = useState(today);
  const [installationNote, setInstallationNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const order = visibleOrders(user, data.orders).find(item => item.id === id);
  if (!order) return <EmptyState title="Esta orden no está disponible en tu bandeja" description="Puedes consultar las órdenes asignadas a tu perfil desde el listado." action={<Link className="btn btn-secondary" to="/orders">Volver a órdenes</Link>} />;
  const admin = isAdmin(user?.role);
  const client = data.clients.find(item => item.id === order.clientId);
  const creator = data.users.find(person => person.id === order.createdBy);
  const money = financials(order);
  const nextAction = availableAction(order, user?.role);
  const canEdit = admin && !order.closedAt && ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status);
  const paymentPercentage = money.collectible > 0 ? Math.min(100, Math.max(0, money.paid / money.collectible * 100)) : 100;
  const amount = Number(paymentAmount) || 0;
  const remainingAfterPayment = (Math.round(money.balance * 100) - Math.round(roundMoney(Number.isFinite(amount) ? amount : 0) * 100)) / 100;
  const sortedPayments = [...order.payments].sort((a, b) => b.date.localeCompare(a.date));

  function openPayment() { setError(''); setPaymentAmount(''); setPaymentDate(today()); setPaymentOpen(true); }
  function openAction() { setError(''); setInstallationDate(today()); setInstallationNote(''); setActionOpen(true); }
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || saving) return;
    if (!paymentDate || paymentDate < dateOnly(order.createdAt) || paymentDate > today()) { setError('La fecha debe estar entre la creación de la OT y hoy.'); return; }
    if (!paymentAmount.trim() || !Number.isFinite(amount) || amount <= 0) { setError('El valor del pago debe ser mayor que cero.'); return; }
    if (Math.abs(Math.round(amount * 100) - amount * 100) > 0.0001) { setError('Ingresa un pago con máximo dos decimales.'); return; }
    if (Math.round(amount * 100) > Math.round(money.balance * 100)) { setError('El pago no puede superar el saldo pendiente.'); return; }
    setSaving(true); setError('');
    try { await addPayment(order.id, { date: paymentDate, amount }); setPaymentOpen(false); toast('Pago registrado. El saldo de la orden se actualizó.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible registrar el pago.'); }
    finally { setSaving(false); }
  }
  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || !nextAction || saving) return;
    setSaving(true); setError('');
    try {
      await transitionOrder(order.id, nextAction.action, nextAction.action === 'install' ? { date: installationDate, note: installationNote } : undefined);
      setActionOpen(false);
      toast(nextAction.action === 'close' ? 'Orden cerrada administrativamente.' : nextAction.action === 'install' ? 'Instalación registrada.' : 'Etapa del trabajo actualizada.');
      if (!admin && (nextAction.action === 'finishPrinting' || nextAction.action === 'install' || (nextAction.action === 'finishWorkshop' && !order.requiresInstallation))) navigate('/orders');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible actualizar la orden.'); }
    finally { setSaving(false); }
  }
  let actionDescription = '';
  if (nextAction?.action === 'send') actionDescription = `La orden quedará aprobada y pasará a ${order.route === 'WORKSHOP_ONLY' ? 'Taller' : 'Impresión'}.`;
  if (nextAction?.action === 'finishPrinting') actionDescription = `La superficie de ${formatNumber(areaOf(order.printing), 3)} m² se registrará como consumo de impresión. ${order.route === 'PRINT_WORKSHOP' ? 'El trabajo pasará a Taller.' : order.requiresInstallation ? 'El trabajo quedará pendiente de instalación.' : 'El trabajo quedará terminado.'}`;
  if (nextAction?.action === 'startWorkshop') actionDescription = 'Se registrará el inicio de este trabajo en Taller.';
  if (nextAction?.action === 'finishWorkshop') actionDescription = order.requiresInstallation ? 'El trabajo de Taller finalizará y la orden quedará pendiente de instalación.' : 'La producción de esta orden quedará terminada.';
  if (nextAction?.action === 'install') actionDescription = 'Registra la fecha en que se realizó la instalación. La orden quedará instalada.';
  if (nextAction?.action === 'close') actionDescription = money.balance > 0 ? `El trabajo quedará cerrado administrativamente y conservará su saldo de ${formatCOP(money.balance)} en cartera. Podrás seguir registrando pagos.` : 'El trabajo quedará cerrado administrativamente con su pago completo registrado.';

  return <div className="page-stack order-detail-page">
    <Link className="order-back-link" to="/orders"><ArrowLeft size={17} /> Órdenes de trabajo</Link>
    <PageHeader eyebrow="ORDEN DE TRABAJO" title={`OT #${String(order.number).padStart(4, '0')}`} description={client?.name || 'Cliente no disponible'} actions={admin ? <div className="order-detail-top-actions">{canEdit && <Link className="btn btn-secondary" to={`/orders/${order.id}/edit`}><Pencil size={16} /> Editar OT</Link>}<Link className="btn btn-secondary" to={`/orders/${order.id}/print`}><Printer size={16} /> Vista imprimible</Link></div> : undefined} />
    <div className="order-detail-status"><WorkBadge status={order.status} /><DocumentBadge type={order.documentType} />{admin && <PaymentBadge status={money.paymentStatus} />}{order.closedAt && <span className="badge order-closed-badge"><CheckCheckIcon /> Cierre administrativo registrado</span>}<span className="order-last-update"><Clock3 size={14} /> Último cambio: {formatDate(order.updatedAt, true)}</span></div>
    <Card className="order-workflow-card"><CardHeader title="Ruta de producción" description={`${ROUTE_LABELS[order.route]}${order.requiresInstallation ? ' · Instalación requerida' : ''}`} /><ProductionSteps order={order} /></Card>
    <div className="order-detail-grid">
      <div className="stack">
        <Card className="order-information-card"><CardHeader title="Información del trabajo" /><div className="order-detail-description"><span className="eyebrow">Descripción</span><p>{order.description}</p></div><dl className="order-info-grid"><div><dt>Categoría comercial</dt><dd>{order.category}</dd></div><div><dt>Creación</dt><dd>{formatDate(order.createdAt, true)}</dd></div><div><dt>Registrada por</dt><dd>{creator?.name || 'Usuario no disponible'}{creator && <small>{ROLE_LABELS[creator.role]}</small>}</dd></div><div><dt>Recorrido</dt><dd>{ROUTE_LABELS[order.route]}</dd></div></dl></Card>
        {order.printing && <Card className="order-information-card"><CardHeader title="Ficha de impresión" description="Dimensiones en metros y superficie calculada" /><div className="order-material-heading"><div className="order-material-icon"><Printer size={23} /></div><div><span className="muted">Material seleccionado</span><h3>{order.printing.material}</h3></div></div><div className="order-dimension-grid"><div><span>Largo</span><strong>{formatNumber(order.printing.length, 3)} <small>m</small></strong></div><div><span>Ancho</span><strong>{formatNumber(order.printing.width, 3)} <small>m</small></strong></div><div className="order-area-highlight"><span>Superficie</span><strong>{formatNumber(areaOf(order.printing), 3)} <small>m²</small></strong></div></div><p className="order-help-text">{order.printingCompletedAt ? `Consumo registrado al finalizar impresión: ${formatDate(order.printingCompletedAt, true)}.` : 'Esta superficie contará como consumo al finalizar la impresión.'}</p></Card>}
        <Card className="order-information-card"><CardHeader title="Taller e instalación" /><dl className="order-info-grid"><div><dt>Paso por Taller</dt><dd>{order.route === 'PRINT_ONLY' ? 'No requerido' : 'Incluido en el recorrido'}</dd></div><div><dt>Instalación</dt><dd>{order.requiresInstallation ? order.installedAt ? 'Realizada' : 'Requerida' : 'No requerida'}</dd></div>{order.workshopStartedAt && <div><dt>Inicio en Taller</dt><dd>{formatDate(order.workshopStartedAt, true)}</dd></div>}{order.installedAt && <div><dt>Fecha de instalación</dt><dd>{formatDate(order.installedAt)}</dd></div>}</dl>{order.installationNote && <div className="order-detail-description"><span className="eyebrow">Observaciones de instalación</span><p>{order.installationNote}</p></div>}</Card>
        {admin && <Card className="order-payments-card"><CardHeader title="Pagos y abonos" description={`${order.payments.length} ${order.payments.length === 1 ? 'pago registrado' : 'pagos registrados'} · cada movimiento conserva su fecha y valor`} action={money.balance > 0 ? <Button variant="secondary" onClick={openPayment}><Plus size={16} /> Registrar pago</Button> : undefined} />{sortedPayments.length ? <DataTable rows={sortedPayments} rowKey={payment => payment.id} columns={[
          { key: 'date', label: 'Fecha del pago', render: payment => formatDate(payment.date) },
          { key: 'amount', label: 'Valor recibido', className: 'money', render: payment => <strong className="order-paid-value">{formatCOP(payment.amount)}</strong> },
          { key: 'user', label: 'Registrado por', render: payment => data.users.find(person => person.id === payment.recordedBy)?.name || 'Usuario no disponible' },
        ]} renderCard={payment => <div className="order-mobile-payment"><div><strong>{formatCOP(payment.amount)}</strong><span>{formatDate(payment.date)}</span></div><small className="muted">{data.users.find(person => person.id === payment.recordedBy)?.name || 'Usuario no disponible'}</small></div>} /> : <EmptyState title="Esta orden aún no tiene pagos" description="Los abonos que registres se descontarán automáticamente del saldo." />}</Card>}
      </div>
      <aside className="stack order-detail-aside">
        {admin && <Card className="order-financial-card"><CardHeader title="Control financiero" description="Valores expresados en COP" /><div className="order-balance-highlight"><span>Saldo por recaudar</span><strong>{formatCOP(money.balance)}</strong><PaymentBadge status={money.paymentStatus} /></div><div className="order-payment-progress"><div><span>Pagado</span><strong>{formatNumber(paymentPercentage, 1)} %</strong></div><progress max="100" value={paymentPercentage} aria-label="Porcentaje pagado de la orden" /></div><FinancialSummary order={order} />{order.documentType === 'FACT' && <p className="order-help-text">Las retenciones son importes manuales sumados al subtotal con IVA, según la regla de cobro acordada.</p>}{money.balance > 0 && <Button onClick={openPayment} className="order-full-button"><Banknote size={17} /> Registrar abono o pago</Button>}</Card>}
        <Card className="order-client-card"><CardHeader title="Cliente" /><div className="order-client-detail"><span className="order-client-avatar">{(client?.name || 'C').split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span><div><strong>{client?.name || 'Cliente no disponible'}</strong><span>{client?.identification || 'Sin identificación'}</span></div></div><dl className="order-summary-list"><div><dt>Teléfono</dt><dd>{client?.phone || 'Sin teléfono registrado'}</dd></div></dl>{admin && client && <Link className="link" to={`/clients/${client.id}`}>Consultar cliente <ArrowRight size={15} /></Link>}</Card>
        {order.closedAt && <div className="order-form-note"><CheckCircle2 size={19} /><p>Cierre administrativo registrado el {formatDate(order.closedAt, true)}.{admin && money.balance > 0 ? ' La orden sigue visible en cartera hasta completar el pago.' : ''}</p></div>}
        {order.documentType === 'FACT' && admin && <div className="order-form-note"><FileText size={19} /><p>FACT identifica la clasificación documental de esta OT. Esta vista no es una factura electrónica.</p></div>}
      </aside>
    </div>
    {nextAction && <div className="order-action-bar"><div><span className="eyebrow">Siguiente acción</span><strong>{STATUS_LABELS[order.status]}</strong></div><Button onClick={openAction}>{nextAction.action === 'close' ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}{nextAction.label}</Button></div>}
    <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title={`Registrar pago · OT #${String(order.number).padStart(4, '0')}`}>
      <form className="stack" onSubmit={submitPayment} noValidate><p className="muted">{client?.name}</p><div className="order-payment-modal-balance"><Wallet size={22} /><div><span>Saldo actual por cobrar</span><strong>{formatCOP(money.balance)}</strong></div><Button type="button" variant="secondary" onClick={() => { setPaymentAmount(String(money.balance)); setError(''); }}>Pagar saldo completo</Button></div><div className="form-grid"><Field label="Fecha de recepción *" htmlFor="detail-payment-date"><input className="input" id="detail-payment-date" type="date" min={dateOnly(order.createdAt)} max={today()} value={paymentDate} onChange={event => { setPaymentDate(event.target.value); setError(''); }} required /></Field><Field label="Valor del pago (COP) *" htmlFor="detail-payment-amount"><input className="input" id="detail-payment-amount" type="number" min="0.01" step="0.01" max={money.balance} inputMode="decimal" value={paymentAmount} placeholder="0" onChange={event => { setPaymentAmount(event.target.value); setError(''); }} required /></Field></div><div className={`order-payment-result ${remainingAfterPayment < 0 ? 'is-invalid' : ''}`} aria-live="polite"><span>Saldo después del pago</span><strong>{formatCOP(remainingAfterPayment)}</strong></div>{error && <p className="order-field-error" role="alert">{error}</p>}<div className="actions"><Button type="button" variant="secondary" onClick={() => setPaymentOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving || money.balance <= 0}><Check size={17} />{saving ? 'Guardando…' : 'Confirmar y registrar pago'}</Button></div></form>
    </Modal>
    <Modal open={actionOpen} onClose={() => setActionOpen(false)} title={nextAction?.label || 'Actualizar orden'}>
      <form className="stack" onSubmit={submitAction}><div className="order-action-confirm"><span className="eyebrow">OT #{String(order.number).padStart(4, '0')}</span><h3>{client?.name}</h3><p>{order.description}</p><WorkBadge status={order.status} /></div><p>{actionDescription}</p>{nextAction?.action === 'install' && <><Field label="Fecha de instalación *" htmlFor="detail-install-date"><input className="input" id="detail-install-date" type="date" value={installationDate} min={dateOnly(order.readyForInstallationAt || order.updatedAt)} max={today()} onChange={event => setInstallationDate(event.target.value)} required /></Field><Field label="Observaciones de instalación" htmlFor="detail-install-note" hint="Opcional"><textarea className="textarea" id="detail-install-note" rows={3} maxLength={1000} value={installationNote} onChange={event => setInstallationNote(event.target.value)} /></Field></>}{error && <p className="order-field-error" role="alert">{error}</p>}<div className="actions"><Button type="button" variant="secondary" onClick={() => setActionOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving}><Check size={17} />{saving ? 'Guardando…' : 'Confirmar'}</Button></div></form>
    </Modal>
  </div>;
}

function CheckCheckIcon() { return <CheckCircle2 size={14} />; }

export function PrintOrderPage() {
  const { id } = useParams();
  const { data, user } = useApp();
  const order = visibleOrders(user, data.orders).find(item => item.id === id);
  if (!order || !isAdmin(user?.role)) return <EmptyState title="Esta orden no está disponible para imprimir" description="La impresión de la ficha administrativa corresponde a Administración." action={<Link className="btn btn-secondary" to="/orders">Volver a órdenes</Link>} />;
  const client = data.clients.find(item => item.id === order.clientId);
  const admin = isAdmin(user?.role);
  const money = financials(order);
  return <div className="order-print-page page-stack">
    <div className="order-print-tools no-print"><Link className="order-back-link" to={`/orders/${order.id}`}><ArrowLeft size={17} /> Volver a la orden</Link><Button onClick={() => window.print()}><Printer size={18} /> Imprimir orden</Button></div>
    <article className="order-print-sheet" aria-label={`Ficha imprimible de orden ${order.number}`}>
      <header className="order-print-header"><div><div className="order-print-brand"><span aria-hidden="true">I</span><div><strong>INTERMEDIOS</strong><small>PUBLICIDAD & ARQUITECTURA</small></div></div><p>Gestión de producción</p></div><div className="order-print-identification"><span>ORDEN DE TRABAJO</span><h1>OT #{String(order.number).padStart(4, '0')}</h1><p>Creación: {formatDate(order.createdAt, true)}</p><DocumentBadge type={order.documentType} /></div></header>
      <div className="order-print-two-columns"><section className="order-print-section"><h2>Información del cliente</h2><dl><div><dt>Razón social</dt><dd>{client?.name || 'Cliente no disponible'}</dd></div><div><dt>NIT / Cédula</dt><dd>{client?.identification || '—'}</dd></div><div><dt>Teléfono</dt><dd>{client?.phone || '—'}</dd></div></dl></section><section className="order-print-section"><h2>Información general</h2><dl><div><dt>Categoría</dt><dd>{order.category}</dd></div><div><dt>Estado del trabajo</dt><dd>{STATUS_LABELS[order.status]}</dd></div><div><dt>Último cambio</dt><dd>{formatDate(order.updatedAt, true)}</dd></div></dl></section></div>
      <section className="order-print-section"><h2>Descripción del trabajo</h2><p className="order-print-description">{order.description}</p></section>
      <section className="order-print-section"><h2>Recorrido de producción</h2><div className="order-print-route"><span><CheckCircle2 size={15} /> Administración</span>{order.route !== 'WORKSHOP_ONLY' && <span><Printer size={15} /> Impresión</span>}{order.route !== 'PRINT_ONLY' && <span><Hammer size={15} /> Taller</span>}{order.requiresInstallation && <span><MapPin size={15} /> Instalación</span>}</div></section>
      <div className="order-print-two-columns">{order.printing && <section className="order-print-section"><h2><Ruler size={14} /> Ficha de impresión</h2><dl><div><dt>Material</dt><dd>{order.printing.material}</dd></div><div><dt>Largo</dt><dd>{formatNumber(order.printing.length, 3)} m</dd></div><div><dt>Ancho</dt><dd>{formatNumber(order.printing.width, 3)} m</dd></div><div><dt>Superficie</dt><dd>{formatNumber(areaOf(order.printing), 3)} m²</dd></div></dl></section>}<section className="order-print-section"><h2>Instalación</h2><dl><div><dt>Requerida</dt><dd>{order.requiresInstallation ? 'Sí' : 'No'}</dd></div>{order.installedAt && <div><dt>Realizada el</dt><dd>{formatDate(order.installedAt)}</dd></div>}</dl>{order.installationNote && <p className="order-print-description">{order.installationNote}</p>}</section></div>
      {admin && <><section className="order-print-section order-print-finance"><h2>Resumen económico · COP</h2><FinancialSummary order={order} /><div className="order-print-payment-status"><span>Estado de pago</span><PaymentBadge status={money.paymentStatus} /></div></section>{order.payments.length > 0 && <section className="order-print-section order-print-payments"><h2>Pagos registrados</h2><table><thead><tr><th>Fecha</th><th>Valor recibido (COP)</th></tr></thead><tbody>{[...order.payments].sort((a, b) => a.date.localeCompare(b.date)).map(payment => <tr key={payment.id}><td>{formatDate(payment.date)}</td><td>{formatCOP(payment.amount)}</td></tr>)}</tbody></table></section>}</>}
      {order.closedAt && <p className="order-print-close">Cierre administrativo: {formatDate(order.closedAt, true)}.</p>}
      <footer className="order-print-footer"><strong>Documento interno de control de producción.</strong><p>No constituye una factura electrónica de venta.</p><small>Intermedios Gestión · Información de la orden registrada en el aplicativo</small></footer>
    </article>
  </div>;
}
