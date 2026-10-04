import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';

const row = (id: string, partNumberNorm = id.toUpperCase()) => ({
  id,
  slug: id,
  name: `Стартер ${id}`,
  description: null,
  brand: { name: 'Bosch', slug: 'bosch' },
  category: { slug: 'startery' },
  specs: [],
  inventory: { quantity: 1 },
  prices: [],
  kind: 'STARTER',
  condition: 'NEW',
  partNumber: partNumberNorm,
  partNumberNorm,
  voltage: 24,
  powerKw: null,
  amperageA: null,
  rotation: null,
  teeth: null,
  coreDepositMinor: null,
  images: [],
  crossReferences: [],
  applications: [],
});

function setup(search: {
  enabled: boolean;
  searchProductIds?: () => Promise<{ ids: string[]; total: number }>;
}) {
  const prisma = {
    product: {
      findMany: vi.fn(async (args: { where?: { id?: { in: string[] } } }) =>
        args.where?.id ? [row('b'), row('a')] : [row('db')],
      ),
      count: vi.fn(async () => 1),
    },
  };
  const warn = vi.fn();
  const service = new CatalogService(prisma as never, { ...search, warn } as never);
  return { service, prisma, warn };
}

const query = { q: 'стартер', page: 1, perPage: 24 };

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

  it('у Postgres-відкаті номер шукається і в артикулі, і в крос-номерах', async () => {
    const { service, prisma } = setup({ enabled: false });
    await service.list({ q: '0 001 368 088', page: 1, perPage: 24 });
    const where = prisma.product.findMany.mock.calls[0][0].where as {
      OR: Record<string, unknown>[];
    };
    expect(where.OR).toEqual([
      { name: { contains: '0 001 368 088', mode: 'insensitive' } },
      { partNumberNorm: { contains: '0001368088' } },
      { crossReferences: { some: { numberNorm: { contains: '0001368088' } } } },
    ]);
  });
});

describe('CatalogService.lookup', () => {
  /** Точний збіг має знайтися одним запитом у Postgres, без участі пошуку. */
  function setupLookup(exact: ReturnType<typeof row>[]) {
    const findMany = vi.fn(async (_args: { where: unknown }) => exact);
    const prisma = { product: { findMany, count: vi.fn(async () => exact.length) } };
    const searchProductIds = vi.fn(async () => ({ ids: [], total: 0 }));
    const service = new CatalogService(prisma as never, {
      enabled: true,
      searchProductIds,
      warn: vi.fn(),
    } as never);
    return { service, findMany, searchProductIds };
  }

  it('номер із роздільниками знаходить товар за нормалізованою формою', async () => {
    const { service, findMany, searchProductIds } = setupLookup([row('p1', '0001368088')]);
    const res = await service.lookup({ number: '0-001-368-088', segment: 'B2C', limit: 12 });

    expect(res).toMatchObject({ normalized: '0001368088', match: 'exact' });
    expect(res.items.map((p) => p.id)).toEqual(['p1']);
    expect(searchProductIds).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0]![0].where).toEqual({
      OR: [
        { partNumberNorm: '0001368088' },
        { crossReferences: { some: { numberNorm: '0001368088' } } },
      ],
    });
  });

  it('без точного збігу результат позначається як неточний', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([]) // точного збігу немає
      .mockResolvedValue([row('p2', 'AZJ3151')]);
    const prisma = { product: { findMany, count: vi.fn(async () => 1) } };
    const service = new CatalogService(prisma as never, {
      enabled: false,
      warn: vi.fn(),
    } as never);

    const res = await service.lookup({ number: 'AZJ 3151', segment: 'B2C', limit: 12 });
    expect(res.match).toBe('fuzzy');
    expect(res.items).toHaveLength(1);
  });

  it('нічого не знайшли — чесний порожній результат, без підміни схожим', async () => {
    const findMany = vi.fn(async () => []);
    const prisma = { product: { findMany, count: vi.fn(async () => 0) } };
    const service = new CatalogService(prisma as never, {
      enabled: false,
      warn: vi.fn(),
    } as never);

    const res = await service.lookup({ number: 'XYZ999', segment: 'B2C', limit: 12 });
    expect(res).toMatchObject({ match: 'none', items: [] });
  });
});

describe('CatalogService.machines', () => {
  it('групує моделі за маркою й бере лише ті, під які є товари', async () => {
    const findMany = vi.fn(async (_args: { where: unknown }) => [
      { slug: 'kraz-6322', name: '6322', segment: 'TRUCK', brand: { name: 'КрАЗ', slug: 'kraz' } },
      { slug: 'maz-5440', name: '5440', segment: 'TRUCK', brand: { name: 'МАЗ', slug: 'maz' } },
      { slug: 'maz-6430', name: '6430', segment: 'TRUCK', brand: { name: 'МАЗ', slug: 'maz' } },
    ]);
    const prisma = { machineModel: { findMany } };
    const service = new CatalogService(prisma as never, { enabled: false, warn: vi.fn() } as never);

    const groups = await service.machines('TRUCK');
    expect(groups.map((g) => [g.brandSlug, g.models.map((m) => m.slug)])).toEqual([
      ['kraz', ['kraz-6322']],
      ['maz', ['maz-5440', 'maz-6430']],
    ]);

    // Порожні моделі відсікаються в запиті, а не після нього.
    expect(findMany.mock.calls[0]![0].where).toEqual({
      segment: 'TRUCK',
      applications: { some: {} },
    });
  });

  it('без групи техніки віддає всю техніку — для карти сайту', async () => {
    const findMany = vi.fn(async (_args: { where: unknown }) => []);
    const prisma = { machineModel: { findMany } };
    const service = new CatalogService(prisma as never, { enabled: false, warn: vi.fn() } as never);

    await service.machines();
    expect(findMany.mock.calls[0]![0].where).toEqual({ applications: { some: {} } });
  });
});
