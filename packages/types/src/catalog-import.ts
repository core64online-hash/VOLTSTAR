import { z } from 'zod';
import {
  CurrencySchema,
  MachineSegment,
  PartCondition,
  PartKind,
  Rotation,
} from './enums';
import {
  amperageField,
  imageUrlField,
  powerKwField,
  slugField,
  teethField,
  voltageField,
} from './fields';
import { partNumberField } from './part-number';

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

/** Список через «;» — для зображень, крос-номерів і техніки. */
const list = (v: unknown): unknown =>
  typeof v === 'string'
    ? v
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
    : v;

/**
 * Рядок файлу імпорту каталогу — один агрегат (стартер, генератор, вузол чи ремкомплект).
 * Джерело: CSV із таблиці, тож усі значення приходять рядками й приводяться до типів тут.
 * Обмеження ті самі, що в адмін-панелі (`AdminProductInputSchema`), щоб імпорт не став
 * шляхом в обхід перевірок.
 *
 * Ціни задаються у гривнях, як у прайсі; у БД зберігаються в копійках — переводить імпорт.
 *
 * Звʼязки «один до багатьох» ідуть окремими сімействами колонок і розбираються поза цією
 * схемою (apps/api/src/scripts/catalog-import.ts):
 *   `xref:BOSCH`  — крос-номери цього виробника, кілька через «;»;
 *   `fits:TRUCK`  — техніка цієї групи, кілька через «;»;
 *   `spec:…`      — решта характеристик.
 *
 * Необовʼязкові поля навмисно без значень за замовчуванням: відсутня колонка означає
 * «не чіпати», а не «стерти». Інакше прайс лише з цінами обнулив би склад і описи.
 */
export const CatalogImportRowSchema = z.object({
  /** Наш артикул — ключ, за яким повторний імпорт оновлює товар, а не дублює. */
  partNumber: partNumberField,
  /** Адреса сторінки; якщо колонки немає, виводиться з артикула й бренду. */
  slug: z.preprocess(blank, slugField.optional()),
  name: z.string().trim().min(2).max(200),
  description: z.preprocess(blank, z.string().trim().max(5000).optional()),
  /** Виробник агрегата (Bosch, Iskra, АТЕ); slug — окремою колонкою або з назви. */
  brand: z.string().trim().min(1, 'brand: бренд обовʼязковий'),
  brandSlug: z.preprocess(blank, slugField.optional()),
  category: z.string().trim().min(1, 'category: категорія обовʼязкова'),
  categorySlug: z.preprocess(blank, slugField.optional()),
  kind: ukEnum(PartKind),
  condition: z.preprocess(blank, ukEnum(PartCondition).default('NEW')),
  voltage: decimal(voltageField.optional()),
  /** Потужність стартера, кВт. */
  powerKw: decimal(powerKwField.optional()),
  /** Струм віддачі генератора, А. */
  amperageA: decimal(amperageField.optional()),
  rotation: z.preprocess(blank, ukEnum(Rotation).optional()),
  teeth: decimal(teethField.optional()),
  /** Застава за старий агрегат при купівлі на обмін, грн. */
  coreDeposit: decimal(z.number().nonnegative().optional()),
  images: z.preprocess((v) => list(blank(v)), z.array(imageUrlField).max(20).optional()),
  currency: z.preprocess(blank, CurrencySchema.default('UAH')),
  /** Роздрібна ціна, грн. */
  priceB2C: decimal(z.number().nonnegative().optional()),
  /** Ціна для бізнесу, грн. */
  priceB2B: decimal(z.number().nonnegative().optional()),
  vatRate: decimal(z.number().min(0).max(1).optional()),
  /** Залишок на складі, шт. */
  stock: decimal(z.number().int().nonnegative().optional()),
});
export type CatalogImportRow = z.infer<typeof CatalogImportRowSchema>;

/** Колонки шаблону: обовʼязкові для нового товару — перші пʼять. */
export const CATALOG_IMPORT_COLUMNS = [
  'partNumber',
  'name',
  'brand',
  'category',
  'kind',
  'condition',
  'slug',
  'description',
  'brandSlug',
  'categorySlug',
  'voltage',
  'powerKw',
  'amperageA',
  'rotation',
  'teeth',
  'coreDeposit',
  'images',
  'currency',
  'priceB2C',
  'priceB2B',
  'vatRate',
  'stock',
] as const;

/** Префікси сімейств колонок для звʼязків «один до багатьох». */
export const XREF_PREFIX = 'xref:';
export const FITS_PREFIX = 'fits:';
export const SPEC_PREFIX = 'spec:';

/** Групи техніки в колонках `fits:` — ті самі, що в енумі, українською в шапці не приймаємо. */
export const FITS_SEGMENTS = Object.values(MachineSegment);
