import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CatalogQuery } from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildSearchParams,
  PRODUCT_DEFAULT_SORT,
  PRODUCT_FIELDS,
  PRODUCT_TOKEN_SEPARATORS,
  PRODUCTS_ALIAS,
  toProductDocument,
  type ProductDocument,
} from './product-document';
import { TypesenseClient, type FetchFn } from './typesense.client';

/** DI-токен для підміни fetch у тестах. */
export const TYPESENSE_FETCH = Symbol('TYPESENSE_FETCH');

const BATCH = 500;
const WARN_EVERY_MS = 60_000;
const productInclude = {
  brand: true,
  category: true,
  inventory: true,
  crossReferences: { select: { numberNorm: true } },
  applications: { select: { machineModel: { select: { slug: true, segment: true } } } },
} as const;

/**
 * Пошуковий індекс каталогу в Typesense. Увімкнено, коли задано TYPESENSE_HOST і
 * TYPESENSE_API_KEY. Пошук — best effort: при недоступності Typesense каталог
 * працює через Postgres (див. CatalogService), а синхронізація лише логує збій.
 */
@Injectable()
export class SearchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchService.name);
  private readonly client: TypesenseClient | null;
  private readonly syncOnStart: boolean;
  private lastWarnAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Optional() @Inject(TYPESENSE_FETCH) fetchFn?: FetchFn,
  ) {
    const host = config.get<string>('TYPESENSE_HOST');
    const apiKey = config.get<string>('TYPESENSE_API_KEY');
    const protocol = config.get<string>('TYPESENSE_PROTOCOL') || 'http';
    const port = config.get<string>('TYPESENSE_PORT') || '8108';
    this.client = host && apiKey ? new TypesenseClient({ baseUrl: `${protocol}://${host}:${port}`, apiKey }, fetchFn) : null;
    this.syncOnStart = config.get<string>('TYPESENSE_SYNC_ON_START') === 'true';
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  onApplicationBootstrap(): void {
    if (this.enabled && this.syncOnStart) {
      void this.reindexAll().catch((e) => this.logger.error(`Початкова індексація не вдалася: ${(e as Error).message}`));
    }
  }

  /**
   * Повна переіндексація без простою: нова колекція products_<ts> → імпорт → перемикання
   * аліасу → видалення старої. Якщо імпорт частково впав — аліас не чіпаємо.
   */
  async reindexAll(): Promise<{ collection: string; indexed: number }> {
    const client = this.requireClient();
    const collection = `${PRODUCTS_ALIAS}_${Date.now()}`;
    await client.createCollection(
      collection,
      PRODUCT_FIELDS,
      PRODUCT_DEFAULT_SORT,
      PRODUCT_TOKEN_SEPARATORS,
    );

    let indexed = 0;
    try {
      let cursor: string | undefined;
      for (;;) {
        const rows = await this.prisma.product.findMany({
          include: productInclude,
          orderBy: { id: 'asc' },
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (rows.length === 0) break;
        const result = await client.importDocuments(collection, rows.map(toProductDocument), 'create');
        if (result.errors.length) throw new Error(`імпорт відхилив ${result.errors.length} док.: ${result.errors[0]}`);
        indexed += result.imported;
        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH) break;
      }
    } catch (e) {
      await client.deleteCollection(collection).catch(() => undefined);
      throw e;
    }

    const previous = await client.getAlias(PRODUCTS_ALIAS);
    await client.upsertAlias(PRODUCTS_ALIAS, collection);
    if (previous && previous !== collection) {
      await client.deleteCollection(previous).catch((e) => this.logger.warn(`Стару колекцію ${previous} не видалено: ${(e as Error).message}`));
    }
    this.logger.log(`Індекс каталогу оновлено: ${indexed} товарів → ${collection}`);
    return { collection, indexed };
  }

  /** Оновлює окремі товари (напр., наявність після оформлення/скасування). Не кидає помилок. */
  async syncProducts(productIds: string[]): Promise<void> {
    if (!this.client || productIds.length === 0) return;
    try {
      const rows = await this.prisma.product.findMany({ where: { id: { in: productIds } }, include: productInclude });
      const result = await this.client.importDocuments(PRODUCTS_ALIAS, rows.map(toProductDocument), 'upsert');
      if (result.errors.length) this.warn(`синхронізація товарів: ${result.errors[0]}`);
    } catch (e) {
      this.warn(`синхронізація товарів: ${(e as Error).message}`);
    }
  }

  /** Ідентифікатори товарів у порядку релевантності + загальна кількість. Кидає при збої. */
  async searchProductIds(query: CatalogQuery): Promise<{ ids: string[]; total: number }> {
    const client = this.requireClient();
    const res = await client.search<ProductDocument>(PRODUCTS_ALIAS, buildSearchParams(query));
    return { ids: res.hits.map((h) => h.document.id), total: res.found };
  }

  /** Попередження не частіше разу на хвилину — щоб лежачий Typesense не засмічував лог. */
  warn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_EVERY_MS) return;
    this.lastWarnAt = now;
    this.logger.warn(`Typesense недоступний або відповів помилкою (${message}) — працюємо через Postgres`);
  }

  private requireClient(): TypesenseClient {
    if (!this.client) throw new Error('Typesense не налаштований (TYPESENSE_HOST / TYPESENSE_API_KEY)');
    return this.client;
  }
}
