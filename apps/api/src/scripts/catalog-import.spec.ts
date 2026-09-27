import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import {
  hasColumn,
  hasSpecColumns,
  parseSpecs,
  prepareRows,
  slugify,
  toMinor,
} from './catalog-import';

const HEADER = 'slug,name,brand,category,fuel,phase,ratedPowerW,maxPowerW';
const ROW = 'honda-eu22i,Honda EU22i,Honda,Інверторні генератори,PETROL,SINGLE,1800,2200';
const prepare = (csv: string) => prepareRows(parseCsv(csv));

describe('slugify', () => {
  it('латиниця лишається, пробіли стають дефісами', () => {
    expect(slugify('Generac GP3300')).toBe('generac-gp3300');
    expect(slugify('  Honda   EU22i  ')).toBe('honda-eu22i');
  });

  it('транслітерація КМУ: є/ї/й/ю/я на початку слова інакші, ніж усередині', () => {
    expect(slugify('Резервні генератори')).toBe('rezervni-heneratory');
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
    expect(slugify('Генератори (бензинові), 5–10 кВт!')).toBe('heneratory-benzynovi-5-10-kvt');
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
        slug: 'a',
        'spec:Обʼєм бака, л': '25',
        'spec:Шум, дБ': '',
        'spec: Вага ': '48',
      }),
    ).toEqual([
      { key: 'Обʼєм бака, л', value: '25' },
      { key: 'Вага', value: '48' },
    ]);
  });
});

describe('prepareRows', () => {
  it('готує товар і виводить машинні назви бренду й категорії', () => {
    const { products, errors } = prepare(`${HEADER}\n${ROW}\n`);
    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      line: 2,
      brandSlug: 'honda',
      categorySlug: 'invertorni-heneratory',
    });
    expect(products[0].row.ratedPowerW).toBe(1800);
  });

  it('явні brandSlug і categorySlug мають пріоритет над транслітерацією', () => {
    const { products } = prepare(`${HEADER},brandSlug,categorySlug\n${ROW},honda-power,inverter\n`);
    expect(products[0]).toMatchObject({ brandSlug: 'honda-power', categorySlug: 'inverter' });
  });

  it('ціни в гривнях з комою й пробілами, ПДВ і залишок', () => {
    const { products, errors } = prepare(
      `${HEADER},priceB2C,priceB2B,vatRate,stock\n${ROW},"18 990,50","17 500",0.2,7\n`,
    );
    expect(errors).toEqual([]);
    expect(products[0].row).toMatchObject({
      priceB2C: 18990.5,
      priceB2B: 17500,
      vatRate: 0.2,
      stock: 7,
    });
  });

  it('порожня клітинка — це «не задано», а не нуль', () => {
    const { products } = prepare(`${HEADER},priceB2C,stock\n${ROW},,\n`);
    expect(products[0].row.priceB2C).toBeUndefined();
    expect(products[0].row.stock).toBeUndefined();
  });

  it('пікова потужність менша за номінальну — помилка рядка', () => {
    const bad = 'x-1,Тест,Honda,Категорія,PETROL,SINGLE,5000,4000';
    const { products, errors } = prepare(`${HEADER}\n${bad}\n`);
    expect(products).toEqual([]);
    expect(errors[0]).toMatchObject({ line: 2, slug: 'x-1' });
    expect(errors[0].messages[0]).toContain('Пікова потужність');
  });

  it('невідоме паливо й кирилиця в slug — помилки з назвою поля', () => {
    const bad = 'Генератор,Тест,Honda,Категорія,ВУГІЛЛЯ,SINGLE,5000,6000';
    const { errors } = prepare(`${HEADER}\n${bad}\n`);
    expect(errors[0].messages.join(' ')).toMatch(/slug/);
    expect(errors[0].messages.join(' ')).toMatch(/fuel/);
  });

  it('javascript: у зображеннях не проходить', () => {
    const { errors } = prepare(`${HEADER},images\n${ROW},javascript:alert(1)\n`);
    expect(errors[0].messages.join(' ')).toMatch(/images/);
  });

  it('битий рядок не зриває решту файлу', () => {
    const bad = 'y-1,Тест,Honda,Категорія,PETROL,SINGLE,5000,4000';
    const { products, errors } = prepare(`${HEADER}\n${bad}\n${ROW}\n`);
    expect(products).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(products[0].row.slug).toBe('honda-eu22i');
  });

  it('дубль slug у файлі — помилка з посиланням на перший рядок', () => {
    const { products, errors } = prepare(`${HEADER}\n${ROW}\n${ROW}\n`);
    expect(products).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 3, slug: 'honda-eu22i' });
    expect(errors[0].messages[0]).toContain('рядку 2');
  });

  it('із назви, де немає літер, машинну назву не зробити — просимо явну колонку', () => {
    const bad = 'z-1,Тест,«»,Категорія,PETROL,SINGLE,5000,6000';
    const { errors } = prepare(`${HEADER}\n${bad}\n`);
    expect(errors[0].messages[0]).toContain('brandSlug');
  });

  it('склад колонок заголовка видно окремо від порожніх клітинок', () => {
    const withStock = prepare(`${HEADER},stock\n${ROW},\n`);
    expect(hasColumn(withStock.columns, 'stock')).toBe(true);
    expect(hasSpecColumns(withStock.columns)).toBe(false);

    const withSpec = prepare(`${HEADER},spec:Шум\n${ROW},68 дБ\n`);
    expect(hasColumn(withSpec.columns, 'stock')).toBe(false);
    expect(hasSpecColumns(withSpec.columns)).toBe(true);
    expect(withSpec.products[0].specs).toEqual([{ key: 'Шум', value: '68 дБ' }]);
  });

  it('порожній файл — ні товарів, ні помилок', () => {
    expect(prepare('')).toMatchObject({ products: [], errors: [] });
  });
});
