import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronRight, ClipboardList, Hammer, LayoutDashboard, LogOut, Menu, PanelsTopLeft, PencilRuler, Plus, Printer, Search, Settings2, SquareStack, Users, Wallet, ChartNoAxesCombined, type LucideIcon } from 'lucide-react';
import { useApp } from '../data/AppContext';
import { canCreate, initials, isAdmin, ROLE_LABELS } from '../domain/utils';
import { Modal } from './ui';

interface NavItem { to: string; label: string; icon: LucideIcon; group: string }
export function AppShell() {
  const { user, logout, usingApi, dataLoading, dataError, refreshData, toast } = useApp();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const admin = isAdmin(user?.role);
  const nav: NavItem[] = admin ? [
    {to:'/',label:'Inicio',icon:LayoutDashboard,group:'Administración'},
    {to:'/operation',label:'Operación',icon:PanelsTopLeft,group:'Administración'},
    {to:'/orders',label:'Órdenes',icon:ClipboardList,group:'Administración'},
    {to:'/clients',label:'Clientes',icon:Users,group:'Administración'},
    {to:'/portfolio',label:'Cartera',icon:Wallet,group:'Administración'},
    {to:'/reports',label:'Reportes',icon:ChartNoAxesCombined,group:'Administración'},
    {to:'/materials',label:'Materiales',icon:SquareStack,group:'Administración'},
    {to:'/design',label:'Diseño',icon:PencilRuler,group:'Bandejas operativas'},
    {to:'/printing',label:'Impresión',icon:Printer,group:'Bandejas operativas'},
    {to:'/workshop',label:'Taller',icon:Hammer,group:'Bandejas operativas'},
    ...(user?.role === 'ADMINMASTER' ? [{to:'/settings/users',label:'Usuarios',icon:Settings2,group:'Sistema'}] : []),
  ] : user?.role === 'DISENO' ? [
    {to:'/design',label:'Mi bandeja',icon:PencilRuler,group:'Diseño'},
    {to:'/orders',label:'Mis órdenes',icon:ClipboardList,group:'Diseño'},
    {to:'/orders/new',label:'Nueva orden',icon:Plus,group:'Diseño'},
  ] : [{to:user?.role === 'IMPRESION' ? '/printing' : '/workshop',label:user?.role === 'IMPRESION' ? 'Bandeja de impresión' : 'Bandeja de taller',icon:user?.role === 'IMPRESION' ? Printer : Hammer,group:'Producción'}];
  const active = nav.find(item => item.to === location.pathname);
  const breadcrumb = active?.label || (location.pathname.startsWith('/orders') ? 'Órdenes de trabajo' : location.pathname.startsWith('/clients') ? 'Clientes' : 'Intermedios');
  useEffect(() => {
    setMenuOpen(false);
    document.title = `${breadcrumb} · Intermedios Gestión`;
    window.scrollTo({ top:0, behavior:'instant' });
  }, [location.pathname, breadcrumb]);
  function search(event: FormEvent) { event.preventDefault(); navigate(`/orders?q=${encodeURIComponent(query.trim())}`); }
  function navigation() { return <nav className="sidebar-navigation" aria-label="Navegación principal">{nav.map((item,index) => <div key={item.to}>{(index === 0 || nav[index - 1].group !== item.group) && <p className="nav-section">{item.group}</p>}<NavLink to={item.to} end={item.to === '/' || (user?.role === 'DISENO' && item.to === '/orders')} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>{item.to === '/orders' && <ChevronRight className="nav-chevron" size={15} />}</NavLink></div>)}</nav>; }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { await logout(); }
    catch { toast('No pudimos confirmar el cierre de sesión en el servidor. Comprueba la conexión e inténtalo de nuevo.', 'error'); }
    finally { setSigningOut(false); }
  }
  function profile() { return <div className="sidebar-profile"><span className="avatar">{initials(user?.name || '')}</span><div><strong>{user?.name}</strong><span>{user && ROLE_LABELS[user.role]}</span>{usingApi && <Link to="/change-password">Cambiar contraseña</Link>}</div><button className="icon-button" onClick={() => void signOut()} disabled={signingOut} aria-label="Cerrar sesión"><LogOut size={18} /></button></div>; }
  return <div className="app-shell"><a href="#main-content" className="skip-link">Ir al contenido</a><aside className="app-sidebar"><Link to={admin ? '/' : nav[0].to} className="brand-link" aria-label="Intermedios Gestión, inicio"><img src="/logo.svg" alt="Intermedios Gestión · Pub & Arq" /></Link>{navigation()}{profile()}</aside>
    <header className="app-topbar"><div className="topbar-leading"><button className="icon-button menu-toggle" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={22} /></button><div className="breadcrumb"><span>Intermedios</span><ChevronRight size={14} /><strong>{breadcrumb}</strong></div><img className="mobile-brand" src="/logo.svg" alt="Intermedios Gestión" /></div><div className="topbar-actions">{canCreate(user?.role) && <><form className="global-search" onSubmit={search}><Search size={16} aria-hidden="true"/><label className="sr-only" htmlFor="global-search">Buscar una orden</label><input id="global-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar OT, cliente o descripción…" /><button type="submit" className="icon-button" aria-label="Realizar búsqueda"><ArrowUpRight size={16}/></button></form><Link to="/orders/new" className="btn btn-primary topbar-new" aria-label="Crear nueva orden"><Plus size={17}/><span>Nueva OT</span></Link></>}<span className="topbar-avatar" aria-label={`${user?.name}, ${user ? ROLE_LABELS[user.role] : ''}`}>{initials(user?.name || '')}</span></div></header>
    <main id="main-content" tabIndex={-1} className="app-content"><div className="demo-strip"><span className="demo-dot"/>{usingApi ? 'Datos del servidor' : 'Revisión del frontend'}<span className="demo-divider">·</span><span>{usingApi ? 'Sin datos de demostración' : 'Datos de ejemplo en este navegador'}</span>{usingApi && <button className="btn btn-ghost" disabled={dataLoading} onClick={() => void refreshData().catch(() => {})}>{dataLoading ? 'Actualizando…' : 'Actualizar datos'}</button>}</div>{dataError && <p className="form-alert" role="alert">{dataError} Los datos visibles pueden estar desactualizados.</p>}<div key={location.pathname + location.search}><Outlet /></div><footer className="app-footer"><span>INTERMEDIOS GESTIÓN</span><span>Publicidad & Arquitectura</span></footer></main>
    <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Intermedios Gestión"><div className="mobile-menu">{navigation()}{profile()}</div></Modal>
  </div>;
}
