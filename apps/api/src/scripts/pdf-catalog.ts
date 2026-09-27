/**
 * Розбір каталогу застосовності у PDF (Prestolite «Popular Truck Guide» і подібні).
 *
 * Навіщо. Виробники агрегатів не віддають дані стрічкою — вони видають каталог застосовності
 * у PDF: під кожною моделлю техніки перелік своїх артикулів із характеристиками, а під ними —
 * OE- і крос-номери. Це те саме, за чим клієнт шукає на сайті, тільки в форматі для друку.
 *
 * Чому по координатах, а не по тексту рядків. Витягнутий з PDF текст злипається: рядок
 * крос-номерів і рядок характеристик виглядають однаково. Але в макеті кожна колонка має свою
 * позицію X, і рядок товару завжди починається з напруги на X ≈ 236. Це і є розпізнавальний
 * знак, надійніший за будь-яку евристику по тексту.
 *
 * Чистий розбір без PDF-бібліотеки й без БД: на вхід — елементи тексту з координатами, на
 * вихід — товари. Так логіку можна покрити тестами, а сам скрипт (pdf-to-csv.ts) лишається тонким.
 */
import { normalizePartNumber } from '@voltstar/types';

/** Елемент тексту зі сторінки PDF: слово й де воно лежить. Y росте знизу вгору. */
export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  text: string;
}

/** Слова, зібрані в один рядок макета. */
export interface PdfLine {
  page: number;
  y: number;
  items: PdfTextItem[];
  /** Текст рядка з одинарними пробілами між словами. */
  text: string;
  /** X найлівішого слова — за ним видно рівень вкладеності. */
  x: number;
}

export interface ParsedApplication {
  brand: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface ParsedCrossRef {
  brand: string;
  number: string;
}

export interface ParsedPdfProduct {
  partNumber: string;
  kind: 'STARTER' | 'ALTERNATOR';
  voltage: number;
  /** Потужність стартера, кВт. */
  powerKw?: number;
  /** Струм віддачі генератора, А. */
  amperageA?: number;
  /** Зуби бендикса — лише в стартерів. */
  teeth?: number;
  specs: { key: string; value: string }[];
  crossReferences: ParsedCrossRef[];
  applications: ParsedApplication[];
  /** Примітки з каталогу: «(Cummins engine)», «Upgrade option: …». */
  notes: string[];
  /** Сторінки, де товар трапився, — щоб було куди подивитися при звірянні. */
  pages: number[];
}

export interface ParsedPdfCatalog {
  products: ParsedPdfProduct[];
  /** Рядки, яких розбір не впізнав: їх треба прочитати очима, а не вважати, що їх не було. */
  skipped: { page: number; text: string }[];
  /** Скільки пар дала таблиця крос-номерів і скільки з них лягло на відомі товари. */
  guide: { entries: number; matched: number };
}

/** Службові написи макета — у них немає даних. */
const CHROME =
  /^(POPULAR TRUCK GUIDE|Sales Email|Sales Tel|www\.|Catalogue Ref No|Issue no|Table of Contents|©|\d{1,3}$)/i;

/** Смуга X, у якій стоїть напруга в рядку товару. */
const VOLTAGE_X = { min: 225, max: 250 };
/** Ліворуч від цієї межі — заголовок моделі техніки, а не дані товару. */
const HEADER_X_MAX = 60;

/**
 * Напруга на початку колонки характеристик. У рядках генераторів це окремий фрагмент («24V»),
 * а в рядках стартерів верстка зливає його з потужністю («24V 4.0kW») — тому збіг із початку,
 * а не по всьому фрагменту.
 */
const VOLTAGE_RE = /^\d{1,2}V(\s|$)/;

/** Смуга X, у якій стоїть артикул; ліворуч від неї даних немає, праворуч — характеристики. */
const PART_NUMBER_X = { min: 140, max: 230 };

/**
 * Характеристики генератора: `24V 110A G 17mm 8pK, 60mm`.
 * G — маса на корпус, IR — ізольований, ER — маса через корпус; далі вал і шків.
 *
 * Пробіли в середині струму (`10 0 A`) — не помилка каталогу, а кернінг, який так лягає при
 * витягуванні тексту; тому цифри до `A` збираються разом.
 */
const ALTERNATOR_RE = /^(\d{1,2})V\s+(\d[\d\s]{0,4})A\s+([A-Z]{1,2})\s+(\S+)\s*(.*)$/;

/**
 * Характеристики стартера: `24V 4.0kW G 10t 40 28`.
 * Після потужності — зуби бендикса, його розмір і виліт (у міліметрах).
 */
const STARTER_RE = /^(\d{1,2})V\s+([\d.]+)\s*kW\s+([A-Z]{1,2})\s+(\d{1,2})t\s*(\S*)\s*(\S*)$/;

/** Підпис до способу підключення: код із каталогу читабельною мовою. */
const GROUND_LABEL: Record<string, string> = {
  G: 'маса на корпус',
  ER: 'маса на корпус',
  IR: 'ізольований',
};

/**
 * Крос-номер «на око»: великі літери, цифри й розділювачі, і хоч одна цифра.
 * Без цифри це слово з примітки («can», «replace»), а не номер.
 */
const LOOKS_LIKE_NUMBER = /^(?=.*\d)[A-Z0-9][A-Z0-9\-./\s]{1,24}$/;

/**
 * Виробник крос-номера за формою самого номера. Каталог друкує номери суцільним списком,
 * не підписуючи джерело, тому виробник тут — здогад, а не факт із документа: за ним товари
 * групуються на сторінці. Сам номер при цьому точний, а шукають саме за номером.
 */
const NUMBER_FAMILIES: { brand: string; test: RegExp }[] = [
  { brand: 'BOSCH', test: /^0\d{9}$/ },
  { brand: 'BOSCH', test: /^BX\d{4}$/ },
  { brand: 'BOSCH', test: /^6033[A-Z]{2}\d{4}$/ },
  { brand: 'MITSUBISHI', test: /^[AM]\d{0,3}T[A-Z]?\d{4,5}/ },
  { brand: 'DENSO', test: /^(DSN\d+|228000\d{4})$/ },
  { brand: 'ISKRA', test: /^(AZ[EFJ]|AAK|11\.20)/ },
];

/** Збирає слова в рядки: усе, що лежить на одній висоті, — один рядок макета. */
export function groupLines(items: PdfTextItem[], tolerance = 2): PdfLine[] {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    if (item.text.trim() === '') continue;
    const bucket = byPage.get(item.page);
    if (bucket) bucket.push(item);
    else byPage.set(item.page, [item]);
  }

  const lines: PdfLine[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageItems = byPage
      .get(page)!
      .slice()
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let current: PdfTextItem[] = [];
    for (const item of pageItems) {
      if (current.length > 0 && Math.abs(current[0]!.y - item.y) > tolerance) {
        lines.push(toLine(page, current));
        current = [];
      }
      current.push(item);
    }
    if (current.length > 0) lines.push(toLine(page, current));
  }
  return lines;
}

function toLine(page: number, items: PdfTextItem[]): PdfLine {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  return {
    page,
    y: sorted[0]!.y,
    items: sorted,
    text: sorted
      .map((i) => i.text.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    x: sorted[0]!.x,
  };
}

/** Чи це рядок товару: напруга стоїть у своїй колонці. */
function productVoltageIndex(line: PdfLine): number {
  return line.items.findIndex(
    (i) => i.x >= VOLTAGE_X.min && i.x <= VOLTAGE_X.max && VOLTAGE_RE.test(i.text.trim()),
  );
}

/** Роки з дужок заголовка: `(<< 2001)`, `(2001 >>)`, `(2005-2015)`. */
export function parseHeaderYears(text: string): {
  yearFrom: number | null;
  yearTo: number | null;
} {
  const before = /<<\s*(\d{4})/.exec(text);
  if (before) return { yearFrom: null, yearTo: Number(before[1]) };
  const after = /(\d{4})\s*>>/.exec(text);
  if (after) return { yearFrom: Number(after[1]), yearTo: null };
  const range = /(\d{4})\s*[-–]\s*(\d{4})/.exec(text);
  if (range) return { yearFrom: Number(range[1]), yearTo: Number(range[2]) };
  return { yearFrom: null, yearTo: null };
}

/**
 * Заголовок моделі техніки: `DAF LF45 (2001 >>)`, `KAMAZ 4308, 5308, 43225 (RUSSIAN TRUCK)`.
 *
 * Марка береться з переліку відомих (найдовший збіг на початку), бо буває з двох слів
 * («Mercedes-Benz»), а решта рядка — модель. Кома в заголовку означає кілька моделей на
 * один набір агрегатів — такі рядки в каталозі звичні й дають по застосовності на кожну.
 */
export function parseModelHeader(
  text: string,
  brands: readonly string[],
): { brand: string; models: string[]; yearFrom: number | null; yearTo: number | null } | null {
  const cleaned = text.replace(/continued\s*\.{2,}/i, '').trim();
  if (cleaned === '') return null;

  const { yearFrom, yearTo } = parseHeaderYears(cleaned);
  // Дужки вже віддали роки; решта дужок — уточнення («RUSSIAN TRUCK»), а не частина назви.
  const withoutParens = cleaned
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutParens === '') return null;

  const upper = withoutParens.toUpperCase();
  const brand = brands
    .filter((b) => upper === b.toUpperCase() || upper.startsWith(`${b.toUpperCase()} `))
    .sort((a, b) => b.length - a.length)[0];
  if (brand === undefined) return null;

  const rest = withoutParens.slice(brand.length).trim();
  const models =
    rest === ''
      ? []
      : rest
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean);
  return { brand, models: models.length > 0 ? models : [rest].filter(Boolean), yearFrom, yearTo };
}

/**
 * Рядок під товаром: або перелік номерів, або примітка.
 *
 * Розрізняємо за вмістом: якщо більшість елементів схожі на номери — це крос-номери.
 * Інакше це фраза на кшталт «861286 can replace 860712GB», і записати її як номери означало б
 * завести в каталог сміття, за яким потім щось «знайдеться».
 */
export function parseCrossRefLine(text: string): { numbers: string[]; note: string | null } {
  const noteMatch = /\(([^)]*[a-z]{3}[^)]*)\)\s*$/.exec(text);
  const note = noteMatch ? noteMatch[1]!.trim() : null;
  const body = noteMatch ? text.slice(0, noteMatch.index).trim() : text.trim();
  if (body === '') return { numbers: [], note };

  const parts = body
    .split(',')
    .map((p) =>
      p
        .trim()
        .replace(/\(R\)$/i, '')
        .trim(),
    )
    .filter(Boolean);
  const numbers = parts.filter((p) => LOOKS_LIKE_NUMBER.test(p.toUpperCase()));
  // Рядок, у якому номерів менше половини, — це речення, а не перелік.
  if (parts.length === 0 || numbers.length * 2 < parts.length) {
    return { numbers: [], note: note ?? body };
  }
  return { numbers, note };
}

/** Виробник крос-номера за формою номера; невпізнане лишається як OE. */
export function crossRefBrand(number: string): string {
  const norm = normalizePartNumber(number);
  for (const family of NUMBER_FAMILIES) {
    if (family.test.test(norm)) return family.brand;
  }
  return 'OE';
}

export interface ParsePdfOptions {
  /** Марки техніки, за якими впізнаються заголовки (зазвичай — зі змісту каталогу). */
  brands: readonly string[];
  /** Артикули самого каталогу: їхні варіанти не є чужими крос-номерами. */
  ownBrand: string;
}

/** Сторінки таблиці крос-номерів: на них не шукають застосовність. */
function guidePages(lines: PdfLine[]): Set<number> {
  const pages = new Set<number>();
  for (const line of lines) {
    if (line.items.filter((i) => /^Original$/i.test(i.text.trim())).length >= 2) {
      pages.add(line.page);
    }
  }
  return pages;
}

/** Розбирає рядки каталогу в товари; однакові артикули з різних сторінок зливаються. */
export function parsePdfCatalog(lines: PdfLine[], options: ParsePdfOptions): ParsedPdfCatalog {
  const products = new Map<string, ParsedPdfProduct>();
  const skipped: { page: number; text: string }[] = [];
  const guide = parseCrossReferenceGuide(lines);
  // Рядок таблиці крос-номерів починається з того самого краю, що й назва моделі техніки,
  // і «VOLVO» в ньому — це виробник номера, а не вантажівка. Тому ці сторінки тут пропускаємо.
  const skipPages = guidePages(lines);

  let application: {
    brand: string;
    models: string[];
    yearFrom: number | null;
    yearTo: number | null;
  } | null = null;
  let current: ParsedPdfProduct | null = null;

  for (const line of lines) {
    if (line.text === '' || CHROME.test(line.text) || skipPages.has(line.page)) continue;

    if (line.x < HEADER_X_MAX) {
      const header = parseModelHeader(line.text, options.brands);
      if (header) {
        application = header;
        current = null;
      } else {
        skipped.push({ page: line.page, text: line.text });
      }
      continue;
    }

    const voltageIndex = productVoltageIndex(line);
    if (voltageIndex >= 0) {
      const partNumber = line.items
        .slice(0, voltageIndex)
        .map((i) => i.text.trim())
        .join('')
        .trim();
      const spec = line.items
        .slice(voltageIndex)
        .map((i) => i.text.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      current = addProduct(products, partNumber, spec, line.page, skipped);
      if (current && application) {
        for (const model of application.models) {
          addApplication(current, {
            brand: application.brand,
            model,
            yearFrom: application.yearFrom,
            yearTo: application.yearTo,
          });
        }
      }
      continue;
    }

    // Крос-номери й примітки друкують у колонці артикула. Усе, що починається правіше, —
    // це підписи до колонок («PINION TEETH», «PULLEY INFO»), а не дані товару.
    if (current === null || line.x < PART_NUMBER_X.min || line.x > PART_NUMBER_X.max) {
      skipped.push({ page: line.page, text: line.text });
      continue;
    }

    const { numbers, note } = parseCrossRefLine(line.text);
    if (note) current.notes.push(note);
    for (const number of numbers) {
      addCrossRef(current, number, options.ownBrand);
    }
    if (numbers.length === 0 && note === null) skipped.push({ page: line.page, text: line.text });
  }

  // Мітки з таблиці точні, тож вони перекривають здогад за виглядом номера.
  const authoritative = new Map(guide.map((e) => [normalizePartNumber(e.original), e.brand]));
  for (const product of products.values()) {
    for (const reference of product.crossReferences) {
      const brand = authoritative.get(normalizePartNumber(reference.number));
      if (brand !== undefined) reference.brand = brand;
    }
  }

  let matched = 0;
  for (const entry of guide) {
    const product = products.get(normalizePartNumber(cleanPartNumber(entry.ownNumber)));
    if (!product) continue;
    matched++;
    addCrossRef(product, entry.original, options.ownBrand, entry.brand);
  }

  return { products: [...products.values()], skipped, guide: { entries: guide.length, matched } };
}

/** У макеті поверх артикула трапляється значок новинки — він прилипає до номера. */
export function cleanPartNumber(value: string): string {
  return value.replace(/^(NEW!|NEW\s)/i, '').trim();
}

function addProduct(
  products: Map<string, ParsedPdfProduct>,
  rawPartNumber: string,
  spec: string,
  page: number,
  skipped: { page: number; text: string }[],
): ParsedPdfProduct | null {
  const partNumber = cleanPartNumber(rawPartNumber);
  if (partNumber === '') {
    skipped.push({ page, text: spec });
    return null;
  }

  // Ключ — нормалізований номер: у каталозі та сама позиція трапляється то «AVI147S3208HD»,
  // то «AVi147S3208HD», а для імпорту це один товар, і дубль зривав би йому рядок.
  const key = normalizePartNumber(partNumber);
  const existing = products.get(key);
  if (existing) {
    if (!existing.pages.includes(page)) existing.pages.push(page);
    return existing;
  }

  const parsed = parseSpec(spec);
  if (parsed === null) {
    skipped.push({ page, text: `${partNumber} ${spec}` });
    return null;
  }

  const product: ParsedPdfProduct = {
    partNumber,
    ...parsed,
    crossReferences: [],
    applications: [],
    notes: [],
    pages: [page],
  };
  products.set(key, product);
  return product;
}

type SpecFields = Pick<
  ParsedPdfProduct,
  'kind' | 'voltage' | 'powerKw' | 'amperageA' | 'teeth' | 'specs'
>;

/** Характеристики з колонок праворуч від артикула. */
export function parseSpec(spec: string): SpecFields | null {
  const alternator = ALTERNATOR_RE.exec(spec);
  if (alternator) {
    const [, voltage, amperage, ground, shaft, pulley] = alternator;
    return {
      kind: 'ALTERNATOR',
      voltage: Number(voltage),
      amperageA: Number(amperage!.replace(/\s+/g, '')),
      specs: [
        { key: 'Підключення', value: GROUND_LABEL[ground!] ?? ground! },
        { key: 'Вал', value: shaft! },
        ...(pulley && pulley !== '-' ? [{ key: 'Шків', value: pulley }] : []),
      ],
    };
  }

  const starter = STARTER_RE.exec(spec);
  if (starter) {
    const [, voltage, power, ground, teeth, pinionSize, pinionRest] = starter;
    return {
      kind: 'STARTER',
      voltage: Number(voltage),
      powerKw: Number(power),
      teeth: Number(teeth),
      specs: [
        { key: 'Підключення', value: GROUND_LABEL[ground!] ?? ground! },
        ...(pinionSize && pinionSize !== '-'
          ? [{ key: 'Розмір бендикса', value: pinionSize }]
          : []),
        ...(pinionRest && pinionRest !== '-' ? [{ key: 'Виліт бендикса', value: pinionRest }] : []),
      ],
    };
  }

  return null;
}

function addApplication(product: ParsedPdfProduct, application: ParsedApplication): void {
  const exists = product.applications.some(
    (a) => a.brand === application.brand && a.model === application.model,
  );
  if (!exists) product.applications.push(application);
}

function addCrossRef(
  product: ParsedPdfProduct,
  number: string,
  ownBrand: string,
  knownBrand?: string,
): void {
  const norm = normalizePartNumber(number);
  // Номер самого товару в його ж крос-номерах нічого не додає.
  if (norm.length < 3 || norm === normalizePartNumber(product.partNumber)) return;
  const guessed = crossRefBrand(number);
  const brand =
    knownBrand ??
    (guessed === 'OE' && isOwnVariant(number, product.partNumber)
      ? ownBrand.toUpperCase()
      : guessed);
  if (product.crossReferences.some((x) => normalizePartNumber(x.number) === norm)) return;
  product.crossReferences.push({ brand, number });
}

/** `859022Z` поруч із `859022` — це варіант того самого каталогу, а не чужий номер. */
function isOwnVariant(number: string, partNumber: string): boolean {
  const norm = normalizePartNumber(number);
  const own = normalizePartNumber(partNumber);
  return norm.startsWith(own) || own.startsWith(norm);
}

/** Пара з таблиці крос-номерів: чий номер, який саме, і на що він міняється. */
export interface GuideEntry {
  brand: string;
  original: string;
  ownNumber: string;
}

/** Ширина стовпчика «Original → Prestolite» у пунктах — за нею шукається пара до заголовка. */
const GUIDE_COLUMN_TOLERANCE = 8;

/** Заголовок виробника в таблиці: великі літери, без схожості на артикул. */
const GUIDE_BRAND = /^[A-Z][A-Z0-9 &.\-/]{2,29}$/;

/**
 * Таблиця крос-номерів у кінці каталогу: `Original | Prestolite` у чотири пари стовпчиків,
 * розбита підзаголовками з назвою виробника.
 *
 * Навіщо окремо від сторінок застосовності. Там номери йдуть суцільним списком, і чий номер —
 * доводиться вгадувати за виглядом. Тут виробник написаний прямо, тому ці мітки точні: саме вони
 * потім перекривають здогад.
 *
 * Таблиця читається по стовпчиках згори вниз, як її і верстали: підзаголовок діє на все, що
 * йде за ним у цьому порядку, зокрема й у наступних стовпчиках.
 */
export function parseCrossReferenceGuide(lines: PdfLine[]): GuideEntry[] {
  const entries: GuideEntry[] = [];
  const byPage = new Map<number, PdfLine[]>();
  for (const line of lines) {
    const bucket = byPage.get(line.page);
    if (bucket) bucket.push(line);
    else byPage.set(line.page, [line]);
  }

  let brand: string | null = null;
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLines = byPage.get(page)!;
    const header = pageLines.find(
      (l) => l.items.filter((i) => /^Original$/i.test(i.text.trim())).length >= 2,
    );
    // Сторінка без шапки таблиці — це не крос-номери (обкладинка, контакти, застосовність).
    if (!header) continue;

    const rows = pageLines.filter((l) => l !== header && l.y < header.y && !CHROME.test(l.text));
    // Краї стовпчиків беремо з самих даних: підписи в шапці зміщені відносно клітинок,
    // і рівняння по них лишає половину таблиці нерозібраною.
    const anchors = columnAnchors(rows);
    if (anchors.length < 2 || anchors.length % 2 !== 0) continue;

    for (let pair = 0; pair < anchors.length; pair += 2) {
      for (const row of rows) {
        const original = cellAt(row, anchors[pair]!);
        const own = cellAt(row, anchors[pair + 1]!);
        if (original === null) continue;
        if (own === null) {
          if (GUIDE_BRAND.test(original) && !/\d/.test(original)) brand = original;
          continue;
        }
        if (brand === null) continue;
        entries.push({ brand, original, ownNumber: own });
      }
    }
  }
  return entries;
}

/** Краї стовпчиків: позиції X, на яких стоїть помітна частина клітинок сторінки. */
function columnAnchors(rows: PdfLine[]): number[] {
  const xs = rows.flatMap((r) => r.items.map((i) => i.x)).sort((a, b) => a - b);
  const clusters: { x: number; count: number }[] = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.x <= GUIDE_COLUMN_TOLERANCE) last.count++;
    else clusters.push({ x, count: 1 });
  }
  // Стовпчик заповнений на всю висоту сторінки; поодинокі позиції — це зноска або номер
  // сторінки. Поріг рахуємо від кількості рядків, щоб він не залежав від густини верстки.
  const threshold = Math.max(2, Math.round(rows.length * 0.2));
  return clusters.filter((c) => c.count >= threshold).map((c) => c.x);
}

function cellAt(line: PdfLine, x: number): string | null {
  const item = line.items.find((i) => Math.abs(i.x - x) <= GUIDE_COLUMN_TOLERANCE);
  const text = item?.text.trim();
  return text === undefined || text === '' ? null : text;
}

/**
 * Марки техніки зі змісту каталогу: рядки виду `Mercedes-Benz ......... 20`.
 * Беремо їх із документа, а не зі сталого переліку, щоб той самий розбір працював
 * і для каталогу з іншим набором марок.
 */
export function parseBrandsFromContents(lines: PdfLine[]): string[] {
  const brands = new Set<string>();
  for (const line of lines) {
    const match = /^(.+?)\s*\.{4,}\s*\d{1,3}$/.exec(line.text);
    if (!match) continue;
    const name = match[1]!.replace(/\(.*?\)/g, '').trim();
    if (name === '' || name.length > 30) continue;
    for (const part of name.split('/')) {
      const trimmed = part.trim();
      if (trimmed.length >= 2) brands.add(trimmed);
    }
  }
  return [...brands];
}
