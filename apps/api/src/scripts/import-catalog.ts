/**
 * Масовий імпорт каталогу з CSV — щоб наповнювати вітрину прайсом, а не руками по товару.
 *
 *   pnpm --filter @voltstar/api catalog:import ./generators.csv --dry-run
 *   pnpm --filter @voltstar/api catalog:import ./generators.csv
 *   pnpm --filter @voltstar/api catalog:import 'https://docs.google.com/…/pub?output=csv'
 *
 * Адреса замість файлу — для терміналу Coolify: прайс ведеться в таблиці, публікується як CSV,
 * імпорт запускається одним рядком, без копіювання файлу в контейнер.
 *
 * Повторний запуск того самого файлу оновлює товари, а не дублює: ключ — колонка slug.
 * Колонки, яких немає в заголовку, не чіпаються (прайс лише з цінами не обнулить склад і описи).
 * Формат колонок — docs/RUNBOOK.md, шаблон — deploy/catalog-example.csv.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Currency, Prisma, Segment } from '@prisma/client';
import { SearchService } from '../modules/search/search.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  hasColumn,
  hasSpecColumns,
  prepareRows,
  toMinor,
  type PreparedProduct,
} from './catalog-import';
import { parseCsv } from './csv';

function loadEnv(): void {
  for (const file of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../../.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** Назви прайс-листів, які створюються за потреби (у seed є лише роздрібний). */
const PRICE_LIST_NAME: Record<string, string> = { B2C: 'Роздріб', B2B: 'Опт', B2G: 'Тендерний' };

const USAGE = 'Використання: catalog:import <файл.csv | https://…> [--dry-run] [--no-reindex]';

async function readSource(source: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${source} → HTTP ${res.status}`);
    return res.text();
  }
  const path = resolve(process.cwd(), source);
  if (!existsSync(path)) throw new Error(`Файл не знайдено: ${path}`);
  return readFileSync(path, 'utf8');
}

/** Прайс-лист сегмента; створюється, якщо його ще немає. Результати кешуються на запуск. */
function priceListResolver(prisma: PrismaService, dryRun: boolean) {
  const cache = new Map<string, string | null>();
  return async (segment: Segment, currency: Currency): Promise<string | null> => {
    const key = `${segment}:${currency}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const existing = await prisma.priceList.findFirst({
      where: { segment, currency, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    let id = existing?.id ?? null;
    if (id === null && !dryRun) {
      const created = await prisma.priceList.create({
        data: { name: PRICE_LIST_NAME[segment] ?? segment, segment, currency },
        select: { id: true },
      });
      id = created.id;
    }
    cache.set(key, id);
    return id;
  };
}

interface WriteContext {
  columns: Set<string>;
  priceList: (segment: Segment, currency: Currency) => Promise<string | null>;
}

/**
 * Один товар — одна транзакція: помилка на одному рядку не має відкочувати вже завантажені.
 * Бренд і категорія створюються за потреби, але не перейменовуються: одруківка в прайсі не
 * повинна тихо змінити назву бренду для всього каталогу.
 */
async function writeProduct(
  prisma: PrismaService,
  p: PreparedProduct,
  ctx: WriteContext,
): Promise<{ id: string; status: 'created' | 'updated' }> {
  const { row } = p;
  return prisma.$transaction(async (tx) => {
    const brand = await tx.brand.upsert({
      where: { slug: p.brandSlug },
      create: { name: row.brand, slug: p.brandSlug },
      update: {},
      select: { id: true },
    });
    const category = await tx.category.upsert({
      where: { slug: p.categorySlug },
      create: { name: row.category, slug: p.categorySlug },
      update: {},
      select: { id: true },
    });

    const before = await tx.product.findUnique({ where: { slug: row.slug }, select: { id: true } });
    const fields = {
      name: row.name,
      brandId: brand.id,
      categoryId: category.id,
      fuel: row.fuel,
      phase: row.phase,
      ratedPowerW: row.ratedPowerW,
      maxPowerW: row.maxPowerW,
      // undefined = поле не змінюється; так колонка, якої немає у файлі, не стирає дані.
      description: row.description,
      images: row.images,
    } satisfies Prisma.ProductUncheckedUpdateInput;

    const product = await tx.product.upsert({
      where: { slug: row.slug },
      create: { slug: row.slug, ...fields, images: row.images ?? [] },
      update: fields,
      select: { id: true },
    });

    if (hasSpecColumns(ctx.columns)) {
      await tx.productSpec.deleteMany({ where: { productId: product.id } });
      if (p.specs.length > 0) {
        await tx.productSpec.createMany({
          data: p.specs.map((s) => ({ productId: product.id, key: s.key, value: s.value })),
        });
      }
    }

    if (hasColumn(ctx.columns, 'stock') && row.stock !== undefined) {
      await tx.inventoryItem.upsert({
        where: { productId: product.id },
        create: { productId: product.id, quantity: row.stock },
        update: { quantity: row.stock },
      });
    }

    const prices: [Segment, number | undefined][] = [
      ['B2C', row.priceB2C],
      ['B2B', row.priceB2B],
    ];
    for (const [segment, amount] of prices) {
      if (amount === undefined) continue;
      const priceListId = await ctx.priceList(segment, row.currency);
      if (priceListId === null)
        throw new Error(`Прайс-лист ${segment}/${row.currency} не знайдено`);
      const amountMinor = toMinor(amount);
      await tx.price.upsert({
        where: { productId_priceListId: { productId: product.id, priceListId } },
        create: { productId: product.id, priceListId, amountMinor, vatRate: row.vatRate ?? 0.2 },
        update: { amountMinor, ...(row.vatRate === undefined ? {} : { vatRate: row.vatRate }) },
      });
    }

    return { id: product.id, status: before ? ('updated' as const) : ('created' as const) };
  });
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noReindex = args.includes('--no-reindex');
  const source = args.find((a) => !a.startsWith('--'));
  if (!source) throw new Error(USAGE);

  const { products, errors, columns } = prepareRows(parseCsv(await readSource(source)));
  if (products.length === 0 && errors.length === 0)
    throw new Error('У файлі немає рядків із товарами');

  const prisma = new PrismaService();
  const ctx: WriteContext = { columns, priceList: priceListResolver(prisma, dryRun) };
  const written: string[] = [];
  let created = 0;
  let updated = 0;

  try {
    for (const p of products) {
      try {
        if (dryRun) {
          const exists = await prisma.product.findUnique({
            where: { slug: p.row.slug },
            select: { id: true },
          });
          if (exists) updated++;
          else created++;
          continue;
        }
        const res = await writeProduct(prisma, p, ctx);
        written.push(res.id);
        if (res.status === 'created') created++;
        else updated++;
      } catch (e) {
        errors.push({ line: p.line, slug: p.row.slug, messages: [(e as Error).message] });
      }
    }

    for (const e of errors.sort((a, b) => a.line - b.line)) {
      console.error(`❌ Рядок ${e.line}${e.slug ? ` (${e.slug})` : ''}: ${e.messages.join('; ')}`);
    }
    console.log(
      `${dryRun ? 'Перевірка (нічого не записано)' : 'Імпорт'}: створено ${created}, оновлено ${updated}, помилок ${errors.length}`,
    );

    if (!dryRun && !noReindex && written.length > 0) {
      const config = { get: (key: string) => process.env[key] } as unknown as ConfigService;
      const search = new SearchService(prisma, config);
      if (search.enabled) {
        const { indexed } = await search.reindexAll();
        console.log(`🔎 Переіндексовано товарів: ${indexed}`);
      } else {
        console.log('ℹ️  Пошук не налаштовано (TYPESENSE_*) — переіндексацію пропущено');
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (errors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌', (e as Error).message);
  process.exit(1);
});
