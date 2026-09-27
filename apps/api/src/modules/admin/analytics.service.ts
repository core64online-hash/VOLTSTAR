import { BadRequestException, Injectable } from '@nestjs/common';
import type { Analytics, AnalyticsQuery, DealStage, LeadStatus, OrderStatus, Segment } from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { DEAL_STAGES, OPEN_LEAD_STATUSES } from '../crm/crm-rules';
import { localDate, resolvePeriod, type Period } from './analytics-period';

/** Звіти ведемо в основній валюті магазину; замовлення в інших валютах сюди не входять. */
const REPORT_CURRENCY = 'UAH' as const;
/** Статуси, які означають, що замовлення колись було оплачене. */
const PAID_AT_SOME_POINT: OrderStatus[] = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'REFUNDED'];
const LEAD_STATUSES: LeadStatus[] = [...OPEN_LEAD_STATUSES, 'CONVERTED', 'DISQUALIFIED'];
const OPEN_STAGES = DEAL_STAGES.filter((s) => s !== 'WON' && s !== 'LOST');
const SEGMENTS: Segment[] = ['B2C', 'B2B', 'B2G'];
const TOP_PRODUCTS = 5;

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : 0);

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: AnalyticsQuery, now: Date = new Date()): Promise<Analytics> {
    let period: Period;
    try {
      period = resolvePeriod(query, now);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const [sales, funnel, partRequests] = await Promise.all([
      this.sales(period),
      this.funnel(period),
      this.partRequests(period),
    ]);
    return {
      period: { from: period.from, to: period.to },
      currency: REPORT_CURRENCY,
      sales,
      funnel,
      partRequests,
    };
  }

  /** Продажі за датою оплати (подія PAID у журналі статусів), повернення — за датою повернення. */
  private async sales(p: Period): Promise<Analytics['sales']> {
    const inPeriod = { gte: p.start, lt: p.end };
    const orderFilter = { currency: REPORT_CURRENCY };
    const [paidEvents, refundEvents, placed, placedPaid] = await Promise.all([
      this.prisma.orderStatusEvent.findMany({
        where: { toStatus: 'PAID', createdAt: inPeriod, order: orderFilter },
        select: {
          createdAt: true,
          order: {
            select: {
              id: true,
              segment: true,
              totalMinor: true,
              items: { select: { productId: true, quantity: true, unitPriceMinor: true, product: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.orderStatusEvent.findMany({
        where: { toStatus: 'REFUNDED', createdAt: inPeriod, order: orderFilter },
        select: { orderId: true, order: { select: { totalMinor: true } } },
      }),
      this.prisma.order.count({ where: { ...orderFilter, createdAt: inPeriod, status: { not: 'DRAFT' } } }),
      this.prisma.order.count({ where: { ...orderFilter, createdAt: inPeriod, status: { in: PAID_AT_SOME_POINT } } }),
    ]);

    // Одне замовлення — одна оплата, навіть якщо подія PAID повторилась.
    const seen = new Set<string>();
    const paid = paidEvents.filter((e) => !seen.has(e.order.id) && seen.add(e.order.id));
    const refundedOrders = new Map(refundEvents.map((e) => [e.orderId, e.order.totalMinor]));
    const refundsMinor = [...refundedOrders.values()].reduce((s, v) => s + v, 0);
    const grossMinor = paid.reduce((s, e) => s + e.order.totalMinor, 0);

    const byDay = new Map(p.days.map((d) => [d, { date: d, revenueMinor: 0, orders: 0 }]));
    const bySegment = new Map(SEGMENTS.map((s) => [s, { segment: s, revenueMinor: 0, orders: 0 }]));
    const products = new Map<string, { productId: string; name: string; quantity: number; revenueMinor: number }>();
    for (const e of paid) {
      const day = byDay.get(localDate(e.createdAt));
      if (day) {
        day.revenueMinor += e.order.totalMinor;
        day.orders += 1;
      }
      const seg = bySegment.get(e.order.segment);
      if (seg) {
        seg.revenueMinor += e.order.totalMinor;
        seg.orders += 1;
      }
      for (const i of e.order.items) {
        const row = products.get(i.productId) ?? { productId: i.productId, name: i.product.name, quantity: 0, revenueMinor: 0 };
        row.quantity += i.quantity;
        row.revenueMinor += i.unitPriceMinor * i.quantity;
        products.set(i.productId, row);
      }
    }

    return {
      revenueMinor: grossMinor - refundsMinor,
      refundsMinor,
      paidOrders: paid.length,
      placedOrders: placed,
      averageOrderMinor: paid.length ? Math.round(grossMinor / paid.length) : 0,
      paymentRate: ratio(placedPaid, placed),
      bySegment: [...bySegment.values()],
      byDay: [...byDay.values()],
      topProducts: [...products.values()]
        .sort((a, b) => b.revenueMinor - a.revenueMinor || b.quantity - a.quantity)
        .slice(0, TOP_PRODUCTS),
    };
  }

  /** Воронка: ліди за період, закриті в періоді угоди, поточний відкритий pipeline. */
  private async funnel(p: Period): Promise<Analytics['funnel']> {
    const inPeriod = { gte: p.start, lt: p.end };
    const [leads, dealsCreated, closed, open] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], where: { createdAt: inPeriod }, _count: { _all: true } }),
      this.prisma.deal.count({ where: { createdAt: inPeriod } }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: { stage: { in: ['WON', 'LOST'] }, closedAt: inPeriod, currency: REPORT_CURRENCY },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      this.prisma.deal.groupBy({
        by: ['stage'],
        where: { stage: { in: OPEN_STAGES }, currency: REPORT_CURRENCY },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
    ]);
    const leadCount = new Map(leads.map((l) => [l.status, l._count._all]));
    const stageOf = (rows: typeof closed, stage: DealStage) => {
      const r = rows.find((x) => x.stage === stage);
      return { count: r?._count._all ?? 0, amountMinor: r?._sum.amountMinor ?? 0 };
    };
    const won = stageOf(closed, 'WON');
    const lost = stageOf(closed, 'LOST');
    return {
      leads: LEAD_STATUSES.map((status) => ({ status, count: leadCount.get(status) ?? 0 })),
      leadsTotal: leads.reduce((s, l) => s + l._count._all, 0),
      dealsCreated,
      won,
      lost,
      winRate: ratio(won.count, won.count + lost.count),
      openPipeline: OPEN_STAGES.map((stage) => ({ stage, ...stageOf(open, stage) })),
    };
  }

  /**
   * Запити на підбір агрегата по номеру: заявки з форми → угоди з цих заявок.
   * Знаменника «скільки разів шукали» тут немає навмисне: пошук по номеру кешується
   * і публічний, рахувати кожне натискання означало б зламати кеш заради статистики.
   */
  private async partRequests(p: Period): Promise<Analytics['partRequests']> {
    const inPeriod = { gte: p.start, lt: p.end };
    const sources = ['part-request', 'reman'];
    const [leads, deals] = await Promise.all([
      this.prisma.lead.count({ where: { source: { in: sources }, createdAt: inPeriod } }),
      this.prisma.deal.count({
        where: { lead: { source: { in: sources }, createdAt: inPeriod } },
      }),
    ]);
    return { leads, deals, dealRate: ratio(deals, leads) };
  }
}
