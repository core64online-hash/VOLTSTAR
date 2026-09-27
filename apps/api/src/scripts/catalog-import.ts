/**
 * Підготовка рядків прайсу до запису в каталог: транслітерація машинних назв, розбір
 * характеристик і перевірка схемою. Чиста логіка без БД — щоб її можна було покрити тестами,
 * а сам скрипт (import-catalog.ts) лишався тонким.
 */
import {
  CatalogImportRowSchema,
  FITS_PREFIX,
  MachineSegment,
  SPEC_PREFIX,
  XREF_PREFIX,
  normalizePartNumber,
  slugField,
  type CatalogImportRow,
  type MachineSegment as MachineSegmentType,
} from '@voltstar/types';
import type { CsvRow } from './csv';

/** Транслітерація за постановою КМУ № 55: «Стартери важкої техніки» → startery-vazhkoi-tekhniky. */
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

/** Колонки сімейства з префіксом: `spec:Вага` → ключ «Вага», значення з клітинки. */
function prefixed(
  record: Record<string, string>,
  prefix: string,
): { key: string; value: string }[] {
  return Object.entries(record)
    .filter(([column]) => column.toLowerCase().startsWith(prefix))
    .map(([column, value]) => ({ key: column.slice(prefix.length).trim(), value: value.trim() }))
    .filter((e) => e.key !== '' && e.value !== '');
}

/** Значення клітинки як список через «;». */
const cellList = (value: string): string[] =>
  value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

/** Характеристики з колонок `spec:…`; порожні клітинки пропускаються. */
export function parseSpecs(record: Record<string, string>): { key: string; value: string }[] {
  return prefixed(record, SPEC_PREFIX);
}

export interface ParsedCrossReference {
  brand: string;
  number: string;
  numberNorm: string;
}

/**
 * Крос-номери з колонок `xref:BOSCH`, кілька через «;». Бренд береться з назви колонки
 * у верхньому регістрі, щоб «xref:bosch» і «xref:Bosch» не давали два різні джерела.
 * Дублі в межах товару схлопуються за нормалізованим номером: у прайсах той самий номер
 * часто трапляється двічі — з роздільниками й без.
 */
export function parseCrossReferences(record: Record<string, string>): ParsedCrossReference[] {
  const out = new Map<string, ParsedCrossReference>();
  for (const { key, value } of prefixed(record, XREF_PREFIX)) {
    const brand = key.toUpperCase();
    for (const number of cellList(value)) {
      const numberNorm = normalizePartNumber(number);
      if (numberNorm.length < 3) continue;
      out.set(`${brand}:${numberNorm}`, { brand, number, numberNorm });
    }
  }
  return [...out.values()];
}

export interface ParsedApplication {
  segment: MachineSegmentType;
  machineBrand: string;
  machineBrandSlug: string;
  machineModel: string;
  machineModelSlug: string;
  engine: string | null;
  yearFrom: number | null;
  yearTo: number | null;
}

/** Роки застосовності: «2005-2015», «2005-» (досі випускається), «-2015» або одинарний «2005». */
function parseYears(value: string): { yearFrom: number | null; yearTo: number | null } | null {
  const single = /^(\d{4})$/.exec(value);
  if (single) return { yearFrom: Number(single[1]), yearTo: Number(single[1]) };
  const range = /^(\d{4})?\s*-\s*(\d{4})?$/.exec(value);
  if (!range || (!range[1] && !range[2])) return null;
  return {
    yearFrom: range[1] ? Number(range[1]) : null,
    yearTo: range[2] ? Number(range[2]) : null,
  };
}

/**
 * Техніка з колонок `fits:TRUCK`, кілька записів через «;». Запис — поля через «|»:
 *
 *   Марка|Модель|Двигун|Роки     напр. «МАЗ|5440|ЯМЗ-238|2005-2015»
 *
 * Двигун і роки необовʼязкові. Формат із роздільником, а не вільний текст, свідомо: марки
 * бувають із двох слів («John Deere»), і «перше слово — марка» ламалося б на них мовчки.
 */
export function parseApplications(record: Record<string, string>): {
  applications: ParsedApplication[];
  errors: string[];
} {
  const applications: ParsedApplication[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const { key, value } of prefixed(record, FITS_PREFIX)) {
    const segment = key.toUpperCase();
    if (!(segment in MachineSegment)) {
      errors.push(
        `${FITS_PREFIX}${key}: невідома група техніки — очікується одна з: ${Object.values(MachineSegment).join(', ')}`,
      );
      continue;
    }
    for (const entry of cellList(value)) {
      const [brand, model, engine, years] = entry.split('|').map((s) => s.trim());
      if (!brand || !model) {
        errors.push(`${FITS_PREFIX}${key}: «${entry}» — потрібно щонайменше «Марка|Модель»`);
        continue;
      }
      let yearFrom: number | null = null;
      let yearTo: number | null = null;
      if (years) {
        const parsed = parseYears(years);
        if (!parsed) {
          errors.push(`${FITS_PREFIX}${key}: «${years}» — роки у форматі 2005-2015`);
          continue;
        }
        ({ yearFrom, yearTo } = parsed);
      }
      const machineBrandSlug = slugify(brand);
      const machineModelSlug = slugify(`${brand} ${model}`);
      if (
        !slugField.safeParse(machineBrandSlug).success ||
        !slugField.safeParse(machineModelSlug).success
      ) {
        errors.push(`${FITS_PREFIX}${key}: з «${brand} ${model}» не вдалося зробити машинну назву`);
        continue;
      }
      const dedupe = `${machineModelSlug}:${engine ?? ''}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      applications.push({
        segment: segment as MachineSegmentType,
        machineBrand: brand,
        machineBrandSlug,
        machineModel: model,
        machineModelSlug,
        engine: engine || null,
        yearFrom,
        yearTo,
      });
    }
  }
  return { applications, errors };
}

export interface PreparedProduct {
  line: number;
  row: CatalogImportRow;
  /** Адреса сторінки: з колонки або з бренду й артикула. */
  slug: string;
  partNumberNorm: string;
  brandSlug: string;
  categorySlug: string;
  specs: { key: string; value: string }[];
  crossReferences: ParsedCrossReference[];
  applications: ParsedApplication[];
}

export interface RowError {
  line: number;
  partNumber: string | null;
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

/** Чи був у заголовку хоч один `spec:`/`xref:`/`fits:` — інакше цих даних не чіпаємо. */
export const hasPrefixedColumns = (columns: Set<string>, prefix: string): boolean =>
  [...columns].some((c) => c.toLowerCase().startsWith(prefix));

export const hasSpecColumns = (columns: Set<string>): boolean =>
  hasPrefixedColumns(columns, SPEC_PREFIX);

/**
 * Перевіряє рядки й доповнює похідними полями. Помилки збираються по рядках: один битий рядок
 * не має зривати весь прайс.
 *
 * Ключ товару — артикул (`partNumber`), а не адреса сторінки: у прайсі постачальника адреси
 * немає, а артикул є завжди, і саме він лишається сталим між вивантаженнями.
 */
export function prepareRows(rows: CsvRow[]): PreparedImport {
  const products: PreparedProduct[] = [];
  const errors: RowError[] = [];
  const columns = new Set<string>(rows.length > 0 ? Object.keys(rows[0].record) : []);
  const seenPart = new Map<string, number>();
  const seenSlug = new Map<string, number>();

  for (const { line, record } of rows) {
    const parsed = CatalogImportRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        line,
        partNumber: record.partNumber?.trim() || null,
        messages: parsed.error.issues.map((i) =>
          i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message,
        ),
      });
      continue;
    }
    const row = parsed.data;
    const partNumberNorm = normalizePartNumber(row.partNumber);
    const duplicateOf = seenPart.get(partNumberNorm);
    if (duplicateOf !== undefined) {
      errors.push({
        line,
        partNumber: row.partNumber,
        messages: [`Дубль артикула у файлі (вже був у рядку ${duplicateOf})`],
      });
      continue;
    }

    // Похідні машинні назви теж мають пройти перевірку: з «АТЭ-1» чи «???» транслітерація
    // дає надто коротке або порожнє значення, і тоді потрібна явна колонка.
    const derived = [
      ['slug', `${row.brand} ${row.partNumber}`, row.slug ?? slugify(`${row.brand} ${row.partNumber}`)],
      ['brandSlug', row.brand, row.brandSlug ?? slugify(row.brand)],
      ['categorySlug', row.category, row.categorySlug ?? slugify(row.category)],
    ] as const;
    const badSlugs = derived.filter(([, , value]) => !slugField.safeParse(value).success);
    if (badSlugs.length > 0) {
      errors.push({
        line,
        partNumber: row.partNumber,
        messages: badSlugs.map(
          ([field, source]) =>
            `${field}: не вдалося зробити машинну назву з «${source}» — задайте колонку ${field}`,
        ),
      });
      continue;
    }
    const [slug, brandSlug, categorySlug] = derived.map(([, , value]) => value);

    const slugDuplicateOf = seenSlug.get(slug);
    if (slugDuplicateOf !== undefined) {
      errors.push({
        line,
        partNumber: row.partNumber,
        messages: [`Адреса «${slug}» вже зайнята рядком ${slugDuplicateOf} — задайте колонку slug`],
      });
      continue;
    }

    const { applications, errors: fitsErrors } = parseApplications(record);
    if (fitsErrors.length > 0) {
      errors.push({ line, partNumber: row.partNumber, messages: fitsErrors });
      continue;
    }

    seenPart.set(partNumberNorm, line);
    seenSlug.set(slug, line);
    products.push({
      line,
      row,
      slug,
      partNumberNorm,
      brandSlug,
      categorySlug,
      specs: parseSpecs(record),
      crossReferences: parseCrossReferences(record),
      applications,
    });
  }

  return { products, errors, columns };
}
