import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';

const row = (id: string, ratedPowerW: number) => ({
  id,
  slug: id,
  name: `Gen ${id}`,
  brand: { name: 'B', slug: 'b' },
  category: { slug: 'c' },
  specs: [],
  inventory: { quantity: 1 },
  prices: [],
  fuel: 'PETROL',
  phase: 'SINGLE',
  ratedPowerW,
  maxPowerW: ratedPowerW + 500,
  images: [],
});

function setup(search: {
  enabled: boolean;
  searchProductIds?: () => Promise<{ ids: string[]; total: number }>;
}) {
  const prisma = {
    product: {
      findMany: vi.fn(async (args: { where?: { id?: { in: string[] } } }) =>
        args.where?.id ? [row('b', 2000), row('a', 1000)] : [row('db', 500)],
      ),
      count: vi.fn(async () => 1),
    },
  };
  const warn = vi.fn();
  const service = new CatalogService(prisma as never, { ...search, warn } as never);
  return { service, prisma, warn };
}

const query = { q: 'gen', page: 1, perPage: 24 };

describe('CatalogService.list', () => {
  it('з Typesense: порядок — як у пошуку, total — з пошуку', async () => {
    const { service } = setup({
      enabled: true,
      searchProductIds: async () => ({ ids: ['a', 'b', 'gone'], total: 3 }),
    });
    const res = await service.list(query);
    expect(res.items.map((p) => p.id)).toEqual(['a', 'b']); // 'gone' видалено з БД — пропускаємо
    expect(res.total).toBe(3);
  });

  it('Typesense недоступний — прозорий перехід на Postgres із попередженням', async () => {
    const { service, warn } = setup({
      enabled: true,
      searchProductIds: async () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const res = await service.list(query);
    expect(res.items.map((p) => p.id)).toEqual(['db']);
    expect(warn).toHaveBeenCalledWith('ECONNREFUSED');
  });

  it('Typesense не налаштований — одразу Postgres', async () => {
    const { service, prisma } = setup({ enabled: false });
    const res = await service.list(query);
    expect(res.items.map((p) => p.id)).toEqual(['db']);
    expect(prisma.product.count).toHaveBeenCalled();
  });
});

describe('CatalogService.candidatesForPower', () => {
  const needs = { phase: 'SINGLE' as const, runningW: 4000, peakW: 5000, recommendedW: 5000 };

  /** Два запити: смуга «із запасом» і смуга «без запасу». Пошук тут не задіяний. */
  function setupCandidates() {
    const calls: { where: Record<string, unknown>; orderBy: unknown; take: number }[] = [];
    const prisma = {
      product: {
        findMany: vi.fn(async (args: (typeof calls)[number]) => {
          calls.push(args);
          return calls.length === 1 ? [priced('big', 5500)] : [priced('small', 4200)];
        }),
        count: vi.fn(),
      },
    };
    const searchProductIds = vi.fn();
    const service = new CatalogService(
      prisma as never,
      {
        enabled: true,
        searchProductIds,
        warn: vi.fn(),
      } as never,
    );
    return { service, calls, searchProductIds };
  }

  const priced = (id: string, ratedPowerW: number) => ({
    ...row(id, ratedPowerW),
    prices: [
      { amountMinor: 100_00, vatRate: 0.2, priceList: { segment: 'B2C', currency: 'UAH' } },
      { amountMinor: 90_00, vatRate: 0.2, priceList: { segment: 'B2B', currency: 'UAH' } },
    ],
  });

  it('запитує обидві смуги з обмеженням і не чіпає пошук', async () => {
    const { service, calls, searchProductIds } = setupCandidates();
    const res = await service.candidatesForPower(needs, 'B2C', 6);

    expect(res.map((p) => p.id)).toEqual(['big', 'small']);
    expect(searchProductIds).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);

    expect(calls[0].where).toMatchObject({
      phase: 'SINGLE',
      maxPowerW: { gte: 5000 },
      ratedPowerW: { gte: 5000 },
    });
    expect(calls[0].orderBy).toEqual({ ratedPowerW: 'asc' });
    expect(calls[1].where).toMatchObject({
      phase: 'SINGLE',
      maxPowerW: { gte: 5000 },
      ratedPowerW: { gte: 4000, lt: 5000 },
    });
    expect(calls[1].orderBy).toEqual({ ratedPowerW: 'desc' });
    expect(calls.map((c) => c.take)).toEqual([6, 6]);
  });

  it('ціни — лише запитаного сегмента', async () => {
    const { service } = setupCandidates();
    const res = await service.candidatesForPower(needs, 'B2B', 6);
    expect(res[0].prices).toEqual([
      { segment: 'B2B', currency: 'UAH', amountMinor: 9000, vatRate: 0.2 },
    ]);
  });
});
