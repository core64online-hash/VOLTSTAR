import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

const item = (productId: string, name: string, quantity: number, unitPriceMinor: number) => ({
  productId,
  quantity,
  unitPriceMinor,
  product: { name },
});
const paid = (at: string, id: string, segment: string, totalMinor: number, items = [item('p1', 'GP3300', 1, totalMinor)]) => ({
  createdAt: new Date(at),
  order: { id, segment, totalMinor, items },
});

function setup() {
  const paidEvents = [
    paid('2026-09-20T09:00:00Z', 'o1', 'B2C', 1_000_00),
    // 22:30 UTC 21-го — у Києві вже 22-ге.
    paid('2026-09-21T22:30:00Z', 'o2', 'B2B', 5_000_00, [item('p1', 'GP3300', 2, 1_500_00), item('p2', 'DG7', 1, 2_000_00)]),
    // Повторна подія PAID для o1 не рахується двічі.
    paid('2026-09-22T10:00:00Z', 'o1', 'B2C', 1_000_00),
  ];
  const prisma = {
    orderStatusEvent: {
      findMany: vi.fn(async ({ where }: { where: { toStatus: string } }) =>
        where.toStatus === 'PAID' ? paidEvents : [{ orderId: 'o1', order: { totalMinor: 1_000_00 } }],
      ),
    },
    order: {
      count: vi.fn(async ({ where }: { where: { status: unknown } }) => ('in' in (where.status as object) ? 3 : 4)),
    },
    lead: {
      groupBy: vi.fn(async () => [
        { status: 'NEW', _count: { _all: 3 } },
        { status: 'CONVERTED', _count: { _all: 2 } },
      ]),
      count: vi.fn(async () => 4),
    },
    deal: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ('lead' in where ? 1 : 5)),
      groupBy: vi.fn(async ({ where }: { where: { stage: { in: string[] } } }) =>
        where.stage.in.includes('WON')
          ? [
              { stage: 'WON', _count: { _all: 3 }, _sum: { amountMinor: 9_000_00 } },
              { stage: 'LOST', _count: { _all: 1 }, _sum: { amountMinor: 1_000_00 } },
            ]
          : [{ stage: 'PROPOSAL', _count: { _all: 2 }, _sum: { amountMinor: 4_000_00 } }],
      ),
    },
  };
  return { svc: new AnalyticsService(prisma as unknown as PrismaService), prisma };
}

const NOW = new Date('2026-09-23T12:00:00Z');

describe('AnalyticsService', () => {
  it('продажі: за датою оплати, без дублів оплати, мінус повернення; ряд за київськими днями', async () => {
    const { svc } = setup();
    const r = await svc.report({ from: '2026-09-20', to: '2026-09-23' }, NOW);
    expect(r.sales.paidOrders).toBe(2);
    expect(r.sales.refundsMinor).toBe(1_000_00);
    expect(r.sales.revenueMinor).toBe(6_000_00 - 1_000_00);
    expect(r.sales.averageOrderMinor).toBe(3_000_00);
    expect(r.sales.paymentRate).toBe(0.75);
    expect(r.sales.byDay.map((d) => [d.date, d.revenueMinor])).toEqual([
      ['2026-09-20', 1_000_00],
      ['2026-09-21', 0],
      ['2026-09-22', 5_000_00],
      ['2026-09-23', 0],
    ]);
    expect(r.sales.bySegment.find((s) => s.segment === 'B2B')).toEqual({ segment: 'B2B', revenueMinor: 5_000_00, orders: 1 });
    expect(r.sales.topProducts[0]).toEqual({ productId: 'p1', name: 'GP3300', quantity: 3, revenueMinor: 4_000_00 });
  });

  it('воронка: усі статуси лідів (з нулями), win rate, відкритий pipeline за стадіями', async () => {
    const { svc } = setup();
    const { funnel } = await svc.report({}, NOW);
    expect(funnel.leadsTotal).toBe(5);
    expect(funnel.leads.find((l) => l.status === 'QUALIFIED')?.count).toBe(0);
    expect(funnel.won).toEqual({ count: 3, amountMinor: 9_000_00 });
    expect(funnel.winRate).toBe(0.75);
    expect(funnel.openPipeline.map((s) => s.stage)).toEqual(['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION']);
    expect(funnel.openPipeline.find((s) => s.stage === 'PROPOSAL')).toEqual({ stage: 'PROPOSAL', count: 2, amountMinor: 4_000_00 });
  });

  it('заявки на підбір по номеру й межі періоду в запитах (UTC-півночі за Києвом)', async () => {
    const { svc, prisma } = setup();
    const r = await svc.report({ from: '2026-09-01', to: '2026-09-30' }, NOW);
    expect(r.partRequests).toEqual({ leads: 4, deals: 1, dealRate: 0.25 });

    const call = (
      prisma.lead.count.mock.calls as unknown as [
        { where: { source?: unknown; createdAt: { gte: Date; lt: Date } } },
      ][]
    ).find((c) => c[0].where.source !== undefined)!;
    expect(call[0].where.source).toEqual({ in: ['part-request', 'reman'] });
    const where = call[0].where.createdAt;
    expect(where.gte.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(where.lt.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('задовгий період → 400', async () => {
    const { svc } = setup();
    await expect(svc.report({ from: '2024-01-01', to: '2026-01-01' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});
