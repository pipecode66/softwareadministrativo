import { request } from './api';

export const MAX_INSTALLATION_PHOTO_BYTES = 160 * 1024;
const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;

export type InstallationStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'PAUSED' | 'POSTPONED' | 'COMPLETED';
export type InstallationPersonalStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'PAUSED' | 'CHECKED_OUT' | 'POSTPONED' | 'COMPLETED';
export type InstallationFilterStatus = InstallationStatus | 'CHECKED_OUT';
export const INSTALLATION_STATUS_LABELS: Record<InstallationStatus, string> = {
  PENDING: 'Sin asignar', ASSIGNED: 'Asignada', IN_PROGRESS: 'En ejecución',
  PAUSED: 'En pausa', POSTPONED: 'Aplazada', COMPLETED: 'Finalizada',
};
export const INSTALLATION_PERSONAL_STATUS_LABELS: Record<InstallationPersonalStatus, string> = {
  ASSIGNED: 'Por instalar', IN_PROGRESS: 'Mi trabajo en ejecución', PAUSED: 'Mi pausa',
  CHECKED_OUT: 'Mi jornada finalizada', POSTPONED: 'Aplazada', COMPLETED: 'Instalación finalizada',
};
export function installationDurationText(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.round(Math.max(0, minutes)) : 0;
  const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  return `${number.format(Math.floor(total / 60))} h ${number.format(total % 60)} min`;
}

export interface InstallationLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
}

export function installationDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date).replace(' ', 'T');
}
export function installationScheduleIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Indica una fecha y hora válidas.');
  const date = new Date(`${value}:00-05:00`);
  if (Number.isNaN(date.getTime()) || installationDateTimeInput(date.toISOString()) !== value) throw new Error('Indica una fecha y hora válidas.');
  return date.toISOString();
}

/** A fresh browser fix is requested only in response to an informed user action. */
export function captureInstallationLocation(): Promise<InstallationLocation> {
  if (!window.isSecureContext) return Promise.reject(new Error('La ubicación requiere una conexión segura HTTPS.'));
  if (!navigator.geolocation) return Promise.reject(new Error('Este dispositivo no permite obtener la ubicación. Solicita una excepción a Administración.'));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    if (![latitude, longitude, accuracy, position.timestamp].every(Number.isFinite)) {
      reject(new Error('El dispositivo no entregó una ubicación válida. Inténtalo nuevamente.'));
      return;
    }
    resolve({ latitude, longitude, accuracy, capturedAt: new Date(position.timestamp).toISOString() });
  }, error => {
    reject(new Error(error.code === 1
      ? 'No se autorizó la ubicación. Actívala en los permisos del navegador o solicita una excepción a Administración.'
      : error.code === 3
        ? 'Se agotó el tiempo para obtener la ubicación. Inténtalo al aire libre o solicita una excepción a Administración.'
        : 'No fue posible obtener la ubicación. Revisa el GPS o solicita una excepción a Administración.'));
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }));
}

/** Re-encodes locally to JPEG, removing source metadata and bounding upload size. */
export async function prepareInstallationPhoto(file: File): Promise<{ dataUrl: string; filename: string; bytes: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Selecciona una fotografía válida.');
  if (!file.size || file.size > MAX_SOURCE_PHOTO_BYTES) throw new Error('La fotografía original debe pesar como máximo 20 MB.');
  const objectUrl = URL.createObjectURL(file);
  const picture = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      picture.onload = () => resolve();
      picture.onerror = () => reject(new Error('No pudimos leer esa fotografía. Prueba una imagen JPEG o PNG.'));
      picture.src = objectUrl;
    });
    if (!picture.naturalWidth || !picture.naturalHeight) throw new Error('La fotografía no tiene dimensiones válidas.');
    const canvas = document.createElement('canvas');
    let edge = 1600;
    while (edge >= 400) {
      const scale = Math.min(1, edge / Math.max(picture.naturalWidth, picture.naturalHeight));
      canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Este navegador no permite preparar la fotografía.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      for (const quality of [.82, .7, .58, .46]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('Este navegador no permite preparar fotografías JPEG.');
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
        if (bytes <= MAX_INSTALLATION_PHOTO_BYTES) return { dataUrl, filename: (file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'evidencia') + '.jpg', bytes };
      }
      edge = Math.floor(edge * .75);
    }
    throw new Error('No fue posible reducir la fotografía al tamaño permitido. Prueba otra imagen.');
  } finally { URL.revokeObjectURL(objectUrl); }
}

export interface InstallationMetrics {
  completedThisMonth: number; inProgress: number; postponed: number;
  onTime: number; scheduledCompleted: number; netWorkMinutes: number;
}
export interface InstallationEvidence { id: string; url: string; createdAt: string }
export interface InstallationMember {
  userId: string; name: string; isLead: boolean;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'PAUSED' | 'CHECKED_OUT';
  arrivedAt: string | null; checkedOutAt: string | null; netWorkMinutes: number;
}
export interface InstallationTeam {
  id: string; name: string; memberIds: string[]; leaderId: string;
  active: boolean; version: number; createdAt: string; updatedAt: string;
}
export interface InstallationTeamInput { name: string; memberIds: string[]; leaderId: string; active: boolean }
export interface InstallationProduct {
  id: string; description: string; quantity: number;
  materials: { id: string; material: string; length: number; width: number; areaM2: number }[];
}
export interface Installation {
  id: string; orderId: string; orderNumber: number; clientName: string;
  description: string; status: InstallationStatus; personalStatus: InstallationPersonalStatus | null; installerId: string | null;
  installerName: string | null; version: number; scheduledStartAt: string;
  scheduledEndAt: string; address: string; contactName: string; contactPhone: string;
  instructions: string; startedAt: string | null; completedAt: string | null;
  result: string | null; checklist: { mounted: boolean; electrical: 'VERIFIED' | 'NOT_APPLICABLE' } | null;
  locationException: boolean; locationExceptionReason: string | null;
  evidence: InstallationEvidence | null; createdAt: string; updatedAt: string;
  netWorkMinutes: number; productionReady: boolean; members: InstallationMember[];
  products: InstallationProduct[];
  teamId?: string | null; teamName?: string | null;
}
export interface InstallationEvent {
  id: string; action: string; actor: { id: string; name: string; role: string };
  occurredAt: string; fromStatus: InstallationStatus | null; toStatus: InstallationStatus;
  details: { summary?: string; reason?: string; note?: string; location?: InstallationLocation; [key: string]: unknown };
}
export interface InstallationList {
  items: Installation[]; page: number; pageSize: number; total: number; metrics: InstallationMetrics;
  availableOrders?: { id: string; number: number; clientName: string; description: string }[];
  installers?: { id: string; name: string }[];
  performance?: ({ installerId: string; name: string } & InstallationMetrics)[];
}
export interface NewInstallation {
  orderId: string; installerId?: string; installerIds?: string[]; teamId?: string;
  scheduledStartAt: string; scheduledEndAt: string;
  address: string; contactName?: string; contactPhone?: string; instructions?: string;
}
export type InstallationAction =
  | { action: 'assign'; installerId?: string; installerIds?: string[]; teamId?: string; reason: string }
  | { action: 'edit-details'; address: string; contactName: string; contactPhone: string; instructions: string; reason: string }
  | { action: 'reschedule'; scheduledStartAt: string; scheduledEndAt: string; reason: string }
  | { action: 'arrive' | 'checkout'; location?: InstallationLocation }
  | { action: 'pause'; kind: 'REST' | 'LUNCH'; note?: string }
  | { action: 'resume' }
  | { action: 'postpone' | 'authorize-location-exception'; reason: string }
  | { action: 'complete'; location?: InstallationLocation; result: string; checklist: { mounted: true; electrical: 'VERIFIED' | 'NOT_APPLICABLE' }; photoId: string; absentMembersReason?: string }
  | { action: 'note'; note: string };

export function apiInstallations(query: { page?: number; pageSize?: number; status?: InstallationFilterStatus; installerId?: string; q?: string } = {}): Promise<InstallationList> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return request<InstallationList>(`/installations?${params}`);
}
export function apiInstallation(id: string): Promise<{ installation: Installation; events: InstallationEvent[] }> {
  return request(`/installations/${encodeURIComponent(id)}`);
}
export function apiCreateInstallation(input: NewInstallation, requestId: string): Promise<{ installation: Installation; replayed: boolean }> {
  return request('/installations', { method: 'POST', body: JSON.stringify({ ...input, requestId }) });
}
export function apiInstallationAction(id: string, version: number, input: InstallationAction, requestId: string): Promise<{ installation: Installation; replayed: boolean }> {
  return request(`/installations/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ ...input, version, requestId }) });
}
export function apiInstallationEvidence(id: string, version: number, imageBase64: string, requestId: string): Promise<{ installation: Installation; evidence: InstallationEvidence; replayed: boolean }> {
  return request(`/installations/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: JSON.stringify({ version, imageBase64, requestId }) });
}
export function apiInstallationTeams(): Promise<{ items: InstallationTeam[] }> {
  return request('/installations/teams');
}
export function apiCreateInstallationTeam(input: InstallationTeamInput, requestId: string): Promise<{ team: InstallationTeam; replayed: boolean }> {
  return request('/installations/teams', { method: 'POST', body: JSON.stringify({ ...input, requestId }) });
}
export function apiUpdateInstallationTeam(id: string, version: number, input: InstallationTeamInput, requestId: string): Promise<{ team: InstallationTeam; replayed: boolean }> {
  return request(`/installations/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...input, version, requestId }) });
}
export async function apiInstallationPhoto(id: string, evidenceId: string): Promise<Blob> {
  let response: Response;
  try { response = await fetch(`/api/v1/installations/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`, { credentials: 'include', cache: 'no-store' }); }
  catch { throw new Error('No pudimos cargar la fotografía. Revisa la conexión e inténtalo de nuevo.'); }
  if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? 'No tienes acceso a esta fotografía o ya no está disponible.' : 'No pudimos cargar la fotografía. Actualiza los datos e inténtalo de nuevo.');
  if (!response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('El servidor no devolvió una fotografía válida.');
  return response.blob();
}
