import { z } from 'zod';
import {
  CurrencySchema,
  MachineSegmentSchema,
  PartConditionSchema,
  PartKindSchema,
  RotationSchema,
  SegmentSchema,
} from './enums';
import { partNumberField } from './part-number';

/** Ціна для конкретного сегмента та валюти. */
export const PriceSchema = z.object({
  segment: SegmentSchema,
  currency: CurrencySchema,
  /** Ціна в мінімальних одиницях (копійки/центи) для точності. */
  amountMinor: z.number().int().nonnegative(),
  /** Ставка ПДВ, частка (напр. 0.2). */
  vatRate: z.number().min(0).max(1).default(0.2),
});
export type Price = z.infer<typeof PriceSchema>;

/** Крос-номер у публічному поданні товару. */
export const CrossReferenceSchema = z.object({
  brand: z.string(),
  number: z.string(),
});
export type CrossReference = z.infer<typeof CrossReferenceSchema>;

/** Техніка, на яку стає агрегат. */
export const ApplicationSchema = z.object({
  segment: MachineSegmentSchema,
  brand: z.string(),
  model: z.string(),
  modelSlug: z.string(),
  engine: z.string().nullable().optional(),
  yearFrom: z.number().int().nullable().optional(),
  yearTo: z.number().int().nullable().optional(),
});
export type Application = z.infer<typeof ApplicationSchema>;

/** Публічне подання агрегата в каталозі. */
export const ProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  categorySlug: z.string(),
  kind: PartKindSchema,
  condition: PartConditionSchema,
  /** Наш артикул. */
  partNumber: z.string(),
  /** Бортова напруга, В. Довідкова характеристика: підбір іде по крос-номеру. */
  voltage: z.number().int().nullable().optional(),
  /** Потужність стартера, кВт. */
  powerKw: z.number().nullable().optional(),
  /** Струм віддачі генератора, А. */
  amperageA: z.number().int().nullable().optional(),
  rotation: RotationSchema.nullable().optional(),
  teeth: z.number().int().nullable().optional(),
  /** Застава за старий агрегат при купівлі на обмін, копійки. */
  coreDepositMinor: z.number().int().nullable().optional(),
  images: z.array(z.string()).default([]),
  inStock: z.boolean().default(true),
  prices: z.array(PriceSchema).default([]),
  /** Заповнюється лише на сторінці товару, у списках порожній. */
  crossReferences: z.array(CrossReferenceSchema).default([]),
  applications: z.array(ApplicationSchema).default([]),
});
export type Product = z.infer<typeof ProductSchema>;

/** Параметри фасетного пошуку каталогу. */
export const CatalogQuerySchema = z.object({
  q: z.string().optional(),
  brand: z.array(z.string()).optional(),
  kind: z.array(PartKindSchema).optional(),
  condition: z.array(PartConditionSchema).optional(),
  /** Група техніки: вантажівки, спецтехніка, сільгосп, мілтехніка. */
  machineSegment: MachineSegmentSchema.optional(),
  /** Машинна назва моделі техніки — для посадкових сторінок застосовності. */
  machineModel: z.string().optional(),
  voltage: z.number().int().optional(),
  inStock: z.boolean().optional(),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(24),
});
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

/** Доступні значення фасетів для фільтрів каталогу. */
export const CatalogFacetsSchema = z.object({
  brands: z.array(z.object({ slug: z.string(), name: z.string() })),
  kinds: z.array(PartKindSchema),
  conditions: z.array(PartConditionSchema),
  machineSegments: z.array(MachineSegmentSchema),
});
export type CatalogFacets = z.infer<typeof CatalogFacetsSchema>;

/**
 * Пошук по крос-номеру — головний вхід у каталог. Клієнт приходить із номером, знятим
 * з агрегата або взятим із каталогу техніки, і має отримати відповідь одразу.
 */
export const LookupQuerySchema = z.object({
  number: partNumberField,
  segment: SegmentSchema.default('B2C'),
  limit: z.number().int().min(1).max(24).default(12),
});
export type LookupQuery = z.infer<typeof LookupQuerySchema>;

/**
 * `exact` — номер збігся з нашим артикулом або з крос-номером: це саме те, що шукали.
 * `fuzzy` — точного збігу немає, показуємо схоже з пошуку, але чесно позначаємо, що це не воно.
 * Порожній результат нічим не підмінюємо: не той стартер гірший, ніж жодного.
 */
export const LookupResultSchema = z.object({
  /** Номер у нормалізованій формі — те, за чим фактично шукали. */
  normalized: z.string(),
  match: z.enum(['exact', 'fuzzy', 'none']),
  items: z.array(ProductSchema),
});
export type LookupResult = z.infer<typeof LookupResultSchema>;
