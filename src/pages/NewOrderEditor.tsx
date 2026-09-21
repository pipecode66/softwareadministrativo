import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, FileText, Info, Plus, Save, Trash2 } from 'lucide-react';
import { useApp } from '../data/AppContext';
import type { Category, DocumentType, Material, OrderInput, OrderProduct, PaymentMethod, ProductionRoute, WorkOrder } from '../domain/types';
import { apiDesignerLoad, apiWorkOrder, usingApi } from '../data/api';
import { CATEGORIES, financials, formatCOP, formatMeasure, formatPesosInput, MATERIALS, roundMoney, today } from '../domain/utils';
import { Button, Card, Field, PageHeader } from '../components/ui';
import './orders.css';

type Area = 'DESIGN' | 'PRINTING' | 'WORKSHOP' | 'EXTERNAL';
type MaterialDraft = { key: string; material: Material; length: string; width: string };
type ProductDraft = {
  key: string; description: string; quantity: string; unitValue: string; specifications: string;
  length: string; width: string;
  design: boolean; printing: boolean; workshop: boolean; external: boolean;
  designerId: string; materials: MaterialDraft[];
};
const paymentMethods: { value: Exclude<PaymentMethod, 'LEGACY'>; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'BANCOLOMBIA', label: 'Bancolombia' },
  { value: 'DAVIVIENDA', label: 'Davivienda' },
];
const draftMaterial = (): MaterialDraft => ({ key: crypto.randomUUID(), material: 'Panaflex', length: '', width: '' });
const draftProduct = (): ProductDraft => ({
  key: crypto.randomUUID(), description: '', quantity: '1', unitValue: '', specifications: '', length: '', width: '',
  design: false, printing: false, workshop: false, external: false, designerId: '', materials: [],
});
const moneyInput = (value: string) => Number(value.replace(/\./g, '')) || 0;
function lineValue(product: ProductDraft): number {
  return roundMoney((Number(product.quantity) || 0) * moneyInput(product.unitValue));
}
function routeFor(products: ProductDraft[]): ProductionRoute {
  const printing = products.some(product => product.printing);
  const workshop = products.some(product => product.workshop);
  const external = products.some(product => product.external);
  if (external && (printing || workshop)) return 'MULTI_AREA';
  if (external) return 'EXTERNO';
  if (!printing && !workshop) return 'MULTI_AREA';
  if (printing && workshop) return 'PRINT_WORKSHOP';
  if (printing) return 'PRINT_ONLY';
  return 'WORKSHOP_ONLY';
}
function orderedActivities(product: ProductDraft): { area: Area; assignedUserId?: string }[] {
  const activities: { area: Area; assignedUserId?: string }[] = [];
  if (product.design) activities.push({ area: 'DESIGN', ...(product.designerId ? { assignedUserId: product.designerId } : {}) });
  if (product.printing) activities.push({ area: 'PRINTING' });
  if (product.workshop) activities.push({ area: 'WORKSHOP' });
  if (product.external) activities.push({ area: 'EXTERNAL' });
  return activities;
}

/** New orders have one commercial parent and independent production activities. */
export function NewOrderEditor({ initialClientId, existing }: { initialClientId: string; existing?: WorkOrder }) {
  const { data, user, createOrder, updateOrder, saveClient, toast } = useApp();
  const navigate = useNavigate();
  const [clientId, setClientId] = useState(existing?.clientId || initialClientId);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientIdentification, setClientIdentification] = useState('');
  const [clientSpecial, setClientSpecial] = useState(false);
  const [clientError, setClientError] = useState('');
  const [category, setCategory] = useState<Category>(existing?.category || 'Otras');
  const [documentType, setDocumentType] = useState<DocumentType>(existing?.documentType || 'REM');
  const [requiresInstallation, setRequiresInstallation] = useState(existing?.requiresInstallation || false);
  const [products, setProducts] = useState<ProductDraft[]>([draftProduct()]);
  const [loadingProducts, setLoadingProducts] = useState(!!existing && usingApi);
  const [reteFuente, setReteFuente] = useState(existing ? String(existing.reteFuente) : '');
  const [reteIva, setReteIva] = useState(existing ? String(existing.reteIva) : '');
  const [ica, setIca] = useState(existing ? String(existing.ica) : '');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Exclude<PaymentMethod, 'LEGACY'>>('EFECTIVO');
  const [remoteDesigners, setRemoteDesigners] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const client = data.clients.find(item => item.id === clientId);
  const base = roundMoney(products.reduce((sum, product) => sum + lineValue(product), 0));
  const autoRetentions = documentType === 'FACT' && base > 524000 ? {
    reteFuente: roundMoney(base * .04), reteIva: roundMoney(base * .0285), ica: roundMoney(base * .007),
  } : { reteFuente: 0, reteIva: 0, ica: 0 };
  const retentions = existing ? { reteFuente: Number(reteFuente) || 0, reteIva: Number(reteIva) || 0, ica: Number(ica) || 0 } : autoRetentions;
  const preview = financials({ value: base, documentType, financialRule: existing?.financialRule || 'NEW', specialPayment: client?.specialPayment,
    ...retentions, payments: existing?.payments || (paymentAmount ? [{ id: '', date: today(), amount: moneyInput(paymentAmount), recordedBy: user?.id || '' }] : []) });
  const route = routeFor(products);
  const designers = [...new Map([
    ...data.users.filter(person => person.role === 'DISENO' && person.active).map(person => ({ id: person.id, name: person.name })),
    ...remoteDesigners,
    ...(user?.role === 'DISENO' && user.active ? [{ id: user.id, name: user.name }] : []),
  ].map(person => [person.id, person])).values()];

  useEffect(() => {
    if (!usingApi || !user || !['ADMINMASTER', 'ADMIN_GENERAL'].includes(user.role)) return;
    let active = true;
    void apiDesignerLoad().then(result => {
      if (active) setRemoteDesigners(result.items.map(person => ({ id: person.id, name: person.name })));
    }).catch(() => {
      // The order can still be saved unassigned if the workload query is temporarily unavailable.
    });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!existing) return;
    let active = true;
    const toDraft = (items: OrderProduct[]) => items.map(product => ({
      key: product.id || crypto.randomUUID(), description: product.description, quantity: String(product.quantity),
      unitValue: formatPesosInput(product.unitValue ?? 0), specifications: product.specifications || '',
      length: product.length ? String(product.length) : '', width: product.width ? String(product.width) : '',
      design: product.activities.some(activity => activity.area === 'DESIGN'),
      printing: product.activities.some(activity => activity.area === 'PRINTING'),
      workshop: product.activities.some(activity => activity.area === 'WORKSHOP'),
      external: product.activities.some(activity => activity.area === 'EXTERNAL'),
      designerId: product.activities.find(activity => activity.area === 'DESIGN')?.assignedUserId || '',
      materials: product.materials.map(material => ({ key: material.id || crypto.randomUUID(), material: material.material,
        length: String(material.length), width: String(material.width) })),
    }));
    if (!usingApi) { setProducts(toDraft(existing.products || [])); setLoadingProducts(false); return; }
    void apiWorkOrder(existing.id).then(result => {
      if (active) { setProducts(toDraft(result.products)); setLoadingProducts(false); }
    }).catch(reason => {
      if (active) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar los productos de la OT.'); setLoadingProducts(false); }
    });
    return () => { active = false; };
  }, [existing?.id]);

  function updateProduct(key: string, update: Partial<ProductDraft>) {
    setProducts(current => current.map(product => product.key === key ? { ...product, ...update } : product));
    setError('');
  }
  function updateMaterial(product: ProductDraft, key: string, update: Partial<MaterialDraft>) {
    updateProduct(product.key, { materials: product.materials.map(item => item.key === key ? { ...item, ...update } : item) });
  }
  async function addClient() {
    if (!clientName.trim() || !clientPhone.trim()) { setClientError('Nombre y celular son obligatorios.'); return; }
    if (documentType === 'FACT' && !clientIdentification.trim()) { setClientError('La identificación es obligatoria para FACT.'); return; }
    try {
      const created = await saveClient({ name: clientName.trim(), phone: clientPhone.trim(), identification: clientIdentification.trim(), specialPayment: clientSpecial });
      setClientId(created.id); setNewClientOpen(false); setClientError(''); setClientName(''); setClientPhone(''); setClientIdentification('');
      toast('Cliente agregado al directorio.');
    } catch (reason) { setClientError(reason instanceof Error ? reason.message : 'No fue posible guardar el cliente.'); }
  }
  function validate(): string {
    if (!client) return 'Selecciona un cliente.';
    if (loadingProducts) return 'Espera a que carguen los productos de esta OT.';
    if (documentType === 'FACT' && !client.identification.trim()) return 'Las órdenes FACT requieren identificación del cliente.';
    if (!products.length) return 'Agrega al menos un producto o trabajo.';
    if (!Number.isSafeInteger(base) || base < 1) return 'El valor total debe ser un número entero de pesos mayor que cero.';
    for (const [index, product] of products.entries()) {
      const label = `Producto ${index + 1}`;
      if (!product.description.trim()) return `${label}: escribe una descripción.`;
      if (!Number.isFinite(Number(product.quantity)) || Number(product.quantity) <= 0 ||
        Math.abs(Number(product.quantity) * 1000 - Math.round(Number(product.quantity) * 1000)) > .0001) return `${label}: indica una cantidad positiva con máximo tres decimales.`;
      if (!Number.isSafeInteger(moneyInput(product.unitValue)) || moneyInput(product.unitValue) < 0) return `${label}: indica un valor unitario válido.`;
      if (!orderedActivities(product).length) return `${label}: selecciona al menos un área de trabajo.`;
      if ((product.length && !product.width) || (product.width && !product.length) ||
        product.length && (!Number.isFinite(Number(product.length)) || Number(product.length) <= 0) ||
        product.width && (!Number.isFinite(Number(product.width)) || Number(product.width) <= 0)) return `${label}: completa largo y ancho válidos, o deja ambos vacíos.`;
      if (product.printing && !product.materials.length) return `${label}: agrega al menos un material de impresión.`;
      for (const material of product.materials) {
        if (!Number.isFinite(Number(material.length)) || Number(material.length) <= 0 || !Number.isFinite(Number(material.width)) || Number(material.width) <= 0 ||
          Math.abs(Number(material.length) * 1000 - Math.round(Number(material.length) * 1000)) > .0001 ||
          Math.abs(Number(material.width) * 1000 - Math.round(Number(material.width) * 1000)) > .0001) return `${label}: cada material necesita largo y ancho positivos, con máximo tres decimales.`;
      }
    }
    if (products.some(product => product.external && (product.printing || product.workshop))) return 'Para trabajo externo y producción interna, crea productos separados dentro de la misma OT.';
    if (!existing && !client.specialPayment && !paymentAmount) return 'Este cliente requiere un abono o pago inicial al crear la OT.';
    if (!existing && paymentAmount && (!Number.isFinite(moneyInput(paymentAmount)) || moneyInput(paymentAmount) <= 0 || moneyInput(paymentAmount) > preview.collectible)) return 'El abono inicial debe ser mayor que cero y no superar el total por cobrar.';
    if (existing && preview.balance < 0) return 'El nuevo total por cobrar no puede ser menor a los pagos ya registrados.';
    return '';
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const issue = validate();
    if (issue) { setError(issue); requestAnimationFrame(() => errorRef.current?.focus()); return; }
    const orderProducts = products.map(product => ({
      description: product.description.trim(), quantity: Number(product.quantity), unitValue: moneyInput(product.unitValue),
      specifications: product.specifications.trim(),
      ...(product.length && product.width ? { length: Number(product.length), width: Number(product.width) } : {}),
      materials: product.printing ? product.materials.map(item => ({ material: item.material, length: Number(item.length), width: Number(item.width) })) : [],
      activities: orderedActivities(product),
    }));
    const description = products.map((product, index) => `${index + 1}. ${product.description.trim()}`).join('\n');
    const input: OrderInput = {
      number: existing?.number || 0, clientId, description, value: base, category, documentType, route, requiresInstallation,
      // The server derives the compatibility printing summary from product materials.
      printing: undefined,
      reteFuente: existing ? retentions.reteFuente : 0, reteIva: existing ? retentions.reteIva : 0, ica: existing ? retentions.ica : 0,
      products: orderProducts,
      ...(!existing && paymentAmount ? { initialPayment: { date: today(), amount: moneyInput(paymentAmount), method: paymentMethod } } : {}),
    };
    setSaving(true); setError('');
    try {
      if (existing) {
        await updateOrder(existing.id, input);
        toast('Los cambios de la OT fueron guardados.');
        navigate(`/orders/${existing.id}`);
      } else {
        const created = await createOrder(input);
        toast('Orden creada y distribuida entre las áreas seleccionadas.');
        navigate(`/orders/${created.id}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible guardar la OT.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setSaving(false); }
  }

  return <div className="page-stack order-form-page">
    <Link className="order-back-link" to={existing ? `/orders/${existing.id}` : '/orders'}><ArrowLeft size={17} /> {existing ? 'Volver a la OT' : 'Órdenes de trabajo'}</Link>
    <PageHeader eyebrow={existing ? `OT #${String(existing.number).padStart(4, '0')}` : 'ÓRDENES DE TRABAJO / NUEVA ORDEN'} title={existing ? 'Editar orden de trabajo' : 'Nueva orden de trabajo'} description="Registra una sola venta con los productos y tareas que realizará cada área." />
    <form onSubmit={submit} noValidate className="order-editor-layout">
      <div className="stack order-editor-main">
        {error && <div className="notice notice-warning" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
        <Card className="order-form-section">
          <div className="order-section-heading"><span>01</span><h2>Cliente y documento</h2></div>
          <div className="form-grid">
            <Field label="Número de OT" htmlFor="ot-number" hint="El servidor asigna el siguiente número al guardar."><input id="ot-number" className="input" value={existing ? String(existing.number) : 'Asignado al guardar'} readOnly /></Field>
            <Field label="Cliente / razón social *" htmlFor="ot-client"><select id="ot-client" className="select" value={clientId} onChange={event => { setClientId(event.target.value); setError(''); }} required><option value="">Selecciona un cliente</option>{data.clients.map(item => <option key={item.id} value={item.id}>{item.name}{item.identification ? ` · ${item.identification}` : ''}</option>)}</select></Field>
          </div>
          {client && <div className="order-client-selected"><div><strong>{client.name}</strong><span>{client.phone} · {client.specialPayment ? 'Pago especial: no requiere abono inicial' : 'Requiere abono inicial'}</span></div><Check size={18} /></div>}
          <div className="order-client-actions"><Link className="link" to="/clients">Consultar clientes</Link><button type="button" className="link" onClick={() => setNewClientOpen(value => !value)}>{newClientOpen ? 'Cancelar' : 'Nuevo cliente'}</button></div>
          {newClientOpen && <div className="order-inline-client"><div className="form-grid"><Field label="Nombre / razón social *" htmlFor="new-client-name"><input id="new-client-name" className="input" value={clientName} onChange={event => setClientName(event.target.value)} /></Field><Field label="Celular *" htmlFor="new-client-phone"><input id="new-client-phone" className="input" type="tel" value={clientPhone} onChange={event => setClientPhone(event.target.value)} /></Field><Field label="NIT o identificación" htmlFor="new-client-identification" hint="Obligatorio si requiere FACT."><input id="new-client-identification" className="input" value={clientIdentification} onChange={event => setClientIdentification(event.target.value)} /></Field></div><label className="order-install-toggle"><input type="checkbox" checked={clientSpecial} onChange={event => setClientSpecial(event.target.checked)} /><span><strong>Cliente de pago especial</strong><small>Puede registrar OTs sin abono inicial; su saldo se verá como Especial.</small></span></label>{clientError && <p className="order-field-error" role="alert">{clientError}</p>}<Button type="button" variant="secondary" onClick={() => void addClient()}>Agregar cliente</Button></div>}
          <fieldset className="order-choice-fieldset order-composite-choice"><legend>Tipo de documento</legend><div className="order-document-options"><label className={`order-choice-card ${documentType === 'REM' ? 'is-selected' : ''}`}><input type="radio" name="documentType" checked={documentType === 'REM'} onChange={() => setDocumentType('REM')} /><FileText size={18} /> REM</label><label className={`order-choice-card ${documentType === 'FACT' ? 'is-selected' : ''}`}><input type="radio" name="documentType" checked={documentType === 'FACT'} onChange={() => setDocumentType('FACT')} /><FileText size={18} /> FACT · IVA 19 %</label></div></fieldset>
          <fieldset className="order-choice-fieldset order-composite-choice"><legend>Categoría comercial</legend><div className="order-category-options">{CATEGORIES.map(item => <label key={item} className={`order-choice-card ${category === item ? 'is-selected' : ''}`}><input type="radio" name="category" checked={category === item} onChange={() => setCategory(item)} />{item}</label>)}</div></fieldset>
        </Card>
        <Card className="order-form-section">
          <div className="order-section-heading"><span>02</span><h2>Productos y trabajos de la venta</h2></div>
          <p className="order-help-text">Cada producto tiene un precio comercial; sus actividades internas distribuyen el trabajo sin duplicar la venta.</p>
          {loadingProducts && <p className="muted">Cargando productos de esta OT…</p>}
          <div className="order-product-list">{products.map((product, index) => <section className="order-product-card" key={product.key} aria-label={`Producto ${index + 1}`}>
            <div className="order-product-heading"><h3>Producto {index + 1}</h3>{products.length > 1 && <Button type="button" variant="secondary" onClick={() => setProducts(current => current.filter(item => item.key !== product.key))}><Trash2 size={15} /> Quitar</Button>}</div>
            <Field label="Descripción del producto *" htmlFor={`product-description-${product.key}`}><textarea id={`product-description-${product.key}`} className="textarea" rows={2} value={product.description} onChange={event => updateProduct(product.key, { description: event.target.value })} required /></Field>
            <div className="order-product-pricing"><Field label="Cantidad *" htmlFor={`product-quantity-${product.key}`}><input id={`product-quantity-${product.key}`} className="input" type="number" min="0.001" step="0.001" value={product.quantity} onChange={event => updateProduct(product.key, { quantity: event.target.value })} required /></Field><Field label="Valor unitario antes de IVA (COP) *" htmlFor={`product-price-${product.key}`}><input id={`product-price-${product.key}`} className="input" inputMode="numeric" value={product.unitValue} onChange={event => updateProduct(product.key, { unitValue: formatPesosInput(event.target.value) })} required /></Field><div className="order-line-total"><span>Subtotal</span><strong>{formatCOP(lineValue(product))}</strong></div></div>
            <Field label="Especificaciones" htmlFor={`product-spec-${product.key}`}><textarea id={`product-spec-${product.key}`} className="textarea" rows={2} value={product.specifications} onChange={event => updateProduct(product.key, { specifications: event.target.value })} placeholder="Acabados, referencias y notas para producción" /></Field>
            {!product.external && <div className="form-grid"><Field label="Largo del producto (m)" htmlFor={`product-length-${product.key}`} hint="Opcional si no aplica."><input id={`product-length-${product.key}`} className="input" type="number" min="0.001" step="0.001" value={product.length} onChange={event => updateProduct(product.key, { length: event.target.value })} /></Field><Field label="Ancho del producto (m)" htmlFor={`product-width-${product.key}`} hint="Opcional si no aplica."><input id={`product-width-${product.key}`} className="input" type="number" min="0.001" step="0.001" value={product.width} onChange={event => updateProduct(product.key, { width: event.target.value })} /></Field></div>}
            <fieldset className="order-choice-fieldset order-composite-areas"><legend>Áreas que intervienen *</legend><div className="order-area-choices">{([
              ['design', 'Diseño'], ['printing', 'Impresión'], ['workshop', 'Taller'], ['external', 'Externo'],
            ] as const).map(([key, label]) => <label key={key} className={`order-choice-card ${product[key] ? 'is-selected' : ''}`}><input type="checkbox" checked={product[key]} disabled={product.external && (key === 'printing' || key === 'workshop')} onChange={event => updateProduct(product.key, {
              [key]: event.target.checked,
              ...(key === 'printing' ? { materials: event.target.checked ? product.materials.length ? product.materials : [draftMaterial()] : [], external: false } : {}),
              ...(key === 'workshop' && event.target.checked ? { external: false } : {}),
              ...(key === 'external' && event.target.checked ? { printing: false, workshop: false, materials: [], length: '', width: '' } : {}),
              ...(key === 'design' && !event.target.checked ? { designerId: '' } : {}),
            })} />{label}</label>)}</div></fieldset>
            {product.design && <Field label="Asignar diseñador" htmlFor={`product-designer-${product.key}`} hint="Si se deja libre, un diseñador disponible podrá tomar la tarea."><select id={`product-designer-${product.key}`} className="select" value={product.designerId} onChange={event => updateProduct(product.key, { designerId: event.target.value })}><option value="">Sin asignar · disponible para tomar</option>{designers.map(designer => <option key={designer.id} value={designer.id}>{designer.name}</option>)}</select></Field>}
            {product.printing && <div className="order-product-materials"><div className="order-product-heading"><h4>Materiales de impresión</h4><Button type="button" variant="secondary" onClick={() => updateProduct(product.key, { materials: [...product.materials, draftMaterial()] })}><Plus size={15} /> Agregar material</Button></div>{product.materials.map((material, materialIndex) => <div className="order-material-row" key={material.key}><Field label={`Material ${materialIndex + 1}`} htmlFor={`material-${material.key}`}><select id={`material-${material.key}`} className="select" value={material.material} onChange={event => updateMaterial(product, material.key, { material: event.target.value as Material })}>{MATERIALS.map(item => <option key={item} value={item}>{item}</option>)}</select></Field><Field label="Largo (m)" htmlFor={`material-length-${material.key}`}><input id={`material-length-${material.key}`} className="input" type="number" min="0.001" step="0.001" value={material.length} onChange={event => updateMaterial(product, material.key, { length: event.target.value })} /></Field><Field label="Ancho (m)" htmlFor={`material-width-${material.key}`}><input id={`material-width-${material.key}`} className="input" type="number" min="0.001" step="0.001" value={material.width} onChange={event => updateMaterial(product, material.key, { width: event.target.value })} /></Field><span className="order-material-area">{formatMeasure((Number(material.length) || 0) * (Number(material.width) || 0))} m²</span><button type="button" className="order-material-remove" aria-label={`Quitar material ${materialIndex + 1}`} onClick={() => updateProduct(product.key, { materials: product.materials.filter(item => item.key !== material.key) })}><Trash2 size={16} /></button></div>)}</div>}
            {product.external && <p className="order-help-text"><Info size={14} /> Externo no requiere medidas ni parámetros de impresión internos.</p>}
          </section>)}</div>
          <Button type="button" variant="secondary" onClick={() => setProducts(current => [...current, draftProduct()])}><Plus size={17} /> Agregar otro producto</Button>
          <label className="order-install-toggle"><input type="checkbox" checked={requiresInstallation} onChange={event => setRequiresInstallation(event.target.checked)} /><span><strong>Esta OT requiere instalación</strong><small>Si no aplica, deja esta opción desmarcada.</small></span></label>
        </Card>
        {existing && documentType === 'FACT' && <Card className="order-form-section"><div className="order-section-heading"><span>03</span><h2>Retenciones de FACT</h2></div><p className="order-help-text">Se descuentan del valor base; el IVA se suma sobre la base original. Puedes ajustar cada importe, incluso si la OT es menor a $524.000.</p><div className="order-retention-grid"><Field label="RETE FUENTE (COP)" htmlFor="edit-rete-fuente"><input id="edit-rete-fuente" className="input" type="number" min="0" step="0.01" value={reteFuente} onChange={event => setReteFuente(event.target.value)} /></Field><Field label="RETE IVA (COP)" htmlFor="edit-rete-iva"><input id="edit-rete-iva" className="input" type="number" min="0" step="0.01" value={reteIva} onChange={event => setReteIva(event.target.value)} /></Field><Field label="ICA 7 × 1000 (COP)" htmlFor="edit-ica"><input id="edit-ica" className="input" type="number" min="0" step="0.01" value={ica} onChange={event => setIca(event.target.value)} /></Field></div><Button type="button" variant="secondary" onClick={() => { setReteFuente(String(autoRetentions.reteFuente)); setReteIva(String(autoRetentions.reteIva)); setIca(String(autoRetentions.ica)); }}>Recalcular según valor actual</Button></Card>}
        {!existing && <Card className="order-form-section">
          <div className="order-section-heading"><span>03</span><h2>Pago al crear la OT</h2></div>
          <p className="order-help-text">{client?.specialPayment ? 'Este cliente puede quedar como Especial sin abono inicial.' : 'Registra el abono o pago recibido al crear la OT.'}</p>
          <div className="form-grid"><Field label={`Valor recibido (COP)${client?.specialPayment ? '' : ' *'}`} htmlFor="initial-payment"><input id="initial-payment" className="input" inputMode="numeric" value={paymentAmount} onChange={event => setPaymentAmount(formatPesosInput(event.target.value))} placeholder={client?.specialPayment ? 'Opcional' : 'Obligatorio'} /></Field><Field label="Medio de pago" htmlFor="initial-payment-method"><select id="initial-payment-method" className="select" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as Exclude<PaymentMethod, 'LEGACY'>)} disabled={!paymentAmount}>{paymentMethods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></Field></div>
        </Card>}
      </div>
      <aside className="order-preview-column"><Card className="order-preview-card"><div className="order-preview-cover"><FileText size={32} /><span>INTERMEDIOS PRECISION</span><h2>Resumen de la OT</h2><p>{products.length} {products.length === 1 ? 'producto' : 'productos'} · {client?.name || 'Cliente por seleccionar'}</p></div><div className="order-preview-body"><dl className="order-summary-list"><div><dt>Número OT</dt><dd>{existing ? `#${existing.number}` : 'Automático'}</dd></div><div><dt>Documento</dt><dd>{documentType}</dd></div><div><dt>Valor antes de IVA</dt><dd>{formatCOP(base)}</dd></div>{documentType === 'FACT' && <><div><dt>IVA 19 %</dt><dd>+ {formatCOP(preview.iva)}</dd></div><div><dt>Retenciones</dt><dd>{existing?.financialRule === 'LEGACY' ? '+' : '−'} {formatCOP(preview.retentions)}</dd></div></>}<div><dt>{existing ? 'Pagos registrados' : 'Abono inicial'}</dt><dd>− {formatCOP(existing ? preview.paid : moneyInput(paymentAmount))}</dd></div></dl><div className="order-preview-total"><span>Total por cobrar</span><strong>{formatCOP(preview.collectible)}</strong><small>Saldo {existing ? 'pendiente' : 'tras abono'}: {formatCOP(preview.balance)}</small></div><Button type="submit" disabled={saving || loadingProducts} className="order-save-button"><Save size={17} /> {saving ? 'Guardando…' : existing ? 'Guardar cambios' : 'Guardar orden de trabajo'}</Button><Link className="btn btn-ghost order-cancel-button" to={existing ? `/orders/${existing.id}` : '/orders'}>Cancelar</Link></div></Card><div className="order-form-note"><Info size={18} /><p>{existing ? 'Solo Administración puede modificar la OT. Los productos se pueden cambiar mientras ninguna actividad haya iniciado.' : 'La OT se crea directamente. Las actividades de cada producto se enviarán a sus áreas; Diseño precede a Impresión cuando ambas aplican.'}</p></div></aside>
    </form>
  </div>;
}
