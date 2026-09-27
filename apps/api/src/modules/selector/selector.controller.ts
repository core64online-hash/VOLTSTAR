import { Body, Controller, Get, Logger, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  SelectorInputSchema,
  SelectorRecommendationQuerySchema,
  type PowerCalculation,
  type SelectorRecommendations,
} from '@voltstar/types';
import { PublicCache } from '../../common/http/public-cache.interceptor';
import { RateLimit } from '../../common/security/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { SelectorService } from './selector.service';

/** Query-параметри приходять рядками; порожні лишаємо `undefined`, щоб спрацювали значення за замовчуванням. */
function toNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

@ApiTags('selector')
@Controller('selector')
export class SelectorController {
  private readonly logger = new Logger(SelectorController.name);

  constructor(
    private readonly selector: SelectorService,
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  /**
   * Генератори під готовий розрахунок. Окремо від `calculate`: це читання, воно кешується
   * як решта каталогу, не пише `SelectorRun` (інакше повторний перегляд псував би конверсію
   * «підбір → заявка») і не залежить від БД — якщо каталог упаде, число клієнт усе одно побачить.
   */
  @Get('recommendations')
  @PublicCache()
  async recommendations(@Query() q: Record<string, unknown>): Promise<SelectorRecommendations> {
    const query = SelectorRecommendationQuerySchema.parse({
      runningW: toNumber(q.runningW),
      peakW: toNumber(q.peakW),
      recommendedW: toNumber(q.recommendedW),
      phase: q.phase,
      segment: q.segment,
      limit: toNumber(q.limit),
    });
    const candidates = await this.catalog.candidatesForPower(query, query.segment, query.limit);
    const { exact, close } = this.selector.matchCandidates(candidates, query);
    return {
      exact: exact.slice(0, query.limit),
      close: close.slice(0, query.limit),
      catalogQuery: { phase: query.phase, minPowerW: query.recommendedW },
    };
  }

  /** Розрахунок потрібної потужності генератора за формою підбору. */
  @Post('calculate')
  @RateLimit({ name: 'selector', limit: 60, windowSec: 60 })
  calculate(@Body() body: unknown): PowerCalculation {
    // Валідація вхідних даних через спільну zod-схему (@voltstar/types).
    const input = SelectorInputSchema.parse(body);
    const result = this.selector.calculatePower(input);
    // Факт розрахунку — для звіту конверсії «підбір → заявка»; збій запису не впливає на відповідь.
    this.prisma.selectorRun
      .create({
        data: {
          recommendedW: Math.round(result.recommendedW),
          phase: input.phase,
          usageMode: input.usageMode,
          itemsCount: input.items.length,
        },
      })
      .catch((e: Error) => this.logger.warn(`Розрахунок підбору не записано: ${e.message}`));
    return result;
  }
}
