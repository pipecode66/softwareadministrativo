import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, Camera, CheckCircle2, ClipboardCheck, Clock3, Coffee, History, MapPin, MessageSquare, Navigation, Pause, Play, Plus, RefreshCw, ShieldCheck, UserRound, UsersRound, Wifi, WifiOff } from 'lucide-react';
import { Button, Card, CardHeader, DataTable, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, SearchInput } from '../components/ui';
import { useApp } from '../data/AppContext';
import { ApiRequestError } from '../data/api';
import {
  apiCreateInstallation, apiCreateInstallationTeam, apiInstallation, apiInstallationAction, apiInstallationEvidence,
  apiInstallationPhoto, apiInstallations, apiInstallationTeams, apiUpdateInstallationTeam, captureInstallationLocation, installationDateTimeInput,
  installationScheduleIso, installationDurationText, INSTALLATION_STATUS_LABELS, INSTALLATION_PERSONAL_STATUS_LABELS, prepareInstallationPhoto,
  type Installation, type InstallationAction, type InstallationEvent, type InstallationList,
  type InstallationFilterStatus, type InstallationLocation, type InstallationMetrics, type InstallationPersonalStatus, type InstallationStatus, type InstallationTeam, type NewInstallation,
} from '../data/installations';
import { formatDate, formatNumber, initials, isAdmin, ROLE_LABELS } from '../domain/utils';
import type { Role } from '../domain/types';
import './installations.css';

const statuses = Object.keys(INSTALLATION_STATUS_LABELS) as InstallationStatus[];
const otCode = (number: number) => `OT #${String(number).padStart(4, '0')}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No fue posible guardar. Inténtalo nuevamente.';
const durationText = installationDurationText;
type InstallerOption = { id: string; name: string };
type AssignmentDraft = { mode: 'INDIVIDUAL' | 'MULTIPLE' | 'TEAM'; installerId: string; installerIds: string[]; teamId: string };
const emptyAssignment = (): AssignmentDraft => ({ mode: 'INDIVIDUAL', installerId: '', installerIds: [], teamId: '' });
function assignmentFields(draft: AssignmentDraft, teams: InstallationTeam[], allowPending: boolean): Pick<NewInstallation, 'installerId' | 'installerIds' | 'teamId'> {
  if (draft.mode === 'TEAM') {
    if (!teams.some(team => team.id === draft.teamId && team.active)) throw new Error('Selecciona un equipo activo.');
    return { teamId: draft.teamId };
  }
  if (draft.mode === 'MULTIPLE') {
    const ids = [...new Set(draft.installerIds)];
    if (ids.length < 2) throw new Error('Selecciona al menos dos instaladores o utiliza la asignación individual.');
    if (!ids.includes(draft.installerId)) throw new Error('Selecciona al responsable principal entre los integrantes.');
    return { installerId: draft.installerId, installerIds: ids };
  }
  if (!draft.installerId && !allowPending) throw new Error('Selecciona al instalador responsable.');
  return draft.installerId ? { installerId: draft.installerId } : {};
}
function StatusBadge({ status }: { status: InstallationStatus }) {
  const tone = status === 'COMPLETED' ? 'green' : status === 'POSTPONED' ? 'red' : status === 'PENDING' || status === 'PAUSED' ? 'amber' : 'blue';
  return <span className={`badge badge-${tone}`}><span className="installation-status-dot" />{INSTALLATION_STATUS_LABELS[status]}</span>;
}
function InstallationState({ installation, admin }: { installation: Installation; admin: boolean }) {
  const { user } = useApp();
  if (admin) return <StatusBadge status={installation.status} />;
  const personal: InstallationPersonalStatus = installation.personalStatus ||
    (installation.status === 'COMPLETED' || installation.status === 'POSTPONED' ? installation.status : installation.members?.find(member => member.userId === user?.id)?.status || 'ASSIGNED');
  const tone = personal === 'CHECKED_OUT' || personal === 'COMPLETED' ? 'green' : personal === 'PAUSED' ? 'amber' : personal === 'POSTPONED' ? 'red' : 'blue';
  return <div className="installation-assignee-summary"><span className={`badge badge-${tone}`}><span className="installation-status-dot" />{INSTALLATION_PERSONAL_STATUS_LABELS[personal]}</span><span className="cell-subtitle">Trabajo: {INSTALLATION_STATUS_LABELS[installation.status]}</span></div>;
}
function useConnectivity() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true), disconnected = () => setOnline(false);
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);
  return online;
}
function ConnectionStatus({ online, updatedAt }: { online: boolean; updatedAt: string }) {
  return <div className={`installation-connection ${online ? '' : 'installation-offline'}`} role="status">
    {online ? <Wifi size={15} /> : <WifiOff size={15} />}
    <span>{online ? updatedAt ? `Última consulta: ${formatDate(updatedAt, true)}` : 'Consultando el servidor…' : 'Sin conexión: los cambios no se envían automáticamente. Reintenta cuando vuelva la señal.'}</span>
  </div>;
}
function Performance({ metrics, name }: { metrics: InstallationMetrics; name?: string }) {
  const percentage = metrics.scheduledCompleted > 0 ? Math.round(metrics.onTime / metrics.scheduledCompleted * 100) : null;
  return <div className="installation-performance">
    {name && <div className="installation-person"><span className="avatar">{initials(name)}</span><strong>{name}</strong></div>}
    <dl className="installation-performance-values"><div><dt>Finalizadas este mes</dt><dd>{metrics.completedThisMonth}</dd></div><div><dt>A tiempo este mes</dt><dd>{percentage === null ? '—' : `${percentage} %`}</dd></div><div><dt>En curso / pausa ahora</dt><dd>{metrics.inProgress}</dd></div></dl>
    <div className="installation-progress" role="img" aria-label={percentage === null ? 'Sin instalaciones finalizadas este mes para calcular puntualidad' : `${metrics.onTime} de ${metrics.scheduledCompleted} instalaciones terminadas a tiempo`}><span style={{ width: `${percentage ?? 0}%` }} /></div>
    <p className="muted">{percentage === null ? 'Sin finalizadas este mes para calcular puntualidad.' : `${metrics.onTime} de ${metrics.scheduledCompleted} finalizadas este mes dentro del horario programado.`}</p>
    <p className="muted">Aplazadas actualmente: {metrics.postponed}. Tiempo activo acumulado: {durationText(metrics.netWorkMinutes)}, sin contar descansos ni almuerzo.</p>
  </div>;
}

export function InstallationsPage() {
  const { usingApi } = useApp();
  if (!usingApi) return <div className="page-stack"><PageHeader eyebrow="OPERACIÓN DE CAMPO" title="Instalaciones" /><Card><EmptyState title="Conexión con el servidor requerida" description="Las instalaciones, ubicaciones y fotografías se guardan únicamente en el servidor. Este entorno local de revisión no simula esos registros." /></Card></div>;
  return <ConnectedInstallations />;
}

function ConnectedInstallations() {
  const { user } = useApp();
  const admin = isAdmin(user?.role);
  const online = useConnectivity();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') || '').slice(0, 200);
  const requestedStatus = params.get('status');
  const allowedStatuses: InstallationFilterStatus[] = admin ? statuses : [...statuses, 'CHECKED_OUT'];
  const status = allowedStatuses.includes(requestedStatus as InstallationFilterStatus) ? requestedStatus as InstallationFilterStatus : undefined;
  const requestedInstallerId = params.get('installer') || undefined;
  const installerId = admin && requestedInstallerId && /^[0-9a-f-]{36}$/i.test(requestedInstallerId) ? requestedInstallerId : undefined;
  const requestedPage = Number(params.get('page') || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1_000_000 ? requestedPage : 1;
  const detailId = params.get('installation');
  const [result, setResult] = useState<InstallationList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [managingTeams, setManagingTeams] = useState(false);
  const [teams, setTeams] = useState<InstallationTeam[]>([]);
  const [teamError, setTeamError] = useState('');
  const pageSize = 10;
  useEffect(() => {
    let active = true;
    let fetching = false;
    setResult(null); setLoading(true); setError('');
    async function load() {
      if (fetching) return;
      fetching = true;
      try {
        const next = await apiInstallations({ q: query, status, installerId, page, pageSize });
        if (!active) return;
        setResult(next); setError(''); setUpdatedAt(new Date().toISOString());
      } catch (cause) { if (active) setError(errorText(cause)); }
      finally { fetching = false; if (active) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => { if (navigator.onLine) void load(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [query, status, installerId, page, revision, user?.id]);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    void apiInstallationTeams().then(response => { if (active) { setTeams(response.items); setTeamError(''); } })
      .catch(cause => { if (active) setTeamError(errorText(cause)); });
    return () => { active = false; };
  }, [admin, revision, user?.id]);
  function updateParams(changes: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  }
  function openInstallation(id: string) { const next = new URLSearchParams(params); next.set('installation', id); setParams(next); }
  function closeInstallation() { const next = new URLSearchParams(params); next.delete('installation'); setParams(next, { replace: true }); }
  const metrics = result?.metrics;
  const metric = (name: keyof InstallationMetrics) => metrics ? formatNumber(metrics[name]) : '…';
  const available = result?.availableOrders || [];
  function jobIdentity(item: Installation) { return <div className="installation-job-identity"><span className="installation-ot">{otCode(item.orderNumber)}</span><strong>{item.clientName}</strong><p>{item.description}</p></div>; }
  function openButton(item: Installation) { return <Button variant={item.status === 'PENDING' && admin ? 'primary' : 'secondary'} onClick={() => openInstallation(item.id)} aria-label={`Abrir instalación ${otCode(item.orderNumber)}`}>{admin ? 'Gestionar' : 'Ver trabajo'}<ArrowRight size={16} /></Button>; }
  return <div className={`page-stack installations-page ${admin ? 'installations-admin' : 'installations-personal'}`}>
    <PageHeader eyebrow="OPERACIÓN DE CAMPO · INTERMEDIOS" title={admin ? 'Gestión de Instalaciones' : 'Mis instalaciones'} description={admin ? 'Programa, asigna y supervisa los trabajos que ya finalizaron producción.' : 'Tus trabajos asignados, avances y registros de instalación.'} actions={<><Button variant="secondary" onClick={() => setRevision(value => value + 1)} disabled={loading || !online}><RefreshCw size={17} />Actualizar</Button>{admin && <><Button variant="secondary" onClick={() => setManagingTeams(true)} disabled={!online}><UsersRound size={17} />Equipos de instalación</Button><Button onClick={() => setCreating(true)} disabled={!result || !available.length || !online}><Plus size={18} />Nueva instalación</Button></>}</>} />
    <ConnectionStatus online={online} updatedAt={updatedAt} />
    {error && <div className="form-alert" role="alert">{error}{result && ' Los datos visibles corresponden a la última consulta confirmada.'}<Button variant="ghost" onClick={() => setRevision(value => value + 1)}>Volver a consultar</Button></div>}
    {admin && teamError && <p className="form-alert" role="alert">No pudimos actualizar los equipos: {teamError}</p>}
    {admin ? <div className="grid-4 installation-kpis"><KpiCard label="Disponibles para programar" value={result ? available.length : '…'} icon={ClipboardCheck} tone="orange" /><KpiCard label="En ejecución / pausa ahora" value={metric('inProgress')} icon={UsersRound} tone="blue" /><KpiCard label="Finalizadas este mes" value={metric('completedThisMonth')} icon={CheckCircle2} tone="green" /><KpiCard label="Aplazadas actualmente" value={metric('postponed')} icon={CalendarClock} tone="amber" /></div> : metrics && <Card className="installation-personal-performance"><CardHeader title="Mi rendimiento" description="Finalizadas y puntualidad: mes actual. En curso y aplazadas: estado actual. Tiempo: acumulado histórico." action={<ShieldCheck size={22} />} /><Performance metrics={metrics} /></Card>}
    <div className="installation-main-layout"><Card className="installation-list-card">
      <CardHeader title={admin ? 'Asignación y control operativo' : 'Mi hoja de trabajo'} description={admin ? 'La instalación mantiene su vínculo con el cliente y la OT, sin duplicar ventas.' : 'Solo aparecen los trabajos asignados a tu cuenta.'} />
      <div className="installation-filters"><SearchInput value={query} onChange={value => updateParams({ q: value })} label="Buscar instalaciones" placeholder="Buscar OT, cliente o trabajo…" />{admin && <><Field label="Estado" htmlFor="installation-state-filter"><select id="installation-state-filter" className="select" value={status || ''} onChange={event => updateParams({ status: event.target.value })}><option value="">Todos los estados</option>{statuses.map(value => <option key={value} value={value}>{INSTALLATION_STATUS_LABELS[value]}</option>)}</select></Field><Field label="Responsable" htmlFor="installation-installer-filter"><select id="installation-installer-filter" className="select" value={installerId || ''} onChange={event => updateParams({ installer: event.target.value })}><option value="">Todos los instaladores</option>{result?.installers?.map(installer => <option key={installer.id} value={installer.id}>{installer.name}</option>)}</select></Field></>}</div>
      {!admin && <div className="installation-tabs" role="group" aria-label="Estado de mi participación">{[{ value: '', label: 'Todas' }, { value: 'ASSIGNED', label: 'Por instalar' }, { value: 'IN_PROGRESS', label: 'En ejecución' }, { value: 'PAUSED', label: 'En pausa' }, { value: 'CHECKED_OUT', label: 'Mi jornada finalizada' }, { value: 'POSTPONED', label: 'Aplazadas' }, { value: 'COMPLETED', label: 'Finalizadas' }].map(tab => <button type="button" key={tab.value} className={status === tab.value || !status && !tab.value ? 'active' : ''} aria-pressed={status === tab.value || !status && !tab.value} onClick={() => updateParams({ status: tab.value })}>{tab.label}</button>)}</div>}
      {loading ? <div className="installation-loading" role="status">Cargando instalaciones…</div> : result?.items.length ? <><DataTable<Installation> rows={result.items} rowKey={item => item.id} columns={[
        { key: 'job', label: 'OT / Cliente / Trabajo', render: jobIdentity },
        { key: 'schedule', label: 'Programación', render: item => <div className="installation-schedule"><span>{formatDate(item.scheduledStartAt, true)}</span><span className="muted">Hasta {formatDate(item.scheduledEndAt, true)}</span><span>{item.address}</span></div> },
        ...(admin ? [{ key: 'responsible', label: 'Responsable / Equipo', render: (item: Installation) => item.installerName ? <div className="installation-assignee-summary"><span className="installation-person"><UserRound size={15} />{item.installerName}</span>{(item.members?.length > 1 || item.teamName) && <span className="muted">{item.teamName ? `${item.teamName} · ` : ''}{item.members?.length || 1} integrantes</span>}</div> : <span className="badge badge-amber">Sin asignar</span> }] : []),
        { key: 'status', label: admin ? 'Estado' : 'Mi estado / Trabajo', render: item => <div className="stack"><InstallationState installation={item} admin={admin} />{!item.productionReady && item.status !== 'COMPLETED' && <span className="installation-blocked">Producción pendiente</span>}</div> },
        { key: 'actions', label: 'Acciones', render: openButton },
      ]} renderCard={item => <div className={`installation-job-card installation-job-${item.status.toLowerCase()}`}><div className="installation-card-heading"><span className="installation-ot">{otCode(item.orderNumber)}</span><InstallationState installation={item} admin={admin} /></div><div className="installation-card-client"><h3>{item.clientName}</h3><p>{item.description}</p></div><div className="installation-card-facts"><p><MapPin size={16} />{item.address}</p><p><CalendarClock size={16} />{formatDate(item.scheduledStartAt, true)}</p>{admin && <p><UserRound size={16} />{item.installerName || 'Sin asignar'}</p>}</div>{!item.productionReady && item.status !== 'COMPLETED' && <p className="installation-blocked">La OT volvió a producción. No se puede iniciar ni cerrar aún.</p>}{openButton(item)}</div>} /><Pagination page={page} pageSize={pageSize} total={result.total} onChange={value => updateParams({ page: String(value) }, false)} /></> : <EmptyState title={error ? 'No pudimos consultar las instalaciones' : 'No hay instalaciones en esta vista'} description={admin ? available.length ? 'Hay órdenes listas: utiliza Nueva instalación para programarlas.' : 'Aquí aparecerán los trabajos que requieren instalación cuando terminen producción.' : 'Administración debe asignarte una instalación. También puedes revisar los otros estados.'} action={(query || status || installerId) ? <Button variant="secondary" onClick={() => updateParams({ q: '', status: '', installer: '' })}>Quitar filtros</Button> : undefined} />}
    </Card>{admin && <aside className="installation-side-panel"><Card><CardHeader title="Rendimiento de instaladores" description="Finalizadas y puntualidad: mes actual. Estados: actuales. Tiempo: acumulado histórico." />{result?.performance?.length ? <div className="installation-performance-list">{result.performance.map(person => <Performance key={person.installerId} metrics={person} name={person.name} />)}</div> : <p className="muted">{loading ? 'Consultando responsables…' : 'No hay instaladores activos registrados.'}</p>}</Card><div className="installation-integrity"><ShieldCheck size={23} /><div><strong>Producción verificada</strong><p>Solo las OT que requieren instalación y terminaron sus actividades pueden programarse.</p></div></div></aside>}</div>
    {creating && admin && result && <CreateInstallationModal available={available} installers={result.installers || []} teams={teams} onClose={() => setCreating(false)} onCreated={installation => { setCreating(false); setRevision(value => value + 1); openInstallation(installation.id); }} />}
    {managingTeams && admin && <InstallationTeamsModal teams={teams} installers={result?.installers || []} onClose={() => setManagingTeams(false)} onSaved={() => setRevision(value => value + 1)} />}
    {detailId && <InstallationDetails key={`${user?.id}:${detailId}`} id={detailId} admin={admin} installers={result?.installers || []} teams={teams} onClose={closeInstallation} onChanged={() => setRevision(value => value + 1)} />}
  </div>;
}

function AssignmentFields({ value, onChange, installers, teams, disabled, prefix, allowPending = false }: { value: AssignmentDraft; onChange: (value: AssignmentDraft) => void; installers: InstallerOption[]; teams: InstallationTeam[]; disabled: boolean; prefix: string; allowPending?: boolean }) {
  const chosenTeam = teams.find(team => team.id === value.teamId && team.active);
  function toggleMember(id: string) {
    const selected = value.installerIds.includes(id);
    const installerIds = selected ? value.installerIds.filter(memberId => memberId !== id) : [...value.installerIds, id];
    onChange({ ...value, installerIds, installerId: installerIds.includes(value.installerId) ? value.installerId : installerIds[0] || '' });
  }
  return <div className="stack installation-assignment-fields">
    <Field label="Tipo de asignación" htmlFor={`${prefix}-assignment-mode`}><select id={`${prefix}-assignment-mode`} className="select" value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as AssignmentDraft['mode'] })} disabled={disabled}><option value="INDIVIDUAL">Individual</option><option value="MULTIPLE">Varios instaladores</option><option value="TEAM">Equipo</option></select></Field>
    {value.mode === 'INDIVIDUAL' && <Field label="Instalador responsable" htmlFor={`${prefix}-installer`} hint={allowPending ? 'Puedes dejarla pendiente y asignar al responsable después.' : undefined}><select id={`${prefix}-installer`} className="select" value={value.installerId} onChange={event => onChange({ ...value, installerId: event.target.value })} required={!allowPending} disabled={disabled}><option value="">{allowPending ? 'Sin asignar' : 'Selecciona al responsable'}</option>{installers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>}
    {value.mode === 'MULTIPLE' && <><fieldset className="installation-member-picker"><legend>Integrantes de la instalación</legend>{installers.length ? installers.map(person => <label key={person.id}><input type="checkbox" checked={value.installerIds.includes(person.id)} onChange={() => toggleMember(person.id)} disabled={disabled} /><span>{person.name}</span></label>) : <p className="muted">No hay instaladores activos disponibles.</p>}</fieldset><Field label="Responsable principal" htmlFor={`${prefix}-leader`} hint="Coordina el trabajo y es la única persona que puede completar el cierre de la instalación."><select id={`${prefix}-leader`} className="select" value={value.installerIds.includes(value.installerId) ? value.installerId : ''} onChange={event => onChange({ ...value, installerId: event.target.value })} required disabled={disabled}><option value="">Selecciona al responsable principal</option>{installers.filter(person => value.installerIds.includes(person.id)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></>}
    {value.mode === 'TEAM' && <><Field label="Equipo de instalación" htmlFor={`${prefix}-team`}><select id={`${prefix}-team`} className="select" value={value.teamId} onChange={event => onChange({ ...value, teamId: event.target.value })} required disabled={disabled}><option value="">Selecciona un equipo activo</option>{teams.filter(team => team.active).map(team => <option key={team.id} value={team.id}>{team.name} · {team.memberIds.length} integrantes</option>)}</select></Field>{chosenTeam && <div className="installation-team-preview"><strong>{chosenTeam.name}</strong><p>Responsable principal: {installers.find(person => person.id === chosenTeam.leaderId)?.name || 'Instalador no disponible'}</p><p>{chosenTeam.memberIds.map(id => installers.find(person => person.id === id)?.name || 'Integrante no disponible').join(' · ')}</p><p className="muted">Esta instalación conserva estos integrantes aunque el equipo se cambie después.</p></div>}</>}
  </div>;
}

function InstallationTeamsModal({ teams, installers, onClose, onSaved }: { teams: InstallationTeam[]; installers: InstallerOption[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [editing, setEditing] = useState<InstallationTeam | 'new' | null>(null);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leaderId, setLeaderId] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latestTeam, setLatestTeam] = useState<InstallationTeam | null>(null);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  function open(team: InstallationTeam | 'new') {
    setEditing(team); setError(''); setConflict(false); setLatestTeam(null); requestRef.current = null;
    setName(team === 'new' ? '' : team.name); setMemberIds(team === 'new' ? [] : team.memberIds);
    setLeaderId(team === 'new' ? '' : team.leaderId); setActive(team === 'new' || team.active);
  }
  function toggle(id: string) {
    const ids = memberIds.includes(id) ? memberIds.filter(memberId => memberId !== id) : [...memberIds, id];
    setMemberIds(ids); if (!ids.includes(leaderId)) setLeaderId(ids[0] || '');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || saving || conflict) return;
    setSaving(true); setError('');
    try {
      if (!name.trim()) throw new Error('Escribe el nombre del equipo.');
      if (!memberIds.length || !memberIds.includes(leaderId)) throw new Error('Selecciona los integrantes y un responsable principal del equipo.');
      const input = { name: name.trim(), memberIds, leaderId, active };
      const fingerprint = JSON.stringify({ id: editing === 'new' ? null : editing.id, version: editing === 'new' ? null : editing.version, ...input });
      if (requestRef.current?.fingerprint !== fingerprint) requestRef.current = { fingerprint, id: crypto.randomUUID() };
      if (editing === 'new') await apiCreateInstallationTeam(input, requestRef.current.id);
      else await apiUpdateInstallationTeam(editing.id, editing.version, input, requestRef.current.id);
      toast('Equipo guardado. Las instalaciones que ya estaban asignadas conservan sus integrantes.'); setEditing(null); onSaved();
    } catch (cause) { setError(errorText(cause)); if (cause instanceof ApiRequestError && cause.code === 'TEAM_CONFLICT') setConflict(true); }
    finally { setSaving(false); }
  }
  async function refreshVersion() {
    if (!editing || editing === 'new' || saving) return;
    setSaving(true); setError('');
    try {
      const response = await apiInstallationTeams();
      const latest = response.items.find(team => team.id === editing.id);
      if (!latest) throw new Error('El equipo ya no está disponible.');
      setEditing(latest); setLatestTeam(latest); setConflict(false); requestRef.current = null; onSaved();
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }
  const unavailable = memberIds.filter(id => !installers.some(person => person.id === id));
  return <Modal open onClose={() => { if (!saving) onClose(); }} title="Equipos de instalación"><div className="stack installation-teams-modal">
    {editing ? <form className="stack" onSubmit={submit} aria-busy={saving}>
      <h3>{editing === 'new' ? 'Nuevo equipo' : 'Editar equipo'}</h3>
      <Field label="Nombre del equipo" htmlFor="installation-team-name"><input id="installation-team-name" className="input" value={name} onChange={event => setName(event.target.value)} maxLength={120} required disabled={saving} /></Field>
      <fieldset className="installation-member-picker"><legend>Integrantes del equipo</legend>{installers.map(person => <label key={person.id}><input type="checkbox" checked={memberIds.includes(person.id)} onChange={() => toggle(person.id)} disabled={saving} /><span>{person.name}</span></label>)}{unavailable.map((id, index) => <label key={id}><input type="checkbox" checked onChange={() => toggle(id)} disabled={saving} /><span>Integrante no disponible {index + 1} · retíralo para actualizar el equipo</span></label>)}</fieldset>
      <Field label="Responsable principal del equipo" htmlFor="installation-team-leader"><select id="installation-team-leader" className="select" value={leaderId} onChange={event => setLeaderId(event.target.value)} required disabled={saving}><option value="">Selecciona al responsable principal</option>{installers.filter(person => memberIds.includes(person.id)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <label className="installation-check"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} disabled={saving} /><span>Equipo activo</span></label>
      <p className="muted">Solo los equipos activos se pueden elegir para nuevas asignaciones. Editar o desactivar el equipo no modifica las instalaciones que ya lo utilizan.</p>
      {error && <p className="form-alert" role="alert">{error}</p>}{conflict && editing !== 'new' && <div className="notice notice-warning"><p>Otra persona pudo actualizar este equipo. Tus campos se conservan. Consulta la nueva versión antes de guardar.</p><Button variant="secondary" disabled={saving} onClick={() => void refreshVersion()}>Consultar nueva versión</Button></div>}{latestTeam && <p className="notice">Versión actual consultada: {latestTeam.name} · {latestTeam.memberIds.length} integrantes · {latestTeam.active ? 'Activo' : 'Inactivo'}. Tus campos escritos se conservaron; revísalos antes de guardar.</p>}<div className="modal-actions"><Button variant="secondary" disabled={saving} onClick={() => setEditing(null)}>Volver a equipos</Button><Button type="submit" disabled={saving || conflict}>{saving ? 'Guardando equipo…' : 'Guardar equipo'}</Button></div>
    </form> : <><p className="muted">Organiza grupos reutilizables de instaladores con un responsable principal.</p><Button onClick={() => open('new')} disabled={!installers.length}><Plus size={17} />Nuevo equipo</Button>{teams.length ? <div className="installation-team-list">{teams.map(team => <div key={team.id} className="installation-team-record"><div className="installation-card-heading"><strong>{team.name}</strong><span className={`badge badge-${team.active ? 'green' : 'slate'}`}>{team.active ? 'Activo' : 'Inactivo'}</span></div><p>Responsable: {installers.find(person => person.id === team.leaderId)?.name || 'Instalador no disponible'}</p><p>{team.memberIds.length} integrantes</p><Button variant="secondary" onClick={() => open(team)} aria-label={`Editar equipo ${team.name}`}>Editar equipo</Button></div>)}</div> : <EmptyState title="No hay equipos registrados" description="Crea uno con los instaladores activos. También puedes asignar personas sin crear un equipo." />}</>}
  </div></Modal>;
}

function CreateInstallationModal({ available, installers, teams, onClose, onCreated }: { available: NonNullable<InstallationList['availableOrders']>; installers: NonNullable<InstallationList['installers']>; teams: InstallationTeam[]; onClose: () => void; onCreated: (installation: Installation) => void }) {
  const { toast } = useApp();
  const [orderId, setOrderId] = useState(available[0]?.id || '');
  const [assignment, setAssignment] = useState<AssignmentDraft>(emptyAssignment);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(''); setSaving(true);
    try {
      if (!orderId || !address.trim()) throw new Error('Selecciona la OT e indica la dirección de instalación.');
      const input: NewInstallation = { orderId, ...assignmentFields(assignment, teams, true), scheduledStartAt: installationScheduleIso(start), scheduledEndAt: installationScheduleIso(end), address: address.trim(), contactName: contactName.trim(), contactPhone: contactPhone.trim(), instructions: instructions.trim() };
      if (input.scheduledEndAt <= input.scheduledStartAt) throw new Error('La finalización programada debe ser posterior al inicio.');
      const fingerprint = JSON.stringify(input);
      if (requestRef.current?.fingerprint !== fingerprint) requestRef.current = { fingerprint, id: crypto.randomUUID() };
      const saved = await apiCreateInstallation(input, requestRef.current.id);
      toast('Instalación programada y guardada en el servidor.'); onCreated(saved.installation);
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }
  return <Modal open onClose={() => { if (!saving) onClose(); }} title="Nueva instalación"><form className="stack installation-create-form" onSubmit={submit} aria-busy={saving}>
    <p className="muted">Selecciona una OT lista para instalar. No se crea una segunda orden ni se duplica su venta.</p>
    <Field label="OT lista para instalar" htmlFor="installation-order"><select id="installation-order" className="select" required value={orderId} onChange={event => setOrderId(event.target.value)} disabled={saving}><option value="">Selecciona una OT</option>{available.map(order => <option key={order.id} value={order.id}>{otCode(order.number)} · {order.clientName} · {order.description}</option>)}</select></Field>
    <AssignmentFields value={assignment} onChange={setAssignment} installers={installers} teams={teams} disabled={saving} prefix="installation-create" allowPending />
    <ScheduleFields start={start} end={end} setStart={setStart} setEnd={setEnd} disabled={saving} prefix="installation-create" />
    <Field label="Dirección de instalación" htmlFor="installation-create-address"><input id="installation-create-address" className="input" required maxLength={1000} value={address} onChange={event => setAddress(event.target.value)} disabled={saving} placeholder="Dirección completa y ciudad" /></Field>
    <div className="form-grid"><Field label="Persona de contacto" htmlFor="installation-contact"><input id="installation-contact" className="input" maxLength={120} value={contactName} onChange={event => setContactName(event.target.value)} disabled={saving} /></Field><Field label="Teléfono de contacto" htmlFor="installation-contact-phone"><input id="installation-contact-phone" className="input" type="tel" maxLength={80} value={contactPhone} onChange={event => setContactPhone(event.target.value)} disabled={saving} /></Field></div>
    <Field label="Indicaciones de instalación" htmlFor="installation-create-instructions" hint="Acceso, ubicación del montaje, punto de anclaje y recomendaciones para el instalador."><textarea id="installation-create-instructions" className="textarea" rows={3} maxLength={4000} value={instructions} onChange={event => setInstructions(event.target.value)} disabled={saving} /></Field>
    {error && <p className="form-alert" role="alert">{error}</p>}<div className="modal-actions"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Programar instalación'}</Button></div>
  </form></Modal>;
}

function ScheduleFields({ start, end, setStart, setEnd, disabled, prefix }: { start: string; end: string; setStart: (value: string) => void; setEnd: (value: string) => void; disabled: boolean; prefix: string }) {
  return <div className="installation-schedule-fields"><p>Fecha y hora de Colombia (Bogotá)</p><div className="form-grid"><Field label="Inicio programado" htmlFor={`${prefix}-start`}><input id={`${prefix}-start`} className="input" type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} disabled={disabled} /></Field><Field label="Finalización programada" htmlFor={`${prefix}-end`}><input id={`${prefix}-end`} className="input" type="datetime-local" required min={start || undefined} value={end} onChange={event => setEnd(event.target.value)} disabled={disabled} /></Field></div></div>;
}

type DetailMode = 'assign' | 'reschedule' | 'postpone' | 'exception' | 'note' | 'complete' | null;
function InstallationDetails({ id, admin, installers, teams, onClose, onChanged }: { id: string; admin: boolean; installers: NonNullable<InstallationList['installers']>; teams: InstallationTeam[]; onClose: () => void; onChanged: () => void }) {
  const { toast, user } = useApp();
  const online = useConnectivity();
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [events, setEvents] = useState<InstallationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState<DetailMode>(null);
  const [assignment, setAssignment] = useState<AssignmentDraft>(emptyAssignment);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [result, setResult] = useState('');
  const [mounted, setMounted] = useState(false);
  const [electrical, setElectrical] = useState<'' | 'VERIFIED' | 'NOT_APPLICABLE'>('');
  const [absentMembersReason, setAbsentMembersReason] = useState('');
  const [preparedPhoto, setPreparedPhoto] = useState<Awaited<ReturnType<typeof prepareInstallationPhoto>> | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const photoUrlRef = useRef('');
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const locationRetryRef = useRef<{ action: 'arrive' | 'checkout' | 'complete'; version: number; location?: InstallationLocation } | null>(null);
  const ambiguousWriteRef = useRef(false);
  useEffect(() => {
    let active = true;
    void apiInstallation(id).then(response => {
      if (active) { setInstallation(response.installation); setEvents(response.events); }
    }).catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current); };
  }, [id]);
  async function refreshDetail() {
    if (busy) return;
    setBusy('refresh'); setError('');
    try { const response = await apiInstallation(id); setInstallation(response.installation); setEvents(response.events); setConflict(false); locationRetryRef.current = null; requestRef.current = null; ambiguousWriteRef.current = false; }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(''); }
  }
  function reportError(cause: unknown) {
    setError(errorText(cause));
    ambiguousWriteRef.current = cause instanceof ApiRequestError && cause.status === 0;
    if (cause instanceof ApiRequestError && ['INSTALLATION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'MEMBERS_STILL_WORKING'].includes(cause.code)) setConflict(true);
    if (cause instanceof ApiRequestError && cause.code === 'LOCATION_STALE') locationRetryRef.current = null;
  }
  function stableRequest(payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    if (requestRef.current?.fingerprint !== fingerprint) requestRef.current = { fingerprint, id: crypto.randomUUID() };
    return requestRef.current.id;
  }
  async function acceptSaved(saved: Installation, message: string) {
    setInstallation(saved); setMode(null); setReason(''); setNote(''); setConflict(false); requestRef.current = null; locationRetryRef.current = null; ambiguousWriteRef.current = false;
    toast(message); onChanged();
    try { const next = await apiInstallation(id); setInstallation(next.installation); setEvents(next.events); }
    catch { setError('El cambio quedó guardado, pero no pudimos actualizar el historial. Vuelve a consultar la instalación.'); }
  }
  async function sendAction(input: InstallationAction, message: string) {
    if (!installation || busy || conflict) return;
    setBusy(input.action); setError('');
    try {
      const saved = await apiInstallationAction(id, installation.version, input, stableRequest({ id, version: installation.version, ...input }));
      await acceptSaved(saved.installation, message);
    } catch (cause) { reportError(cause); }
    finally { setBusy(''); }
  }
  async function captureFor(action: 'arrive' | 'checkout' | 'complete', item: Installation) {
    if (item.locationException) return undefined;
    const previous = locationRetryRef.current;
    // An ambiguous network failure retries the exact request, even if its fix aged:
    // the server checks idempotency before freshness and can confirm the first write.
    if (previous?.action === action && previous.version === item.version && previous.location &&
      (ambiguousWriteRef.current || Date.now() - new Date(previous.location.capturedAt).getTime() < 4 * 60_000)) return previous.location;
    const location = await captureInstallationLocation();
    if (location.accuracy > 250) throw new Error(`La ubicación tiene una precisión de ${Math.round(location.accuracy)} m. Se requieren 250 m o menos. Activa la ubicación precisa o solicita una excepción a Administración.`);
    locationRetryRef.current = { action, version: item.version, location };
    return location;
  }
  async function recordLocationAction(action: 'arrive' | 'checkout') {
    if (!installation || busy || conflict) return;
    setBusy(action); setError('');
    try {
      const location = await captureFor(action, installation);
      const input: InstallationAction = { action, ...(location ? { location } : {}) };
      const saved = await apiInstallationAction(id, installation.version, input, stableRequest({ id, version: installation.version, ...input }));
      await acceptSaved(saved.installation, action === 'arrive' ? 'Tu llegada quedó registrada. Tu tiempo de trabajo está en curso.' : 'Tu salida quedó registrada. La instalación conserva el avance de los demás integrantes.');
    } catch (cause) { reportError(cause); }
    finally { setBusy(''); }
  }
  async function choosePhoto(file: File | undefined) {
    if (!file || busy) return;
    setBusy('prepare-photo'); setError('');
    try { setPreparedPhoto(await prepareInstallationPhoto(file)); }
    catch (cause) { reportError(cause); }
    finally { setBusy(''); }
  }
  async function uploadPhoto() {
    if (!installation || !preparedPhoto || busy || conflict) return;
    setBusy('upload-photo'); setError('');
    try {
      const imageBase64 = preparedPhoto.dataUrl.slice(preparedPhoto.dataUrl.indexOf(',') + 1);
      const response = await apiInstallationEvidence(id, installation.version, imageBase64, stableRequest({ id, version: installation.version, imageBase64 }));
      setInstallation(response.installation); setPreparedPhoto(null); requestRef.current = null; ambiguousWriteRef.current = false; onChanged();
      if (photoUrlRef.current) { URL.revokeObjectURL(photoUrlRef.current); photoUrlRef.current = ''; setPhotoUrl(''); }
      toast('Fotografía guardada de forma privada en el servidor.');
      try { const next = await apiInstallation(id); setInstallation(next.installation); setEvents(next.events); }
      catch { setError('La fotografía quedó guardada, pero no pudimos actualizar el historial. Vuelve a consultar la instalación.'); }
    } catch (cause) { reportError(cause); }
    finally { setBusy(''); }
  }
  async function viewPhoto() {
    if (!installation?.evidence || busy) return;
    setBusy('view-photo'); setError('');
    try {
      const photo = await apiInstallationPhoto(id, installation.evidence.id);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = URL.createObjectURL(photo); setPhotoUrl(photoUrlRef.current);
    } catch (cause) { reportError(cause); }
    finally { setBusy(''); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!installation || busy || conflict) return;
    if (mode === 'complete') {
      if (!mounted || !electrical || !result.trim()) { setError('Verifica el montaje, indica la prueba eléctrica o No aplica y describe el resultado.'); return; }
      if (preparedPhoto) { setError('Guarda la fotografía seleccionada antes de finalizar.'); return; }
      if (!installation.evidence) { setError('Guarda una fotografía de evidencia antes de finalizar.'); return; }
      const activeOthers = (installation.members || []).filter(member => member.userId !== user?.id && ['IN_PROGRESS', 'PAUSED'].includes(member.status));
      if (activeOthers.length) { setError('Los demás integrantes que llegaron deben registrar su salida antes de finalizar la instalación.'); return; }
      const absent = (installation.members || []).filter(member => !member.arrivedAt);
      if (absent.length && !absentMembersReason.trim()) { setError('Explica por qué se finaliza sin los integrantes que no registraron llegada.'); return; }
      setBusy('complete'); setError('');
      try {
        const location = await captureFor('complete', installation);
        const input: InstallationAction = { action: 'complete', result: result.trim(), checklist: { mounted: true, electrical }, photoId: installation.evidence.id, ...(location ? { location } : {}), ...(absent.length ? { absentMembersReason: absentMembersReason.trim() } : {}) };
        const saved = await apiInstallationAction(id, installation.version, input, stableRequest({ id, version: installation.version, ...input }));
        await acceptSaved(saved.installation, 'Instalación finalizada. La OT quedó marcada como instalada.');
      } catch (cause) { reportError(cause); }
      finally { setBusy(''); }
      return;
    }
    if (mode === 'note') { if (!note.trim()) { setError('Escribe una observación.'); return; } await sendAction({ action: 'note', note: note.trim() }, 'Observación guardada.'); return; }
    if (!reason.trim()) { setError('Escribe el motivo del cambio.'); return; }
    if (mode === 'assign') {
      try { await sendAction({ action: 'assign', ...assignmentFields(assignment, teams, false), reason: reason.trim() }, 'Responsables actualizados. El cambio quedó en el historial.'); }
      catch (cause) { reportError(cause); }
    } else if (mode === 'postpone') await sendAction({ action: 'postpone', reason: reason.trim() }, 'Instalación aplazada. Se detuvo el tiempo activo.');
    else if (mode === 'exception') await sendAction({ action: 'authorize-location-exception', reason: reason.trim() }, 'Excepción de ubicación autorizada y registrada.');
    else if (mode === 'reschedule') {
      try {
        const scheduledStartAt = installationScheduleIso(start), scheduledEndAt = installationScheduleIso(end);
        if (scheduledEndAt <= scheduledStartAt) throw new Error('La finalización programada debe ser posterior al inicio.');
        await sendAction({ action: 'reschedule', scheduledStartAt, scheduledEndAt, reason: reason.trim() }, 'Programación actualizada.');
      } catch (cause) { reportError(cause); }
    }
  }
  function openMode(next: DetailMode) {
    setMode(next); setError('');
    if (next === 'reschedule' && installation) { setStart(installationDateTimeInput(installation.scheduledStartAt)); setEnd(installationDateTimeInput(installation.scheduledEndAt)); }
    if (next === 'assign' && installation) {
      const installerIds = installation.members?.map(member => member.userId) || (installation.installerId ? [installation.installerId] : []);
      setAssignment({ mode: installation.teamId && teams.some(team => team.id === installation.teamId && team.active) ? 'TEAM' : installerIds.length > 1 ? 'MULTIPLE' : 'INDIVIDUAL', installerId: installation.installerId || '', installerIds, teamId: installation.teamId || '' });
    }
  }
  const disabled = Boolean(busy) || !online || conflict;
  const finished = installation?.status === 'COMPLETED';
  const availableForChange = installation && !finished && installation.productionReady;
  const canPlan = availableForChange && !['IN_PROGRESS', 'PAUSED'].includes(installation.status);
  const myMembership = installation?.members?.find(member => member.userId === user?.id);
  const lead = !admin && installation?.installerId === user?.id;
  const ownStatus = myMembership?.status;
  const activeOthers = installation?.members?.filter(member => member.userId !== user?.id && ['IN_PROGRESS', 'PAUSED'].includes(member.status)) || [];
  const absentMembers = installation?.members?.filter(member => !member.arrivedAt) || [];
  const modeTitle = { assign: 'Asignar responsable', reschedule: 'Reprogramar instalación', postpone: 'Aplazar instalación', exception: 'Autorizar excepción de ubicación', note: 'Añadir observación', complete: 'Protocolo de cierre' };
  return <Modal open onClose={() => { if (!busy) onClose(); }} title={installation ? `${otCode(installation.orderNumber)} · Instalación` : 'Detalle de instalación'}>
    <div className="stack installation-detail" data-testid="installation-detail" aria-busy={Boolean(busy) || loading}>
      {loading ? <p role="status">Consultando la instalación…</p> : installation && <>
        <div className="installation-detail-heading"><InstallationState installation={installation} admin={admin} /><span className="installation-version">Versión {installation.version} · Actualizada {formatDate(installation.updatedAt, true)}</span></div>
        <div className="installation-detail-client"><h3>{installation.clientName}</h3><p>{installation.description}</p>{admin && <Link className="link" to={`/orders/${installation.orderId}`}>Abrir OT completa<ArrowRight size={14} /></Link>}</div>
        {!installation.productionReady && !finished && <p className="form-alert" role="alert">La OT tiene producción pendiente. No se puede avanzar la instalación hasta que termine.</p>}
        <dl className="installation-detail-facts"><div><dt>Responsable principal</dt><dd>{installation.installerName || 'Sin asignar'}</dd></div><div><dt>Inicio programado</dt><dd>{formatDate(installation.scheduledStartAt, true)}</dd></div><div><dt>Finalización programada</dt><dd>{formatDate(installation.scheduledEndAt, true)}</dd></div><div><dt>Tiempo activo registrado</dt><dd>{durationText(installation.netWorkMinutes)}</dd></div>{installation.startedAt && <div><dt>Primera llegada</dt><dd>{formatDate(installation.startedAt, true)}</dd></div>}{installation.completedAt && <div><dt>Finalización</dt><dd>{formatDate(installation.completedAt, true)}</dd></div>}</dl>
        {Boolean(installation.members?.length) && <section className="installation-members"><h4><UsersRound size={18} />{installation.teamName || 'Integrantes de la instalación'}</h4><p className="muted">Cada persona registra su llegada, pausas y salida. El responsable principal coordina y completa el cierre.</p><ul>{installation.members.map(member => <li key={member.userId}><div className="installation-member-heading"><strong>{member.name}{member.userId === user?.id ? ' (tú)' : ''}</strong>{member.isLead && <span className="badge badge-blue">Responsable principal</span>}</div><span className={`badge badge-${member.status === 'CHECKED_OUT' ? 'green' : member.status === 'PAUSED' ? 'amber' : 'slate'}`}>{({ ASSIGNED: 'Sin llegada', IN_PROGRESS: 'Trabajando', PAUSED: 'En pausa', CHECKED_OUT: 'Salida registrada' })[member.status]}</span><p>Llegada: {formatDate(member.arrivedAt || undefined, true)} · Salida: {formatDate(member.checkedOutAt || undefined, true)}</p><p>Tiempo activo: {durationText(member.netWorkMinutes)}</p></li>)}</ul></section>}
        <section className="installation-address"><div><MapPin size={19} /><div><strong>{installation.address}</strong>{(installation.contactName || installation.contactPhone) && <p>{installation.contactName}{installation.contactName && installation.contactPhone ? ' · ' : ''}{installation.contactPhone}</p>}</div></div><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(installation.address)}`} className="btn btn-secondary" target="_blank" rel="noreferrer noopener"><Navigation size={16} />Abrir Maps</a></section>
        {installation.instructions && <section className="installation-text-block"><h4>Indicaciones para el trabajo</h4><p>{installation.instructions}</p></section>}
        {installation.locationException ? <p className="notice notice-warning"><ShieldCheck size={16} />Excepción de ubicación autorizada por Administración: {installation.locationExceptionReason}</p> : !admin && !finished && <p className="installation-privacy"><MapPin size={16} />Al registrar llegada, salida y finalización se solicita tu ubicación y precisión. No hay seguimiento continuo. La hora queda registrada por el servidor.</p>}
        {finished && <section className="installation-result"><h4><CheckCircle2 size={18} />Resultado de la instalación</h4><p>{installation.result}</p><p className="muted">Montaje verificado · {installation.checklist?.electrical === 'NOT_APPLICABLE' ? 'Conexión eléctrica: no aplica' : 'Conexión eléctrica verificada'}</p></section>}
        {installation.evidence && <section className="installation-photo-section"><div className="installation-photo-label"><span><Camera size={17} />Evidencia guardada · {formatDate(installation.evidence.createdAt, true)}</span><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void viewPhoto()}>{busy === 'view-photo' ? 'Cargando…' : photoUrl ? 'Volver a cargar fotografía' : 'Ver fotografía'}</Button></div>{photoUrl && <img className="installation-evidence-image" src={photoUrl} alt={`Evidencia de instalación de ${otCode(installation.orderNumber)}`} />}</section>}
        {availableForChange && <div className="installation-detail-actions">
          {admin ? <>{canPlan && <><Button variant="secondary" disabled={disabled || !installers.length} onClick={() => openMode('assign')}><UserRound size={16} />{installation.installerId ? 'Reasignar responsable' : 'Asignar responsable'}</Button><Button variant="secondary" disabled={disabled} onClick={() => openMode('reschedule')}><CalendarClock size={16} />Reprogramar</Button></>}{installation.status !== 'POSTPONED' && <Button variant="secondary" disabled={disabled} onClick={() => openMode('postpone')}><Pause size={16} />Aplazar instalación</Button>}{!installation.locationException && <Button variant="secondary" disabled={disabled} onClick={() => openMode('exception')}><ShieldCheck size={16} />Autorizar excepción GPS</Button>}</> : <>
            {installation.status !== 'POSTPONED' && ownStatus === 'ASSIGNED' && <Button disabled={disabled} onClick={() => void recordLocationAction('arrive')}><MapPin size={17} />{busy === 'arrive' ? 'Registrando llegada…' : 'Registrar llegada'}</Button>}
            {installation.status !== 'POSTPONED' && ownStatus === 'IN_PROGRESS' && <><Button variant="secondary" disabled={disabled} onClick={() => void sendAction({ action: 'pause', kind: 'REST' }, 'Inicio de tu descanso registrado.')}><Coffee size={16} />Iniciar descanso</Button><Button variant="secondary" disabled={disabled} onClick={() => void sendAction({ action: 'pause', kind: 'LUNCH' }, 'Inicio de tu almuerzo registrado.')}><Pause size={16} />Iniciar almuerzo</Button></>}
            {installation.status !== 'POSTPONED' && ownStatus === 'PAUSED' && <Button disabled={disabled} onClick={() => void sendAction({ action: 'resume' }, 'Tu trabajo se reanudó.')}><Play size={17} />Reanudar trabajo</Button>}
            {installation.status !== 'POSTPONED' && ownStatus && ['IN_PROGRESS', 'PAUSED'].includes(ownStatus) && !lead && <Button disabled={disabled} onClick={() => void recordLocationAction('checkout')}><MapPin size={17} />{busy === 'checkout' ? 'Registrando salida…' : 'Registrar salida'}</Button>}
            {installation.status !== 'POSTPONED' && lead && ownStatus && ['IN_PROGRESS', 'CHECKED_OUT'].includes(ownStatus) && <Button disabled={disabled || activeOthers.length > 0} onClick={() => openMode('complete')}><CheckCircle2 size={17} />Finalizar instalación</Button>}
            {lead && activeOthers.length > 0 && <p className="notice">Antes de finalizar, deben registrar su salida: {activeOthers.map(member => member.name).join(', ')}.</p>}
            {lead && ownStatus === 'IN_PROGRESS' && <p className="installation-privacy">Al confirmar la finalización también se registra tu salida con ubicación.</p>}
            {!lead && ownStatus === 'CHECKED_OUT' && <p className="notice">Tu salida ya está guardada. El responsable principal completará el cierre de la instalación.</p>}
            {installation.status === 'POSTPONED' && <p className="notice">Instalación aplazada. Administración debe reprogramarla antes de continuar.</p>}
          </>}
          <Button variant="secondary" disabled={disabled} onClick={() => openMode('note')}><MessageSquare size={16} />Añadir observación</Button>
        </div>}
        {mode && !finished && <form className="stack installation-action-form" onSubmit={submit}>
          <h4>{modeTitle[mode]}</h4>
          {mode === 'assign' && <AssignmentFields value={assignment} onChange={setAssignment} installers={installers} teams={teams} disabled={disabled} prefix="installation-assign" />}
          {mode === 'reschedule' && <ScheduleFields start={start} end={end} setStart={setStart} setEnd={setEnd} disabled={disabled} prefix="installation-reschedule" />}
          {mode === 'exception' && <p className="notice notice-warning">Esta autorización permite llegada y cierre sin GPS únicamente en esta instalación. El motivo y tu usuario quedarán registrados.</p>}
          {mode === 'note' ? <Field label="Observación" htmlFor="installation-detail-note"><textarea id="installation-detail-note" className="textarea" rows={3} required maxLength={4000} value={note} onChange={event => setNote(event.target.value)} disabled={disabled} /></Field> : mode !== 'complete' && <Field label="Motivo del cambio" htmlFor="installation-change-reason"><textarea id="installation-change-reason" className="textarea" rows={3} required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={disabled} /></Field>}
          {mode === 'complete' && <>
            <label className="installation-check"><input type="checkbox" required checked={mounted} onChange={event => setMounted(event.target.checked)} disabled={disabled} /><span>Montaje fijado y nivelado</span></label>
            <Field label="Conexión eléctrica" htmlFor="installation-electrical"><select id="installation-electrical" className="select" value={electrical} onChange={event => setElectrical(event.target.value as typeof electrical)} required disabled={disabled}><option value="">Selecciona el resultado</option><option value="VERIFIED">Verificada y probada</option><option value="NOT_APPLICABLE">No aplica a este trabajo</option></select></Field>
            <Field label="Evidencia fotográfica" htmlFor="installation-evidence-file" hint="Se optimiza en este dispositivo antes de guardarse. Una fotografía del resultado es obligatoria."><input id="installation-evidence-file" className="input" type="file" accept="image/*" capture="environment" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choosePhoto(file); }} /></Field>
            {preparedPhoto && <div className="installation-photo-preview"><img src={preparedPhoto.dataUrl} alt="Fotografía seleccionada, todavía sin guardar" /><p className="muted">{preparedPhoto.filename} · {Math.ceil(preparedPhoto.bytes / 1024)} KB · Todavía no está guardada.</p><Button disabled={disabled} onClick={() => void uploadPhoto()}><Camera size={16} />{busy === 'upload-photo' ? 'Guardando fotografía…' : 'Guardar fotografía'}</Button><Button variant="secondary" disabled={Boolean(busy)} onClick={() => setPreparedPhoto(null)}>Descartar fotografía seleccionada</Button></div>}
            {installation.evidence && <p className="installation-photo-confirmed"><CheckCircle2 size={16} />La instalación tiene una fotografía guardada.</p>}
            <Field label="Resultado de la instalación" htmlFor="installation-result"><textarea id="installation-result" className="textarea" rows={4} required maxLength={4000} value={result} onChange={event => setResult(event.target.value)} disabled={disabled} placeholder="Describe el resultado, las comprobaciones y las observaciones de terreno." /></Field>
            {absentMembers.length > 0 && <Field label="Motivo de cierre sin integrantes que no llegaron" htmlFor="installation-absent-reason" hint={`Sin llegada: ${absentMembers.map(member => member.name).join(', ')}. No se les registra tiempo trabajado ni una instalación finalizada.`}><textarea id="installation-absent-reason" className="textarea" rows={3} required maxLength={2000} value={absentMembersReason} onChange={event => setAbsentMembersReason(event.target.value)} disabled={disabled} /></Field>}
          </>}
          <div className="modal-actions"><Button variant="secondary" onClick={() => setMode(null)} disabled={Boolean(busy)}>Volver al detalle</Button><Button type="submit" disabled={disabled || !installation.productionReady}>{busy && busy !== 'view-photo' ? 'Guardando…' : mode === 'complete' ? 'Confirmar finalización' : 'Guardar cambio'}</Button></div>
        </form>}
        <section className="installation-history"><h4><History size={18} />Historial de la instalación</h4>{events.length ? <ol>{events.map(event => <InstallationEventRow key={event.id} event={event} />)}</ol> : <p className="muted">No hay eventos registrados.</p>}</section>
      </>}
      {busy && <p className="installation-saving" role="status">{busy === 'arrive' || busy === 'checkout' || busy === 'complete' ? 'Obteniendo ubicación y guardando en el servidor…' : busy === 'prepare-photo' ? 'Preparando fotografía…' : busy === 'view-photo' ? 'Consultando fotografía…' : 'Guardando en el servidor…'}</p>}
      {!online && <p className="form-alert" role="alert">No hay conexión. Lo que escribas aquí no se envía automáticamente; no cierres este formulario y vuelve a intentar al reconectar.</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {conflict && <p className="notice notice-warning">Otra persona actualizó esta instalación. Consulta la versión nueva antes de guardar de nuevo; tus campos escritos se conservan.</p>}
      <div className="installation-detail-footer"><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void refreshDetail()}><RefreshCw size={16} />Actualizar instalación</Button><Button variant="secondary" disabled={Boolean(busy)} onClick={onClose}>Cerrar</Button></div>
    </div>
  </Modal>;
}

function InstallationEventRow({ event }: { event: InstallationEvent }) {
  const actionLabels: Record<string, string> = { create: 'Instalación programada', assign: 'Responsables asignados', reschedule: 'Instalación reprogramada', arrive: 'Llegada registrada', pause: 'Pausa iniciada', resume: 'Trabajo reanudado', checkout: 'Salida registrada', postpone: 'Instalación aplazada', complete: 'Instalación finalizada', note: 'Observación registrada', 'authorize-location-exception': 'Excepción de ubicación autorizada', evidence: 'Fotografía guardada' };
  const details = event.details || {};
  const names = (members: unknown) => Array.isArray(members) ? members.flatMap(member => member && typeof member === 'object' && typeof member.name === 'string' ? [member.name] : []).join(', ') : '';
  const memberNames = names(details.members), previousMembers = names(details.previousMembers), absentNames = names(details.absentMembers);
  return <li><div className="installation-event-heading"><strong>{details.summary || actionLabels[event.action] || 'Registro de instalación'}</strong><time dateTime={event.occurredAt}>{formatDate(event.occurredAt, true)}</time></div><p>{event.actor.name} · {ROLE_LABELS[event.actor.role as Role] || 'Usuario'}</p>{details.reason && <p><strong>Motivo: </strong>{details.reason}</p>}{details.note && <p className="installation-event-note">{details.note}</p>}{typeof details.previousInstallerName === 'string' && <p>Responsable anterior: {details.previousInstallerName}</p>}{typeof details.installerName === 'string' && <p>Responsable principal: {details.installerName}</p>}{previousMembers && <p>Integrantes anteriores: {previousMembers}</p>}{memberNames && <p>Integrantes: {memberNames}</p>}{typeof details.teamName === 'string' && <p>Equipo: {details.teamName}</p>}{typeof details.previousStartAt === 'string' && typeof details.previousEndAt === 'string' && <p>Horario anterior: {formatDate(details.previousStartAt, true)} a {formatDate(details.previousEndAt, true)}</p>}{typeof details.scheduledStartAt === 'string' && typeof details.scheduledEndAt === 'string' && <p>Programación: {formatDate(details.scheduledStartAt, true)} a {formatDate(details.scheduledEndAt, true)}</p>}{details.kind === 'REST' && <p>Descanso</p>}{details.kind === 'LUNCH' && <p>Almuerzo</p>}{absentNames && <p>Integrantes sin llegada: {absentNames}</p>}{typeof details.absentMembersReason === 'string' && <p>Motivo de cierre sin su participación: {details.absentMembersReason}</p>}{details.location && <p className="installation-location-proof"><MapPin size={13} />Ubicación: {details.location.latitude.toFixed(5)}, {details.location.longitude.toFixed(5)} · Precisión {Math.round(details.location.accuracy)} m · Captura {formatDate(details.location.capturedAt, true)}</p>}</li>;
}
