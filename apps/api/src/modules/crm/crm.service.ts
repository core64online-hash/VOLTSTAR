import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ChangeDealStageInput,
  ConvertLeadInput,
  CreateActivityInput,
  CreateDealInput,
  CreateLeadInput,
  CreateTaskInput,
  CrmTask,
  Deal,
  DealDetail,
  Lead,
  LeadStatus,
  OrderStatus,
  Pipeline,
  UpdateLeadInput,
} from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assertDealTransition,
  assertLeadTransition,
  CLOSED_STAGES,
  DEAL_STAGE_LABELS,
  DEAL_STAGES,
  dealStageForOrder,
  DUPLICATE_WINDOW_MS,
  normalizePhone,
  OPEN_LEAD_STATUSES,
  pickAssignee,
  segmentForSource,
} from './crm-rules';

type Tx = Prisma.TransactionClient;

const dealInclude = {
  company: true,
  contact: true,
  owner: { select: { id: true, email: true } },
  order: { select: { number: true } },
} satisfies Prisma.DealInclude;
type DealRow = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

const leadInclude = {
  owner: { select: { id: true, email: true } },
  deal: { select: { id: true } },
} satisfies Prisma.LeadInclude;
type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

const SOURCE_LABEL: Record<string, string> = {
  'part-request': 'підбір по номеру',
  'price-request': 'запит ціни',
  reman: 'відновлення агрегата',
  'b2b-request': 'запит B2B',
  'b2g-request': 'запит B2G',
  contact: 'звернення',
};

/** Закриті угоди показуємо в канбані лише за останні 30 днів. */
const CLOSED_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─────────────────────────── Ліди ───────────────────────────

  /**
   * Публічна заявка. Повторна заявка з тим самим телефоном/email протягом доби
   * до відкритого ліда не створює дубль, а додається в його історію.
   */
  async createLead(input: CreateLeadInput, now: Date = new Date()): Promise<{ leadId: string; duplicate: boolean }> {
    const email = input.email?.toLowerCase() ?? null;
    const phone = normalizePhone(input.phone);
    const contactMatch: Prisma.LeadWhereInput[] = [];
    if (email) contactMatch.push({ email });
    if (phone) contactMatch.push({ phone });
    if (contactMatch.length === 0) throw new BadRequestException('Вкажіть коректний телефон або email');

    const duplicate = await this.prisma.lead.findFirst({
      where: {
        status: { in: OPEN_LEAD_STATUSES },
        createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
        OR: contactMatch,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate) {
      await this.prisma.activity.create({
        data: {
          leadId: duplicate.id,
          type: 'system',
          content: `Повторна заявка (${SOURCE_LABEL[input.source] ?? input.source})${input.message ? `: ${input.message}` : ''}`,
        },
      });
      return { leadId: duplicate.id, duplicate: true };
    }

    const ownerId = await this.pickManager();
    const lead = await this.prisma.lead.create({
      data: {
        source: input.source,
        segment: segmentForSource(input.source),
        name: input.name,
        email,
        phone,
        companyName: input.companyName || null,
        edrpou: input.edrpou ?? null,
        message: input.message || null,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        ownerId,
      },
      include: leadInclude,
    });

    void this.notifications.leadCreated({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      companyName: lead.companyName,
      source: SOURCE_LABEL[lead.source] ?? lead.source,
      ownerEmail: lead.owner?.email ?? null,
    });
    return { leadId: lead.id, duplicate: false };
  }

  async listLeads(filter: { status?: LeadStatus; ownerId?: string }): Promise<Lead[]> {
    const rows = await this.prisma.lead.findMany({
      where: { status: filter.status, ownerId: filter.ownerId },
      include: leadInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toLead);
  }

  async updateLead(id: string, input: UpdateLeadInput, actorId: string): Promise<Lead> {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Лід не знайдено');
    const data: Prisma.LeadUpdateInput = {};
    const notes: string[] = [];

    if (input.status && input.status !== lead.status) {
      assertLeadTransition(lead.status, input.status);
      data.status = input.status;
      notes.push(`Статус: ${lead.status} → ${input.status}`);
    }
    if (input.ownerId && input.ownerId !== lead.ownerId) {
      await this.assertStaffUser(input.ownerId);
      data.owner = { connect: { id: input.ownerId } };
      notes.push('Змінено відповідального менеджера');
    }
    if (notes.length === 0) return toLead(await this.loadLead(id));

    await this.prisma.$transaction([
      this.prisma.lead.update({ where: { id }, data }),
      this.prisma.activity.create({ data: { leadId: id, type: 'system', content: notes.join('; '), authorId: actorId } }),
    ]);
    return toLead(await this.loadLead(id));
  }

  /**
   * Лід → угода: компанія (за ЄДРПОУ, з привʼязкою до зареєстрованої організації),
   * контакт (за email, з привʼязкою до акаунта), угода на стадії QUALIFIED.
   */
  async convertLead(id: string, input: ConvertLeadInput, actorId: string): Promise<Deal> {
    const dealId = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id } });
      if (!lead) throw new NotFoundException('Лід не знайдено');
      if (lead.status === 'CONVERTED' || lead.status === 'DISQUALIFIED') {
        throw new BadRequestException('Лід уже закрито');
      }

      const companyId =
        lead.companyName || lead.edrpou
          ? await this.upsertCompany(tx, { name: lead.companyName ?? lead.name ?? 'Компанія', edrpou: lead.edrpou, segment: lead.segment })
          : null;
      const contactId = await this.upsertContact(tx, { name: lead.name, email: lead.email, phone: lead.phone, companyId });

      const deal = await tx.deal.create({
        data: {
          title: input.title ?? `${lead.companyName ?? lead.name ?? 'Лід'} — ${SOURCE_LABEL[lead.source] ?? lead.source}`,
          stage: 'QUALIFIED',
          amountMinor: input.amountMinor,
          leadId: lead.id,
          companyId,
          contactId,
          ownerId: lead.ownerId ?? actorId,
        },
      });
      await tx.lead.update({ where: { id }, data: { status: 'CONVERTED' } });
      await tx.activity.create({ data: { dealId: deal.id, type: 'system', content: 'Угоду створено з ліда', authorId: actorId } });
      return deal.id;
    });
    return toDeal(await this.loadDeal(dealId));
  }

  // ─────────────────────────── Угоди ───────────────────────────

  /** Канбан: відкриті угоди + закриті за 30 днів, з кількістю й сумою по стадіях. */
  async pipeline(filter: { ownerId?: string }, now: Date = new Date()): Promise<Pipeline> {
    const rows = await this.prisma.deal.findMany({
      where: {
        ownerId: filter.ownerId,
        OR: [{ stage: { notIn: CLOSED_STAGES } }, { closedAt: { gte: new Date(now.getTime() - CLOSED_VISIBLE_MS) } }],
      },
      include: dealInclude,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return {
      stages: DEAL_STAGES.map((stage) => {
        const deals = rows.filter((d) => d.stage === stage).map(toDeal);
        return { stage, count: deals.length, totalMinor: deals.reduce((s, d) => s + d.amountMinor, 0), deals };
      }),
    };
  }

  async createDeal(input: CreateDealInput, actorId: string): Promise<Deal> {
    const deal = await this.prisma.deal.create({
      data: {
        title: input.title,
        amountMinor: input.amountMinor,
        companyId: input.companyId,
        contactId: input.contactId,
        ownerId: actorId,
        activities: { create: { type: 'system', content: 'Угоду створено вручну', authorId: actorId } },
      },
    });
    return toDeal(await this.loadDeal(deal.id));
  }

  async getDeal(id: string, now: Date = new Date()): Promise<DealDetail> {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: {
        ...dealInclude,
        activities: { include: { author: { select: { email: true } } }, orderBy: { createdAt: 'desc' } },
        tasks: { include: { assignee: { select: { id: true, email: true } } }, orderBy: { dueAt: 'asc' } },
      },
    });
    if (!deal) throw new NotFoundException('Угоду не знайдено');
    return {
      ...toDeal(deal),
      activities: deal.activities.map((a) => ({
        id: a.id,
        type: a.type,
        content: a.content,
        author: a.author?.email ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      tasks: deal.tasks.map((t) => toTask(t, now)),
    };
  }

  async changeDealStage(id: string, input: ChangeDealStageInput, actorId: string): Promise<Deal> {
    const deal = await this.prisma.deal.findUnique({ where: { id } });
    if (!deal) throw new NotFoundException('Угоду не знайдено');
    assertDealTransition(deal.stage, input.stage, input.lostReason);
    await this.moveDeal(this.prisma, deal.id, deal.stage, input.stage, actorId, input.lostReason);
    return toDeal(await this.loadDeal(id));
  }

  // ─────────────────────── Активності й задачі ───────────────────────

  async addActivity(input: CreateActivityInput, actorId: string): Promise<{ id: string }> {
    if (input.dealId && !(await this.prisma.deal.findUnique({ where: { id: input.dealId }, select: { id: true } }))) {
      throw new NotFoundException('Угоду не знайдено');
    }
    if (input.leadId && !(await this.prisma.lead.findUnique({ where: { id: input.leadId }, select: { id: true } }))) {
      throw new NotFoundException('Лід не знайдено');
    }
    const a = await this.prisma.activity.create({
      data: { type: input.type, content: input.content, dealId: input.dealId, leadId: input.leadId, authorId: actorId },
    });
    return { id: a.id };
  }

  async createTask(input: CreateTaskInput, actorId: string, now: Date = new Date()): Promise<CrmTask> {
    const assigneeId = input.assigneeId ?? actorId;
    if (input.assigneeId) await this.assertStaffUser(input.assigneeId);
    const task = await this.prisma.task.create({
      data: {
        title: input.title,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        dealId: input.dealId,
        leadId: input.leadId,
        assigneeId,
      },
      include: { assignee: { select: { id: true, email: true } } },
    });
    return toTask(task, now);
  }

  async listTasks(filter: { assigneeId?: string; includeDone: boolean }, now: Date = new Date()): Promise<CrmTask[]> {
    const rows = await this.prisma.task.findMany({
      where: { assigneeId: filter.assigneeId, ...(filter.includeDone ? {} : { done: false }) },
      include: { assignee: { select: { id: true, email: true } } },
      orderBy: [{ done: 'asc' }, { dueAt: 'asc' }],
      take: 200,
    });
    return rows.map((t) => toTask(t, now));
  }

  async updateTask(id: string, done: boolean, now: Date = new Date()): Promise<CrmTask> {
    const task = await this.prisma.task.update({
      where: { id },
      data: { done },
      include: { assignee: { select: { id: true, email: true } } },
    }).catch(() => {
      throw new NotFoundException('Задачу не знайдено');
    });
    return toTask(task, now);
  }

  // ─────────────────── Інтеграція із замовленнями ───────────────────

  /**
   * B2B/B2G-замовлення → угода на стадії PROPOSAL (рахунок виставлено), з компанією
   * організації та контактом покупця. Ідемпотентно: одна угода на замовлення.
   */
  async onOrderPlaced(orderNumber: string): Promise<void> {
    await this.safely(`onOrderPlaced ${orderNumber}`, async () => {
      const order = await this.prisma.order.findUnique({
        where: { number: orderNumber },
        include: { organization: true, user: true, deal: true },
      });
      if (!order || order.segment === 'B2C' || order.deal) return;

      await this.prisma.$transaction(async (tx) => {
        const companyId = order.organization
          ? await this.upsertCompany(tx, {
              name: order.organization.name,
              edrpou: order.organization.edrpou,
              segment: order.organization.segment,
              orgId: order.organization.id,
            })
          : null;
        const contactId = await this.upsertContact(tx, {
          name: order.contactName,
          email: order.contactEmail?.toLowerCase() ?? null,
          phone: normalizePhone(order.contactPhone),
          companyId,
          userId: order.userId,
        });
        // Той самий менеджер, що вже веде компанію; інакше — найменш завантажений.
        const previous = companyId
          ? await tx.deal.findFirst({ where: { companyId, ownerId: { not: null } }, orderBy: { createdAt: 'desc' } })
          : null;
        // Статус міг змінитися, поки ми сюди дійшли (напр., рахунок уже звірено) — угода одразу закривається.
        const current = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
        const closedStage = current ? dealStageForOrder(current.status) : null;
        const deal = await tx.deal.create({
          data: {
            title: `Замовлення ${order.number}`,
            stage: closedStage ?? 'PROPOSAL',
            closedAt: closedStage ? new Date() : null,
            lostReason: closedStage === 'LOST' ? 'Замовлення скасовано до опрацювання' : null,
            amountMinor: order.totalMinor,
            currency: order.currency,
            orderId: order.id,
            companyId,
            contactId,
            ownerId: previous?.ownerId ?? (await this.pickManager(tx)),
          },
        });
        await tx.activity.create({
          data: {
            dealId: deal.id,
            type: 'system',
            content: `Оформлено замовлення ${order.number}, виставлено рахунок${closedStage === 'WON' ? '; уже оплачено' : ''}`,
          },
        });
      });
    });
  }

  /** Оплата замовлення → угода WON; скасування/повернення → LOST (якщо угода ще відкрита). */
  async onOrderStatus(orderNumber: string, status: OrderStatus): Promise<void> {
    const target = dealStageForOrder(status);
    if (!target) return;
    await this.safely(`onOrderStatus ${orderNumber} → ${status}`, async () => {
      const deal = await this.prisma.deal.findFirst({ where: { order: { number: orderNumber } } });
      if (!deal || CLOSED_STAGES.includes(deal.stage)) return;
      const reason = target === 'LOST' ? (status === 'CANCELLED' ? 'Замовлення скасовано' : 'Кошти за замовлення повернено') : undefined;
      await this.moveDeal(this.prisma, deal.id, deal.stage, target, null, reason, `за замовленням ${orderNumber}`);
    });
  }

  // ─────────────────────────── Допоміжне ───────────────────────────

  private async moveDeal(
    db: Tx | PrismaService,
    dealId: string,
    from: Deal['stage'],
    to: Deal['stage'],
    actorId: string | null,
    lostReason?: string,
    context?: string,
  ): Promise<void> {
    const closed = CLOSED_STAGES.includes(to);
    await db.deal.update({
      where: { id: dealId },
      data: { stage: to, closedAt: closed ? new Date() : null, lostReason: to === 'LOST' ? lostReason ?? null : null },
    });
    await db.activity.create({
      data: {
        dealId,
        type: 'system',
        authorId: actorId,
        content: `Стадія: ${DEAL_STAGE_LABELS[from]} → ${DEAL_STAGE_LABELS[to]}${context ? ` (${context})` : ''}${lostReason ? `. Причина: ${lostReason}` : ''}`,
      },
    });
  }

  private async pickManager(db: Tx | PrismaService = this.prisma): Promise<string | null> {
    const managers = await db.user.findMany({ where: { role: 'MANAGER' }, select: { id: true } });
    if (managers.length === 0) return null;
    const load = await db.lead.groupBy({
      by: ['ownerId'],
      where: { status: { in: OPEN_LEAD_STATUSES }, ownerId: { in: managers.map((m) => m.id) } },
      _count: { _all: true },
    });
    const byOwner = new Map(load.map((l) => [l.ownerId, l._count._all]));
    return pickAssignee(managers.map((m) => ({ id: m.id, openLeads: byOwner.get(m.id) ?? 0 })));
  }

  private async upsertCompany(
    tx: Tx,
    c: { name: string; edrpou: string | null; segment: Prisma.CompanyCreateInput['segment']; orgId?: string },
  ): Promise<string> {
    if (c.orgId) {
      const byOrg = await tx.company.findUnique({ where: { orgId: c.orgId } });
      if (byOrg) return byOrg.id;
    }
    const byEdrpou = c.edrpou ? await tx.company.findFirst({ where: { edrpou: c.edrpou } }) : null;
    if (byEdrpou) {
      if (c.orgId && !byEdrpou.orgId) await tx.company.update({ where: { id: byEdrpou.id }, data: { orgId: c.orgId } });
      return byEdrpou.id;
    }
    // Зареєстрована організація з тим самим ЄДРПОУ — повʼязуємо, якщо ще не повʼязана.
    const org = !c.orgId && c.edrpou ? await tx.organization.findFirst({ where: { edrpou: c.edrpou, company: null } }) : null;
    const created = await tx.company.create({
      data: { name: c.name, edrpou: c.edrpou, segment: c.segment, orgId: c.orgId ?? org?.id ?? null },
    });
    return created.id;
  }

  private async upsertContact(
    tx: Tx,
    c: { name: string | null; email: string | null; phone: string | null; companyId: string | null; userId?: string | null },
  ): Promise<string | null> {
    if (!c.email && !c.phone) return null;
    const existing = c.userId
      ? await tx.contact.findUnique({ where: { userId: c.userId } })
      : c.email
        ? await tx.contact.findFirst({ where: { email: c.email } })
        : await tx.contact.findFirst({ where: { phone: c.phone } });
    if (existing) {
      if (c.companyId && !existing.companyId) await tx.contact.update({ where: { id: existing.id }, data: { companyId: c.companyId } });
      return existing.id;
    }
    const user = c.userId ? null : c.email ? await tx.user.findUnique({ where: { email: c.email }, include: { contact: true } }) : null;
    const created = await tx.contact.create({
      data: {
        firstName: c.name,
        email: c.email,
        phone: c.phone,
        companyId: c.companyId,
        userId: c.userId ?? (user && !user.contact ? user.id : null),
      },
    });
    return created.id;
  }

  private async assertStaffUser(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!u || (u.role !== 'MANAGER' && u.role !== 'ADMIN')) throw new BadRequestException('Відповідальним може бути лише менеджер');
  }

  private async loadLead(id: string): Promise<LeadRow> {
    return this.prisma.lead.findUniqueOrThrow({ where: { id }, include: leadInclude });
  }

  private async loadDeal(id: string): Promise<DealRow> {
    return this.prisma.deal.findUniqueOrThrow({ where: { id }, include: dealInclude });
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(`CRM: не вдалося обробити ${what}: ${(e as Error).message}`);
    }
  }
}

function toLead(l: LeadRow): Lead {
  return {
    id: l.id,
    source: l.source,
    status: l.status,
    segment: l.segment,
    name: l.name,
    email: l.email,
    phone: l.phone,
    companyName: l.companyName,
    edrpou: l.edrpou,
    message: l.message,
    owner: l.owner,
    dealId: l.deal?.id ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}

function toDeal(d: DealRow): Deal {
  return {
    id: d.id,
    title: d.title,
    stage: d.stage,
    amountMinor: d.amountMinor,
    currency: d.currency,
    lostReason: d.lostReason,
    company: d.company ? { id: d.company.id, name: d.company.name, edrpou: d.company.edrpou } : null,
    contact: d.contact
      ? {
          id: d.contact.id,
          name: [d.contact.firstName, d.contact.lastName].filter(Boolean).join(' ') || d.contact.email || '—',
          email: d.contact.email,
          phone: d.contact.phone,
        }
      : null,
    owner: d.owner,
    orderNumber: d.order?.number ?? null,
    leadId: d.leadId,
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toTask(
  t: { id: string; title: string; dueAt: Date | null; done: boolean; dealId: string | null; leadId: string | null; assignee: { id: string; email: string } | null },
  now: Date,
): CrmTask {
  return {
    id: t.id,
    title: t.title,
    dueAt: t.dueAt?.toISOString() ?? null,
    done: t.done,
    overdue: !t.done && !!t.dueAt && t.dueAt.getTime() < now.getTime(),
    assignee: t.assignee,
    dealId: t.dealId,
    leadId: t.leadId,
  };
}
