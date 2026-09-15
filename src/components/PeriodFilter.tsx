import { useId, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type { DateRange } from '../domain/types';
import { isCalendarDate, today } from '../domain/utils';

type Mode = 'day' | 'month' | 'dates' | 'months';
export const monthEnd = (month: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return '';
  const end = new Date(`${month}-01T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return `${month}-${end.getUTCDate()}`;
};
export const periodMode = (range: DateRange): Mode => range.from === range.to ? 'day' : range.from.endsWith('-01') && range.to === monthEnd(range.from.slice(0, 7)) ? 'month' : 'dates';
export function PeriodFilter({ value, onChange }: { value: DateRange; onChange: (value: DateRange) => void }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>(() => periodMode(value));
  const [draft, setDraft] = useState<DateRange>(value);
  const [error, setError] = useState('');
  function update(next: DateRange) {
    setDraft(next);
    if (!isCalendarDate(next.from) || !isCalendarDate(next.to)) { setError('Completa las dos fechas válidas del período.'); return; }
    if (next.from > next.to) { setError('El inicio debe ser anterior o igual al final.'); return; }
    setError(''); onChange(next);
  }
  function select(nextMode: Mode) {
    setMode(nextMode); setError('');
    const next = nextMode === 'day' ? { from: today(), to: today() } : nextMode === 'month' ? { from: `${today().slice(0,7)}-01`, to: monthEnd(today().slice(0,7)) } : nextMode === 'months' ? { from: `${value.from.slice(0,7)}-01`, to: monthEnd(value.to.slice(0,7)) } : value;
    setDraft(next); onChange(next);
  }
  return <div className="period-filter"><div className="period-modes" role="group" aria-label="Tipo de período"><CalendarDays size={16} aria-hidden="true" />{([['day','Día'],['month','Mes'],['dates','Rango de fechas'],['months','Rango de meses']] as const).map(([key,label]) => <button key={key} type="button" aria-pressed={mode === key} className={mode === key ? 'active' : ''} onClick={() => select(key)}>{label}</button>)}</div><div className="period-inputs">
    {mode === 'day' && <><label className="sr-only" htmlFor={`${id}-day`}>Fecha del reporte</label><input className="input" id={`${id}-day`} type="date" value={draft.from} onChange={e => update({ from:e.target.value,to:e.target.value })} /></>}
    {mode === 'month' && <><label className="sr-only" htmlFor={`${id}-month`}>Mes del reporte</label><input className="input" id={`${id}-month`} type="month" value={draft.from.slice(0,7)} onChange={e => update({from: e.target.value ? `${e.target.value}-01` : '',to: monthEnd(e.target.value)})} /></>}
    {mode === 'dates' && <><label htmlFor={`${id}-from`}>Desde</label><input className="input" id={`${id}-from`} type="date" value={draft.from} max={draft.to || undefined} onChange={e => update({...draft,from:e.target.value})} /><label htmlFor={`${id}-to`}>Hasta</label><input className="input" id={`${id}-to`} type="date" value={draft.to} min={draft.from || undefined} onChange={e => update({...draft,to:e.target.value})} /></>}
    {mode === 'months' && <><label htmlFor={`${id}-from-month`}>Desde</label><input className="input" id={`${id}-from-month`} type="month" value={draft.from.slice(0,7)} max={draft.to.slice(0,7) || undefined} onChange={e => update({...draft,from:e.target.value ? `${e.target.value}-01` : ''})} /><label htmlFor={`${id}-to-month`}>Hasta</label><input className="input" id={`${id}-to-month`} type="month" value={draft.to.slice(0,7)} min={draft.from.slice(0,7) || undefined} onChange={e => update({...draft,to:monthEnd(e.target.value)})} /></>}
  </div>{error && <span className="field-error" role="alert">{error}</span>}</div>;
}
