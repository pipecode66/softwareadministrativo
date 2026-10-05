import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Clock3, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiHistory, type AuditEvent } from '../data/api';
import { useApp } from '../data/AppContext';
import { formatCOP, formatDate, isAdmin, ROLE_LABELS } from '../domain/utils';
import { Card, EmptyState, Pagination } from './ui';
import '../pages/history.css';

const actionFallback: Record<string,string> = {
  create:'Creó la orden de trabajo.', edit:'Editó la orden de trabajo.', payment:'Registró un pago.',
  send:'Envió la OT a producción.', finishPrinting:'Finalizó Impresión.', finishExternal:'Finalizó Externo.',
  startWorkshop:'Inició Taller.', finishWorkshop:'Finalizó Taller.', install:'Registró la instalación.', close:'Cerró la OT.',
  designDetails:'Editó la preparación técnica de Diseño.', assignDesign:'Asignó Diseño.',
  startActivity:'Inició una actividad.', completeActivity:'Finalizó una actividad.', finishProduction:'Finalizó la producción.',
  laserMinutes:'Registró minutos de Corte Láser.', certificates:'Actualizó certificados de retención.',
};
function value(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return 'Sin dato';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number' && /valor|rete|iva|ica|cobro/i.test(label)) return formatCOP(value);
  return String(value);
}

export function AuditHistory({ orderId, compact = false }: { orderId?: string; compact?: boolean }) {
  const { user } = useApp();
  const [items,setItems] = useState<AuditEvent[]>([]);
  const [page,setPage] = useState(1);
  const [total,setTotal] = useState(0);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const pageSize = compact ? 8 : 20;
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void apiHistory({ orderId,page,pageSize }).then(result => {
      if (active) { setItems(result.items); setTotal(result.total); setLoading(false); }
    }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : 'No fue posible consultar el historial.'); setLoading(false); } });
    return () => { active = false; };
  }, [orderId,page,pageSize]);
  return <Card className="audit-history-card">
    {compact && <div className="card-header"><div><h2>Historial de cambios</h2><p className="muted">Quién modificó esta OT y qué hizo.</p></div>{isAdmin(user?.role) && <Link className="link" to={`/history?orderId=${orderId}`}>Ver historial completo <ArrowRight size={14}/></Link>}</div>}
    {error && <p className="notice notice-warning" role="alert">{error}</p>}
    {loading && !items.length ? <p className="muted">Cargando historial…</p> : !items.length ? <EmptyState title="Sin cambios registrados" description="Los próximos movimientos de esta OT aparecerán aquí."/> : <div className="audit-list">{items.map(item => <details className="audit-event" key={item.id}>
      <summary><span className="audit-icon"><History size={17}/></span><span className="audit-main"><strong>{item.details.summary || actionFallback[item.action] || 'Actualizó la OT.'}</strong><small>{item.actor.name} · {ROLE_LABELS[item.actor.role]}</small></span><span className="audit-time"><Clock3 size={14}/>{formatDate(item.occurredAt,true)}</span><ChevronDown className="audit-chevron" size={17}/></summary>
      <div className="audit-detail">{!orderId && <Link className="audit-order-link" to={`/orders/${item.orderId}`}>Abrir OT #{String(item.orderNumber).padStart(4,'0')} <ArrowRight size={14}/></Link>}
        {item.details.changes.length ? <dl>{item.details.changes.map((change,index) => <div key={`${change.label}-${index}`}><dt>{change.label}</dt><dd>{change.before !== undefined && <><span>{value(change.before,change.label)}</span><ArrowRight size={13}/></>}<strong>{value(change.after,change.label)}</strong></dd></div>)}</dl> : <p className="muted">Este registro histórico no contiene un desglose adicional.</p>}
      </div>
    </details>)}</div>}
    {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage}/>} 
  </Card>;
}
