import { useState, type FormEvent } from 'react';
import { KeyRound, Pencil, Plus, ShieldCheck, UsersRound } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { Role, User } from '../domain/types';
import { initials, ROLE_LABELS } from '../domain/utils';
import { Button, Card, DataTable, EmptyState, Field, KpiCard, Modal, PageHeader, SearchInput } from '../components/ui';

export function UsersPage() {
  const { accounts, user, saveUser, resetPassword, usingApi, dataLoading, toast } = useApp();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'ADMIN_GENERAL' as Role, active: true, password: '' });
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const rows = accounts.filter(u => `${u.name} ${u.email} ${ROLE_LABELS[u.role]}`.toLowerCase().includes(query.toLowerCase()));
  const active = accounts.filter(u => u.active).length;
  function open(value: User | 'new') {
    setEditing(value); setError('');
    setForm(value === 'new' ? { name: '', email: '', role: 'ADMIN_GENERAL', active: true, password: '' } : { name: value.name, email: value.email, role: value.role, active: value.active, password: '' });
  }
  function close() { if (!pending) { setEditing(null); setResetting(null); setTemporaryPassword(''); setForm(current => ({ ...current, password: '' })); } }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    try {
      await saveUser(form, editing && editing !== 'new' ? editing.id : undefined);
      setEditing(null); setForm(current => ({ ...current, password: '' }));
      toast(usingApi ? 'Usuario guardado en el servidor.' : 'Usuario guardado en el entorno local.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No fue posible guardar.'); }
    finally { setPending(false); }
  }
  async function submitReset(event: FormEvent) {
    event.preventDefault();
    if (pending || !resetting) return;
    setPending(true); setError('');
    try {
      await resetPassword(resetting.id, temporaryPassword);
      setResetting(null); setTemporaryPassword('');
      toast('Contraseña temporal guardada. Sus sesiones se cerraron y deberá cambiarla al ingresar.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No fue posible restablecer la contraseña.'); }
    finally { setPending(false); }
  }
  function actions(account: User) {
    return <div className="row wrap"><Button variant="ghost" onClick={() => open(account)}><Pencil size={15}/>Editar</Button>{usingApi && account.id !== user?.id && <Button variant="ghost" onClick={() => { setResetting(account); setTemporaryPassword(''); setError(''); }}><KeyRound size={15}/>Restablecer contraseña</Button>}</div>;
  }
  if (user?.role !== 'ADMINMASTER') return <EmptyState title="Acceso restringido" description="La gestión de usuarios corresponde a Adminmaster."/>;
  return <div className="page-stack">
    <PageHeader eyebrow="CONTROL DE ACCESOS" title="Usuarios y perfiles" description="Define quién participa en cada área de Intermedios." actions={<Button onClick={() => open('new')} disabled={dataLoading}><Plus size={18}/>Nuevo usuario</Button>}/>
    <div className="grid-3"><KpiCard label="Usuarios activos" value={dataLoading ? '…' : `${active} / 15`} icon={UsersRound} meta={dataLoading ? 'Consultando el servidor' : `${Math.max(0, 15 - active)} accesos disponibles`} tone="blue"/><KpiCard label="Perfiles de trabajo" value="5" icon={ShieldCheck} meta="Permisos diferenciados por área" tone="orange"/></div>
    <Card><div className="toolbar"><SearchInput value={query} onChange={setQuery} label="Buscar usuarios" placeholder="Buscar por nombre, correo o perfil…"/></div>{rows.length ? <DataTable<User> rows={rows} rowKey={u => u.id} columns={[
      { key: 'name', label: 'Usuario', render: u => <div className="user-cell"><span className="avatar">{initials(u.name)}</span><div><span className="cell-title">{u.name}</span><span className="cell-subtitle">{u.email}</span></div></div> },
      { key: 'role', label: 'Perfil', render: u => ROLE_LABELS[u.role] },
      { key: 'active', label: 'Estado', render: u => <div className="stack"><span className={`badge badge-${u.active ? 'green' : 'slate'}`}>{u.active ? 'Activo' : 'Inactivo'}</span>{usingApi && u.mustChangePassword && <span className="cell-subtitle">Cambio de contraseña pendiente</span>}</div> },
      { key: 'action', label: 'Acciones', render: actions },
    ]} renderCard={u => <div className="stack"><div className="row"><span className="avatar">{initials(u.name)}</span><strong>{u.name}</strong></div><span className="muted break-word">{u.email}</span><div className="row wrap"><span className="badge badge-slate">{ROLE_LABELS[u.role]}</span><span className={`badge badge-${u.active ? 'green' : 'slate'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></div>{usingApi && u.mustChangePassword && <span className="cell-subtitle">Cambio de contraseña pendiente</span>}{actions(u)}</div>}/> : <EmptyState title={dataLoading ? 'Cargando usuarios…' : 'No encontramos usuarios'} description={dataLoading ? 'Consultando las cuentas del servidor.' : 'Prueba otro nombre o correo.'}/>}</Card>
    <p className="notice">{usingApi ? 'Las contraseñas no se muestran ni se recuperan. Comparte la contraseña temporal de forma privada; al ingresar, la persona deberá cambiarla. Desactivar una cuenta, cambiar su perfil o restablecer su contraseña cierra sus sesiones.' : 'Los cambios de cuentas corresponden al entorno local de revisión. Las contraseñas y su restablecimiento se gestionan únicamente en modo servidor.'}</p>
    <Modal open={!!editing} onClose={close} title={editing === 'new' ? 'Nuevo usuario' : 'Editar usuario'}><form className="stack" onSubmit={submit} aria-busy={pending}>
      <Field label="Nombre" htmlFor="user-name"><input className="input" id="user-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={120} disabled={pending}/></Field>
      <Field label="Correo" htmlFor="user-email"><input className="input" id="user-email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required maxLength={160} disabled={pending}/></Field>
      <Field label="Perfil" htmlFor="user-role"><select className="select" id="user-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })} disabled={pending}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <label className="check-field"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} disabled={pending}/>Usuario activo</label>
      {usingApi && editing === 'new' && <Field label="Contraseña temporal" htmlFor="user-password" hint="Entre 12 y 128 caracteres. Será obligatorio cambiarla al ingresar."><input className="input" id="user-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} disabled={pending}/></Field>}
      {error && <p className="form-alert" role="alert">{error}</p>}<div className="modal-actions"><Button variant="secondary" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar usuario'}</Button></div>
    </form></Modal>
    <Modal open={!!resetting} onClose={close} title="Restablecer contraseña"><form className="stack" onSubmit={submitReset} aria-busy={pending}>
      <p>Se cerrarán todas las sesiones de <strong>{resetting?.name}</strong>. La persona deberá cambiar esta contraseña temporal al volver a ingresar.</p>
      <Field label="Contraseña temporal" htmlFor="reset-password" hint="Entre 12 y 128 caracteres; compártela de forma privada."><input className="input" id="reset-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={temporaryPassword} onChange={e => setTemporaryPassword(e.target.value)} disabled={pending}/></Field>
      {error && <p className="form-alert" role="alert">{error}</p>}<div className="modal-actions"><Button variant="secondary" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Confirmar restablecimiento'}</Button></div>
    </form></Modal>
  </div>;
}
