import { useEffect, useState, type ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { apiReceivables, type ReceivableReport } from '../data/api';
import { receivableItems, type ReceivableQuery } from '../domain/receivables';
import { formatCOP } from '../domain/utils';
import { Button, DocumentBadge, KpiCard, Pagination } from './ui';

type Props = Omit<ComponentProps<typeof KpiCard>, 'value' | 'children'> & {
  amount: number | null; query: ReceivableQuery; revision?: number | string;
};

export function ReceivableKpi({ amount, query, revision = 0, ...props }: Props) {
  const { data, usingApi } = useApp();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [remote, setRemote] = useState<{ key: string; report: ReceivableReport } | null>(null);
  const [error, setError] = useState('');
  const queryKey = JSON.stringify(query);
  const requestKey = `${queryKey}|${revision}|${page}|${attempt}`;
  const pageSize = 10;
  useEffect(() => { setPage(1); }, [queryKey]);
  useEffect(() => {
    if (!open || !usingApi) return;
    let active = true;
    setError('');
    void apiReceivables({ ...query, page, pageSize }).then(report => {
      if (active) setRemote({ key: requestKey, report });
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'No fue posible consultar las órdenes pendientes.');
    });
    return () => { active = false; };
  }, [open, requestKey, usingApi]);
  const current = remote?.key === requestKey ? remote.report : null;
  const local = usingApi ? [] : receivableItems(data.orders, data.clients, query);
  const items = usingApi ? current?.items ?? [] : local.slice((page - 1) * pageSize, page * pageSize);
  const count = usingApi ? current?.total ?? 0 : local.length;
  const loading = usingApi && open && !current && !error;
  const shownAmount = usingApi && open && current ? current.totalAmount : amount;
  return <KpiCard {...props} value={shownAmount === null ? '—' : formatCOP(shownAmount)}>
    <details className="analytics-receivable" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Ver OT pendientes <ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="analytics-receivable-body">
        {loading ? <p className="muted" role="status">Consultando órdenes…</p> : error ? <div role="alert"><p className="analytics-error">{error}</p><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button></div> : <>
          <p className="muted">{count} {count === 1 ? 'OT pendiente' : 'OT pendientes'} · número de mayor a menor</p>
          {items.length ? <ol className="analytics-receivable-list">{items.map(item => <li key={item.orderId}>
            <div className="analytics-receivable-heading"><Link className="link" to={`/orders/${item.orderId}`}>OT #{String(item.number).padStart(4, '0')}</Link><DocumentBadge type={item.documentType} /></div>
            <strong>{item.clientName}</strong><span>{item.description}</span>
            <div className="analytics-receivable-amount"><span>Valor pendiente</span><strong>{formatCOP(item.amount)}</strong></div>
          </li>)}</ol> : <p className="muted">No hay órdenes pendientes para este concepto.</p>}
          {count > pageSize && <Pagination page={page} pageSize={pageSize} total={count} onChange={setPage} />}
        </>}
      </div>
    </details>
  </KpiCard>;
}
