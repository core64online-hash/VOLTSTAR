import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('заголовок і значення, обрізані пробіли', () => {
    const rows = parseCsv('slug,name\n honda-eu22i , Honda EU22i \n');
    expect(rows).toEqual([{ line: 2, record: { slug: 'honda-eu22i', name: 'Honda EU22i' } }]);
  });

  it('лапки: роздільник, перенос рядка й подвоєні лапки всередині клітинки', () => {
    const rows = parseCsv('slug,name\n"a","Обʼєм бака, л: 25\nшум 68 дБ"\n"b","15"" екран"\n');
    expect(rows[0].record.name).toBe('Обʼєм бака, л: 25\nшум 68 дБ');
    expect(rows[1].record.name).toBe('15" екран');
  });

  it('номер рядка враховує переноси всередині лапок', () => {
    const rows = parseCsv('slug\n"пер\nенос"\nдругий\n');
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it('BOM від Excel, CRLF і крапка з комою як роздільник', () => {
    const rows = parseCsv('﻿slug;name\r\nhonda;Honda\r\n');
    expect(rows).toEqual([{ line: 2, record: { slug: 'honda', name: 'Honda' } }]);
  });

  it('кома лишається роздільником, якщо крапок з комою менше', () => {
    const rows = parseCsv('slug,name,note\na,b,"1; 2; 3"\n');
    expect(rows[0].record).toEqual({ slug: 'a', name: 'b', note: '1; 2; 3' });
  });

  it('порожні рядки пропускаються, зокрема останній перенос', () => {
    expect(parseCsv('slug\na\n\n\nb\n')).toHaveLength(2);
  });

  it('зсув колонок — помилка з номером рядка, а не тихе завантаження не тих даних', () => {
    expect(() => parseCsv('slug,name\na,b,c\n')).toThrow(/Рядок 2/);
    expect(() => parseCsv('slug,name\na\n')).toThrow(/Рядок 2/);
  });

  it('незакриті лапки — помилка', () => {
    expect(() => parseCsv('slug\n"без кінця\n')).toThrow(/Незакриті лапки/);
  });

  it('порожній файл — порожній результат', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});
