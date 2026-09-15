import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, ClipboardList, Plus, Printer, TrendingUp, Wallet, Wrench } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { PeriodFilter } from '../components/PeriodFilter';
import { Card, CardHeader, EmptyState, KpiCard, PageHeader, PaymentBadge, WorkBadge } from '../components/ui';
import { currentMonthRange, dateOnly, financials, formatCOP, formatDate } from '../domain/utils';
import type { DateRange } from '../domain/types';
import { CategoryChart, reportSummary, SalesChart } from './Reports';
import './analytics.css';

export function DashboardPage() {
  const { data, loadSalesReport, toast, usingApi, user } = useApp();
  const statisticsOnly = user?.role === 'ADMINMASTER';
  const [range, setRange] = useState<DateRange>(currentMonthRange);
  const [remoteReport, setRemoteReport] = useState<Awaited<ReturnType<typeof loadSalesReport>> | null>(null);
  useEffect(() => {
    if (!usingApi) { setRemoteReport(null); return; }
    let active = true;
    void loadSalesReport({ from: range.from, to: range.to })
      .then(report => { if (active) setRemoteReport(report); })
      .catch(error => { if (active) toast(error instanceof Error ? error.message : 'No se pudo cargar el resumen.', 'error'); });
    return () => { active = false; };
  }, [range.from, range.to, usingApi]);
  const localReport = reportSummary(data.orders, range);
  const sales = localReport.sales;
  const received = remoteReport?.totals.received ?? localReport.received;
  const base = remoteReport?.totals.base ?? localReport.base;
  const portfolio = remoteReport?.totals.balance ?? localReport.balance;
  const debts = data.orders.filter(order => dateOnly(order.createdAt) <= range.to).map(order => ({ order, money: financials(order, range.to) })).filter(row => row.money.balance > 0).sort((a, b) => b.money.balance - a.money.balance);
  const recentlyUpdated = [...data.orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const active = data.orders.filter(order => !['COMPLETED', 'INSTALLED'].includes(order.status));
  const stations = [
    { name: 'Administración', count: active.filter(order => ['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status)).length, icon: ClipboardList, description: 'Órdenes nuevas y revisión administrativa', className: 'amber', path: '/orders' },
    { name: 'Impresión', count: active.filter(order => order.status === 'IN_PRINTING').length, icon: Printer, description: 'Órdenes pendientes de completar impresión', className: 'red', path: '/printing' },
    { name: 'Taller', count: active.filter(order => order.status === 'IN_WORKSHOP').length, icon: Wrench, description: 'Trabajos de fabricación y acabados', className: 'blue', path: '/workshop' },
    { name: 'Instalación', count: active.filter(order => order.status === 'PENDING_INSTALLATION').length, icon: Wrench, description: 'Trabajos pendientes de instalar', className: 'blue', path: '/orders?status=PENDING_INSTALLATION' },
  ];
  return <div className="page-stack analytics-page">
    <PageHeader eyebrow="RESUMEN EJECUTIVO · INTERMEDIOS" title={`Hola, ${user?.name.split(' ')[0] ?? 'Administración'}`} description="Una vista clara de las estadísticas comerciales de la empresa." actions={<Link className="btn btn-primary" to="/orders/new"><Plus size={18} />Crear orden</Link>} />
    <Card><PeriodFilter value={range} onChange={setRange} /></Card>
    <div className="metrics-grid">
      <KpiCard label="Ventas del período · base" value={formatCOP(base)} icon={TrendingUp} tone="orange" meta="Por creación de OT, antes de IVA" />
      <KpiCard label="Pagos recibidos" value={formatCOP(received)} icon={Banknote} tone="green" meta="Por fecha de cada abono o pago" />
      <KpiCard label="Cartera al corte" value={formatCOP(portfolio)} icon={Wallet} tone="amber" meta={`${debts.length} órdenes con saldo al ${formatDate(range.to)}`} />
      <KpiCard label="Órdenes del período" value={sales.length} icon={ClipboardList} tone="slate" meta="Cantidad de OT creadas en las fechas seleccionadas" />
    </div>
    {!statisticsOnly && <div className="analytics-main-grid"><Card><CardHeader title="Ventas en el tiempo" description="Valores base por fecha de creación de la orden" action={<Link className="link" to="/reports">Ver reportes <ArrowRight size={15} /></Link>} /><SalesChart orders={sales} range={range} /><div className="analytics-card-bottom"><span>Valor promedio por orden</span><strong>{formatCOP(sales.length ? base / sales.length : 0)}</strong></div></Card><Card><CardHeader title="Ventas por categoría" description="Distribución del valor base del período" /><CategoryChart orders={sales} /></Card></div>}
    {!statisticsOnly && <section className="stack" aria-labelledby="dashboard-operation"><div className="analytics-section-heading"><div><h2 id="dashboard-operation">Operación actual</h2><p className="muted">Todas las órdenes activas · independiente del período de ventas</p></div><Link to="/operation" className="link">Ver operación <ArrowRight size={15} /></Link></div><div className="analytics-stations">{stations.map(station => <Link key={station.name} to={station.path} className={`analytics-station analytics-station-${station.className}`}><div className="analytics-station-top"><span><station.icon size={17} />{station.name}</span><strong>{station.count}</strong></div><p>{station.description}</p><div className="analytics-progress"><span style={{ width: `${active.length ? station.count / active.length * 100 : 0}%` }} /></div></Link>)}</div></section>}
    {!statisticsOnly && <div className="grid-2"><Card><CardHeader title="Órdenes con saldo por cobrar" description={`Mayores saldos al corte de ${formatDate(range.to)}`} action={<Link to="/portfolio" className="link">Ver cartera <ArrowRight size={15} /></Link>} />{debts.length ? <div className="analytics-order-list">{debts.slice(0, 4).map(({ order, money }) => <Link key={order.id} className="analytics-order-row" to={`/orders/${order.id}`}><div><span className="eyebrow">OT #{String(order.number).padStart(4, '0')}</span><strong>{data.clients.find(client => client.id === order.clientId)?.name ?? 'Cliente'}</strong><small className="muted">{order.description}</small></div><strong className="analytics-amber money">{formatCOP(money.balance)}</strong></Link>)}</div> : <EmptyState title="Sin cartera pendiente" description="Las órdenes incluidas en este corte no tienen saldo por cobrar." />}</Card>
    <Card><CardHeader title="Últimas órdenes actualizadas" description="Último cambio de estado operativo · todas las fechas" action={<Link to="/orders" className="link">Ver órdenes <ArrowRight size={15} /></Link>} />{recentlyUpdated.length ? <div className="analytics-order-list">{recentlyUpdated.map(order => <Link key={order.id} className="analytics-recent-row" to={`/orders/${order.id}`}><div className="analytics-recent-heading"><strong>OT #{String(order.number).padStart(4, '0')}</strong><WorkBadge status={order.status} /></div><div><PaymentBadge status={financials(order).paymentStatus} /></div><p>{order.description}</p><small className="muted">Actualizada {formatDate(order.updatedAt, true)}</small></Link>)}</div> : <EmptyState title="Aún no hay órdenes" description="Crea la primera OT para comenzar a organizar los trabajos." />}</Card></div>}
  </div>;
}
