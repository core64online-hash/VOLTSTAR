import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CatalogFacets,
  CatalogQuery,
  EquipmentPreset,
  PhaseType,
  Product,
  Segment,
} from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from '../search/search.service';

const productInclude = {
  brand: true,
  category: true,
  specs: true,
  inventory: true,
  prices: { include: { priceList: true } },
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

  private async listFromDb(
    query: CatalogQuery,
    segment: Segment,
  ): Promise<{ items: Product[]; total: number; page: number; perPage: number }> {
    const where: Prisma.ProductWhereInput = {};

    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
    if (query.brand?.length) where.brand = { is: { slug: { in: query.brand } } };
    if (query.fuel?.length) where.fuel = { in: query.fuel };
    if (query.phase) where.phase = query.phase;
    if (query.minPowerW != null || query.maxPowerW != null) {
      where.ratedPowerW = {
        ...(query.minPowerW != null ? { gte: query.minPowerW } : {}),
        ...(query.maxPowerW != null ? { lte: query.maxPowerW } : {}),
      };
    }
    if (query.inStock) where.inventory = { is: { quantity: { gt: 0 } } };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { ratedPowerW: 'asc' },
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

  /** Доступні бренди та типи палива для фільтрів каталогу. */
  async facets(): Promise<CatalogFacets> {
    const [brands, fuels] = await Promise.all([
      this.prisma.brand.findMany({ orderBy: { name: 'asc' }, select: { slug: true, name: true } }),
      this.prisma.product.findMany({ distinct: ['fuel'], select: { fuel: true } }),
    ]);
    return { brands, fuels: fuels.map((f) => f.fuel) };
  }

  /** Пресети типової техніки для форми підбору. */
  async equipmentPresets(): Promise<EquipmentPreset[]> {
    const rows = await this.prisma.equipmentPreset.findMany({ orderBy: { label: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      powerW: r.powerW,
      loadType: r.loadType as EquipmentPreset['loadType'],
      category: r.category,
    }));
  }

  /**
   * Кандидати під розрахунок підбору. Два запити, а не один: якщо взяти «все від робочої
   * потужності вгору» з обмеженням, на великому каталозі вибірка заповниться слабкими
   * моделями й точні збіги до неї просто не потраплять. Тому окремо смуга «з запасом»
   * (від рекомендованої, знизу вгору) і окремо «без запасу» (нижче рекомендованої, згори вниз).
   *
   * Пошук тут не потрібен: текстового запиту немає, умова числова, а `@@index([ratedPowerW])`
   * її вже покриває — Typesense додав би лише ще одну точку відмови.
   */
  async candidatesForPower(
    needs: { phase: PhaseType; runningW: number; peakW: number; recommendedW: number },
    segment: Segment = 'B2C',
    take = 12,
  ): Promise<Product[]> {
    const base = { phase: needs.phase, maxPowerW: { gte: needs.peakW } };
    const [withReserve, withoutReserve] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...base, ratedPowerW: { gte: needs.recommendedW } },
        include: productInclude,
        orderBy: { ratedPowerW: 'asc' },
        take,
      }),
      this.prisma.product.findMany({
        where: {
          ...base,
          ratedPowerW: { gte: needs.runningW, lt: needs.recommendedW },
        },
        include: productInclude,
        orderBy: { ratedPowerW: 'desc' },
        take,
      }),
    ]);
    return [...withReserve, ...withoutReserve].map((r) => this.toDto(r, segment));
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
      brand: row.brand.name,
      categorySlug: row.category.slug,
      fuel: row.fuel,
      phase: row.phase,
      ratedPowerW: row.ratedPowerW,
      maxPowerW: row.maxPowerW,
      images: row.images,
      inStock: (row.inventory?.quantity ?? 0) > 0,
      prices,
    };
  }
}
