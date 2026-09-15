import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, UserRound } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { DEMO_PASSWORD } from '../data/seed';
import { isAdmin, ROLE_LABELS } from '../domain/utils';
import { Button, Field } from '../components/ui';

export function LoginPage() {
  const { data, user, login, usingApi, sessionReady, dataError } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const location = useLocation();
  const home = user ? isAdmin(user.role) ? '/' : user.role === 'DISENO' ? '/design' : user.role === 'IMPRESION' ? '/printing' : '/workshop' : '/';
  const requested = (location.state as { from?: string } | null)?.from;
  const destination = requested?.startsWith('/') && !requested.startsWith('//') && requested.split(/[?#]/)[0] !== '/login' ? requested : home;
  if (!sessionReady) return <div className="loading-screen" role="status">Comprobando tu sesión…</div>;
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : destination} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(''); setPending(true);
    try {
      await login(email,password);
    } catch (err) { setError(err instanceof Error ? err.message : 'No fue posible ingresar.'); }
    finally { setPending(false); }
  }
  return <div className="login-page"><main className="login-main"><div className="login-wrap"><div className="login-card">
    <span className="crop-mark crop-top"/><span className="crop-mark crop-bottom"/>
    <div className="login-brand"><span className="login-label"><LockKeyhole size={12}/> ACCESO CORPORATIVO</span><h1>Bienvenido a Intermedios</h1><p>Tu operación, conectada en un solo lugar.</p></div>
    <form onSubmit={submit} className="stack login-form" aria-busy={pending}>
      <Field label="Usuario o correo" htmlFor="login-email"><div className="input-with-icon"><UserRound size={18}/><input id="login-email" type="email" required autoComplete="username" maxLength={160} disabled={pending} value={email} onChange={e => setEmail(e.target.value)} placeholder={usingApi ? 'tu.correo@empresa.com' : 'tu.usuario@intermedios.local'}/></div></Field>
      <Field label="Contraseña" htmlFor="login-password"><div className="input-with-icon"><KeyRound size={18}/><input id="login-password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" maxLength={128} disabled={pending} value={password} onChange={e => setPassword(e.target.value)} placeholder="Ingresa tu contraseña"/><button type="button" className="icon-button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></Field>
      {(error || dataError) && <p className="form-alert" role="alert">{error || dataError}</p>}
      <Button type="submit" className="login-submit" disabled={pending}>{pending ? 'Ingresando…' : 'Ingresar al sistema'}<ArrowRight size={18}/></Button>
    </form>
    <div className="login-review"><span className="demo-dot"/><p>{usingApi ? 'Acceso con tu cuenta del servidor' : 'Entorno local de revisión · datos de ejemplo'}</p></div>
    {!usingApi && <><button className="login-help" type="button" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}>Ver accesos de revisión <span>{showHelp ? '−' : '+'}</span></button>{showHelp && <div className="login-accounts"><p>Contraseña de las cuentas locales: <strong>{DEMO_PASSWORD}</strong></p>{data.users.filter(u => u.active).map(u => <button type="button" key={u.id} onClick={() => { setEmail(u.email); setPassword(DEMO_PASSWORD); setError(''); }}><span>{ROLE_LABELS[u.role]}</span><small>{u.email}</small><ArrowRight size={14}/></button>)}<p>Estos accesos son ficticios y solo permiten revisar las pantallas. No inician sesión en el servidor.</p></div>}</>}
    {usingApi && <p className="muted">Si no tienes acceso, solicita una cuenta a la persona encargada de Administración.</p>}
  </div></div></main><footer className="login-footer">© {new Date().getFullYear()} INTERMEDIOS PUBLICIDAD & ARQUITECTURA</footer></div>;
}
