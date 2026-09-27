import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password.util';
import type { PrismaService } from '../../prisma/prisma.service';
import { anonymizedEmail, PrivacyService } from './privacy.service';
import { applyRetention, RETENTION_DAYS } from './retention';

async function setup(user: Record<string, unknown> | null, admins = 2) {
  const tx: string[] = [];
  const op = (name: string) => vi.fn((args: unknown) => (tx.push(name), args));
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      count: vi.fn(async () => admins),
      update: op('user.update'),
    },
    passwordResetToken: { deleteMany: op('resetTokens.delete') },
    cart: { deleteMany: op('carts.delete') },
    lead: { updateMany: op('leads.anonymize'), findMany: vi.fn(async () => []) },
    contact: { updateMany: op('contact.anonymize') },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
  return { svc: new PrivacyService(prisma as unknown as PrismaService), prisma, tx };
}

describe('PrivacyService.deleteAccount', () => {
  it('знеособлює профіль, CRM-контакт і заявки (за email і телефоном), видаляє кошики й токени', async () => {
    const passwordHash = await hashPassword('Secret-123');
    const { svc, prisma, tx } = await setup({ id: 'u1', email: 'ivan@x.ua', phone: '+38 050 123 45 67', role: 'CUSTOMER', passwordHash });
    await expect(svc.deleteAccount('u1', 'Secret-123')).resolves.toEqual({ id: 'u1', deleted: true });
    expect(tx).toEqual(['resetTokens.delete', 'carts.delete', 'leads.anonymize', 'contact.anonymize', 'user.update']);
    expect(prisma.lead.updateMany.mock.calls[0][0]).toMatchObject({
      where: { OR: [{ email: 'ivan@x.ua' }, { phone: '380501234567' }] },
      data: { name: null, email: null, phone: null, message: null },
    });
    expect(prisma.user.update.mock.calls[0][0]).toMatchObject({
      data: { email: anonymizedEmail('u1'), firstName: null, lastName: null, phone: null, passwordHash: null, role: 'CUSTOMER' },
    });
  });

  it('невірний пароль → 401; вже видалений → 404; останній адмін → 400', async () => {
    const passwordHash = await hashPassword('Secret-123');
    await expect((await setup({ id: 'u1', email: 'a@x.ua', role: 'CUSTOMER', passwordHash })).svc.deleteAccount('u1', 'nope')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect((await setup({ id: 'u1', email: anonymizedEmail('u1'), role: 'CUSTOMER', passwordHash })).svc.deleteAccount('u1', 'Secret-123')).rejects.toBeInstanceOf(NotFoundException);
    await expect((await setup({ id: 'u1', email: 'a@x.ua', role: 'ADMIN', passwordHash }, 1)).svc.deleteAccount('u1', 'Secret-123')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('applyRetention', () => {
  function fake() {
    const calls: Record<string, unknown> = {};
    const model = (name: string) => ({
      count: vi.fn(async (a: unknown) => ((calls[`${name}.count`] = a), 1)),
      deleteMany: vi.fn((a: unknown) => ((calls[`${name}.delete`] = a), { count: 2 })),
      updateMany: vi.fn((a: unknown) => ((calls[`${name}.update`] = a), { count: 3 })),
    });
    const prisma = {
      passwordResetToken: model('resetTokens'),
      cart: model('carts'),
      lead: model('leads'),
      order: model('orders'),
      auditLog: model('audit'),
      webhookEvent: model('webhooks'),
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    return { prisma, calls };
  }
  const NOW = new Date('2026-09-23T00:00:00Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

  it('пробний прогін лише рахує', async () => {
    const { prisma, calls } = fake();
    const r = await applyRetention(prisma as unknown as PrismaService, { now: NOW, dryRun: true });
    expect(Object.values(r).every((n) => n === 1)).toBe(true);
    expect(Object.keys(calls).every((k) => k.endsWith('.count'))).toBe(true);
  });

  it('межі строків і дії: видалення, а для контактів у B2C-замовленнях — знеособлення', async () => {
    const { prisma, calls } = fake();
    const r = await applyRetention(prisma as unknown as PrismaService, { now: NOW });
    expect(r).toMatchObject({ carts: 2, b2cOrderContacts: 3 });
    const cartsWhere = (calls['carts.delete'] as { where: { updatedAt: { lt: Date } } }).where;
    expect(cartsWhere.updatedAt.lt.toISOString()).toBe(daysAgo(RETENTION_DAYS.carts));
    const leads = (calls['leads.delete'] as { where: Record<string, unknown> }).where;
    expect(leads.deal).toBeNull();
    const orders = calls['orders.update'] as { where: { segment: string; createdAt: { lt: Date } }; data: unknown };
    expect(orders.where.segment).toBe('B2C');
    expect(orders.where.createdAt.lt.toISOString()).toBe(daysAgo(1095));
    expect(orders.data).toEqual({ contactName: null, contactEmail: null, contactPhone: null });
  });
});
