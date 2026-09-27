import type { Role, WorkOrder } from '../domain/types';
import { isAdmin } from '../domain/utils';

export function orderArrivalMessages(
  role: Role,
  previousOrders: WorkOrder[],
  currentOrders: WorkOrder[],
  baselineReady: boolean,
): string[] {
  if (!baselineReady) return [];
  const previousById = new Map(previousOrders.map(order => [order.id, order]));
  const messages: string[] = [];
  for (const order of currentOrders) {
    const previous = previousById.get(order.id);
    const enteredAdminReview = isAdmin(role)
      && (!previous || previous.status !== order.status)
      && order.status === 'PENDING_ADMIN_REVIEW';
    const enteredPrinting = role === 'IMPRESION'
      && (!previous || previous.status !== order.status)
      && order.status === 'IN_PRINTING';
    const enteredWorkshop = role === 'TALLER'
      && (!previous || previous.status !== order.status)
      && ['IN_WORKSHOP', 'PENDING_INSTALLATION'].includes(order.status);
    if (enteredAdminReview) messages.push(`Nueva OT #${String(order.number).padStart(4, '0')} pendiente de revisión.`);
    else if (enteredPrinting) messages.push(`La OT #${String(order.number).padStart(4, '0')} llegó a Impresión.`);
    else if (enteredWorkshop) messages.push(`La OT #${String(order.number).padStart(4, '0')} llegó a Taller.`);
  }
  return messages;
}
