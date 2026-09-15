import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, FileText, Hammer, Info, Printer, Ruler, Save } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { Category, DocumentType, Material, OrderInput, ProductionRoute, WorkOrder } from '../domain/types';
import { areaOf, canCreate, CATEGORIES, financials, formatCOP, formatMeasure, formatNumber, isAdmin, MATERIALS, ROUTE_LABELS } from '../domain/utils';
import { Button, Card, EmptyState, Field, PageHeader } from '../components/ui';
import './orders.css';

interface FormValues {
  number: string; clientId: string; description: string; value: string;
  category: Category; documentType: DocumentType; route: ProductionRoute;
  requiresInstallation: boolean; material: Material; length: string; width: string;
  reteFuente: string; reteIva: string; ica: string;
}
type FormErrors = Partial<Record<keyof FormValues | 'general', string>>;
function initialValues(order?: WorkOrder, clientId = ''): FormValues {
  return {
    number: order ? String(order.number) : '', clientId: order?.clientId || clientId,
    description: order?.description || '', value: order ? String(order.value) : '',
    category: order?.category || 'Otras', documentType: order?.documentType || 'REM',
    route: order?.route || 'PRINT_WORKSHOP', requiresInstallation: order?.requiresInstallation || false,
    material: order?.printing?.material || 'Panaflex', length: order?.printing ? String(order.printing.length) : '', width: order?.printing ? String(order.printing.width) : '',
    reteFuente: order?.reteFuente ? String(order.reteFuente) : '', reteIva: order?.reteIva ? String(order.reteIva) : '', ica: order?.ica ? String(order.ica) : '',
  };
}

export function OrderFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, user } = useApp();
  const order = id ? data.orders.find(item => item.id === id) : undefined;
  if (!canCreate(user?.role)) return <EmptyState title="No tienes acceso a crear órdenes" description="La creación corresponde a Administración y Diseño." action={<Link className="btn btn-secondary" to="/orders">Ver órdenes</Link>} />;
  if (id && !order) return <EmptyState title="No encontramos esta orden" action={<Link className="btn btn-secondary" to="/orders">Volver a órdenes</Link>} />;
  if (order && (!isAdmin(user?.role) || !['NEW', 'PENDING_ADMIN_REVIEW'].includes(order.status))) return <EmptyState title="Esta orden no está disponible para edición" description="Administración puede editar los datos antes de enviar el trabajo a producción." action={<Link className="btn btn-secondary" to={`/orders/${order.id}`}>Volver a la orden</Link>} />;
  return <OrderEditor key={id || 'new'} existing={order} initialClientId={params.get('client') || params.get('clientId') || ''} />;
}

function OrderEditor({ existing, initialClientId }: { existing?: WorkOrder; initialClientId: string }) {
  const { data, user, createOrder, saveClient, updateOrder, toast } = useApp();
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(() => initialValues(existing, initialClientId));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientIdentification, setNewClientIdentification] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [clientError, setClientError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const admin = isAdmin(user?.role);
  const fact = values.documentType === 'FACT';
  const hasPrinting = values.route !== 'WORKSHOP_ONLY';
  const selectedClient = data.clients.find(client => client.id === values.clientId);
  const base = Number(values.value) || 0;
  // Use the same cents-based calculation as the stored OT and its reports.
  const previewMoney = financials({
    value: Number.isFinite(base) ? base : 0, documentType: values.documentType,
    reteFuente: Number(values.reteFuente) || 0, reteIva: Number(values.reteIva) || 0, ica: Number(values.ica) || 0,
    payments: existing?.payments || [],
  });
  const { iva, retentions, gross, collectible: total } = previewMoney;
  const area = hasPrinting ? areaOf({ material: values.material, length: Number(values.length) || 0, width: Number(values.width) || 0 }) : 0;
  const backPath = existing ? `/orders/${existing.id}` : '/orders';
  async function addClient() {
    if (!newClientName.trim()) { setClientError('El nombre del cliente es obligatorio.'); return; }
    try {
      const client = await saveClient({ name: newClientName.trim(), identification: newClientIdentification.trim(), phone: newClientPhone.trim() });
      change('clientId', client.id);
      setNewClientName(''); setNewClientIdentification(''); setNewClientPhone(''); setClientError(''); setNewClientOpen(false);
      toast('Cliente agregado al directorio.');
    } catch (error) { setClientError(error instanceof Error ? error.message : 'No fue posible crear el cliente.'); }
  }
  function change<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => { const next = { ...current }; delete next[key]; delete next.general; return next; });
  }
  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!selectedClient) next.clientId = 'Selecciona un cliente del directorio.';
    if (!values.description.trim()) next.description = 'Describe el trabajo que se realizará.';
    if (!values.value.trim() || !Number.isFinite(base) || base < 0.01) next.value = 'El valor es obligatorio y debe ser mayor que cero.';
    else if (Math.abs(Math.round(base * 100) - base * 100) > 0.0001) next.value = 'Ingresa un valor con máximo dos decimales.';
    if (hasPrinting) {
      if (!values.length.trim() || !Number.isFinite(Number(values.length)) || Number(values.length) <= 0) next.length = 'El largo debe ser mayor que cero.';
      if (!values.width.trim() || !Number.isFinite(Number(values.width)) || Number(values.width) <= 0) next.width = 'El ancho debe ser mayor que cero.';
    }
    if (fact) {
      (['reteFuente', 'reteIva', 'ica'] as const).forEach(key => {
        if (values[key] && (!Number.isFinite(Number(values[key])) || Number(values[key]) < 0)) next[key] = 'Ingresa un importe válido, igual o mayor que cero.';
        else if (Math.abs(Math.round(Number(values[key]) * 100) - Number(values[key]) * 100) > 0.0001) next[key] = 'Ingresa un importe con máximo dos decimales.';
      });

    }
    if (existing && previewMoney.balance < 0) next.general = 'El total por cobrar no puede ser menor a los pagos registrados.';
    return next;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const input: OrderInput = {
      number: existing?.number ?? Math.max(0, ...data.orders.map(order => order.number)) + 1, clientId: values.clientId, description: values.description.trim(), value: base,
      documentType: values.documentType, category: values.category, route: values.route, requiresInstallation: values.requiresInstallation,
      printing: hasPrinting ? { material: values.material, length: Number(values.length), width: Number(values.width) } : undefined,
      reteFuente: fact ? Number(values.reteFuente) || 0 : 0, reteIva: fact ? Number(values.reteIva) || 0 : 0, ica: fact ? Number(values.ica) || 0 : 0,
    };
    setSaving(true);
    try {
      if (existing) {
        await updateOrder(existing.id, input);
        toast('Los cambios de la orden fueron guardados.');
        navigate(`/orders/${existing.id}`);
      } else {
        const order = await createOrder(input);
        toast(user?.role === 'DISENO' ? 'Orden creada y enviada a revisión administrativa.' : 'Orden creada. Ya puedes enviarla a producción.');
        navigate(`/orders/${order.id}`);
      }
    } catch (error) {
      setErrors({ general: error instanceof Error ? error.message : 'No fue posible guardar la orden.' });
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setSaving(false); }
  }
  const attrs = (key: keyof FormValues) => ({ 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `${key}-error` : undefined });
  const errorFor = (key: keyof FormValues) => errors[key] ? <span id={`${key}-error`} className="order-field-error">{errors[key]}</span> : null;

  return <div className="page-stack order-form-page">
    <Link className="order-back-link" to={backPath}><ArrowLeft size={17} /> {existing ? 'Volver a la orden' : 'Órdenes de trabajo'}</Link>
    <PageHeader eyebrow={existing ? `ORDEN #${String(existing.number).padStart(4, '0')}` : 'ÓRDENES DE TRABAJO / NUEVA ORDEN'} title={existing ? 'Editar orden de trabajo' : 'Nueva orden de trabajo'} description="Registra el cliente, las condiciones del trabajo y su recorrido por producción." />
    <form onSubmit={submit} noValidate className="order-editor-layout">
      <div className="stack order-editor-main">
        {!!Object.keys(errors).length && <div className="notice notice-warning" role="alert" tabIndex={-1} ref={errorRef}><strong>Revisa los datos de la orden.</strong><p>{errors.general || 'Hay campos pendientes o con valores que necesitan corrección.'}</p></div>}
        <Card className="order-form-section">
          <div className="order-section-heading"><span>01</span><h2>Cliente y número de orden</h2></div>
          <div className="form-grid">
            <Field label="Número de OT" htmlFor="ot-number" hint="Automático desde 1. Se asigna al guardar y no puede editarse."><input className="input" id="ot-number" value={existing ? String(existing.number) : 'Asignado al guardar'} readOnly /></Field>
            <Field label="Cliente / Razón social *" htmlFor="ot-client"><select className="select" id="ot-client" value={values.clientId} onChange={event => change('clientId', event.target.value)} required {...attrs('clientId')}><option value="">Selecciona un cliente</option>{data.clients.map(client => <option key={client.id} value={client.id}>{client.name} · {client.identification}</option>)}</select>{errorFor('clientId')}</Field>
          </div>
          {selectedClient && <div className="order-client-selected"><div><strong>{selectedClient.name}</strong><span>{selectedClient.identification} · {selectedClient.phone || 'Sin teléfono registrado'}</span></div><Check size={18} /></div>}
          {admin && <div className="row"><Link className="link order-client-link" to="/clients">Consultar directorio de clientes <ArrowRight size={15} /></Link><button type="button" className="link" onClick={() => setNewClientOpen(value => !value)}>{newClientOpen ? 'Cancelar nuevo cliente' : 'Nuevo cliente'}</button></div>}
          {admin && newClientOpen && <div className="order-inline-client"><div className="form-grid"><Field label="Nombre / razón social *" htmlFor="new-client-name"><input className="input" id="new-client-name" value={newClientName} onChange={event => setNewClientName(event.target.value)} /></Field><Field label="NIT o identificación" htmlFor="new-client-identification"><input className="input" id="new-client-identification" value={newClientIdentification} onChange={event => setNewClientIdentification(event.target.value)} /></Field><Field label="Teléfono" htmlFor="new-client-phone"><input className="input" id="new-client-phone" value={newClientPhone} onChange={event => setNewClientPhone(event.target.value)} /></Field></div>{clientError && <p className="field-error" role="alert">{clientError}</p>}<button type="button" className="btn btn-secondary" onClick={() => void addClient()}>Agregar cliente al directorio</button></div>}
          {data.clients.length === 0 && <p className="notice notice-warning">Administración debe registrar un cliente antes de crear la orden.</p>}
        </Card>
        <Card className="order-form-section">
          <div className="order-section-heading"><span>02</span><h2>Información general del trabajo</h2></div>
          <Field label="Descripción del trabajo *" htmlFor="ot-description" hint="Incluye las especificaciones y acabados que necesita producción."><textarea className="textarea" id="ot-description" value={values.description} onChange={event => change('description', event.target.value)} rows={4} placeholder="Describe el trabajo, sus características y acabados…" required {...attrs('description')} />{errorFor('description')}</Field>
          <div className="order-value-field"><Field label="Valor del trabajo antes de IVA (COP) *" htmlFor="ot-value"><div className="order-input-unit"><span>$</span><input className="input" id="ot-value" type="number" min="0.01" step="0.01" inputMode="decimal" value={values.value} placeholder="0" onChange={event => change('value', event.target.value)} required {...attrs('value')} /><span>COP</span></div>{errorFor('value')}</Field></div>
          <fieldset className="order-choice-fieldset"><legend>Categoría comercial *</legend><div className="order-category-options">{CATEGORIES.map(category => <label className={`order-choice-card ${values.category === category ? 'is-selected' : ''}`} key={category}><input type="radio" name="category" value={category} checked={values.category === category} onChange={() => change('category', category)} /><span>{category}</span>{values.category === category && <Check size={15} aria-hidden="true" />}</label>)}</div></fieldset>
        </Card>
        <Card className="order-form-section">
          <div className="order-section-heading"><span>03</span><h2>Clasificación del documento</h2></div>
          <fieldset className="order-choice-fieldset"><legend className="order-sr-only">Tipo de documento</legend><div className="order-document-options">
            <label className={`order-choice-card order-document-card ${!fact ? 'is-selected' : ''}`}><input type="radio" name="documentType" value="REM" checked={!fact} onChange={() => change('documentType', 'REM')} /><FileText size={23} aria-hidden="true" /><span><strong>Remisión · REM</strong><small>Control interno del trabajo.</small></span></label>
            <label className={`order-choice-card order-document-card ${fact ? 'is-selected' : ''}`}><input type="radio" name="documentType" value="FACT" checked={fact} onChange={() => change('documentType', 'FACT')} /><FileText size={23} aria-hidden="true" /><span><strong>Facturación · FACT</strong><small>Registro con IVA del 19 %.</small></span></label>
          </div></fieldset>
          {fact && <div className="order-fact-panel">
            <p className="eyebrow">Desglose de la orden</p>
            <div className="order-tax-breakdown"><div><span>Valor antes de IVA</span><strong>{formatCOP(base)}</strong></div><div><span>IVA 19 %</span><strong>+ {formatCOP(iva)}</strong></div><div><span>Subtotal con IVA</span><strong>{formatCOP(gross)}</strong></div></div>
            {admin && <><p className="eyebrow">Retenciones manuales y opcionales · importes en COP</p><div className="order-retention-grid">
              {([{ key: 'reteFuente', label: 'RETE FUENTE' }, { key: 'reteIva', label: 'RETE IVA 15' }, { key: 'ica', label: 'ICA 7 × 1000' }] as const).map(item => <Field key={item.key} label={item.label} htmlFor={`ot-${item.key}`}><input className="input" id={`ot-${item.key}`} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0 COP" value={values[item.key]} onChange={event => change(item.key, event.target.value)} {...attrs(item.key)} />{errorFor(item.key)}</Field>)}
            </div><p className="order-help-text">Los importes ingresados se suman al subtotal con IVA. Déjalos vacíos cuando no correspondan.</p></>}
            <p className="order-help-text"><Info size={15} /> Esta selección clasifica la OT; no emite una factura electrónica.</p>
          </div>}
        </Card>
        <Card className="order-form-section">
          <div className="order-section-heading"><span>04</span><h2>Recorrido de producción</h2></div>
          <fieldset className="order-choice-fieldset"><legend className="order-sr-only">Selecciona el recorrido</legend><div className="order-route-options">{([
            { value: 'PRINT_ONLY', icon: Printer, label: 'Solo Impresión', help: 'Administración → Impresión' },
            { value: 'WORKSHOP_ONLY', icon: Hammer, label: 'Solo Taller', help: 'Administración → Taller' },
            { value: 'PRINT_WORKSHOP', icon: ArrowRight, label: 'Impresión → Taller', help: 'Ambas áreas, en este orden' },
          ] as const).map(route => <label key={route.value} className={`order-choice-card order-route-card ${values.route === route.value ? 'is-selected' : ''}`}><input type="radio" name="route" value={route.value} checked={values.route === route.value} onChange={() => change('route', route.value)} /><route.icon size={21} aria-hidden="true" /><strong>{route.label}</strong><small>{route.help}</small></label>)}</div></fieldset>
          {hasPrinting && <div className="order-printing-panel"><h3><Ruler size={18} /> Parámetros de impresión</h3><div className="order-material-fields">
            <Field label="Material *" htmlFor="ot-material"><select className="select" id="ot-material" value={values.material} onChange={event => change('material', event.target.value as Material)} required>{MATERIALS.map(material => <option key={material} value={material}>{material}</option>)}</select></Field>
            <Field label="Largo (m) *" htmlFor="ot-length"><input className="input" id="ot-length" type="number" min="0.001" step="0.001" inputMode="decimal" value={values.length} onChange={event => change('length', event.target.value)} placeholder="Ej. 2.5" required {...attrs('length')} />{errorFor('length')}</Field>
            <Field label="Ancho (m) *" htmlFor="ot-width"><input className="input" id="ot-width" type="number" min="0.001" step="0.001" inputMode="decimal" value={values.width} onChange={event => change('width', event.target.value)} placeholder="Ej. 1.2" required {...attrs('width')} />{errorFor('width')}</Field>
          </div><div className="order-area-result" aria-live="polite"><Ruler size={21} /><div><small>Superficie requerida</small><strong>{formatMeasure(Number(values.length) || 0)} m × {formatMeasure(Number(values.width) || 0)} m = <em>{formatMeasure(area)} m²</em></strong></div></div></div>}
          <label className="order-install-toggle"><input type="checkbox" checked={values.requiresInstallation} onChange={event => change('requiresInstallation', event.target.checked)} /><span><strong>Este trabajo requiere instalación</strong><small>Administración o Taller registrarán su realización.</small></span></label>
        </Card>
      </div>
      <aside className="order-preview-column">
        <Card className="order-preview-card"><div className="order-preview-cover"><FileText size={32} /><span>INTERMEDIOS PRECISION</span><h2>{existing ? 'Revisión de la orden' : 'Tu próxima orden'}</h2><p>{values.description.trim() || 'Cada detalle cuenta para un buen trabajo.'}</p></div>
          <div className="order-preview-body"><p className="eyebrow">Resumen previo al registro</p><dl className="order-summary-list"><div><dt>Número OT</dt><dd>{existing ? `#${existing.number}` : 'Automático al guardar'}</dd></div><div><dt>Cliente</dt><dd>{selectedClient?.name || 'Por seleccionar'}</dd></div><div><dt>Documento</dt><dd>{values.documentType}</dd></div><div><dt>Categoría</dt><dd>{values.category}</dd></div><div><dt>Recorrido</dt><dd>{ROUTE_LABELS[values.route]}</dd></div>{hasPrinting && <div><dt>Área de impresión</dt><dd>{formatNumber(area, 3)} m² · {values.material}</dd></div>}<div><dt>Instalación</dt><dd>{values.requiresInstallation ? 'Requerida' : 'No requerida'}</dd></div></dl>
            <div className="order-preview-total" aria-live="polite"><span>{admin ? 'Total por cobrar' : 'Valor con impuestos'}</span><strong>{formatCOP(total)}</strong><small>COP {fact ? '· IVA incluido' : ''}</small></div>
            {admin && fact && retentions > 0 && <p className="order-help-text">Retenciones registradas: {formatCOP(retentions)}</p>}
            <Button type="submit" disabled={saving} className="order-save-button"><Save size={17} /> {saving ? 'Guardando…' : existing ? 'Guardar cambios' : 'Guardar orden de trabajo'}</Button>
            <Link className="btn btn-ghost order-cancel-button" to={backPath}>Cancelar</Link>
          </div>
        </Card>
        <div className="order-form-note"><Info size={18} /><p>{user?.role === 'DISENO' ? 'Al guardar, la orden llegará a Administración para revisión antes de pasar a producción.' : 'Al guardar, podrás revisar la orden y enviarla al primer departamento de su recorrido.'}</p></div>
      </aside>
    </form>
  </div>;
}
