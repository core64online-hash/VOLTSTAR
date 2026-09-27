import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import {
  hasColumn,
  hasSpecColumns,
  parseApplications,
  parseCrossReferences,
  parseSpecs,
  prepareRows,
  slugify,
  toMinor,
} from './catalog-import';

const HEADER = 'partNumber,name,brand,category,kind,condition';
const ROW = '0001368088,Стартер Bosch 24V,Bosch,Стартери,STARTER,REMANUFACTURED';
const prepare = (csv: string) => prepareRows(parseCsv(csv));

describe('slugify', () => {
  it('латиниця лишається, пробіли стають дефісами', () => {
    expect(slugify('Bosch 0001368088')).toBe('bosch-0001368088');
    expect(slugify('  John   Deere  ')).toBe('john-deere');
  });

  it('транслітерація КМУ: є/ї/й/ю/я на початку слова інакші, ніж усередині', () => {
    expect(slugify('Стартери важкої техніки')).toBe('startery-vazhkoi-tekhniky');
    expect(slugify('Ялта')).toBe('yalta');
    expect(slugify('Мая')).toBe('maia');
    expect(slugify('Їжак')).toBe('yizhak');
    expect(slugify('Щит')).toBe('shchyt');
  });

  it('мʼякий знак зникає, не розриваючи слово', () => {
    expect(slugify('Дизельні')).toBe('dyzelni');
  });

  it('апострофи зникають, а не стають дефісом', () => {
    expect(slugify('Обʼєм')).toBe('obiem');
    expect(slugify("В'ячеслав")).toBe('viacheslav');
  });

  it('розділові знаки схлопуються в один дефіс, по краях їх немає', () => {
    expect(slugify('Стартери (24 В), 6–8 кВт!')).toBe('startery-24-v-6-8-kvt');
  });
});

describe('toMinor', () => {
  it('гривні в копійки без похибки float', () => {
    expect(toMinor(18990)).toBe(1899000);
    expect(toMinor(18990.99)).toBe(1899099);
    expect(toMinor(0)).toBe(0);
  });
});

describe('parseSpecs', () => {
  it('бере лише колонки spec: і пропускає порожні', () => {
    expect(
      parseSpecs({
        partNumber: 'a',
        'spec:Тип кріплення, отворів': '3',
        'spec:Шків': '',
        'spec: Вага ': '48',
      }),
    ).toEqual([
      { key: 'Тип кріплення, отворів', value: '3' },
      { key: 'Вага', value: '48' },
    ]);
  });
});

describe('parseCrossReferences', () => {
  it('бренд із назви колонки, кілька номерів через «;»', () => {
    expect(
      parseCrossReferences({ 'xref:BOSCH': '0 001 368 088; 0001368089', 'xref:iskra': 'AZJ3151' }),
    ).toEqual([
      { brand: 'BOSCH', number: '0 001 368 088', numberNorm: '0001368088' },
      { brand: 'BOSCH', number: '0001368089', numberNorm: '0001368089' },
      { brand: 'ISKRA', number: 'AZJ3151', numberNorm: 'AZJ3151' },
    ]);
  });

  it('той самий номер у різних написаннях не дублюється', () => {
    const out = parseCrossReferences({ 'xref:BOSCH': '0-001-368-088; 0001368088' });
    expect(out).toHaveLength(1);
  });

  it('сміття замість номера пропускається', () => {
    expect(parseCrossReferences({ 'xref:BOSCH': '—; AB' })).toEqual([]);
  });
});

describe('parseApplications', () => {
  it('марка, модель, двигун і роки', () => {
    const { applications, errors } = parseApplications({
      'fits:TRUCK': 'МАЗ|5440|ЯМЗ-238|2005-2015; КрАЗ|6322',
      'fits:AGRICULTURAL': 'John Deere|8400||2010-',
    });
    expect(errors).toEqual([]);
    expect(applications).toEqual([
      {
        segment: 'TRUCK',
        machineBrand: 'МАЗ',
        machineBrandSlug: 'maz',
        machineModel: '5440',
        machineModelSlug: 'maz-5440',
        engine: 'ЯМЗ-238',
        yearFrom: 2005,
        yearTo: 2015,
      },
      {
        segment: 'TRUCK',
        machineBrand: 'КрАЗ',
        machineBrandSlug: 'kraz',
        machineModel: '6322',
        machineModelSlug: 'kraz-6322',
        engine: null,
        yearFrom: null,
        yearTo: null,
      },
      {
        segment: 'AGRICULTURAL',
        machineBrand: 'John Deere',
        machineBrandSlug: 'john-deere',
        machineModel: '8400',
        machineModelSlug: 'john-deere-8400',
        engine: null,
        yearFrom: 2010,
        yearTo: null,
      },
    ]);
  });

  it('невідома група техніки — помилка з переліком допустимих', () => {
    const { errors } = parseApplications({ 'fits:BOATS': 'МАЗ|5440' });
    expect(errors[0]).toContain('TRUCK');
  });

  it('запис без моделі й криві роки — помилки', () => {
    expect(parseApplications({ 'fits:TRUCK': 'МАЗ' }).errors[0]).toContain('Марка|Модель');
    expect(parseApplications({ 'fits:TRUCK': 'МАЗ|5440||давно' }).errors[0]).toContain('2005-2015');
  });

  it('той самий двигун на тій самій моделі не дублюється', () => {
    const { applications } = parseApplications({
      'fits:TRUCK': 'МАЗ|5440|ЯМЗ-238; МАЗ|5440|ЯМЗ-238',
    });
    expect(applications).toHaveLength(1);
  });
});

describe('prepareRows', () => {
  it('готує товар і виводить адресу з бренду й артикула', () => {
    const { products, errors } = prepare(`${HEADER}\n${ROW}\n`);
    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      line: 2,
      slug: 'bosch-0001368088',
      partNumberNorm: '0001368088',
      brandSlug: 'bosch',
      categorySlug: 'startery',
    });
  });

  it('артикул із роздільниками шукається у нормалізованій формі', () => {
    const row = '0 001 368 088,Стартер,Bosch,Стартери,STARTER,NEW';
    const { products } = prepare(`${HEADER}\n${row}\n`);
    expect(products[0].partNumberNorm).toBe('0001368088');
    expect(products[0].slug).toBe('bosch-0-001-368-088');
  });

  it('стан за замовчуванням — новий', () => {
    const { products } = prepare(
      `partNumber,name,brand,category,kind\n0001368088,Стартер,Bosch,Стартери,STARTER\n`,
    );
    expect(products[0].row.condition).toBe('NEW');
  });

  it('явні slug, brandSlug і categorySlug мають пріоритет над транслітерацією', () => {
    const { products } = prepare(
      `${HEADER},slug,brandSlug,categorySlug\n${ROW},bosch-st-24,bosch-auto,starters\n`,
    );
    expect(products[0]).toMatchObject({
      slug: 'bosch-st-24',
      brandSlug: 'bosch-auto',
      categorySlug: 'starters',
    });
  });

  it('ціни в гривнях з комою й пробілами, ПДВ, залишок і застава', () => {
    const { products, errors } = prepare(
      `${HEADER},priceB2C,priceB2B,vatRate,stock,coreDeposit\n${ROW},"14 500,50","13 200",0.2,7,3000\n`,
    );
    expect(errors).toEqual([]);
    expect(products[0].row).toMatchObject({
      priceB2C: 14500.5,
      priceB2B: 13200,
      vatRate: 0.2,
      stock: 7,
      coreDeposit: 3000,
    });
  });

  it('технічні характеристики агрегата', () => {
    const { products, errors } = prepare(
      `${HEADER},voltage,powerKw,teeth,rotation\n${ROW},24,"6,6",11,CW\n`,
    );
    expect(errors).toEqual([]);
    expect(products[0].row).toMatchObject({ voltage: 24, powerKw: 6.6, teeth: 11, rotation: 'CW' });
  });

  it('порожня клітинка — це «не задано», а не нуль', () => {
    const { products } = prepare(`${HEADER},priceB2C,stock,voltage\n${ROW},,,\n`);
    expect(products[0].row.priceB2C).toBeUndefined();
    expect(products[0].row.stock).toBeUndefined();
    expect(products[0].row.voltage).toBeUndefined();
  });

  it('невідомий тип агрегата — помилка з назвою поля', () => {
    const bad = '0001368088,Стартер,Bosch,Стартери,ТУРБІНА,NEW';
    const { products, errors } = prepare(`${HEADER}\n${bad}\n`);
    expect(products).toEqual([]);
    expect(errors[0]).toMatchObject({ line: 2, partNumber: '0001368088' });
    expect(errors[0].messages.join(' ')).toMatch(/kind/);
  });

  it('надто короткий артикул не проходить', () => {
    const bad = '12,Стартер,Bosch,Стартери,STARTER,NEW';
    expect(prepare(`${HEADER}\n${bad}\n`).errors[0].messages.join(' ')).toMatch(/partNumber/);
  });

  it('javascript: у зображеннях не проходить', () => {
    const { errors } = prepare(`${HEADER},images\n${ROW},javascript:alert(1)\n`);
    expect(errors[0].messages.join(' ')).toMatch(/images/);
  });

  it('битий рядок не зриває решту файлу', () => {
    const bad = '0001368099,Стартер,Bosch,Стартери,ТУРБІНА,NEW';
    const { products, errors } = prepare(`${HEADER}\n${bad}\n${ROW}\n`);
    expect(products).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(products[0].row.partNumber).toBe('0001368088');
  });

  it('дубль артикула у файлі — помилка з посиланням на перший рядок', () => {
    const { products, errors } = prepare(`${HEADER}\n${ROW}\n${ROW}\n`);
    expect(products).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 3, partNumber: '0001368088' });
    expect(errors[0].messages[0]).toContain('рядку 2');
  });

  it('той самий артикул іншим написанням — теж дубль', () => {
    const other = '0-001-368-088,Стартер,Bosch,Стартери,STARTER,NEW';
    const { products, errors } = prepare(`${HEADER}\n${ROW}\n${other}\n`);
    expect(products).toHaveLength(1);
    expect(errors[0].messages[0]).toContain('Дубль артикула');
  });

  it('дві адреси однакові — просимо розвести їх явно', () => {
    const a = '0001368088,Стартер,Bosch,Стартери,STARTER,NEW,bosch-st';
    const b = '0001368099,Стартер,Bosch,Стартери,STARTER,NEW,bosch-st';
    const { products, errors } = prepare(`${HEADER},slug\n${a}\n${b}\n`);
    expect(products).toHaveLength(1);
    expect(errors[0].messages[0]).toContain('bosch-st');
  });

  it('із назви, де немає літер, машинну назву не зробити — просимо явну колонку', () => {
    const bad = '0001368088,Стартер,«»,Стартери,STARTER,NEW';
    const { errors } = prepare(`${HEADER}\n${bad}\n`);
    expect(errors[0].messages.join(' ')).toContain('brandSlug');
  });

  it('помилка в fits: не пропускає товар мовчки', () => {
    const { products, errors } = prepare(`${HEADER},fits:TRUCK\n${ROW},МАЗ\n`);
    expect(products).toEqual([]);
    expect(errors[0].messages[0]).toContain('Марка|Модель');
  });

  it('склад колонок заголовка видно окремо від порожніх клітинок', () => {
    const withStock = prepare(`${HEADER},stock\n${ROW},\n`);
    expect(hasColumn(withStock.columns, 'stock')).toBe(true);
    expect(hasSpecColumns(withStock.columns)).toBe(false);

    const withSpec = prepare(`${HEADER},spec:Шків\n${ROW},клиновий\n`);
    expect(hasColumn(withSpec.columns, 'stock')).toBe(false);
    expect(hasSpecColumns(withSpec.columns)).toBe(true);
    expect(withSpec.products[0].specs).toEqual([{ key: 'Шків', value: 'клиновий' }]);
  });

  it('крос-номери й техніка потрапляють у підготовлений товар', () => {
    const { products } = prepare(
      `${HEADER},xref:BOSCH,fits:TRUCK\n${ROW},0 001 368 088,МАЗ|5440|ЯМЗ-238\n`,
    );
    expect(products[0].crossReferences).toEqual([
      { brand: 'BOSCH', number: '0 001 368 088', numberNorm: '0001368088' },
    ]);
    expect(products[0].applications[0]).toMatchObject({ machineModelSlug: 'maz-5440' });
  });

  it('порожній файл — ні товарів, ні помилок', () => {
    expect(prepare('')).toMatchObject({ products: [], errors: [] });
  });
});
