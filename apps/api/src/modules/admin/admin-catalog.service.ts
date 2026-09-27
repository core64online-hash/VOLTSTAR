import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizePartNumber,
  type AdminProduct,
  type AdminProductInput,
  type AdminProductUpdate,
  type ApplicationInput,
  type CatalogRefs,
  type CrossReferenceInput,
  type Page,
  type SetPriceInput,
} from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from '../search/search.service';

const productInclude = {
  brand: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  specs: { orderBy: { id: 'asc' } },
  inventory: true,
  prices: { include: { priceList: true }, orderBy: { priceList: { segment: 'asc' } } },
  crossReferences: { orderBy: [{ brand: 'asc' }, { numberNorm: 'asc' }] },
  applications: { include: { machineModel: { include: { brand: true } } } },
} satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/**
 * Керування каталогом з адмін-панелі: товари, характеристики, ціни за прайс-листами, залишки.
 * Після кожної зміни товар синхронізується з пошуковим індексом (best effort).
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {}

  async refs(): Promise<CatalogRefs> {
    const [brands, categories, machineModels, priceLists] = await Promise.all([
      this.prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.machineModel.findMany({
        select: { id: true, name: true, segment: true, brand: { select: { name: true } } },
        orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.priceList.findMany({
        select: { id: true, name: true, segment: true, currency: true, active: true },
        orderBy: [{ segment: 'asc' }, { currency: 'asc' }],
      }),
    ]);
    return {
      brands,
      categories,
      machineModels: machineModels.map((m) => ({
        id: m.id,
        name: m.name,
        brand: m.brand.name,
        segment: m.segment,
      })),
      priceLists,
    };
  }

  async list(q: { q?: string; page: number; perPage: number }): Promise<Page<AdminProduct>> {
    const where: Prisma.ProductWhereInput = q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { slug: { contains: q.q, mode: 'insensitive' } },
            { partNumberNorm: { contains: normalizePartNumber(q.q) } },
            { crossReferences: { some: { numberNorm: { contains: normalizePartNumber(q.q) } } } },
            { brand: { name: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: rows.map(toAdminProduct), total, page: q.page, perPage: q.perPage };
  }

  async get(id: string): Promise<AdminProduct> {
    return toAdminProduct(await this.load(id));
  }

  async create(input: AdminProductInput): Promise<AdminProduct> {
    await this.assertRefs(input.brandId, input.categoryId);
    await this.assertMachineModels(input.applications);
    const { specs, stock, crossReferences, applications, ...fields } = input;
    const product = await this.unique(() =>
      this.prisma.product.create({
        data: {
          ...fields,
          partNumberNorm: normalizePartNumber(fields.partNumber),
          description: fields.description || null,
          specs: { create: specs },
          crossReferences: { create: toCrossReferenceRows(crossReferences) },
          applications: { create: applications },
          inventory: { create: { quantity: stock } },
        },
      }),
    );
    return this.afterChange(product.id);
  }

  async update(id: string, input: AdminProductUpdate): Promise<AdminProduct> {
    await this.load(id);
    await this.assertRefs(input.brandId, input.categoryId);
    await this.assertMachineModels(input.applications);
    const { specs, crossReferences, applications, ...fields } = input;
    await this.unique(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            ...fields,
            // Нормалізована форма — похідна від артикула, ніколи не задається окремо.
            ...(fields.partNumber ? { partNumberNorm: normalizePartNumber(fields.partNumber) } : {}),
          },
        });
        if (specs) {
          await tx.productSpec.deleteMany({ where: { productId: id } });
          await tx.productSpec.createMany({ data: specs.map((s) => ({ ...s, productId: id })) });
        }
        if (crossReferences) {
          await tx.crossReference.deleteMany({ where: { productId: id } });
          await tx.crossReference.createMany({
            data: toCrossReferenceRows(crossReferences).map((x) => ({ ...x, productId: id })),
          });
        }
        if (applications) {
          await tx.productApplication.deleteMany({ where: { productId: id } });
          await tx.productApplication.createMany({
            data: applications.map((a) => ({ ...a, productId: id })),
          });
        }
      }),
    );
    return this.afterChange(id);
  }

  async setPrice(productId: string, priceListId: string, input: SetPriceInput): Promise<AdminProduct> {
    await this.load(productId);
    const list = await this.prisma.priceList.findUnique({ where: { id: priceListId } });
    if (!list) throw new NotFoundException('Прайс-лист не знайдено');
    await this.prisma.price.upsert({
      where: { productId_priceListId: { productId, priceListId } },
      create: { productId, priceListId, amountMinor: input.amountMinor, vatRate: input.vatRate },
      update: { amountMinor: input.amountMinor, vatRate: input.vatRate },
    });
    return this.afterChange(productId);
  }

  /** Знімає ціну з прайс-листа — у цьому сегменті/валюті товар стає недоступним для купівлі. */
  async removePrice(productId: string, priceListId: string): Promise<AdminProduct> {
    await this.load(productId);
    await this.prisma.price.deleteMany({ where: { productId, priceListId } });
    return this.afterChange(productId);
  }

  async setStock(productId: string, quantity: number): Promise<AdminProduct> {
    await this.load(productId);
    await this.prisma.inventoryItem.upsert({
      where: { productId },
      create: { productId, quantity },
      update: { quantity },
    });
    return this.afterChange(productId);
  }

  private async afterChange(id: string): Promise<AdminProduct> {
    await this.search.syncProducts([id]);
    return this.get(id);
  }

  private async load(id: string): Promise<ProductRow> {
    const p = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!p) throw new NotFoundException('Товар не знайдено');
    return p;
  }

  private async assertRefs(brandId?: string, categoryId?: string): Promise<void> {
    const [brand, category] = await Promise.all([
      brandId ? this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } }) : true,
      categoryId ? this.prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }) : true,
    ]);
    if (!brand) throw new BadRequestException('Бренд не знайдено');
    if (!category) throw new BadRequestException('Категорію не знайдено');
  }

  private async assertMachineModels(applications?: ApplicationInput[]): Promise<void> {
    if (!applications?.length) return;
    const ids = [...new Set(applications.map((a) => a.machineModelId))];
    const found = await this.prisma.machineModel.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('Модель техніки не знайдено');
  }

  /** Унікальні slug і артикул: конфлікт Prisma P2002 → 409 зі зрозумілим повідомленням. */
  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = String((e.meta as { target?: string[] } | undefined)?.target ?? '');
        throw new ConflictException(
          target.includes('partNumber')
            ? 'Товар із таким артикулом уже існує'
            : 'Товар із таким slug уже існує',
        );
      }
      throw e;
    }
  }
}

/**
 * Крос-номери з форми: нормалізована форма рахується тут, дублі в межах товару схлопуються.
 * Інакше два написання того самого номера впали б на унікальному індексі вже в базі.
 */
function toCrossReferenceRows(
  input: CrossReferenceInput[],
): { brand: string; number: string; numberNorm: string }[] {
  const out = new Map<string, { brand: string; number: string; numberNorm: string }>();
  for (const x of input) {
    const brand = x.brand.trim().toUpperCase();
    const numberNorm = normalizePartNumber(x.number);
    out.set(`${brand}:${numberNorm}`, { brand, number: x.number.trim(), numberNorm });
  }
  return [...out.values()];
}

export function toAdminProduct(p: ProductRow): AdminProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    brand: p.brand,
    category: p.category,
    partNumber: p.partNumber,
    kind: p.kind,
    condition: p.condition,
    voltage: p.voltage,
    powerKw: p.powerKw === null ? null : Number(p.powerKw),
    amperageA: p.amperageA,
    rotation: p.rotation,
    teeth: p.teeth,
    coreDepositMinor: p.coreDepositMinor,
    images: p.images,
    specs: p.specs.map((s) => ({ key: s.key, value: s.value })),
    crossReferences: p.crossReferences.map((x) => ({ brand: x.brand, number: x.number })),
    applications: p.applications.map((a) => ({
      machineModelId: a.machineModelId,
      machineBrand: a.machineModel.brand.name,
      machineModel: a.machineModel.name,
      ...(a.engine === null ? {} : { engine: a.engine }),
      ...(a.yearFrom === null ? {} : { yearFrom: a.yearFrom }),
      ...(a.yearTo === null ? {} : { yearTo: a.yearTo }),
      ...(a.note === null ? {} : { note: a.note }),
    })),
    stock: p.inventory?.quantity ?? 0,
    prices: p.prices.map((pr) => ({
      priceListId: pr.priceListId,
      priceList: pr.priceList.name,
      segment: pr.priceList.segment,
      currency: pr.priceList.currency,
      amountMinor: pr.amountMinor,
      vatRate: pr.vatRate,
    })),
    updatedAt: p.updatedAt.toISOString(),
  };
}
