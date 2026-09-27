import { z } from 'zod';
import { CurrencySchema } from './enums';
import { imageUrlField, powerWField, slugField } from './fields';
import { FuelType, PhaseType } from './selector';

/**
 * Перелік із повідомленням українською: типове zod-івське «Invalid enum value» в звіті
 * імпорту читає не програміст, а той, хто веде прайс.
 */
const ukEnum = <T extends Record<string, string>>(values: T): z.ZodNativeEnum<T> =>
  z.nativeEnum(values, {
    errorMap: () => ({ message: `очікується одне з: ${Object.values(values).join(', ')}` }),
  });

/** Порожня клітинка таблиці означає «не задано», а не нуль чи порожній рядок. */
const blank = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/**
 * Числа з таблиці: «18 990,50» → 18990.5. Пробіли-роздільники тисяч і кома як десяткова крапка —
 * звичні для української локалі, Excel і LibreOffice віддають прайс саме так.
 */
const num = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  // Нечислове значення лишаємо рядком — тоді zod скаже «очікувалося число», а не «NaN».
  return Number.isNaN(n) ? v : n;
};

const decimal = (schema: z.ZodTypeAny): z.ZodEffects<z.ZodTypeAny> =>
  z.preprocess((v) => num(blank(v)), schema);

/** Список через «;» — для колонки із зображеннями. */
const list = (v: unknown): unknown =>
  typeof v === 'string'
    ? v
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
    : v;

/**
 * Рядок файлу імпорту каталогу — один генератор. Джерело: CSV із таблиці, тож усі значення
 * приходять рядками й приводяться до типів тут. Обмеження ті самі, що в адмін-панелі
 * (`AdminProductInputSchema`), щоб імпорт не став шляхом в обхід перевірок.
 *
 * Ціни задаються у гривнях, як у прайсі; у БД зберігаються в копійках — переводить імпорт.
 * Характеристики товару передаються окремими колонками з префіксом `spec:` і розбираються
 * поза цією схемою (`parseSpecs` в apps/api/src/scripts/catalog-import.ts).
 *
 * Необовʼязкові поля навмисно без значень за замовчуванням: відсутня колонка означає
 * «не чіпати», а не «стерти». Інакше прайс лише з цінами обнулив би склад і описи.
 */
export const CatalogImportRowSchema = z
  .object({
    slug: slugField,
    name: z.string().trim().min(2).max(200),
    description: z.preprocess(blank, z.string().trim().max(5000).optional()),
    /** Назва бренду як у прайсі; slug — окремою колонкою або з назви (транслітерація). */
    brand: z.string().trim().min(1, 'brand: бренд обовʼязковий'),
    brandSlug: z.preprocess(blank, slugField.optional()),
    category: z.string().trim().min(1, 'category: категорія обовʼязкова'),
    categorySlug: z.preprocess(blank, slugField.optional()),
    fuel: ukEnum(FuelType),
    phase: ukEnum(PhaseType),
    /** Номінальна (робоча) потужність, Вт. */
    ratedPowerW: decimal(powerWField),
    /** Максимальна (пікова) потужність, Вт. */
    maxPowerW: decimal(powerWField),
    images: z.preprocess((v) => list(blank(v)), z.array(imageUrlField).max(20).optional()),
    currency: z.preprocess(blank, CurrencySchema.default('UAH')),
    /** Роздрібна ціна, грн. */
    priceB2C: decimal(z.number().nonnegative().optional()),
    /** Ціна для бізнесу, грн. */
    priceB2B: decimal(z.number().nonnegative().optional()),
    vatRate: decimal(z.number().min(0).max(1).optional()),
    /** Залишок на складі, шт. */
    stock: decimal(z.number().int().nonnegative().optional()),
  })
  .refine((r) => r.maxPowerW >= r.ratedPowerW, {
    message: 'Пікова потужність не може бути меншою за номінальну',
    path: ['maxPowerW'],
  });
export type CatalogImportRow = z.infer<typeof CatalogImportRowSchema>;

/** Колонки шаблону: обовʼязкові для нового товару — перші сім. */
export const CATALOG_IMPORT_COLUMNS = [
  'slug',
  'name',
  'brand',
  'category',
  'fuel',
  'phase',
  'ratedPowerW',
  'maxPowerW',
  'description',
  'brandSlug',
  'categorySlug',
  'images',
  'currency',
  'priceB2C',
  'priceB2B',
  'vatRate',
  'stock',
] as const;
