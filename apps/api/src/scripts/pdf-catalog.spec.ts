import { describe, expect, it } from 'vitest';
import {
  cleanPartNumber,
  groupLines,
  parseBrandsFromContents,
  parseCrossRefLine,
  parseCrossReferenceGuide,
  parseHeaderYears,
  parseModelHeader,
  parsePdfCatalog,
  parseSpec,
  type PdfTextItem,
} from './pdf-catalog';

const BRANDS = ['DAF', 'Mercedes-Benz', 'Kamaz', 'Volvo'];

/** Слова одного рядка макета: `на(x)` задає початок кожного фрагмента. */
const line = (page: number, y: number, cells: [number, string][]): PdfTextItem[] =>
  cells.map(([x, text]) => ({ page, x, y, text }));

describe('groupLines', () => {
  it('слова на одній висоті стають одним рядком, порядок — зліва направо', () => {
    const lines = groupLines([
      { page: 1, x: 236, y: 400, text: '24V' },
      { page: 1, x: 150, y: 400.4, text: '860815' },
      { page: 1, x: 150, y: 380, text: 'AELD074' },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['860815 24V', 'AELD074']);
    expect(lines[0]!.x).toBe(150);
  });

  it('рядки різних сторінок не змішуються, навіть коли лежать на тій самій висоті', () => {
    const lines = groupLines([
      { page: 2, x: 150, y: 400, text: 'B' },
      { page: 1, x: 150, y: 400, text: 'A' },
    ]);
    expect(lines.map((l) => [l.page, l.text])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
  });
});

describe('parseHeaderYears', () => {
  it('«<< 2001» — до року, «2001 >>» — від року, діапазон — обидва', () => {
    expect(parseHeaderYears('DAF 45 (<< 2001)')).toEqual({ yearFrom: null, yearTo: 2001 });
    expect(parseHeaderYears('DAF LF45 (2001 >>)')).toEqual({ yearFrom: 2001, yearTo: null });
    expect(parseHeaderYears('MAN TGA (2000-2008)')).toEqual({ yearFrom: 2000, yearTo: 2008 });
    expect(parseHeaderYears('VOLVO FH')).toEqual({ yearFrom: null, yearTo: null });
  });
});

describe('parseModelHeader', () => {
  it('марка з двох слів не ріжеться по пробілу', () => {
    expect(parseModelHeader('Mercedes-Benz Actros MP4 (2011 >>)', BRANDS)).toEqual({
      brand: 'Mercedes-Benz',
      models: ['Actros MP4'],
      yearFrom: 2011,
      yearTo: null,
    });
  });

  it('кома в заголовку означає кілька моделей на той самий агрегат', () => {
    const header = parseModelHeader('KAMAZ 4308, 5308, 43225 (RUSSIAN TRUCK)', BRANDS);
    expect(header?.models).toEqual(['4308', '5308', '43225']);
    // Дужки без років — це уточнення, а не частина назви моделі.
    expect(header?.models.join()).not.toContain('RUSSIAN');
  });

  it('«continued…» на перенесеній сторінці не стає частиною назви', () => {
    expect(parseModelHeader('DAF 55 (<< 2001)   continued...', BRANDS)?.models).toEqual(['55']);
  });

  it('рядок із невідомою маркою не вважається заголовком', () => {
    expect(parseModelHeader('0001368088, 0986017520', BRANDS)).toBeNull();
  });
});

describe('parseSpec', () => {
  it('генератор: струм, спосіб підключення, вал і шків', () => {
    expect(parseSpec('24V 110A G 17mm 8pK, 60mm')).toEqual({
      kind: 'ALTERNATOR',
      voltage: 24,
      amperageA: 110,
      specs: [
        { key: 'Підключення', value: 'маса на корпус' },
        { key: 'Вал', value: '17mm' },
        { key: 'Шків', value: '8pK, 60mm' },
      ],
    });
  });

  it('пробіли в середині струму — це кернінг верстки, а не інше число', () => {
    expect(parseSpec('24V 10 0 A G 17mm 2V, 72mm')?.amperageA).toBe(100);
  });

  it('ER — теж маса на корпус, а не невідомий код', () => {
    expect(parseSpec('24V 100A ER 7/8” -')?.specs[0]).toEqual({
      key: 'Підключення',
      value: 'маса на корпус',
    });
  });

  it('стартер: потужність і зуби бендикса', () => {
    const spec = parseSpec('24V 4.0kW IR 10t 40 28');
    expect(spec).toMatchObject({ kind: 'STARTER', voltage: 24, powerKw: 4, teeth: 10 });
    expect(spec?.specs).toContainEqual({ key: 'Підключення', value: 'ізольований' });
    expect(spec?.specs).toContainEqual({ key: 'Виліт бендикса', value: '28' });
  });

  it('прочерк у колонці означає «не вказано», а не значення «-»', () => {
    expect(parseSpec('24V 55A G 17mm -')?.specs.map((s) => s.key)).toEqual(['Підключення', 'Вал']);
  });

  it('рядок не з таблиці характеристик не розбирається', () => {
    expect(parseSpec('AELD074, 1387388')).toBeNull();
  });
});

describe('parseCrossRefLine', () => {
  it('перелік номерів розбирається, суфікс відновлення (R) відкидається', () => {
    expect(parseCrossRefLine('1201327(R), AELB426(R), AELB737')).toEqual({
      numbers: ['1201327', 'AELB426', 'AELB737'],
      note: null,
    });
  });

  it('уточнення в дужках лишається приміткою, а не номером', () => {
    expect(parseCrossRefLine('3283721, AELD190 (Cummins engine)')).toEqual({
      numbers: ['3283721', 'AELD190'],
      note: 'Cummins engine',
    });
  });

  it('речення не перетворюється на номери — інакше в каталог потрапило б сміття', () => {
    expect(parseCrossRefLine('861286 can replace 860712GB')).toEqual({
      numbers: [],
      note: '861286 can replace 860712GB',
    });
  });
});

describe('cleanPartNumber', () => {
  it('значок новинки прилипає до артикула у верстці — прибираємо', () => {
    expect(cleanPartNumber('NEW!861346')).toBe('861346');
    expect(cleanPartNumber('861346')).toBe('861346');
  });
});

describe('parseBrandsFromContents', () => {
  it('марки беруться зі змісту каталогу, а не зі сталого переліку', () => {
    const lines = groupLines([
      ...line(3, 700, [[30, 'DAF ............ 2']]),
      ...line(3, 690, [[30, 'Valday / Gazelle ....... 37']]),
      ...line(3, 680, [[30, 'GAZ (See Valday / Gazelle) ........... 37']]),
    ]);
    expect(parseBrandsFromContents(lines)).toEqual(['DAF', 'Valday', 'Gazelle', 'GAZ']);
  });
});

describe('parseCrossReferenceGuide', () => {
  const guideLines = groupLines([
    ...line(50, 757, [
      [30, 'Original'],
      [104, 'Prestolite'],
      [161, 'Original'],
      [235, 'Prestolite'],
    ]),
    ...line(50, 737, [
      [28, 'BOSCH'],
      [159, '0124555016'],
      [224, '860807GB'],
    ]),
    ...line(50, 725, [
      [28, '0120488252'],
      [93, '860141'],
      [159, '0124655016'],
      [224, '860807GB'],
    ]),
    ...line(50, 713, [
      [28, '0120488253'],
      [93, '860141'],
    ]),
  ]);

  it('підзаголовок дає виробника номерів, зокрема й у наступних стовпчиках', () => {
    expect(parseCrossReferenceGuide(guideLines)).toEqual([
      { brand: 'BOSCH', original: '0120488252', ownNumber: '860141' },
      { brand: 'BOSCH', original: '0120488253', ownNumber: '860141' },
      { brand: 'BOSCH', original: '0124555016', ownNumber: '860807GB' },
      { brand: 'BOSCH', original: '0124655016', ownNumber: '860807GB' },
    ]);
  });

  it('сторінка без шапки таблиці не розбирається як крос-номери', () => {
    const contacts = groupLines(line(88, 700, [[28, 'ACCOUNTS DEPARTMENT']]));
    expect(parseCrossReferenceGuide(contacts)).toEqual([]);
  });
});

describe('parsePdfCatalog', () => {
  const options = { brands: BRANDS, ownBrand: 'Prestolite' };

  it('у рядку стартера напруга злита з потужністю — це все одно товар, а не примітка', () => {
    const lines = groupLines([
      ...line(4, 724, [[28, 'DAF LF45 (2001 >>)']]),
      ...line(4, 418, [
        [150, '860815'],
        [236, '24V 4.0kW'],
        [289, 'G'],
        [309, '10t'],
        [338, '40'],
        [367, '28'],
      ]),
    ]);
    const { products } = parsePdfCatalog(lines, options);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ partNumber: '860815', kind: 'STARTER', powerKw: 4 });
    expect(products[0]!.notes).toEqual([]);
  });

  it('підписи до колонок стоять правіше артикула й не стають примітками товару', () => {
    const lines = groupLines([
      ...line(4, 724, [[28, 'DAF LF45 (2001 >>)']]),
      ...line(4, 418, [
        [150, '860806GB'],
        [236, '24V'],
        [262, '110A'],
        [289, 'G'],
        [302, '17mm'],
      ]),
      ...line(4, 380, [[305, 'PINION']]),
      ...line(4, 370, [[150, 'AELD074, 1387388']]),
    ]);
    const { products, skipped } = parsePdfCatalog(lines, options);
    expect(products[0]!.notes).toEqual([]);
    expect(products[0]!.crossReferences.map((x) => x.number)).toEqual(['AELD074', '1387388']);
    expect(skipped.map((s) => s.text)).toEqual(['PINION']);
  });

  it('той самий артикул під різною технікою — один товар із двома застосовностями', () => {
    const lines = groupLines([
      ...line(4, 724, [[28, 'DAF LF45 (2001 >>)']]),
      ...line(4, 700, [
        [150, '860815'],
        [236, '24V 4.0kW'],
        [289, 'G'],
        [309, '10t'],
      ]),
      ...line(5, 724, [[28, 'DAF CF65 (2001 >>)']]),
      ...line(5, 700, [
        [150, '860815'],
        [236, '24V 4.0kW'],
        [289, 'G'],
        [309, '10t'],
      ]),
    ]);
    const { products } = parsePdfCatalog(lines, options);
    expect(products).toHaveLength(1);
    expect(products[0]!.applications.map((a) => a.model)).toEqual(['LF45', 'CF65']);
    expect(products[0]!.pages).toEqual([4, 5]);
  });

  it('той самий номер у різному написанні — один товар, а не дубль для імпорту', () => {
    const lines = groupLines([
      ...line(4, 724, [[28, 'DAF LF45 (2001 >>)']]),
      ...line(4, 700, [
        [150, 'AVI147S3208HD'],
        [236, '24V'],
        [262, '150A'],
        [289, 'IR'],
        [302, '17mm'],
      ]),
      ...line(4, 650, [
        [150, 'AVi147S3208HD'],
        [236, '24V'],
        [262, '150A'],
        [289, 'IR'],
        [302, '17mm'],
      ]),
    ]);
    expect(parsePdfCatalog(lines, options).products).toHaveLength(1);
  });

  it('виробник із таблиці крос-номерів перекриває здогад за виглядом номера', () => {
    const lines = groupLines([
      ...line(4, 724, [[28, 'DAF LF45 (2001 >>)']]),
      ...line(4, 700, [
        [150, '860141'],
        [236, '24V'],
        [262, '55A'],
        [289, 'G'],
        [302, '17mm'],
      ]),
      ...line(4, 690, [[150, '0120488252']]),
      ...line(50, 757, [
        [30, 'Original'],
        [104, 'Prestolite'],
        [161, 'Original'],
        [235, 'Prestolite'],
      ]),
      ...line(50, 737, [[28, 'DELCO REMY']]),
      ...line(50, 725, [
        [28, '0120488252'],
        [93, '860141'],
      ]),
      // Другий рядок пари потрібен, щоб стовпчик було видно як стовпчик, а не як зноску.
      ...line(50, 713, [
        [28, '0120488253'],
        [93, '861999'],
      ]),
    ]);
    const { products, guide } = parsePdfCatalog(lines, options);
    expect(guide).toEqual({ entries: 2, matched: 1 });
    expect(products[0]!.crossReferences).toEqual([{ brand: 'DELCO REMY', number: '0120488252' }]);
  });
});
