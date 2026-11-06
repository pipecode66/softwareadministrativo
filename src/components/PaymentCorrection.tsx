import { useRef, useState, type FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Payment, PaymentMethod, WorkOrder } from '../domain/types';
import { dateOnly, financials, formatCOP, formatDate, isAdmin, today } from '../domain/utils';
import { useApp } from '../data/AppContext';
import { Button, Field, Modal } from './ui';

export function PaymentCorrectionButton({ order, payment }: { order: WorkOrder; payment: Payment }) {
  const [open, setOpen] = useState(false);
  const { user } = useApp();
  if (!isAdmin(user?.role)) return null;
  return <><Button variant="ghost" onClick={() => setOpen(true)} aria-label={`Corregir pago de ${formatCOP(payment.amount)}`}><Pencil size={15}/>Corregir</Button>
    {open && <PaymentCorrectionForm order={order} payment={payment} onClose={() => setOpen(false)} />}</>;
}
function PaymentCorrectionForm({ order, payment, onClose }: { order: WorkOrder; payment: Payment; onClose: () => void }) {
  const { correctPayment, deletePayment, toast } = useApp();
  const version = useRef(order.version ?? 1);
  const originalPayment = useRef(payment).current;
  const [amount, setAmount] = useState(String(payment.amount));
  const [date, setDate] = useState(payment.date.slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>(payment.method || 'LEGACY');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [removing, setRemoving] = useState(false);
  const number = Number(amount);
  const preview = financials({ ...order, payments:removing ? order.payments.filter(item => item.id !== payment.id)
    : order.payments.map(item => item.id === payment.id ? { ...item, amount:Number.isFinite(number) ? number : 0 } : item) });
  const originalMethod = { EFECTIVO:'Efectivo', BANCOLOMBIA:'Bancolombia', DAVIVIENDA:'Davivienda', LEGACY:'Sin dato histórico' }[originalPayment.method || 'LEGACY'];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    if (!removing && (!Number.isFinite(number) || number <= 0 || Math.round(number*100)/100 !== number)) { setError('Ingresa un valor positivo con máximo dos decimales.'); return; }
    if (!removing && preview.balance < 0) { setError('Los pagos no pueden superar el total de la OT.'); return; }
    savingRef.current = true;
    setSaving(true); setError('');
    try {
      if (removing) await deletePayment(order.id, payment.id, version.current);
      else await correctPayment(order.id, payment.id, { amount:number, date, method }, version.current);
      toast(removing ? 'Abono eliminado. El saldo y los reportes se actualizaron.' : 'Pago corregido. El saldo y los reportes se actualizaron.'); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : removing ? 'No se pudo eliminar el abono.' : 'No se pudo corregir el pago.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <Modal open title="Corregir pago" onClose={() => { if (!saving) onClose(); }}><form className="stack" onSubmit={submit} aria-busy={saving}>
    <p>OT #{String(order.number).padStart(4,'0')}. {removing ? 'La eliminación dejará constancia de quién la realizó.' : 'La corrección conserva el registro y deja constancia de quién la realizó.'}</p>
    <label style={{ display:'flex', alignItems:'center', gap:8 }}><input type="checkbox" checked={removing} disabled={saving} onChange={event => { setRemoving(event.target.checked); setError(''); }} /><span>Eliminar abono</span></label>
    {removing ? <p className="notice notice-warning">Al confirmar, se eliminará el abono registrado de <strong>{formatCOP(originalPayment.amount)}</strong>, con fecha <strong>{formatDate(originalPayment.date)}</strong> y medio <strong>{originalMethod}</strong>.</p> : <>
    <Field label="Valor corregido (COP)" htmlFor="correct-payment-amount"><input id="correct-payment-amount" className="input" type="number" min="0.01" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={saving}/></Field>
    <Field label="Fecha corregida" htmlFor="correct-payment-date"><input id="correct-payment-date" className="input" type="date" min={dateOnly(order.createdAt)} max={today()} required value={date} onChange={event => setDate(event.target.value)} disabled={saving}/></Field>
    <Field label="Medio de pago corregido" htmlFor="correct-payment-method"><select id="correct-payment-method" className="select" value={method} onChange={event => setMethod(event.target.value as PaymentMethod)} disabled={saving}><option value="EFECTIVO">Efectivo</option><option value="BANCOLOMBIA">Bancolombia</option><option value="DAVIVIENDA">Davivienda</option>{payment.method === 'LEGACY' || !payment.method ? <option value="LEGACY">Sin dato histórico</option> : null}</select></Field>
    </>}
    <p aria-live="polite">{removing ? 'Saldo después de eliminar el abono:' : 'Saldo después de la corrección:'} <strong>{formatCOP(preview.balance)}</strong></p>
    {error && <p className="form-alert" role="alert">{error}</p>}
    <div className="actions"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" variant={removing ? 'danger' : 'primary'} disabled={saving}>{removing && <Trash2 size={15}/>} {saving ? removing ? 'Eliminando…' : 'Guardando…' : removing ? 'Eliminar abono' : 'Guardar corrección'}</Button></div>
  </form></Modal>;
}
