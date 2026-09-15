import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { Button, Field } from '../components/ui';

export function ChangePasswordPage() {
  const { user, changePassword, logout, toast } = useApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (newPassword !== confirmation) { setError('Las contraseñas nuevas no coinciden.'); return; }
    if (newPassword === currentPassword) { setError('La contraseña nueva debe ser diferente de la actual.'); return; }
    setError(''); setPending(true);
    try { await changePassword(currentPassword, newPassword); toast('Contraseña actualizada. Las demás sesiones se cerraron.'); navigate('/', { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : 'No fue posible cambiar la contraseña.'); }
    finally { setPending(false); }
  }
  async function signOut() {
    if (pending) return;
    setPending(true); setError('');
    try { await logout(); }
    catch { setError('No pudimos confirmar el cierre de sesión en el servidor. Comprueba la conexión e inténtalo de nuevo.'); }
    finally { setPending(false); }
  }
  return <div className="login-page"><main className="login-main"><div className="login-wrap"><div className="login-card stack">
    <div className="login-brand"><img src="/logo.svg" alt="Intermedios Gestión"/><KeyRound size={28}/><h1>Cambiar contraseña</h1><p>{user?.mustChangePassword ? 'Por seguridad, cambia tu contraseña temporal antes de continuar.' : 'Actualiza la contraseña de tu cuenta.'}</p></div>
    <p className="muted break-word">{user?.email}</p>
    <form className="stack" onSubmit={submit} aria-busy={pending}>
      <Field label="Contraseña actual" htmlFor="password-current"><input className="input" id="password-current" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required maxLength={128} disabled={pending}/></Field>
      <Field label="Nueva contraseña" htmlFor="password-new" hint="Entre 12 y 128 caracteres. No reutilices la contraseña temporal."><input className="input" id="password-new" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></Field>
      <Field label="Confirmar nueva contraseña" htmlFor="password-confirm"><input className="input" id="password-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></Field>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? 'Procesando…' : 'Guardar nueva contraseña'}</Button>
    </form>
    <Button variant="secondary" disabled={pending} onClick={() => void signOut()}>Cerrar sesión</Button>
    {!user?.mustChangePassword && !pending && <Link to="/" className="btn btn-ghost">Volver al aplicativo</Link>}
  </div></div></main></div>;
}
