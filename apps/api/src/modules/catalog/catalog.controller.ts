import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CatalogQuerySchema,
  LookupQuerySchema,
  MachineSegmentSchema,
  SegmentSchema,
  type Segment,
} from '@voltstar/types';
import { PublicCache } from '../../common/http/public-cache.interceptor';
import { CatalogService } from './catalog.service';

/** Нормалізує query-параметр у масив рядків. */
function toArray(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function toNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Каталог публічний і не залежить від користувача (сегмент — у параметрах), тож кешується в браузері й CDN. */
@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  @PublicCache()
  list(@Query() q: Record<string, unknown>) {
    const query = CatalogQuerySchema.parse({
      q: q.q ? String(q.q) : undefined,
      brand: toArray(q.brand),
      kind: toArray(q.kind),
      condition: toArray(q.condition),
      machineSegment: q.machineSegment ? String(q.machineSegment) : undefined,
      machineModel: q.machineModel ? String(q.machineModel) : undefined,
      voltage: toNumber(q.voltage),
      inStock: q.inStock === 'true' ? true : undefined,
      page: toNumber(q.page) ?? 1,
      perPage: toNumber(q.perPage) ?? 24,
    });
    return this.catalog.list(query, this.segment(q.segment));
  }

  @Get('facets')
  @PublicCache()
  facets() {
    return this.catalog.facets();
  }

  /**
   * Пошук по крос-номеру. GET і без побічних ефектів — тому кешується так само, як решта
   * каталогу: той самий номер у робочий день пробивають десятки разів.
   */
  @Get('lookup')
  @PublicCache()
  lookup(@Query() q: Record<string, unknown>) {
    const query = LookupQuerySchema.parse({
      number: String(q.number ?? ''),
      segment: this.segment(q.segment),
      limit: toNumber(q.limit) ?? 12,
    });
    return this.catalog.lookup(query);
  }

  /** Техніка з товарами — для посадкових сторінок і карти сайту. */
  @Get('machines')
  @PublicCache()
  machines(@Query('segment') segment?: string) {
    const parsed = MachineSegmentSchema.safeParse(segment);
    return this.catalog.machines(parsed.success ? parsed.data : undefined);
  }

  @Get('products/:slug')
  @PublicCache()
  getOne(@Param('slug') slug: string, @Query('segment') segment?: string) {
    return this.catalog.getBySlug(slug, this.segment(segment));
  }

  private segment(raw: unknown): Segment {
    const parsed = SegmentSchema.safeParse(raw);
    return parsed.success ? parsed.data : 'B2C';
  }
}
