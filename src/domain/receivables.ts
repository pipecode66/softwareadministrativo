import type { Category, Client, DocumentType, WorkOrder } from './types';
import { dateOnly, financials, roundMoney } from './utils';

export type ReceivableMetric = 'portfolioAtCutoff' | 'balanceWithIva' | 'balanceWithoutIva' | 'rem' | 'fact' | 'retentions' | 'reteFuente' | 'reteIva' | 'ica';
export interface ReceivableQuery {
  cutoff: string; metric: ReceivableMetric; category?: Category; documentType?: DocumentType;
}
export interface ReceivableItem {
  orderId: string; number: number; clientId: string; clientName: string;
  description: string; documentType: DocumentType; amount: number;
}

/** Uses the same cash balance and current certificate rules as the server. */
export function receivableAmounts(order: WorkOrder, cutoff: string): Record<ReceivableMetric, number> {
  const money = financials(order, cutoff);
  const balance = Math.max(0, money.balance);
  const pending = (key: 'reteFuente' | 'reteIva' | 'ica') =>
    order.documentType === 'FACT' && !order.certificates?.[key] ? roundMoney(order[key]) : 0;
  const reteFuente = pending('reteFuente'), reteIva = pending('reteIva'), ica = pending('ica');
  const balanceWithoutIva = Math.max(0, roundMoney(balance - money.iva));
  const retentions = (Math.round(reteFuente * 100) + Math.round(reteIva * 100) + Math.round(ica * 100)) / 100;
  return {
    portfolioAtCutoff: (Math.round(balanceWithoutIva * 100) + Math.round(retentions * 100)) / 100,
    balanceWithIva: balance,
    balanceWithoutIva,
    rem: order.documentType === 'REM' ? balance : 0,
    fact: order.documentType === 'FACT' ? balance : 0,
    reteFuente, reteIva, ica,
    retentions,
  };
}

export function receivableItems(orders: WorkOrder[], clients: Client[], query: ReceivableQuery): ReceivableItem[] {
  return orders.filter(order => dateOnly(order.createdAt) <= query.cutoff
    && (!query.category || order.category === query.category)
    && (!query.documentType || order.documentType === query.documentType))
    .map(order => ({
      orderId: order.id, number: order.number, clientId: order.clientId,
      clientName: clients.find(client => client.id === order.clientId)?.name ?? 'Cliente',
      description: order.description, documentType: order.documentType,
      amount: receivableAmounts(order, query.cutoff)[query.metric],
    })).filter(item => item.amount > 0)
    .sort((a, b) => b.number - a.number || a.orderId.localeCompare(b.orderId));
}
