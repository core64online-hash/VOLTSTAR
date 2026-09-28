/**
 * Каталог застосовності у PDF → CSV для `catalog:import`.
 *
 *   pnpm --filter @voltstar/api catalog:pdf-to-csv ./PP4039.pdf --brand Prestolite
 *   pnpm --filter @voltstar/api catalog:pdf-to-csv ./PP4039.pdf --brand Prestolite --out ./prestolite.csv
 *
 * Навмисно у два кроки, а не одразу в базу. Розбір PDF — це здогад по макету: у каталозі
 * трапляються примітки серед номерів, зноски й моделі, записані не так, як усюди. Проміжний
 * CSV можна прочитати, виправити руками й лише тоді заливати — на вітрині помилка коштує
 * дорожче, ніж зайва команда.
 *
 * Цін у таких каталогах немає — колонок із цінами у файлі теж. Імпорт не чіпає те, чого немає
 * в заголовку, тож ціни, заведені раніше, лишаються на місці.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { MachineSegment, XREF_PREFIX, FITS_PREFIX, SPEC_PREFIX } from '@voltstar/types';
import {
  groupLines,
  parseBrandsFromContents,
  parsePdfCatalog,
  type ParsedPdfProduct,
  type PdfTextItem,
} from './pdf-catalog';

const USAGE =
  'Використання: catalog:pdf-to-csv <файл.pdf> --brand <виробник> [--out <файл.csv>] [--segment TRUCK]';

/** Назва товару українською: те, що клієнт побачить у списку. */
const KIND_LABEL = { STARTER: 'Стартер', ALTERNATOR: 'Генератор' } as const;
const KIND_CATEGORY = { STARTER: 'Стартери', ALTERNATOR: 'Генератори' } as const;

function arg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Текст зі сторінок PDF із координатами кожного слова. */
async function readPdfItems(path: string): Promise<PdfTextItem[]> {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
  const items: PdfTextItem[] = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      items.push({ page, x: item.transform[4], y: item.transform[5], text: item.str });
    }
  }
  return items;
}

/** Клітинка CSV: лапки лише там, де без них файл зламається. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(products: ParsedPdfProduct[], brand: string, segment: string): string {
  const xrefBrands = [
    ...new Set(products.flatMap((p) => p.crossReferences.map((x) => x.brand))),
  ].sort();
  const specKeys = [...new Set(products.flatMap((p) => p.specs.map((s) => s.key)))].sort();

  const columns = [
    'partNumber',
    'name',
    'brand',
    'category',
    'kind',
    'condition',
    'voltage',
    'powerKw',
    'amperageA',
    'teeth',
    'description',
    ...xrefBrands.map((b) => `${XREF_PREFIX}${b}`),
    `${FITS_PREFIX}${segment}`,
    ...specKeys.map((k) => `${SPEC_PREFIX}${k}`),
  ];

  const rows = products.map((product) => {
    const label = KIND_LABEL[product.kind];
    const power = product.kind === 'STARTER' ? `${product.powerKw} кВт` : `${product.amperageA} A`;
    const values: Record<string, string> = {
      partNumber: product.partNumber,
      name: `${label} ${brand} ${product.partNumber} ${product.voltage}V ${power}`,
      brand,
      category: KIND_CATEGORY[product.kind],
      kind: product.kind,
      condition: 'NEW',
      voltage: String(product.voltage),
      powerKw: product.powerKw === undefined ? '' : String(product.powerKw),
      amperageA: product.amperageA === undefined ? '' : String(product.amperageA),
      teeth: product.teeth === undefined ? '' : String(product.teeth),
      description: product.notes.join('. '),
      [`${FITS_PREFIX}${segment}`]: product.applications
        .map((a) => {
          // Формат імпорту — «Марка|Модель|Двигун|Роки». Двигун у каталогах застосовності не
          // вказують, тож поле лишається порожнім, а не вигаданим: інакше роки з'їхали б у нього.
          if (a.yearFrom === null && a.yearTo === null) return `${a.brand}|${a.model}`;
          return `${a.brand}|${a.model}||${a.yearFrom ?? ''}-${a.yearTo ?? ''}`;
        })
        .join('; '),
    };
    for (const b of xrefBrands) {
      values[`${XREF_PREFIX}${b}`] = product.crossReferences
        .filter((x) => x.brand === b)
        .map((x) => x.number)
        .join('; ');
    }
    for (const key of specKeys) {
      values[`${SPEC_PREFIX}${key}`] = product.specs.find((s) => s.key === key)?.value ?? '';
    }
    return columns.map((c) => cell(values[c] ?? '')).join(',');
  });

  return [columns.map(cell).join(','), ...rows].join('\n') + '\n';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = args[0]?.startsWith('--') ? undefined : args[0];
  const brand = arg(args, '--brand');
  if (source === undefined || brand === undefined) {
    console.error(USAGE);
    process.exit(2);
  }

  const segment = (arg(args, '--segment') ?? 'TRUCK').toUpperCase();
  if (!(segment in MachineSegment)) {
    console.error(
      `Невідома група техніки «${segment}» — очікується одна з: ${Object.values(MachineSegment).join(', ')}`,
    );
    process.exit(2);
  }

  const path = resolve(process.cwd(), source);
  if (!existsSync(path)) {
    console.error(`Файл не знайдено: ${path}`);
    process.exit(2);
  }

  const lines = groupLines(await readPdfItems(path));
  const brands = parseBrandsFromContents(lines);
  if (brands.length === 0) {
    console.error(
      'У документі не знайдено змісту з марками техніки — за таким каталогом застосовність не побудувати.',
    );
    process.exit(1);
  }

  const { products, skipped, guide } = parsePdfCatalog(lines, { brands, ownBrand: brand });

  const out = resolve(
    process.cwd(),
    arg(args, '--out') ?? basename(path).replace(/\.pdf$/i, '') + '.csv',
  );
  writeFileSync(out, toCsv(products, brand, segment), 'utf8');

  const xrefs = products.reduce((n, p) => n + p.crossReferences.length, 0);
  const applications = products.reduce((n, p) => n + p.applications.length, 0);
  console.log(`Марок техніки у змісті: ${brands.length}`);
  console.log(
    `Товарів: ${products.length}, крос-номерів: ${xrefs}, застосовностей: ${applications}`,
  );
  console.log(
    `Таблиця крос-номерів: ${guide.entries} пар, із них лягло на товари каталогу — ${guide.matched}`,
  );
  console.log(`Файл: ${out}`);
  if (skipped.length > 0) {
    console.log(`\nНе розібрано рядків: ${skipped.length} — перегляньте їх очима:`);
    for (const line of skipped.slice(0, 20)) console.log(`  с. ${line.page}: ${line.text}`);
    if (skipped.length > 20) console.log(`  … і ще ${skipped.length - 20}`);
  }
  console.log('\nДалі: перевірте CSV і залийте — catalog:import <файл.csv> --dry-run');
}

main().catch((e) => {
  console.error('❌', (e as Error).message);
  process.exit(1);
});
