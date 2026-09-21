import { describe, expect, it } from 'vitest';
import { monthEnd, periodMode } from '../src/components/PeriodFilter';
import { materialConsumption } from '../src/pages/Materials';
import { bulkAllocationPreview, portfolioAtCutoff } from '../src/pages/Portfolio';
import { periodBuckets, reportSummary, sumMoney } from '../src/pages/Reports';
import { MATERIALS } from '../src/domain/utils';
import type { DateRange, WorkOrder } from '../src/domain/types';

const september: DateRange = { from: '2026-09-01', to: '2026-09-30' };
const payment = (date: string, amount: number) => ({ id: `${date}-${amount}`, date, amount, recordedBy: 'admin' });
const order = (overrides: Partial<WorkOrder> = {}): WorkOrder => ({
  id: 'old', number: 1, clientId: 'client-1', description: 'Publicidad de ejemplo', value: 100_000,
  documentType: 'REM', category: 'SuperGiros', route: 'PRINT_ONLY', requiresInstallation: false,
  status: 'COMPLETED', createdBy: 'admin', createdAt: '2026-08-01T12:00:00-05:00', updatedAt: '2026-08-10T12:00:00-05:00',
  reteFuente: 0, reteIva: 0, ica: 0, payments: [], ...overrides,
});
const old = order({ payments: [payment('2026-08-15', 25_000), payment('2026-09-10', 35_000), payment('2026-10-01', 40_000)] });
const current = order({ id: 'current', number: 2, value: 200_000, documentType: 'FACT', category: 'Otras', reteFuente: 10_000, reteIva: 5_000, ica: 3_000, createdAt: '2026-09-01T05:00:00Z', payments: [payment('2026-09-20', 20_000), payment('2026-10-01', 200_000)] });
const future = order({ id: 'future', number: 3, value: 300_000, createdAt: '2026-10-01T12:00:00-05:00' });
const orders = [old, current, future];

describe('Criterios de reportes y cartera', () => {
  it('separa fecha de venta, fecha de cada abono y deuda acumulada al corte', () => {
    const report = reportSummary(orders, september);
    expect(report.sales.map(row => row.id)).toEqual(['current']);
    expect(report.base).toBe(200_000);
    expect(report.received).toBe(55_000);
    expect(report.balance).toBe(276_000);
  });

  it('conserva FACT bruto antes de retenciones y desglosa el total cobrable', () => {
    const report = reportSummary(orders, september);
    expect(report.factGross).toBe(238_000);
    expect(report.factBase).toBe(200_000);
    expect(report.iva).toBe(38_000);
    expect(report.balanceWithoutIva).toBe(238_000);
    expect(report.ivaDue).toBe(38_000);
    expect(report.documents.find(row => row.type === 'FACT')).toEqual({ type: 'FACT', count: 1, base: 200_000, iva: 38_000, gross: 238_000, retentions: 18_000, collectible: 256_000 });
  });

  it('separa el IVA pendiente de una FACT nueva con retenciones descontadas', () => {
    const newer = order({ id: 'newer', documentType: 'FACT', financialRule: 'NEW', value: 1_000_000,
      reteFuente: 40_000, reteIva: 28_500, ica: 7_000, createdAt: '2026-09-10T12:00:00-05:00', payments: [payment('2026-09-15', 100_000)] });
    const report = reportSummary([newer], september);
    expect(report.factBase).toBe(1_000_000);
    expect(report.iva).toBe(190_000);
    expect(report.balance).toBe(1_014_500);
    expect(report.balanceWithoutIva).toBe(824_500);
    expect(report.ivaDue).toBe(190_000);
  });

  it('aplica la misma categoría y documento a todos los indicadores y tablas', () => {
    const report = reportSummary(orders, september, 'SuperGiros', 'REM');
    expect(report.base).toBe(0);
    expect(report.factGross).toBe(0);
    expect(report.received).toBe(35_000);
    expect(report.balance).toBe(40_000);
    expect(report.categories).toEqual([{ name: 'SuperGiros', count: 0, base: 0, iva: 0, received: 35_000, balance: 40_000 }]);
    expect(report.documents.map(row => row.type)).toEqual(['REM']);
  });

  it('incluye cobros de órdenes antiguas aunque no haya ventas en el período', () => {
    const report = reportSummary([old], september);
    expect(report.sales).toEqual([]);
    expect(report.received).toBe(35_000);
    expect(report.balance).toBe(40_000);
  });

  it('cuadra el detalle por categorías con los totales generales', () => {
    const report = reportSummary(orders, september);
    for (const field of ['base', 'received', 'balance'] as const) expect(sumMoney(report.categories.map(row => row[field]))).toBe(report[field]);
    expect(sumMoney([0.1, 0.2, 0.7])).toBe(1);
  });

  it('toma ambos extremos inclusivos en horario de Bogotá', () => {
    const atStart = order({ id: 'start', createdAt: '2026-09-01T05:00:00Z' });
    const beforeStart = order({ id: 'before', createdAt: '2026-09-01T04:59:59Z' });
    const atEnd = order({ id: 'end', createdAt: '2026-10-01T04:59:59Z' });
    const afterEnd = order({ id: 'after', createdAt: '2026-10-01T05:00:00Z' });
    expect(reportSummary([atStart, beforeStart, atEnd, afterEnd], september).sales.map(row => row.id)).toEqual(['start', 'end']);
  });

  it('conserva deuda histórica de trabajos terminados aun si se pagaron posteriormente', () => {
    const historic = portfolioAtCutoff(orders, '2026-09-30');
    expect(historic.map(row => row.order.id)).toEqual(['current', 'old']);
    expect(historic.map(row => row.money.balance)).toEqual([236_000, 40_000]);
    expect(portfolioAtCutoff([old, current], '2026-10-01').map(row => [row.order.id, row.money.balance])).toEqual([['current', 36_000]]);
    expect(portfolioAtCutoff([old], '2026-08-14')[0].money.balance).toBe(100_000);
    expect(portfolioAtCutoff([old], '2026-08-15')[0].money.balance).toBe(75_000);
  });
});

describe('Pago grupal', () => {
  it('aplica primero a las OT de menor saldo y deja la más costosa pendiente', () => {
    const preview = bulkAllocationPreview([
      { id: 'costosa', number: 3, balance: 500_000 },
      { id: 'barata', number: 1, balance: 100_000 },
      { id: 'media', number: 2, balance: 200_000 },
    ], 250_000);
    expect(preview.map(item => [item.id, item.allocated, item.remaining])).toEqual([
      ['barata', 100_000, 0], ['media', 150_000, 50_000], ['costosa', 0, 500_000],
    ]);
  });

  it('desempata por número de OT y asigna centavos sin pérdidas', () => {
    const preview = bulkAllocationPreview([
      { id: 'b', number: 2, balance: 0.30 }, { id: 'a', number: 1, balance: 0.30 },
    ], 0.45);
    expect(preview.map(item => [item.id, item.allocated, item.remaining])).toEqual([
      ['a', 0.30, 0], ['b', 0.15, 0.15],
    ]);
  });
});

describe('Consumo de impresión', () => {
  it('cuenta la fecha de fin de impresión, no la creación ni lo que está en cola', () => {
    const printing = { material: 'Panaflex' as const, length: 2.5, width: 1.2 };
    const done = order({ id: 'done', printing, printingCompletedAt: '2026-09-08T12:00:00-05:00' });
    const queued = order({ id: 'queued', printing, status: 'IN_PRINTING', createdAt: '2026-09-08T12:00:00-05:00' });
    const previous = order({ id: 'previous', printing, printingCompletedAt: '2026-08-31T12:00:00-05:00' });
    const rows = materialConsumption([done, queued, previous], september);
    expect(rows.map(row => row.order.id)).toEqual(['done']);
    expect(rows[0].area).toBe(3);
    expect(materialConsumption([done], september, 'Banner')).toEqual([]);
  });

  it('mantiene las cinco categorías y el área a tres decimales', () => {
    const source = MATERIALS.map((material, index) => order({ id: `material-${index}`, printing: { material, length: 1.234, width: 2.345 }, printingCompletedAt: '2026-09-10T12:00:00-05:00' }));
    expect(materialConsumption(source, september).map(row => row.material)).toEqual(MATERIALS);
    expect(materialConsumption(source, september, 'V. Corte')[0].area).toBe(2.894);
  });
});

describe('Períodos y agrupación del gráfico', () => {
  it('termina los meses correctamente en años normales y bisiestos', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2000-02')).toBe('2000-02-29');
    expect(monthEnd('2026-13')).toBe('');
    expect(monthEnd('')).toBe('');
  });

  it('no presenta un rango parcial como un mes entero', () => {
    expect(periodMode(september)).toBe('month');
    expect(periodMode({ from: '2026-09-01', to: '2026-09-14' })).toBe('dates');
    expect(periodMode({ from: '2026-09-14', to: '2026-09-14' })).toBe('day');
  });

  it('crea días inclusivos o meses según la amplitud sin omitir el último', () => {
    expect(periodBuckets({ from: '2026-09-01', to: '2026-09-03' }).buckets.map(row => row.key)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    const monthly = periodBuckets({ from: '2026-06-15', to: '2026-09-14' });
    expect(monthly.monthly).toBe(true);
    expect(monthly.buckets.map(row => row.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('rechaza fechas inexistentes y rangos invertidos', () => {
    expect(periodBuckets({ from: '2026-02-30', to: '2026-03-02' }).buckets).toEqual([]);
    expect(periodBuckets({ from: '2026-09-10', to: '2026-09-01' }).buckets).toEqual([]);
  });

  it('no recorta silenciosamente los datos de un rango histórico largo', () => {
    const result = periodBuckets({ from: '1900-01-01', to: '2026-09-30' });
    expect(result.buckets.at(-1)?.key).toBe('2026-09');
  });
});
