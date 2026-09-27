/**
 * Підготовка рядків прайсу до запису в каталог: транслітерація машинних назв, розбір
 * характеристик і перевірка схемою. Чиста логіка без БД — щоб її можна було покрити тестами,
 * а сам скрипт (import-catalog.ts) лишався тонким.
 */
import { CatalogImportRowSchema, slugField, type CatalogImportRow } from '@voltstar/types';
import type { CsvRow } from './csv';

/** Колонки характеристик товару: `spec:Обʼєм бака, л` → ключ «Обʼєм бака, л». */
export const SPEC_PREFIX = 'spec:';

/** Транслітерація за постановою КМУ № 55: «Резервні генератори» → rezervni-heneratory. */
const UK: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  // Трапляються в прайсах від постачальників.
  ы: 'y',
  э: 'e',
  ъ: '',
  ё: 'e',
};

/** На початку слова ці літери передаються інакше: «Ялта» → yalta, а не ialta. */
const UK_INITIAL: Record<string, string> = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };

/** Апострофи всіх накреслень просто зникають, а не стають дефісом. */
const APOSTROPHES = new Set(["'", '’', 'ʼ', '`', '´']);

/** Машинна назва з довільного тексту: латиниця в нижньому регістрі, цифри й дефіси. */
export function slugify(value: string): string {
  let out = '';
  let wordStart = true;
  for (const ch of value.toLowerCase().trim()) {
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      wordStart = false;
      continue;
    }
    if (APOSTROPHES.has(ch)) continue;
    const mapped = wordStart ? (UK_INITIAL[ch] ?? UK[ch]) : UK[ch];
    if (mapped !== undefined) {
      out += mapped;
      // Мʼякий знак не завершує слово — наступна літера все ще не на його початку.
      if (mapped !== '') wordStart = false;
      continue;
    }
    out += '-';
    wordStart = true;
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Ціна з прайсу (гривні) у копійки. Множення на 100 у float дає 1899098.9999 — звідси round. */
export const toMinor = (amount: number): number => Math.round(amount * 100);

/** Характеристики з колонок `spec:…`; порожні клітинки пропускаються. */
export function parseSpecs(record: Record<string, string>): { key: string; value: string }[] {
  return Object.entries(record)
    .filter(([column]) => column.toLowerCase().startsWith(SPEC_PREFIX))
    .map(([column, value]) => ({
      key: column.slice(SPEC_PREFIX.length).trim(),
      value: value.trim(),
    }))
    .filter((s) => s.key !== '' && s.value !== '');
}

export interface PreparedProduct {
  line: number;
  row: CatalogImportRow;
  brandSlug: string;
  categorySlug: string;
  specs: { key: string; value: string }[];
}

export interface RowError {
  line: number;
  slug: string | null;
  messages: string[];
}

export interface PreparedImport {
  products: PreparedProduct[];
  errors: RowError[];
  /** Які колонки були в заголовку: відсутня колонка означає «не чіпати це поле». */
  columns: Set<string>;
}

/** Чи була колонка в заголовку файлу (не плутати з порожньою клітинкою). */
export const hasColumn = (columns: Set<string>, name: string): boolean => columns.has(name);

/** Чи був у заголовку хоч один `spec:` — інакше характеристики товарів не чіпаємо. */
export const hasSpecColumns = (columns: Set<string>): boolean =>
  [...columns].some((c) => c.toLowerCase().startsWith(SPEC_PREFIX));

/**
 * Перевіряє рядки й доповнює похідними полями. Помилки збираються по рядках: один битий рядок
 * не має зривати весь прайс.
 */
export function prepareRows(rows: CsvRow[]): PreparedImport {
  const products: PreparedProduct[] = [];
  const errors: RowError[] = [];
  const columns = new Set<string>(rows.length > 0 ? Object.keys(rows[0].record) : []);
  const seen = new Map<string, number>();

  for (const { line, record } of rows) {
    const parsed = CatalogImportRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        line,
        slug: record.slug?.trim() || null,
        messages: parsed.error.issues.map((i) =>
          i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message,
        ),
      });
      continue;
    }
    const row = parsed.data;
    const duplicateOf = seen.get(row.slug);
    if (duplicateOf !== undefined) {
      errors.push({
        line,
        slug: row.slug,
        messages: [`Дубль slug у файлі (вже був у рядку ${duplicateOf})`],
      });
      continue;
    }
    // Похідні машинні назви теж мають пройти перевірку: з «АВР-2» чи «???» транслітерація
    // дає надто коротке або порожнє значення, і тоді потрібна явна колонка.
    const derived = [
      ['brandSlug', row.brand, row.brandSlug ?? slugify(row.brand)],
      ['categorySlug', row.category, row.categorySlug ?? slugify(row.category)],
    ] as const;
    const badSlugs = derived.filter(([, , value]) => !slugField.safeParse(value).success);
    if (badSlugs.length > 0) {
      errors.push({
        line,
        slug: row.slug,
        messages: badSlugs.map(
          ([field, source]) =>
            `${field}: не вдалося зробити машинну назву з «${source}» — задайте колонку ${field}`,
        ),
      });
      continue;
    }

    seen.set(row.slug, line);
    products.push({
      line,
      row,
      brandSlug: derived[0][2],
      categorySlug: derived[1][2],
      specs: parseSpecs(record),
    });
  }

  return { products, errors, columns };
}
