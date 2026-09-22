import { apiDeleteOrderDraft, apiOrderDraft, apiSaveOrderDraft, type OrderDraftRecord, usingApi } from './api';
import type { Category, DocumentType, Material, PaymentMethod, PrintingType } from '../domain/types';

const PREFIX = 'intermedios-order-draft:';
export const ORDER_DRAFT_EVENT = 'intermedios-order-draft-changed';

export interface OrderFormDraft {
  clientId: string;
  category: Category;
  documentType: DocumentType;
  requiresInstallation: boolean;
  paymentAmount: string;
  paymentMethod: Exclude<PaymentMethod, 'LEGACY'>;
  products: Array<{
    key: string; description: string; quantity: string; unitValue: string;
    design: boolean; printing: boolean; printingType: PrintingType; workshop: boolean; external: boolean;
    designerId: string;
    materials: Array<{ key: string; material: Material; length: string; width: string }>;
  }>;
}

function key(userId: string) { return `${PREFIX}${userId}`; }

export async function loadOrderDraft<T>(userId: string): Promise<OrderDraftRecord<T> | null> {
  if (usingApi) return (await apiOrderDraft<T>()).draft;
  const raw = localStorage.getItem(key(userId));
  if (!raw) return null;
  try { return JSON.parse(raw) as OrderDraftRecord<T>; }
  catch { localStorage.removeItem(key(userId)); return null; }
}

export async function saveOrderDraft<T>(userId: string, payload: T): Promise<OrderDraftRecord<T>> {
  let draft: OrderDraftRecord<T>;
  if (usingApi) draft = (await apiSaveOrderDraft(payload)).draft;
  else {
    const previous = await loadOrderDraft<T>(userId);
    const now = new Date().toISOString();
    draft = { payload, createdAt: previous?.createdAt ?? now, updatedAt: now };
    localStorage.setItem(key(userId), JSON.stringify(draft));
  }
  window.dispatchEvent(new CustomEvent(ORDER_DRAFT_EVENT));
  return draft;
}

export async function deleteOrderDraft(userId: string): Promise<void> {
  if (usingApi) await apiDeleteOrderDraft();
  else localStorage.removeItem(key(userId));
  window.dispatchEvent(new CustomEvent(ORDER_DRAFT_EVENT));
}
