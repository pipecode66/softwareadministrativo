import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Ruler } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../data/AppContext';
import { PeriodFilter } from '../components/PeriodFilter';
import { Card, CardHeader, DataTable, EmptyState, Field, KpiCard, PageHeader, Pagination } from '../components/ui';
import { areaOf, currentMonthRange, dateOnly, formatDate, formatNumber, inRange, MATERIALS } from '../domain/utils';
import type { DateRange, Material, WorkOrder } from '../domain/types';
import { periodBuckets } from './Reports';
import './analytics.css';

const MATERIAL_COLORS = ['#2563eb', '#64748b', '#ac8776', '#f97316', '#9a4809'];
export const materialConsumption = (orders: WorkOrder[], range: DateRange, material: Material | 'ALL' = 'ALL') => orders
  .filter(order => order.printing && order.printingCompletedAt && inRange(order.printingCompletedAt, range) && (material === 'ALL' || material === order.printing.material))
  .map(order => ({ order, material: order.printing!.material, area: areaOf(order.printing), completedAt: order.printingCompletedAt! }))
  .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

export function MaterialsPage() {
  const { data, loadMaterialReport, toast, usingApi } = useApp();
  const [range, setRange] = useState<DateRange>(currentMonthRange);
  const [material, setMaterial] = useState<Material | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const rows = materialConsumption(data.orders, range, material);
  const { monthly, buckets } = periodBuckets(range);
  const [remoteReport, setRemoteReport] = useState<Awaited<ReturnType<typeof loadMaterialReport>> | null>(null);
  useEffect(() => {
    if (!usingApi) { setRemoteReport(null); return; }
    let active = true;
    void loadMaterialReport({ from: range.from, to: range.to, groupBy: monthly ? 'month' : 'day', material: material === 'ALL' ? undefined : material })
      .then(report => { if (active) setRemoteReport(report); })
      .catch(error => { if (active) toast(error instanceof Error ? error.message : 'No se pudo cargar el consumo de materiales.', 'error'); });
    return () => { active = false; };
  }, [material, monthly, range.from, range.to, usingApi]);
  const localTotal = rows.reduce((sum, row) => sum + row.area, 0);
  const localMaterials = MATERIALS.map((name, index) => ({ name, color: MATERIAL_COLORS[index], value: rows.filter(row => row.material === name).reduce((sum, row) => sum + row.area, 0), count: rows.filter(row => row.material === name).length }));
  const total = remoteReport?.totalM2 ?? localTotal;
  const materials = remoteReport ? MATERIALS.map((name, index) => { const row = remoteReport.materials.find(item => item.material === name); return { name, color: MATERIAL_COLORS[index], value: row?.m2 ?? 0, count: row?.count ?? 0 }; }) : localMaterials;
  const localTimeline = buckets.map(bucket => ({ ...bucket, area: rows.filter(row => (monthly ? dateOnly(row.completedAt).slice(0, 7) : dateOnly(row.completedAt)) === bucket.key).reduce((sum, row) => sum + row.area, 0) }));
  const timeline = remoteReport ? remoteReport.timeline.map(item => ({ key: item.period, label: item.period, area: item.m2 })) : localTimeline;
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  return <div className="page-stack analytics-page">
    <PageHeader eyebrow="CONTROL DE PRODUCCIÓN" title="Materiales de impresión" description="Superficie registrada al completar impresión, separada por tipo de material." />
    <Card><div className="analytics-filters"><PeriodFilter value={range} onChange={value => { setRange(value); setPage(1); }} /><Field label="Material" htmlFor="materials-filter"><select id="materials-filter" className="select" value={material} onChange={event => { setMaterial(event.target.value as Material | 'ALL'); setPage(1); }}><option value="ALL">Todos los materiales</option>{MATERIALS.map(name => <option key={name}>{name}</option>)}</select></Field></div></Card>
    <Card className="analytics-material-banner"><div><span className="analytics-banner-icon"><Ruler size={26} /></span><div><span className="eyebrow">SUPERFICIE IMPRESA DEL PERÍODO</span><strong>{formatNumber(total, 3)} <small>m²</small></strong><span className="muted">{rows.length} órdenes con impresión finalizada</span></div></div><div className="analytics-material-strip"><div>{materials.map(row => <span key={row.name} title={`${row.name}: ${formatNumber(row.value, 3)} m²`} style={{ background: row.color, width: `${total ? row.value / total * 100 : 0}%` }} />)}</div><span>Distribución entre los cinco materiales del catálogo</span></div></Card>
    <div className="analytics-material-grid">{materials.map(row => <div key={row.name} className="analytics-material-kpi" style={{ borderTopColor: row.color }}><KpiCard label={row.name} value={<>{formatNumber(row.value, 3)} <small>m²</small></>} icon={Layers} tone="slate" meta={`${row.count} órdenes en la selección`} /></div>)}</div>
    <div className="analytics-material-charts"><Card><CardHeader title="Distribución de superficie" description="Participación por material · metros cuadrados" />{total > 0 ? <><div className="analytics-donut analytics-material-donut" aria-label="Distribución de superficie impresa por material"><ResponsiveContainer width="100%" height="100%"><PieChart accessibilityLayer><Pie isAnimationActive={false} data={materials.filter(row => row.value > 0)} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="89%" paddingAngle={2} stroke="none">{materials.filter(row => row.value > 0).map(row => <Cell key={row.name} fill={row.color} />)}</Pie><Tooltip formatter={value => `${formatNumber(Number(value), 3)} m²`} /></PieChart></ResponsiveContainer><div className="analytics-donut-center"><span>Total impreso</span><strong>{formatNumber(total, 3)}</strong><small>m²</small></div></div><ul className="analytics-breakdown">{materials.map(row => <li key={row.name}><span><i style={{ background: row.color }} />{row.name}</span><div><strong>{formatNumber(row.value, 3)} m²</strong><small>{formatNumber(row.value / total * 100, 1)} %</small></div></li>)}</ul></> : <EmptyState title="Sin consumo registrado" description="Solo se contabilizan las órdenes cuya impresión ya finalizó." />}</Card>
    <Card><CardHeader title="Evolución de la superficie impresa" description={`${monthly ? 'Agrupación mensual' : 'Agrupación diaria'} · fecha de finalización de impresión`} />{rows.length ? <><div className="analytics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeline} margin={{ top: 10, right: 6, bottom: 8, left: 0 }} accessibilityLayer><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={28} /><YAxis tickFormatter={value => formatNumber(value, 1)} width={50} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} /><Tooltip formatter={value => `${formatNumber(Number(value), 3)} m²`} /><Bar isAnimationActive={false} dataKey="area" name="Superficie impresa" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={32} /></BarChart></ResponsiveContainer></div><details className="analytics-chart-data"><summary>Consultar metros cuadrados por período</summary><div className="analytics-table-scroll"><table className="table"><caption className="sr-only">Superficie impresa por período</caption><thead><tr><th>Período</th><th>Superficie</th></tr></thead><tbody>{timeline.map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{formatNumber(row.area, 3)} m²</td></tr>)}</tbody></table></div></details></> : <EmptyState title="Sin impresiones finalizadas en estas fechas" description="Cambia el período o el material para consultar otros resultados." />}<div className="analytics-card-bottom"><span>Promedio por orden impresa</span><strong>{formatNumber(rows.length ? total / rows.length : 0, 3)} m²</strong></div></Card></div>
    <Card><CardHeader title="Superficie por orden de trabajo" description="La estadística muestra únicamente m². Las dimensiones se consultan en el detalle de cada OT." />{rows.length ? <><DataTable rows={rows.slice((safePage - 1) * 8, safePage * 8)} rowKey={row => row.order.id} columns={[
      { key: 'order', label: 'Orden', render: row => <Link className="link" to={`/orders/${row.order.id}`}>OT #{String(row.order.number).padStart(4, '0')}</Link> },
      { key: 'date', label: 'Impresión finalizada', render: row => formatDate(row.completedAt) },
      { key: 'client', label: 'Cliente', render: row => data.clients.find(client => client.id === row.order.clientId)?.name ?? 'Cliente' },
      { key: 'material', label: 'Material', render: row => <span className="badge">{row.material}</span> },
      { key: 'area', label: 'Superficie', render: row => <strong className="money">{formatNumber(row.area, 3)} m²</strong> },
    ]} renderCard={row => <div className="analytics-mobile-record"><div className="row"><Link className="link" to={`/orders/${row.order.id}`}>OT #{String(row.order.number).padStart(4, '0')}</Link><span className="badge">{row.material}</span></div><strong>{data.clients.find(client => client.id === row.order.clientId)?.name ?? 'Cliente'}</strong><dl><div><dt>Impresión finalizada</dt><dd>{formatDate(row.completedAt)}</dd></div><div><dt>Superficie</dt><dd>{formatNumber(row.area, 3)} m²</dd></div></dl></div>} /><Pagination page={safePage} pageSize={8} total={rows.length} onChange={setPage} /></> : <EmptyState title="No hay órdenes para mostrar" description="Las órdenes en cola de impresión todavía no se suman al consumo." />}</Card>
  </div>;
}
