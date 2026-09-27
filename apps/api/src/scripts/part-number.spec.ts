import { describe, expect, it } from 'vitest';
import { normalizePartNumber, partNumberField } from '@voltstar/types';

describe('normalizePartNumber', () => {
  it('усі написання одного номера зводяться до однієї форми', () => {
    const expected = '0001368088';
    for (const written of ['0001368088', '0 001 368 088', '0-001-368-088', '0.001.368.088']) {
      expect(normalizePartNumber(written)).toBe(expected);
    }
  });

  it('регістр не має значення', () => {
    expect(normalizePartNumber('azj3151')).toBe('AZJ3151');
  });

  it('кирилиця, схожа накресленням, стає латиницею', () => {
    expect(normalizePartNumber('СТ-142')).toBe(normalizePartNumber('CT-142'));
    expect(normalizePartNumber('АТЭ-1')).toBe('AT1'); // Э не має латинського двійника — відкидається
  });

  it('порожній результат для тексту без літер і цифр', () => {
    expect(normalizePartNumber('— / —')).toBe('');
  });
});

describe('partNumberField', () => {
  it('приймає номер із роздільниками', () => {
    expect(partNumberField.safeParse('0 001 368 088').success).toBe(true);
  });

  it('відхиляє надто короткий номер', () => {
    expect(partNumberField.safeParse('12').success).toBe(false);
    expect(partNumberField.safeParse('--').success).toBe(false);
  });
});
