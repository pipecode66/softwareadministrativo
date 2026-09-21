import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, CircleDashed, ClipboardCheck, FileText, Hammer, Inbox, Printer, Search, Wallet, X, type LucideIcon } from 'lucide-react';
import type { DocumentType, PaymentStatus, WorkStatus } from '../domain/types';
import { STATUS_LABELS } from '../domain/utils';

export function Button({ variant = 'primary', className = '', children, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) { return <button type={type} className={`btn btn-${variant} ${className}`} {...props}>{children}</button>; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) { return <header className="page-heading"><div>{eyebrow && <p className="eyebrow"><span />{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="page-heading-actions">{actions}</div>}</header>; }
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="card-header"><div><h2>{title}</h2>{description && <p className="muted">{description}</p>}</div>{action}</div>; }
export function KpiCard({ label, value, icon: Icon, meta, tone = 'orange' }: { label: string; value: ReactNode; icon?: LucideIcon; meta?: ReactNode; tone?: 'orange' | 'blue' | 'green' | 'amber' | 'slate' }) { return <section className={`kpi-card kpi-${tone}`}><div className="kpi-top"><span className="kpi-label">{label}</span>{Icon && <span className="kpi-icon"><Icon size={19} strokeWidth={1.8} /></span>}</div><div className="kpi-value">{value}</div>{meta && <div className="kpi-meta">{meta}</div>}</section>; }
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Inbox size={26} strokeWidth={1.5} /></div><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>; }
const workIcons: Record<WorkStatus, LucideIcon> = { NEW: FileText, PENDING_ADMIN_REVIEW: ClipboardCheck, IN_PRINTING: Printer, IN_WORKSHOP: Hammer, IN_EXTERNAL: ClipboardCheck, IN_PRODUCTION: ClipboardCheck, PENDING_INSTALLATION: Hammer, COMPLETED: Check, INSTALLED: Check };
export function WorkBadge({ status }: { status: WorkStatus }) { const Icon = workIcons[status]; const tone = ['NEW','PENDING_ADMIN_REVIEW'].includes(status) ? 'amber' : status === 'IN_PRINTING' ? 'red' : ['IN_WORKSHOP','PENDING_INSTALLATION'].includes(status) ? 'blue' : status === 'IN_EXTERNAL' ? 'slate' : 'green'; return <span className={`badge badge-${tone}`}><Icon size={13} aria-hidden="true" />{STATUS_LABELS[status]}</span>; }
export function PaymentBadge({ status }: { status: PaymentStatus }) { const Icon = status === 'PAID' ? Check : status === 'PARTIAL' ? Wallet : CircleDashed; return <span className={`badge badge-${status === 'PAID' ? 'green' : 'amber'}`}><Icon size={13} aria-hidden="true" />{status === 'PAID' ? 'Pagada' : status === 'PARTIAL' ? 'Abono' : status === 'SPECIAL' ? 'Especial' : 'Pendiente'}</span>; }
export function DocumentBadge({ type }: { type: DocumentType }) { return <span className={`badge document-badge ${type === 'FACT' ? 'badge-violet' : 'badge-slate'}`}>{type}</span>; }
export function SearchInput({ value, onChange, placeholder = 'Buscar…', label = 'Buscar' }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string }) { const id = useId(); return <div className="search-input"><label className="sr-only" htmlFor={id}>{label}</label><Search size={17} aria-hidden="true" /><input id={id} type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>; }
export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: ReactNode; hint?: ReactNode; children: ReactNode }) { return <div className={`field ${error ? 'field-invalid' : ''}`}><label htmlFor={htmlFor}>{label}</label>{children}{hint && <span className="field-hint">{hint}</span>}{error && <span className="field-error" role="alert">{error}</span>}</div>; }
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const firstField = ref.current?.querySelector<HTMLElement>('.modal-body input:not([disabled]):not([type="hidden"]),.modal-body select:not([disabled]),.modal-body textarea:not([disabled])');
      (firstField || ref.current?.querySelector<HTMLElement>('button:not([disabled])') || ref.current)?.focus();
    });
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || []).filter(el => el.getClientRects().length);
      if (!items.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = original; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [open]);
  if (!open) return null;
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><div className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar ventana"><X size={20} /></button></div><div className="modal-body">{children}</div></div></div>, document.body);
}
export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><p>Mostrando <strong>{total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)}</strong> de {total}</p><nav aria-label="Paginación"><button className="icon-button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft size={16} /></button><span className="page-current">{page}</span><span className="muted">de {pages}</span><button className="icon-button" aria-label="Página siguiente" disabled={page >= pages} onClick={() => onChange(page + 1)}><ArrowRight size={16} /></button></nav></div>;
}
export function DataTable<T>({ columns, rows, rowKey, renderCard }: { columns: { key: string; label: string; render: (row: T) => ReactNode; className?: string }[]; rows: T[]; rowKey: (row: T) => string; renderCard: (row: T) => ReactNode }) { return <><div className="desktop-table"><table className="table"><thead><tr>{columns.map(col => <th scope="col" key={col.key} className={col.className}>{col.label || <span className="sr-only">Acciones</span>}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(col => <td key={col.key} className={col.className}>{col.render(row)}</td>)}</tr>)}</tbody></table></div><div className="mobile-records">{rows.map(row => <div className="mobile-record" key={rowKey(row)}>{renderCard(row)}</div>)}</div></>; }
