import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  normalizePartNumber,
  type CatalogFacets,
  type CatalogQuery,
  type LookupQuery,
  type LookupResult,
  type MachineBrandGroup,
  type MachineSegment,
  type Product,
  type Segment,
} from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from '../search/search.service';

const productInclude = {
  brand: true,
  category: true,
  specs: true,
  inventory: true,
  prices: { include: { priceList: true } },
  crossReferences: true,
  applications: { include: { machineModel: { include: { brand: true } } } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {}

  /**
   * Список товарів із фільтрами та пагінацією. Ціни — для вказаного сегмента.
   * Якщо налаштовано Typesense — пошук (стійкий до опечаток) іде через нього,
   * а при його недоступності — прозоро через Postgres.
   */
  async list(
    query: CatalogQuery,
    segment: Segment = 'B2C',
  ): Promise<{ items: Product[]; total: number; page: number; perPage: number }> {
    if (this.search.enabled) {
      try {
        const { ids, total } = await this.search.searchProductIds(query);
        const rows = await this.prisma.product.findMany({
          where: { id: { in: ids } },
          include: productInclude,
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const items = ids.flatMap((id) => {
          const row = byId.get(id);
          return row ? [this.toDto(row, segment)] : []; // товар видалено, а індекс ще не оновлено
        });
        return { items, total, page: query.page, perPage: query.perPage };
      } catch (e) {
        this.search.warn((e as Error).message);
      }
    }
    return this.listFromDb(query, segment);
  }

  private where(query: CatalogQuery): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {};

    if (query.q) {
      // У Postgres-відкаті шукаємо і за назвою, і за номерами: клієнт вводить номер,
      // а не назву, і без Typesense він має знаходити так само.
      const norm = normalizePartNumber(query.q);
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        ...(norm.length >= 3
          ? [
              { partNumberNorm: { contains: norm } },
              { crossReferences: { some: { numberNorm: { contains: norm } } } },
            ]
          : []),
      ];
    }
    if (query.brand?.length) where.brand = { is: { slug: { in: query.brand } } };
    if (query.kind?.length) where.kind = { in: query.kind };
    if (query.condition?.length) where.condition = { in: query.condition };
    if (query.voltage != null) where.voltage = query.voltage;
    if (query.machineSegment || query.machineModel) {
      where.applications = {
        some: {
          machineModel: {
            is: {
              ...(query.machineSegment ? { segment: query.machineSegment } : {}),
              ...(query.machineModel ? { slug: query.machineModel } : {}),
            },
          },
        },
      };
    }
    if (query.inStock) where.inventory = { is: { quantity: { gt: 0 } } };
    return where;
  }

  private async listFromDb(
    query: CatalogQuery,
    segment: Segment,
  ): Promise<{ items: Product[]; total: number; page: number; perPage: number }> {
    const where = this.where(query);

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toDto(r, segment)),
      total,
      page: query.page,
      perPage: query.perPage,
    };
  }

  /** Доступні значення для фільтрів каталогу. */
  async facets(): Promise<CatalogFacets> {
    const [brands, kinds, conditions, segments] = await Promise.all([
      this.prisma.brand.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } }),
      this.prisma.product.findMany({ distinct: ['kind'], select: { kind: true } }),
      this.prisma.product.findMany({ distinct: ['condition'], select: { condition: true } }),
      this.prisma.machineModel.findMany({ distinct: ['segment'], select: { segment: true } }),
    ]);
    return {
      brands,
      kinds: kinds.map((k) => k.kind),
      conditions: conditions.map((c) => c.condition),
      machineSegments: segments.map((s) => s.segment),
    };
  }

  /**
   * Пошук по крос-номеру — головний вхід у каталог: клієнт приходить із номером, знятим
   * з агрегата або взятим із каталогу техніки, а не з описом того, що йому треба.
   *
   * Спершу точний збіг у Postgres: наш артикул або крос-номер у нормалізованій формі.
   * Він покритий індексами, працює без Typesense і не залежить від того, як клієнт розставив
   * пробіли й дефіси. Якщо точного збігу немає — віддаємо схоже з пошуку, але позначаємо
   * результат як неточний: не той стартер гірший, ніж жодного.
   */
  async lookup(query: LookupQuery): Promise<LookupResult> {
    const normalized = normalizePartNumber(query.number);

    const exact = await this.prisma.product.findMany({
      where: {
        OR: [
          { partNumberNorm: normalized },
          { crossReferences: { some: { numberNorm: normalized } } },
        ],
      },
      include: productInclude,
      orderBy: { name: 'asc' },
      take: query.limit,
    });
    if (exact.length > 0) {
      return { normalized, match: 'exact', items: exact.map((r) => this.toDto(r, query.segment)) };
    }

    const { items } = await this.list(
      { q: query.number, page: 1, perPage: query.limit },
      query.segment,
    );
    return { normalized, match: items.length > 0 ? 'fuzzy' : 'none', items };
  }

  /**
   * Техніка, під яку в каталозі є агрегати, згрупована за маркою — для посадкових сторінок
   * і карти сайту. Моделі без жодного товару не віддаємо: сторінка під них була б порожньою,
   * а в індексі пошуковика — сміттям.
   */
  async machines(segment?: MachineSegment): Promise<MachineBrandGroup[]> {
    const rows = await this.prisma.machineModel.findMany({
      where: { ...(segment ? { segment } : {}), applications: { some: {} } },
      select: {
        slug: true,
        name: true,
        segment: true,
        brand: { select: { name: true, slug: true } },
      },
      orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
    });

    const groups = new Map<string, MachineBrandGroup>();
    for (const r of rows) {
      const group = groups.get(r.brand.slug) ?? {
        brand: r.brand.name,
        brandSlug: r.brand.slug,
        models: [],
      };
      group.models.push({ slug: r.slug, name: r.name, segment: r.segment });
      groups.set(r.brand.slug, group);
    }
    return [...groups.values()];
  }

  async getBySlug(slug: string, segment: Segment = 'B2C'): Promise<Product> {
    const row = await this.prisma.product.findUnique({ where: { slug }, include: productInclude });
    if (!row) throw new NotFoundException(`Товар "${slug}" не знайдено`);
    return this.toDto(row, segment);
  }

  /** Prisma-модель → публічний DTO з цінами для сегмента. */
  private toDto(row: ProductWithRelations, segment: Segment): Product {
    const prices = row.prices
      .filter((p) => p.priceList.segment === segment)
      .map((p) => ({
        segment: p.priceList.segment as Segment,
        currency: p.priceList.currency,
        amountMinor: p.amountMinor,
        vatRate: p.vatRate,
      }));

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? null,
      brand: row.brand.name,
      categorySlug: row.category.slug,
      kind: row.kind,
      condition: row.condition,
      partNumber: row.partNumber,
      voltage: row.voltage,
      // Decimal у Prisma — точний тип, у JSON віддаємо числом.
      powerKw: row.powerKw === null ? null : Number(row.powerKw),
      amperageA: row.amperageA,
      rotation: row.rotation,
      teeth: row.teeth,
      coreDepositMinor: row.coreDepositMinor,
      images: row.images,
      inStock: (row.inventory?.quantity ?? 0) > 0,
      prices,
      crossReferences: row.crossReferences.map((x) => ({ brand: x.brand, number: x.number })),
      applications: row.applications.map((a) => ({
        segment: a.machineModel.segment,
        brand: a.machineModel.brand.name,
        model: a.machineModel.name,
        modelSlug: a.machineModel.slug,
        engine: a.engine,
        yearFrom: a.yearFrom,
        yearTo: a.yearTo,
      })),
    };
  }
}
