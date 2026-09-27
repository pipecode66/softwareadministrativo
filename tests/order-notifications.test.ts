import { describe, expect, it } from 'vitest';
import { orderArrivalMessages } from '../src/data/orderNotifications';
import { makeSeed } from '../src/data/seed';
import type { WorkOrder } from '../src/domain/types';

const sample = makeSeed().orders[0];

function atStatus(id: string, number: number, status: WorkOrder['status']): WorkOrder {
  return { ...sample, id, number, status };
}

describe('Avisos de llegada de órdenes', () => {
  it('usa la primera carga de cada sesión como línea base silenciosa', () => {
    const existing = atStatus('existing-review', 21, 'PENDING_ADMIN_REVIEW');
    expect(orderArrivalMessages('ADMINMASTER', [], [existing], false)).toEqual([]);
  });

  it('avisa después de la línea base cuando una OT nueva llega al perfil', () => {
    const incoming = atStatus('new-review', 22, 'PENDING_ADMIN_REVIEW');
    expect(orderArrivalMessages('ADMIN_GENERAL', [], [incoming], true)).toEqual([
      'Nueva OT #0022 pendiente de revisión.',
    ]);
  });

  it('avisa los cambios reales de etapa sin repetir órdenes que permanecen iguales', () => {
    const before = atStatus('production-order', 23, 'NEW');
    const printing = atStatus('production-order', 23, 'IN_PRINTING');
    expect(orderArrivalMessages('IMPRESION', [before], [printing], true)).toEqual([
      'La OT #0023 llegó a Impresión.',
    ]);
    expect(orderArrivalMessages('IMPRESION', [printing], [printing], true)).toEqual([]);
  });
});
