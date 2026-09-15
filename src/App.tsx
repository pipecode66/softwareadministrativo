import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './data/AppContext';
import { AppShell } from './components/AppShell';
import { EmptyState } from './components/ui';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import type { Role } from './domain/types';

const DashboardPage = lazy(()=>import('./pages/Dashboard').then(m=>({default:m.DashboardPage})));
const OrdersPage = lazy(()=>import('./pages/Orders').then(m=>({default:m.OrdersPage})));
const OrderFormPage = lazy(()=>import('./pages/OrderForm').then(m=>({default:m.OrderFormPage})));
const OrderDetailPage = lazy(()=>import('./pages/OrderDetail').then(m=>({default:m.OrderDetailPage})));
const PrintOrderPage = lazy(()=>import('./pages/OrderDetail').then(m=>({default:m.PrintOrderPage})));
const ClientsPage = lazy(()=>import('./pages/Clients').then(m=>({default:m.ClientsPage})));
const ClientDetailPage = lazy(()=>import('./pages/Clients').then(m=>({default:m.ClientDetailPage})));
const OperationPage = lazy(()=>import('./pages/Operation').then(m=>({default:m.OperationPage})));
const QueuePage = lazy(()=>import('./pages/Queues').then(m=>({default:m.QueuePage})));
const ReportsPage = lazy(()=>import('./pages/Reports').then(m=>({default:m.ReportsPage})));
const PortfolioPage = lazy(()=>import('./pages/Portfolio').then(m=>({default:m.PortfolioPage})));
const MaterialsPage = lazy(()=>import('./pages/Materials').then(m=>({default:m.MaterialsPage})));
const UsersPage = lazy(()=>import('./pages/Users').then(m=>({default:m.UsersPage})));
const admins:Role[]=['ADMINMASTER','ADMIN_GENERAL'];
function Guard({roles,children,allowPasswordChange=false}:{roles?:Role[];children:ReactNode;allowPasswordChange?:boolean}){
  const {user,sessionReady}=useApp();const location=useLocation();
  if(!sessionReady)return <Loading/>;
  if(!user)return <Navigate to="/login" replace state={{from:location.pathname+location.search}}/>;
  if(user.mustChangePassword&&!allowPasswordChange)return <Navigate to="/change-password" replace/>;
  if(roles&&!roles.includes(user.role))return <EmptyState title="Acceso restringido" description="Tu perfil no tiene permisos para consultar esta sección." action={<Link className="btn btn-secondary" to="/">Volver a mi inicio</Link>}/>;
  return children;
}
function Home(){const {user}=useApp();return user?.role==='DISENO'?<Navigate to="/design" replace/>:user?.role==='IMPRESION'?<Navigate to="/printing" replace/>:user?.role==='TALLER'?<Navigate to="/workshop" replace/>:<DashboardPage/>;}
function Loading(){return <div className="page-stack loading-screen" aria-busy="true" aria-label="Cargando pantalla"><div className="skeleton skeleton-heading"/><div className="grid-3">{[1,2,3].map(n=><div className="skeleton skeleton-card" key={n}/>)}</div><div className="skeleton skeleton-table"/></div>;}
export class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true};}componentDidCatch(error:Error,_info:ErrorInfo){console.error('Intermedios: error de interfaz',error);}
  render(){return this.state.failed?<div className="app-error"><EmptyState title="No pudimos abrir esta pantalla" description="Recarga para intentarlo de nuevo. Los datos guardados en el navegador se conservan." action={<button className="btn btn-primary" onClick={()=>window.location.reload()}>Volver a cargar</button>}/></div>:this.props.children;}
}
export default function App(){return <AppErrorBoundary><AppProvider><BrowserRouter><Suspense fallback={<Loading/>}><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/change-password" element={<Guard allowPasswordChange><ChangePasswordPage/></Guard>}/><Route element={<Guard><AppShell/></Guard>}><Route index element={<Home/>}/><Route path="operation" element={<Guard roles={admins}><OperationPage/></Guard>}/><Route path="orders" element={<OrdersPage/>}/><Route path="orders/new" element={<Guard roles={[...admins,'DISENO']}><OrderFormPage/></Guard>}/><Route path="orders/:id/edit" element={<Guard roles={admins}><OrderFormPage/></Guard>}/><Route path="orders/:id/print" element={<Guard roles={admins}><PrintOrderPage/></Guard>}/><Route path="orders/:id" element={<OrderDetailPage/>}/><Route path="clients" element={<Guard roles={admins}><ClientsPage/></Guard>}/><Route path="clients/:id" element={<Guard roles={admins}><ClientDetailPage/></Guard>}/><Route path="portfolio" element={<Guard roles={admins}><PortfolioPage/></Guard>}/><Route path="reports" element={<Guard roles={admins}><ReportsPage/></Guard>}/><Route path="materials" element={<Guard roles={admins}><MaterialsPage/></Guard>}/><Route path="design" element={<Guard roles={[...admins,'DISENO']}><QueuePage department="DISENO"/></Guard>}/><Route path="printing" element={<Guard roles={[...admins,'IMPRESION']}><QueuePage department="IMPRESION"/></Guard>}/><Route path="workshop" element={<Guard roles={[...admins,'TALLER']}><QueuePage department="TALLER"/></Guard>}/><Route path="settings/users" element={<Guard roles={['ADMINMASTER']}><UsersPage/></Guard>}/><Route path="*" element={<EmptyState title="Esta página no existe" description="Comprueba la dirección o vuelve al inicio." action={<Link className="btn btn-primary" to="/">Ir al inicio</Link>}/>}/></Route></Routes></Suspense></BrowserRouter></AppProvider></AppErrorBoundary>;}
