import { useSearchParams } from 'react-router-dom';
import { AuditHistory } from '../components/AuditHistory';
import { PageHeader } from '../components/ui';
import './history.css';

export function HistoryPage() {
  const [params] = useSearchParams();
  const orderId = params.get('orderId') || undefined;
  return <div className="page-stack"><PageHeader eyebrow="TRAZABILIDAD" title="Historial" description={orderId ? 'Todos los cambios registrados para esta orden.' : 'Cambios realizados en las órdenes, con responsable, fecha, hora y detalle.'}/><AuditHistory orderId={orderId}/></div>;
}
