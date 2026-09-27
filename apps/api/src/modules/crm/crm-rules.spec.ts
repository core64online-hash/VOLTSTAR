import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateLeadSchema } from '@voltstar/types';
import {
  assertDealTransition,
  assertLeadTransition,
  dealStageForOrder,
  normalizePhone,
  pickAssignee,
  segmentForSource,
} from './crm-rules';

describe('normalizePhone', () => {
  it('зводить українські формати до 380XXXXXXXXX', () => {
    expect(normalizePhone('+38 (050) 123-45-67')).toBe('380501234567');
    expect(normalizePhone('050 123 45 67')).toBe('380501234567');
    expect(normalizePhone('501234567')).toBe('380501234567');
    expect(normalizePhone('380501234567')).toBe('380501234567');
  });

  it('іноземні номери — лише цифри; сміття — null', () => {
    expect(normalizePhone('+48 600 700 800')).toBe('48600700800');
    expect(normalizePhone('12-34')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('segmentForSource', () => {
  it('запити бізнесу й держсектору — відповідні сегменти, решта — B2C', () => {
    expect(segmentForSource('b2b-request')).toBe('B2B');
    expect(segmentForSource('b2g-request')).toBe('B2G');
    expect(segmentForSource('part-request')).toBe('B2C');
    expect(segmentForSource('reman')).toBe('B2C');
  });
});

describe('assertLeadTransition', () => {
  it('робочий шлях і повторне відкриття відхиленого', () => {
    expect(() => assertLeadTransition('NEW', 'CONTACTED')).not.toThrow();
    expect(() => assertLeadTransition('CONTACTED', 'QUALIFIED')).not.toThrow();
    expect(() => assertLeadTransition('DISQUALIFIED', 'NEW')).not.toThrow();
  });

  it('CONVERTED — лише через конвертацію; з CONVERTED виходу немає', () => {
    expect(() => assertLeadTransition('QUALIFIED', 'CONVERTED')).toThrow(/угоду/);
    expect(() => assertLeadTransition('CONVERTED', 'NEW')).toThrow(BadRequestException);
  });
});

describe('assertDealTransition', () => {
  it('відкриту угоду можна рухати вперед і назад', () => {
    expect(() => assertDealTransition('NEW', 'PROPOSAL')).not.toThrow();
    expect(() => assertDealTransition('NEGOTIATION', 'QUALIFIED')).not.toThrow();
    expect(() => assertDealTransition('NEGOTIATION', 'WON')).not.toThrow();
  });

  it('програш — лише з причиною; закриту угоду не рухаємо', () => {
    expect(() => assertDealTransition('PROPOSAL', 'LOST')).toThrow(/причину/);
    expect(() => assertDealTransition('PROPOSAL', 'LOST', '  ')).toThrow(/причину/);
    expect(() => assertDealTransition('PROPOSAL', 'LOST', 'Дорого')).not.toThrow();
    expect(() => assertDealTransition('WON', 'NEGOTIATION')).toThrow(/закрито/);
    expect(() => assertDealTransition('QUALIFIED', 'QUALIFIED')).toThrow(BadRequestException);
  });
});

describe('pickAssignee', () => {
  it('найменш завантажений менеджер, при рівності — стабільно за id', () => {
    expect(pickAssignee([{ id: 'm2', openLeads: 3 }, { id: 'm1', openLeads: 1 }, { id: 'm3', openLeads: 1 }])).toBe('m1');
    expect(pickAssignee([])).toBeNull();
  });
});

describe('dealStageForOrder', () => {
  it('оплата → WON, скасування/повернення → LOST, інше — без змін', () => {
    expect(dealStageForOrder('PAID')).toBe('WON');
    expect(dealStageForOrder('CANCELLED')).toBe('LOST');
    expect(dealStageForOrder('REFUNDED')).toBe('LOST');
    expect(dealStageForOrder('SHIPPED')).toBeNull();
  });
});

describe('CreateLeadSchema', () => {
  const base = { source: 'b2b-request', name: 'Петро' };

  it('потрібен телефон або email; порожні рядки з форми ігноруються', () => {
    expect(CreateLeadSchema.safeParse({ ...base }).success).toBe(false);
    expect(CreateLeadSchema.safeParse({ ...base, email: '', phone: '0501234567' }).success).toBe(true);
    expect(CreateLeadSchema.safeParse({ ...base, email: 'a@b.ua', edrpou: '' }).success).toBe(true);
  });

  it('заповнене приховане поле (бот) і невалідний ЄДРПОУ — відхиляються', () => {
    expect(CreateLeadSchema.safeParse({ ...base, phone: '0501234567', website: 'http://spam' }).success).toBe(false);
    expect(CreateLeadSchema.safeParse({ ...base, phone: '0501234567', edrpou: '123' }).success).toBe(false);
  });
});
