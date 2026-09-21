import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, CheckCheck, Layers3, Plus, ReceiptText, Users, Wallet } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { Button, Card, CardHeader, DataTable, DocumentBadge, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, SearchInput, WorkBadge } from '../components/ui';
import { CATEGORIES, dateOnly, financials, formatCOP, formatDate, formatNumber, normalize, today } from '../domain/utils';
import type { Category, DocumentType, PaymentMethod, WorkOrder } from '../domain/types';
import { sumMoney } from './Reports';
import './analytics.css';

const isFinished = (order: WorkOrder) => ['COMPLETED', 'INSTALLED'].includes(order.status);
const PAYMENT_METHODS = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'BANCOLOMBIA', label: 'Bancolombia' },
  { value: 'DAVIVIENDA', label: 'Davivienda' },
] as const;
export const portfolioAtCutoff = (orders: WorkOrder[], cutoff: string) => orders
  .filter(order => dateOnly(order.createdAt) <= cutoff)
  .map(order => ({ order, money: financials(order, cutoff) }))
  .filter(row => row.money.balance > 0)
  .sort((a, b) => b.money.balance - a.money.balance);

type PayableOrder = { id: string; number: number; balance: number };
export function bulkAllocationPreview(orders: PayableOrder[], amount: number) {
  let remaining = Math.round(amount * 100);
  return [...orders].sort((a, b) => a.balance - b.balance || a.number - b.number || a.id.localeCompare(b.id)).map(order => {
    const allocatedCents = Math.min(Math.max(remaining, 0), Math.round(order.balance * 100));
    remaining -= allocatedCents;
    return { ...order, allocated: allocatedCents / 100, remaining: (Math.round(order.balance * 100) - allocatedCents) / 100 };
  });
}

export function PortfolioPage() {
  const { data, addPayment, bulkPayment, loadPortfolioReport, toast, usingApi } = useApp();
  const [cutoff, setCutoff] = useState(today);
  const [document, setDocument] = useState<DocumentType | 'ALL'>('ALL');
  const [category, setCategory] = useState<Category | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [finishedOnly, setFinishedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Exclude<PaymentMethod, 'LEGACY'>>('EFECTIVO');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkClientId, setBulkClientId] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkAmount, setBulkAmount] = useState('');
  const [bulkDate, setBulkDate] = useState(today);
  const [bulkMethod, setBulkMethod] = useState<Exclude<PaymentMethod, 'LEGACY'>>('EFECTIVO');
  const [bulkRequestId, setBulkRequestId] = useState(() => crypto.randomUUID());
  const [bulkError, setBulkError] = useState('');
  const [savingBulk, setSavingBulk] = useState(false);
  const [revision, setRevision] = useState(0);
  const [remoteReport, setRemoteReport] = useState<Awaited<ReturnType<typeof loadPortfolioReport>> | null>(null);
  useEffect(() => {
    if (!usingApi) { setRemoteReport(null); return; }
    let active = true;
    setRemoteReport(null);
    const query = { cutoff, pageSize: 100, category: category === 'ALL' ? undefined : category, documentType: document === 'ALL' ? undefined : document };
    void (async () => {
      const first = await loadPortfolioReport({ ...query, page: 1 });
      const items = [...first.items];
      for (let nextPage = 2; items.length < first.total; nextPage++) {
        const next = await loadPortfolioReport({ ...query, page: nextPage });
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return { ...first, items };
    })()
      .then(report => { if (active) setRemoteReport(report); })
      .catch(error => { if (active) toast(error instanceof Error ? error.message : 'No se pudo cargar la cartera.', 'error'); });
    return () => { active = false; };
  }, [category, cutoff, document, revision, usingApi]);
  const localRows = portfolioAtCutoff(data.orders, cutoff).filter(({ order }) => (document === 'ALL' || document === order.documentType) && (category === 'ALL' || category === order.category) && (!finishedOnly || isFinished(order))).map(row => ({ ...row, money: { ...row.money, balanceWithoutIva: Math.max(0, row.money.balance - row.money.iva) }, client: data.clients.find(client => client.id === row.order.clientId) }));
  const remoteRows = remoteReport?.items.map(item => {
    const source = data.orders.find(order => order.id === item.order.id);
    if (!source) return null;
    return { order: source, money: { ...financials(source, cutoff), collectible: item.collectible, paid: item.paid, balance: item.balance, balanceWithoutIva: item.balanceWithoutIva }, client: data.clients.find(client => client.id === item.order.clientId) };
  }).filter((row): row is NonNullable<typeof row> => {
    if (!row) return false;
    return !finishedOnly || isFinished(row.order);
  }) ?? [];
  const rows = (usingApi && remoteReport ? remoteRows : localRows).filter(row => normalize(`${row.order.number} ${String(row.order.number).padStart(4, '0')} ${row.client?.name ?? ''} ${row.order.description}`).includes(normalize(search.trim())));
  const total = sumMoney(rows.map(row => row.money.balance));
  const totalWithoutIva = sumMoney(rows.map(row => row.money.balanceWithoutIva));
  const ivaDue = sumMoney([total, -totalWithoutIva]);
  const finished = rows.filter(row => isFinished(row.order));
  const clientIds = new Set(rows.map(row => row.order.clientId));
  const byClient = Array.from(clientIds).map(id => ({ id, name: data.clients.find(client => client.id === id)?.name ?? 'Cliente', count: rows.filter(row => row.order.clientId === id).length, balance: sumMoney(rows.filter(row => row.order.clientId === id).map(row => row.money.balance)) })).sort((a, b) => b.balance - a.balance);
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const selected = data.orders.find(order => order.id === selectedId);
  const currentBalance = selected ? financials(selected).balance : 0;
  const bulkClient = data.clients.find(client => client.id === bulkClientId);
  const bulkCandidates = data.orders.filter(order => order.clientId === bulkClientId && financials(order).balance > 0)
    .sort((a, b) => financials(a).balance - financials(b).balance || a.number - b.number);
  const bulkSelected = bulkCandidates.filter(order => bulkSelectedIds.includes(order.id));
  const bulkDue = sumMoney(bulkSelected.map(order => financials(order).balance));
  const bulkPreview = bulkAllocationPreview(bulkSelected.map(order => ({ id: order.id, number: order.number, balance: financials(order).balance })), Math.max(0, Number(bulkAmount) || 0));
  function openPayment(order: WorkOrder) {
    setSelectedId(order.id); setPaymentDate(today()); setAmount(''); setPaymentMethod('EFECTIVO'); setError('');
  }
  function openBulk(clientId: string) {
    setBulkClientId(clientId);
    setBulkSelectedIds(data.orders.filter(order => order.clientId === clientId && financials(order).balance > 0).map(order => order.id));
    setBulkDate(today()); setBulkAmount(''); setBulkMethod('EFECTIVO'); setBulkError(''); setBulkRequestId(crypto.randomUUID());
  }
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || saving) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError('Ingresa un valor de pago mayor que cero.'); return; }
    if (parsed > currentBalance) { setError('El pago no puede superar el saldo actual de la orden.'); return; }
    if (!paymentDate || paymentDate < dateOnly(selected.createdAt) || paymentDate > today()) { setError('La fecha debe estar entre la creación de la OT y hoy.'); return; }
    setSaving(true); setError('');
    try { await addPayment(selected.id, { date: paymentDate, amount: parsed, method: paymentMethod }); setSelectedId(null); setRevision(value => value + 1); toast('Pago registrado. El saldo de la orden se actualizó.', 'success'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible registrar el pago.'); }
    finally { setSaving(false); }
  }
  async function submitBulk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bulkClientId || savingBulk) return;
    const parsed = Number(bulkAmount);
    if (!bulkSelected.length) { setBulkError('Selecciona al menos una OT del cliente.'); return; }
    if (!Number.isFinite(parsed) || parsed <= 0 || Math.abs(parsed * 100 - Math.round(parsed * 100)) > 0.000001) { setBulkError('Ingresa un pago mayor que cero con máximo dos decimales.'); return; }
    if (Math.round(parsed * 100) > Math.round(bulkDue * 100)) { setBulkError('El pago supera el saldo de las OT seleccionadas.'); return; }
    if (!bulkDate || bulkDate > today() || bulkSelected.some(order => bulkDate < dateOnly(order.createdAt))) { setBulkError('La fecha debe estar entre la creación de todas las OT seleccionadas y hoy.'); return; }
    setSavingBulk(true); setBulkError('');
    try {
      const result = await bulkPayment({ clientId: bulkClientId, selectedOrderIds: bulkSelectedIds, date: bulkDate, amount: parsed, method: bulkMethod }, bulkRequestId);
      setBulkClientId(null); setRevision(value => value + 1);
      toast(`Pago grupal registrado en ${result.allocations.length} ${result.allocations.length === 1 ? 'orden' : 'órdenes'}.`, 'success');
    } catch (reason) { setBulkError(reason instanceof Error ? reason.message : 'No fue posible registrar el pago grupal.'); }
    finally { setSavingBulk(false); }
  }
  const paymentAction = (order: WorkOrder) => financials(order).balance > 0 ? <Button variant="secondary" onClick={() => openPayment(order)}><Plus size={15} />Abono</Button> : <span className="muted">Pagada después del corte</span>;
  return <div className="page-stack analytics-page">
    <PageHeader eyebrow="CONTROL FINANCIERO" title="Cartera" description="Saldos pendientes por cliente y orden, con pagos individuales o repartidos entre varias OT." />
    <Card><div className="analytics-portfolio-filters"><SearchInput value={search} onChange={value => { setSearch(value); setPage(1); }} placeholder="Buscar cliente, OT o descripción" label="Buscar en cartera" /><Field label="Fecha de corte" htmlFor="portfolio-cutoff"><input id="portfolio-cutoff" className="input" type="date" value={cutoff} max={today()} required onChange={event => { if (event.target.value) { setCutoff(event.target.value); setPage(1); } }} /></Field><Field label="Documento" htmlFor="portfolio-document"><select id="portfolio-document" className="select" value={document} onChange={event => { setDocument(event.target.value as DocumentType | 'ALL'); setPage(1); }}><option value="ALL">REM y FACT</option><option>REM</option><option>FACT</option></select></Field><Field label="Categoría" htmlFor="portfolio-category"><select id="portfolio-category" className="select" value={category} onChange={event => { setCategory(event.target.value as Category | 'ALL'); setPage(1); }}><option value="ALL">Todas las categorías</option>{CATEGORIES.map(name => <option key={name}>{name}</option>)}</select></Field></div><label className="analytics-checkbox"><input type="checkbox" checked={finishedOnly} onChange={event => { setFinishedOnly(event.target.checked); setPage(1); }} />Solo trabajos terminados o instalados con saldo</label></Card>
    <div className="metrics-grid"><KpiCard label="Cartera con IVA" value={formatCOP(total)} icon={Wallet} tone="amber" meta={`Pagos registrados hasta ${formatDate(cutoff)}`} /><KpiCard label="Cartera sin IVA" value={formatCOP(totalWithoutIva)} icon={Wallet} tone="slate" meta="Saldo tras separar el IVA pendiente" /><KpiCard label="IVA pendiente de cobro" value={formatCOP(ivaDue)} icon={ReceiptText} tone="blue" meta="Diferencia entre cartera con y sin IVA" /><KpiCard label="Órdenes con saldo" value={rows.length} icon={Banknote} tone="orange" meta="Según los filtros seleccionados" /><KpiCard label="Clientes por cobrar" value={clientIds.size} icon={Users} tone="slate" meta="Clientes distintos con saldo pendiente" /><KpiCard label="Terminadas con saldo" value={formatCOP(sumMoney(finished.map(row => row.money.balance)))} icon={CheckCheck} tone="blue" meta={`${finished.length} órdenes terminadas o instaladas actualmente`} /></div>
    {finished.length > 0 && <div className="notice notice-warning">{finished.length} {finished.length === 1 ? 'orden está terminada o instalada y conserva' : 'órdenes están terminadas o instaladas y conservan'} saldo al corte. Terminar el trabajo no registra su pago.</div>}
    <Card><CardHeader title="Órdenes pendientes de cobro" description={`Saldos al ${formatDate(cutoff)} · estado operativo actual. Incluye órdenes creadas antes del corte.`} />{rows.length ? <><DataTable rows={rows.slice((safePage - 1) * 8, safePage * 8)} rowKey={row => row.order.id} columns={[
      { key: 'client', label: 'Cliente / orden', render: row => <div><span className="cell-title">{row.client?.name ?? 'Cliente'}</span><Link className="link" to={`/orders/${row.order.id}`}>OT #{String(row.order.number).padStart(4, '0')}</Link></div> },
      { key: 'type', label: 'Tipo', render: row => <DocumentBadge type={row.order.documentType} /> },
      { key: 'collectible', label: 'Total cobrable', render: row => formatCOP(row.money.collectible) },
      { key: 'paid', label: 'Pagado al corte', render: row => formatCOP(row.money.paid) },
      { key: 'balance', label: 'Saldo al corte', render: row => <strong className="analytics-amber money">{formatCOP(row.money.balance)}</strong> },
      { key: 'status', label: 'Trabajo actual', render: row => <WorkBadge status={row.order.status} /> },
      { key: 'actions', label: 'Registrar pago', render: row => paymentAction(row.order) },
    ]} renderCard={row => <div className="analytics-mobile-record"><div className="row"><Link className="link" to={`/orders/${row.order.id}`}>OT #{String(row.order.number).padStart(4, '0')}</Link><DocumentBadge type={row.order.documentType} /></div><strong>{row.client?.name ?? 'Cliente'}</strong><WorkBadge status={row.order.status} /><dl><div><dt>Total cobrable</dt><dd>{formatCOP(row.money.collectible)}</dd></div><div><dt>Pagado al corte</dt><dd>{formatCOP(row.money.paid)}</dd></div><div><dt>Saldo al corte</dt><dd className="analytics-amber">{formatCOP(row.money.balance)}</dd></div></dl>{paymentAction(row.order)}</div>} /><Pagination page={safePage} pageSize={8} total={rows.length} onChange={setPage} /></> : <EmptyState title="No hay saldos pendientes en esta selección" description="Prueba otras fechas o filtros para consultar la cartera." />}</Card>
    <div className="grid-2">
      <Card><CardHeader title="Cartera por cliente" description="Distribución de los saldos de la selección actual" />{byClient.length ? <ul className="analytics-debt-clients">{byClient.map(client => <li key={client.id}>
        <div><Link to={`/clients/${client.id}`} className="link">{client.name}</Link><strong>{formatCOP(client.balance)}</strong></div>
        <small className="muted">{client.count} órdenes · {formatNumber(total ? client.balance / total * 100 : 0, 1)} % de la cartera seleccionada</small>
        <div className="analytics-progress"><span style={{ width: `${total ? client.balance / total * 100 : 0}%` }} /></div>
        <Button variant="secondary" disabled={!data.orders.some(order => order.clientId === client.id && financials(order).balance > 0)} onClick={() => openBulk(client.id)}><Layers3 size={15} />Pago a varias OT</Button>
      </li>)}</ul> : <EmptyState title="Sin clientes por cobrar" />}</Card>
      <Card><CardHeader title="Trabajos terminados por cobrar" description="Estado operativo actual y saldo a la fecha de corte" />{finished.length ? <div className="analytics-order-list">{finished.map(row => <div key={row.order.id} className="analytics-finished-debt"><div><Link className="link" to={`/orders/${row.order.id}`}>OT #{String(row.order.number).padStart(4, '0')} · {row.client?.name}</Link><p>{row.order.description}</p><strong className="analytics-amber">{formatCOP(row.money.balance)}</strong></div>{paymentAction(row.order)}</div>)}</div> : <EmptyState title="Sin trabajos terminados con deuda" description="No hay órdenes terminadas o instaladas con saldo en esta selección." />}</Card>
    </div>
    <Modal open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected ? `Registrar pago · OT #${String(selected.number).padStart(4, '0')}` : 'Registrar pago'}>{selected && <form className="stack" onSubmit={submitPayment}>
      <p className="muted">{data.clients.find(client => client.id === selected.clientId)?.name}</p>
      <div className="analytics-payment-balance"><span>Saldo actual de la orden</span><strong>{formatCOP(currentBalance)}</strong></div>
      {cutoff !== today() && <p className="notice">Estás consultando un corte histórico. El formulario utiliza el saldo actual de la OT; el pago afectará los cortes desde su fecha de registro.</p>}
      <div className="form-grid"><Field label="Fecha del pago" htmlFor="portfolio-payment-date"><input id="portfolio-payment-date" className="input" type="date" required min={dateOnly(selected.createdAt)} max={today()} value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></Field><Field label="Valor del pago (COP)" htmlFor="portfolio-payment-amount"><input id="portfolio-payment-amount" className="input" type="number" inputMode="decimal" min="0.01" step="0.01" max={currentBalance} required value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" /></Field><Field label="Medio de pago" htmlFor="portfolio-payment-method"><select id="portfolio-payment-method" className="select" required value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as Exclude<PaymentMethod, 'LEGACY'>)}>{PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></Field></div>
      <div className="analytics-payment-balance"><span>Saldo después del pago</span><strong>{formatCOP(currentBalance - (Number(amount) || 0))}</strong></div>
      {error && <p className="analytics-error" role="alert">{error}</p>}
      <div className="actions"><Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>Cancelar</Button><Button type="submit" disabled={saving || currentBalance <= 0}><Banknote size={17} />Registrar pago</Button></div>
    </form>}</Modal>
    <Modal open={Boolean(bulkClientId)} onClose={() => setBulkClientId(null)} title={`Pago a varias OT · ${bulkClient?.name ?? 'Cliente'}`}>
      {bulkClientId && <form className="stack" onSubmit={submitBulk}>
        <p className="muted">Selecciona las OT de este cliente. El importe se aplica primero a las de menor saldo; las más costosas quedan para el final.</p>
        {cutoff !== today() && <p className="notice">Este pago se calcula con los saldos actuales, aunque estés consultando un corte histórico.</p>}
        <fieldset className="analytics-bulk-list"><legend>Órdenes con saldo actual</legend>{bulkCandidates.map(order => <label key={order.id} className="analytics-bulk-row"><input type="checkbox" checked={bulkSelectedIds.includes(order.id)} onChange={event => { setBulkSelectedIds(current => event.target.checked ? [...current, order.id] : current.filter(id => id !== order.id)); setBulkRequestId(crypto.randomUUID()); }} /><span>OT #{String(order.number).padStart(4, '0')} · {order.description}</span><strong>{formatCOP(financials(order).balance)}</strong></label>)}</fieldset>
        <div className="analytics-payment-balance"><span>Saldo de OT seleccionadas</span><strong>{formatCOP(bulkDue)}</strong></div>
        <div className="form-grid"><Field label="Fecha del pago" htmlFor="portfolio-bulk-date"><input id="portfolio-bulk-date" className="input" type="date" required max={today()} value={bulkDate} onChange={event => { setBulkDate(event.target.value); setBulkRequestId(crypto.randomUUID()); }} /></Field><Field label="Valor total recibido (COP)" htmlFor="portfolio-bulk-amount"><input id="portfolio-bulk-amount" className="input" type="number" inputMode="decimal" min="0.01" step="0.01" max={bulkDue} required value={bulkAmount} onChange={event => { setBulkAmount(event.target.value); setBulkRequestId(crypto.randomUUID()); }} placeholder="0" /></Field><Field label="Medio de pago" htmlFor="portfolio-bulk-method"><select id="portfolio-bulk-method" className="select" required value={bulkMethod} onChange={event => { setBulkMethod(event.target.value as Exclude<PaymentMethod, 'LEGACY'>); setBulkRequestId(crypto.randomUUID()); }}>{PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></Field></div>
        {bulkSelected.length > 0 && Number(bulkAmount) > 0 && <div className="analytics-bulk-preview"><strong>Distribución prevista</strong>{bulkPreview.map(item => <div key={item.id}><span>OT #{String(item.number).padStart(4, '0')}</span><span>{formatCOP(item.allocated)} aplicado · {formatCOP(item.remaining)} pendiente</span></div>)}</div>}
        {bulkError && <p className="analytics-error" role="alert">{bulkError}</p>}
        <div className="actions"><Button type="button" variant="secondary" onClick={() => setBulkClientId(null)}>Cancelar</Button><Button type="submit" disabled={savingBulk || !bulkSelected.length || !Number(bulkAmount)}><Layers3 size={17} />Registrar pago grupal</Button></div>
      </form>}
    </Modal>
  </div>;
}
