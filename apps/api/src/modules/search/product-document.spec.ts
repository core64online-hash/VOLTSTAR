import { describe, expect, it } from 'vitest';
import type { CatalogQuery } from '@voltstar/types';
import { buildFilterBy, buildSearchParams, toProductDocument } from './product-document';

const base: CatalogQuery = { page: 1, perPage: 24 };

describe('toProductDocument', () => {
  it('мапить агрегат у документ індексу; наявність — з залишку', () => {
    const doc = toProductDocument({
      id: 'p1',
      slug: 'bosch-0001368088',
      name: 'Стартер Bosch 24V',
      description: null,
      brand: { name: 'Bosch', slug: 'bosch' },
      category: { slug: 'startery' },
      kind: 'STARTER',
      condition: 'REMANUFACTURED',
      partNumberNorm: '0001368088',
      voltage: 24,
      crossReferences: [{ numberNorm: 'AZJ3151' }, { numberNorm: 'AZJ3151' }],
      applications: [{ machineModel: { slug: 'maz-5440', segment: 'TRUCK' } }],
      inventory: { quantity: 0 },
    });
    expect(doc).toEqual({
      id: 'p1',
      slug: 'bosch-0001368088',
      name: 'Стартер Bosch 24V',
      brand: 'Bosch',
      brandSlug: 'bosch',
      categorySlug: 'startery',
      kind: 'STARTER',
      condition: 'REMANUFACTURED',
      partNumber: '0001368088',
      crossNumbers: ['AZJ3151'], // дублі схлопуються
      voltage: 24,
      machineModels: ['maz-5440'],
      machineSegments: ['TRUCK'],
      inStock: false,
    });
    expect(doc).not.toHaveProperty('description');
  });

  it('невідома напруга індексується нулем — Typesense не приймає null', () => {
    const doc = toProductDocument({
      id: 'p2',
      slug: 's',
      name: 'Стартер',
      description: null,
      brand: { name: 'B', slug: 'b' },
      category: { slug: 'c' },
      kind: 'STARTER',
      condition: 'NEW',
      partNumberNorm: 'AB123',
      voltage: null,
      crossReferences: [],
      applications: [],
      inventory: null,
    });
    expect(doc.voltage).toBe(0);
  });
});

describe('buildFilterBy', () => {
  it('без фільтрів — undefined', () => {
    expect(buildFilterBy(base)).toBeUndefined();
  });

  it('усі фільтри каталогу → синтаксис Typesense з екрануванням рядків', () => {
    expect(
      buildFilterBy({
        ...base,
        brand: ['bosch', 'könner & söhnen'],
        kind: ['STARTER', 'ALTERNATOR'],
        condition: ['REMANUFACTURED'],
        voltage: 24,
        machineSegment: 'TRUCK',
        machineModel: 'maz-5440',
        inStock: true,
      }),
    ).toBe(
      'brandSlug:=[`bosch`,`könner & söhnen`] && kind:=[`STARTER`,`ALTERNATOR`] && condition:=[`REMANUFACTURED`] && voltage:=24 && machineSegments:=`TRUCK` && machineModels:=`maz-5440` && inStock:=true',
    );
  });

  it('зворотні лапки у значенні не ламають фільтр (ін’єкція в filter_by)', () => {
    expect(buildFilterBy({ ...base, brand: ['x` || inStock:=false'] })).toBe(
      'brandSlug:=[`x || inStock:=false`]',
    );
  });
});

describe('buildSearchParams', () => {
  it('без тексту — усі документи за назвою', () => {
    expect(buildSearchParams({ ...base, page: 2, perPage: 12 })).toMatchObject({
      q: '*',
      sort_by: 'name:asc',
      page: 2,
      per_page: 12,
    });
  });

  it('номер шукається і як введено, і в нормалізованій формі', () => {
    expect(buildSearchParams({ ...base, q: '  0 001 368 088  ' })).toMatchObject({
      q: '0 001 368 088 0001368088',
      query_by: 'partNumber,crossNumbers,name,brand,description',
      sort_by: '_text_match:desc,name:asc',
    });
  });

  it('номер має більшу вагу, ніж назва й опис', () => {
    const { query_by, query_by_weights } = buildSearchParams({ ...base, q: 'AZJ3151' });
    const fields = query_by!.split(',');
    const weights = query_by_weights!.split(',').map(Number);
    expect(weights[fields.indexOf('partNumber')]).toBeGreaterThan(
      weights[fields.indexOf('name')],
    );
    expect(weights[fields.indexOf('crossNumbers')]).toBeGreaterThan(
      weights[fields.indexOf('description')],
    );
  });

  it('текст без цифр і латиниці не дублюється нормалізованою формою', () => {
    expect(buildSearchParams({ ...base, q: 'стартер' }).q).toBe('стартер');
  });
});
