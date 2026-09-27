import type { PrismaService } from '../../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Строки зберігання даних (ЗУ «Про захист персональних даних», ст. 6: не довше, ніж потрібно для мети).
 * Ці ж строки описані в політиці конфіденційності — змінюйте узгоджено.
 */
export const RETENTION_DAYS = {
  /** Використані/прострочені токени скидання паролю. */
  resetTokens: 1,
  /** Покинуті кошики. */
  carts: 30,
  /** Заявки, що не стали угодою. */
  leadsWithoutDeal: 3 * 365,
  /** Контактні дані в замовленнях B2C після строку податкового обліку (ПКУ ст. 44.3 — 1095 днів). */
  b2cOrderContacts: 1095,
  /** Журнал дій персоналу. */
  auditLog: 3 * 365,
  /** Ідентифікатори оброблених вебхуків (захист від повторів). */
  webhookEvents: 365,
} as const;

export type RetentionReport = Record<keyof typeof RETENTION_DAYS, number>;

/** Видаляє або знеособлює дані, строк зберігання яких сплив. `dryRun` лише рахує. */
export async function applyRetention(prisma: PrismaService, opts: { now?: Date; dryRun?: boolean } = {}): Promise<RetentionReport> {
  const now = (opts.now ?? new Date()).getTime();
  const before = (days: number) => new Date(now - days * DAY);
  const d = RETENTION_DAYS;

  const where = {
    resetTokens: { OR: [{ expiresAt: { lt: before(d.resetTokens) } }, { usedAt: { lt: before(d.resetTokens) } }] },
    carts: { updatedAt: { lt: before(d.carts) } },
    leadsWithoutDeal: { createdAt: { lt: before(d.leadsWithoutDeal) }, deal: null },
    b2cOrderContacts: {
      segment: 'B2C' as const,
      createdAt: { lt: before(d.b2cOrderContacts) },
      OR: [{ contactName: { not: null } }, { contactEmail: { not: null } }, { contactPhone: { not: null } }],
    },
    auditLog: { createdAt: { lt: before(d.auditLog) } },
    webhookEvents: { receivedAt: { lt: before(d.webhookEvents) } },
  };

  if (opts.dryRun) {
    const [resetTokens, carts, leadsWithoutDeal, b2cOrderContacts, auditLog, webhookEvents] = await Promise.all([
      prisma.passwordResetToken.count({ where: where.resetTokens }),
      prisma.cart.count({ where: where.carts }),
      prisma.lead.count({ where: where.leadsWithoutDeal }),
      prisma.order.count({ where: where.b2cOrderContacts }),
      prisma.auditLog.count({ where: where.auditLog }),
      prisma.webhookEvent.count({ where: where.webhookEvents }),
    ]);
    return { resetTokens, carts, leadsWithoutDeal, b2cOrderContacts, auditLog, webhookEvents };
  }

  const [resetTokens, carts, leadsWithoutDeal, b2cOrderContacts, auditLog, webhookEvents] = await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: where.resetTokens }),
    prisma.cart.deleteMany({ where: where.carts }),
    prisma.lead.deleteMany({ where: where.leadsWithoutDeal }),
    prisma.order.updateMany({ where: where.b2cOrderContacts, data: { contactName: null, contactEmail: null, contactPhone: null } }),
    prisma.auditLog.deleteMany({ where: where.auditLog }),
    prisma.webhookEvent.deleteMany({ where: where.webhookEvents }),
  ]);
  return {
    resetTokens: resetTokens.count,
    carts: carts.count,
    leadsWithoutDeal: leadsWithoutDeal.count,
    b2cOrderContacts: b2cOrderContacts.count,
    auditLog: auditLog.count,
    webhookEvents: webhookEvents.count,
  };
}
