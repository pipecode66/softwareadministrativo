import { useEffect, useState } from 'react';
import { Banknote, ChartNoAxesCombined, ReceiptText, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../data/AppContext';
import { PeriodFilter } from '../components/PeriodFilter';
import { Card, CardHeader, DataTable, EmptyState, Field, KpiCard, PageHeader } from '../components/ui';
import type { Category, DateRange, DocumentType, WorkOrder } from '../domain/types';
import { CATEGORIES, currentMonthRange, dateOnly, financials, formatCOP, formatNumber, inRange, isCalendarDate, roundMoney } from '../domain/utils';
import './analytics.css';

export const CATEGORY_COLORS = ['#f97316', '#2563eb', '#d99b05', '#64748b'];
export const shortMoney = (n: number) => Math.abs(n) >= 1_000_000 ? `$${formatNumber(n / 1_000_000, 1)} M` : Math.abs(n) >= 1_000 ? `$${formatNumber(n / 1_000, 0)} mil` : `$${formatNumber(n, 0)}`;
export const sumMoney = (values: number[]) => values.reduce((sum, value) => sum + Math.round(roundMoney(value) * 100), 0) / 100;

export function reportSummary(orders: WorkOrder[], range: DateRange, category: Category | 'ALL' = 'ALL', document: DocumentType | 'ALL' = 'ALL') {
  const relevant = orders.filter(order => (category === 'ALL' || order.category === category) && (document === 'ALL' || order.documentType === document));
  const sales = relevant.filter(order => inRange(order.createdAt, range));
  const paymentsInPeriod = (source: WorkOrder[]) => sumMoney(source.flatMap(order => order.payments.filter(payment => inRange(payment.date, range)).map(payment => payment.amount)));
  const debtAtCutoff = (source: WorkOrder[]) => sumMoney(source.filter(order => dateOnly(order.createdAt) <= range.to).map(order => financials(order, range.to).balance));
  const categories = CATEGORIES.filter(name => category === 'ALL' || name === category).map(name => {
    const categorySales = sales.filter(order => order.category === name);
    const categorySource = relevant.filter(order => order.category === name);
    return { name, count: categorySales.length, base: sumMoney(categorySales.map(order => order.value)), iva: sumMoney(categorySales.map(order => financials(order).iva)), received: paymentsInPeriod(categorySource), balance: debtAtCutoff(categorySource) };
  });
  const documents = (['FACT', 'REM'] as const).filter(type => document === 'ALL' || document === type).map(type => {
    const list = sales.filter(order => order.documentType === type).map(order => financials(order));
    return { type, count: list.length, base: sumMoney(list.map(money => money.base)), iva: sumMoney(list.map(money => money.iva)), gross: sumMoney(list.map(money => money.gross)), retentions: sumMoney(list.map(money => money.retentions)), collectible: sumMoney(list.map(money => money.collectible)) };
  });
  return { sales, received: paymentsInPeriod(relevant), base: sumMoney(sales.map(order => order.value)), factGross: sumMoney(sales.filter(order => order.documentType === 'FACT').map(order => financials(order).gross)), balance: debtAtCutoff(relevant), categories, documents };
}

export function periodBuckets(range: DateRange) {
  const start = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);
  if (!isCalendarDate(range.from) || !isCalendarDate(range.to) || start > end) return { monthly: false, buckets: [] as { key: string; label: string }[] };
  const monthly = (end.getTime() - start.getTime()) / 86_400_000 > 62;
  const cursor = new Date(start);
  if (monthly) cursor.setDate(1);
  const buckets: { key: string; label: string }[] = [];
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    buckets.push({ key: monthly ? `${year}-${month}` : `${year}-${month}-${day}`, label: cursor.toLocaleDateString('es-CO', monthly ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }) });
    if (monthly) cursor.setMonth(cursor.getMonth() + 1); else cursor.setDate(cursor.getDate() + 1);
  }
  return { monthly, buckets };
}

export function SalesChart({ orders, range }: { orders: WorkOrder[]; range: DateRange }) {
  const { monthly, buckets } = periodBuckets(range);
  const chart = buckets.map(bucket => ({ ...bucket, REM: 0, FACT: 0 }));
  for (const order of orders) {
    const date = dateOnly(order.createdAt);
    const bucket = chart.find(item => item.key === (monthly ? date.slice(0, 7) : date));
    if (bucket && inRange(order.createdAt, range)) bucket[order.documentType] = sumMoney([bucket[order.documentType], order.value]);
  }
  if (!orders.length) return <EmptyState title="Sin ventas en este período" description="Cambia los filtros o registra una orden para consultar su distribución." />;
  return <>
    <div className="analytics-chart" aria-label="Gráfico de ventas base por fecha y tipo de documento">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart} barGap={3} margin={{ top: 12, right: 6, bottom: 8, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} tick={{ fontSize: 11, fill: '#64748b' }} />
          <YAxis tickFormatter={shortMoney} tickLine={false} axisLine={false} width={68} tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip formatter={value => formatCOP(Number(value))} contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }} />
          <Bar dataKey="FACT" name="FACT · base" fill="#f97316" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="REM" name="REM · base" fill="#a6b4d2" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="analytics-legend"><span><i style={{ background: '#f97316' }} />FACT · antes de IVA</span><span><i style={{ background: '#a6b4d2' }} />REM · valor base</span></div>
    <details className="analytics-chart-data"><summary>Consultar valores del gráfico</summary><div className="analytics-table-scroll"><table className="table"><caption className="sr-only">Ventas base en COP por período y documento</caption><thead><tr><th>Período</th><th>FACT · base</th><th>REM · base</th></tr></thead><tbody>{chart.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{formatCOP(row.FACT)}</td><td>{formatCOP(row.REM)}</td></tr>)}</tbody></table></div></details>
  </>;
}

export function CategoryChart({ orders, categoryRows }: { orders: WorkOrder[]; categoryRows?: Array<{ name: string; base: number }> }) {
  const chart = CATEGORIES.map((name, index) => ({ name, value: categoryRows?.find(row => row.name === name)?.base ?? sumMoney(orders.filter(order => order.category === name).map(order => order.value)), color: CATEGORY_COLORS[index] }));
  const total = sumMoney(chart.map(item => item.value));
  if (!total) return <EmptyState title="Sin valores para distribuir" description="Las categorías aparecerán cuando existan órdenes en la selección." />;
  return <div className="analytics-donut-layout">
    <div className="analytics-donut" aria-label="Distribución de ventas base por categoría">
      <ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie data={chart.filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="89%" paddingAngle={2} stroke="none" isAnimationActive={false}>{chart.filter(row => row.value > 0).map(row => <Cell key={row.name} fill={row.color} />)}</Pie><Tooltip formatter={value => formatCOP(Number(value))} /></PieChart></ResponsiveContainer>
      <div className="analytics-donut-center"><span>Total base</span><strong>{shortMoney(total)}</strong></div>
    </div>
    <ul className="analytics-breakdown">{chart.map(row => <li key={row.name}><span><i style={{ background: row.color }} />{row.name}</span><div><strong>{formatNumber(row.value / total * 100, 1)} %</strong><small>{formatCOP(row.value)}</small></div></li>)}</ul>
  </div>;
}

export function ReportsPage() {
  const { data, usingApi, loadSalesReport, toast } = useApp();
  const [range, setRange] = useState<DateRange>(currentMonthRange);
  const [category, setCategory] = useState<Category | 'ALL'>('ALL');
  const [document, setDocument] = useState<DocumentType | 'ALL'>('ALL');
  const [remoteReport, setRemoteReport] = useState<Awaited<ReturnType<typeof loadSalesReport>> | null>(null);
  useEffect(() => {
    if (!usingApi) { setRemoteReport(null); return; }
    let active = true;
    void loadSalesReport({ from: range.from, to: range.to, category: category === 'ALL' ? undefined : category, documentType: document === 'ALL' ? undefined : document })
      .then(report => { if (active) setRemoteReport(report); })
      .catch(error => { if (active) toast(error instanceof Error ? error.message : 'No se pudo cargar el reporte.', 'error'); });
    return () => { active = false; };
  }, [category, document, range.from, range.to, usingApi]);
  const local = reportSummary(data.orders, range, category, document);
  const report = remoteReport ? {
    ...local,
    received: remoteReport.totals.received, base: remoteReport.totals.base, factGross: remoteReport.totals.factGross, balance: remoteReport.totals.balance,
    categories: remoteReport.categories.map(row => ({ name: row.category, count: row.count, base: row.base, iva: row.iva, received: row.received, balance: row.balance })),
    documents: remoteReport.documents.map(row => ({ type: row.documentType, count: row.count, base: row.base, iva: row.iva, gross: row.gross, retentions: row.retentions, collectible: row.collectible })),
  } : local;
  const { sales, received, base, factGross, balance, categories, documents } = report;
  return <div className="page-stack analytics-page">
    <PageHeader eyebrow="ANÁLISIS COMERCIAL" title="Reportes de ventas" description="Ventas, recaudo y cartera: cada indicador con su fecha y criterio de cálculo." />
    <Card><div className="analytics-filters"><PeriodFilter value={range} onChange={setRange} /><div className="analytics-filter-pair"><Field label="Categoría" htmlFor="reports-category"><select id="reports-category" className="select" value={category} onChange={event => setCategory(event.target.value as Category | 'ALL')}><option value="ALL">Todas las categorías</option>{CATEGORIES.map(name => <option key={name}>{name}</option>)}</select></Field><Field label="Documento" htmlFor="reports-document"><select id="reports-document" className="select" value={document} onChange={event => setDocument(event.target.value as DocumentType | 'ALL')}><option value="ALL">REM y FACT</option><option>REM</option><option>FACT</option></select></Field></div></div></Card>
    <div className="metrics-grid">
      <KpiCard label="Ventas · valor base" value={formatCOP(base)} icon={ChartNoAxesCombined} tone="orange" meta={`${sales.length} órdenes creadas en el período`} />
      <KpiCard label="FACT · total con IVA" value={formatCOP(factGross)} icon={ReceiptText} tone="blue" meta="Órdenes FACT del período, antes de retenciones" />
      <KpiCard label="Pagos recibidos" value={formatCOP(received)} icon={Banknote} tone="green" meta="Por fecha del pago, incluso de órdenes anteriores" />
      <KpiCard label="Cartera al corte" value={formatCOP(balance)} icon={Wallet} tone="amber" meta={`Saldo acumulado hasta ${range.to}`} />
    </div>
    <div className="analytics-main-grid"><Card><CardHeader title="Ventas en el tiempo" description="Fecha de creación de la OT · valores antes de IVA" /><SalesChart orders={sales} range={range} /></Card><Card><CardHeader title="Ventas por categoría" description="Participación sobre el valor base del período" /><CategoryChart orders={sales} categoryRows={categories} /></Card></div>
    <Card><CardHeader title="Desglose por categoría" description="Los pagos se agrupan por su propia fecha; la cartera incluye órdenes anteriores al período." /><DataTable rows={categories} rowKey={row => row.name} columns={[
      { key: 'category', label: 'Categoría', render: row => <strong>{row.name}</strong> },
      { key: 'count', label: 'Órdenes', render: row => row.count },
      { key: 'base', label: 'Ventas base', render: row => formatCOP(row.base) },
      { key: 'iva', label: 'IVA', render: row => formatCOP(row.iva) },
      { key: 'received', label: 'Pagos del período', render: row => formatCOP(row.received) },
      { key: 'balance', label: 'Cartera al corte', render: row => <strong className="analytics-amber">{formatCOP(row.balance)}</strong> },
    ]} renderCard={row => <div className="analytics-mobile-record"><strong>{row.name} <span className="muted">· {row.count} OT</span></strong><dl><div><dt>Ventas base</dt><dd>{formatCOP(row.base)}</dd></div><div><dt>IVA</dt><dd>{formatCOP(row.iva)}</dd></div><div><dt>Pagos del período</dt><dd>{formatCOP(row.received)}</dd></div><div><dt>Cartera al corte</dt><dd>{formatCOP(row.balance)}</dd></div></dl></div>} /></Card>
    <Card><CardHeader title="Control REM / FACT" description="Órdenes creadas en el período seleccionado. Los importes de retención son manuales." /><DataTable rows={documents} rowKey={row => row.type} columns={[
      { key: 'type', label: 'Documento', render: row => <strong>{row.type} · {row.count} OT</strong> },
      { key: 'base', label: 'Valor base', render: row => formatCOP(row.base) },
      { key: 'iva', label: 'IVA', render: row => formatCOP(row.iva) },
      { key: 'gross', label: 'Total con IVA', render: row => formatCOP(row.gross) },
      { key: 'retentions', label: 'Retenciones', render: row => formatCOP(row.retentions) },
      { key: 'collectible', label: 'Total cobrable', render: row => <strong>{formatCOP(row.collectible)}</strong> },
    ]} renderCard={row => <div className="analytics-mobile-record"><strong>{row.type} · {row.count} órdenes</strong><dl><div><dt>Valor base</dt><dd>{formatCOP(row.base)}</dd></div><div><dt>IVA</dt><dd>{formatCOP(row.iva)}</dd></div><div><dt>Total con IVA</dt><dd>{formatCOP(row.gross)}</dd></div><div><dt>Retenciones</dt><dd>{formatCOP(row.retentions)}</dd></div><div><dt>Total cobrable</dt><dd>{formatCOP(row.collectible)}</dd></div></dl></div>} /></Card>
    <p className="analytics-footnote">FACT es una clasificación de control interno. Esta aplicación no emite facturas electrónicas ni está conectada con la DIAN.</p>
  </div>;
}
