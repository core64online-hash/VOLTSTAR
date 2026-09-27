import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ManageOrdersQuery,
  OrderDetail,
  OrderStatus,
  OrderSummary,
  StaffOrderSummary,
  Role,
} from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { availableDocuments } from '../documents/documents.service';
import { CrmService } from '../crm/crm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SearchService } from '../search/search.service';
import { logStatusChange } from './order-events';
import { assertManualTransition, releasesStock } from './order-state';

/** Хто дивиться замовлення: користувач (id, роль) або гість з email із замовлення. */
export interface OrderViewer {
  userId?: string;
  role?: Role;
  email?: string;
}

const detailInclude = {
  items: { include: { product: true }, orderBy: { id: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
  organization: true,
} satisfies Prisma.OrderInclude;
type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

const isStaff = (role?: Role) => role === 'MANAGER' || role === 'ADMIN';

/**
 * Доступ до замовлення: персонал — до будь-якого; власник акаунта — до свого;
 * гість — за email, вказаним при оформленні. Інакше 404, щоб не підтверджувати існування номера.
 */
export function canView(
  order: { userId: string | null; contactEmail: string | null },
  viewer: OrderViewer,
): boolean {
  if (isStaff(viewer.role)) return true;
  if (viewer.userId && order.userId === viewer.userId) return true;
  return !!viewer.email && !!order.contactEmail && order.contactEmail.toLowerCase() === viewer.email.toLowerCase();
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly search: SearchService,
    private readonly crm: CrmService,
  ) {}

  /** Історія замовлень користувача (кабінет). */
  async listMine(userId: string): Promise<OrderSummary[]> {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toSummary);
  }

  /** Список для менеджера з фільтром за статусом. */
  async listForStaff(query: ManageOrdersQuery): Promise<{ items: StaffOrderSummary[]; total: number; page: number; perPage: number }> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { contactEmail: { contains: query.q, mode: 'insensitive' } },
              { contactName: { contains: query.q, mode: 'insensitive' } },
              { organization: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true, organization: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.order.count({ where }),
    ]);
    const items = rows.map((o) => ({
      ...toSummary(o),
      contactName: o.contactName,
      contactEmail: o.contactEmail,
      organization: o.organization?.name ?? null,
    }));
    return { items, total, page: query.page, perPage: query.perPage };
  }

  async getDetail(number: string, viewer: OrderViewer): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({ where: { number }, include: detailInclude });
    if (!order || !canView(order, viewer)) throw new NotFoundException('Замовлення не знайдено');
    return toDetail(order);
  }

  /** Перевірка доступу без завантаження деталей (для документів). */
  async assertCanView(number: string, viewer: OrderViewer): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { number },
      select: { userId: true, contactEmail: true },
    });
    if (!order || !canView(order, viewer)) throw new NotFoundException('Замовлення не знайдено');
  }

  /**
   * Ручна зміна статусу менеджером: перевірка переходу, журнал, повернення резерву
   * на склад (скасування / повернення коштів до відвантаження), позначка платежів
   * як повернених. Лист покупцю — після коміту.
   */
  async changeStatus(number: string, to: OrderStatus, actorId: string, note?: string): Promise<OrderDetail> {
    let restockedIds: string[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { number }, include: { items: true } });
      if (!order) throw new NotFoundException('Замовлення не знайдено');
      assertManualTransition(order.status, to);

      if (releasesStock(order.status, to)) {
        restockedIds = order.items.map((i) => i.productId);
        for (const item of order.items) {
          await tx.inventoryItem.updateMany({
            where: { productId: item.productId },
            data: { quantity: { increment: item.quantity } },
          });
        }
      }
      if (to === 'REFUNDED') {
        await tx.payment.updateMany({ where: { orderId: order.id, status: 'SUCCEEDED' }, data: { status: 'REFUNDED' } });
      }

      await tx.order.update({ where: { id: order.id }, data: { status: to } });
      await logStatusChange(tx, { orderId: order.id, from: order.status, to, actor: actorId, note });
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: detailInclude });
    });

    void this.notifications.orderStatusChanged(number, to);
    void this.crm.onOrderStatus(number, to);
    if (restockedIds.length) void this.search.syncProducts(restockedIds);
    return toDetail(updated);
  }
}

function toSummary(o: { number: string; status: OrderStatus; segment: OrderSummary['segment']; currency: OrderSummary['currency']; totalMinor: number; createdAt: Date; items: Array<{ quantity: number }> }): OrderSummary {
  return {
    number: o.number,
    status: o.status,
    segment: o.segment,
    currency: o.currency,
    totalMinor: o.totalMinor,
    itemsCount: o.items.reduce((n, i) => n + i.quantity, 0),
    createdAt: o.createdAt.toISOString(),
  };
}

function toDetail(o: OrderWithDetail): OrderDetail {
  return {
    ...toSummary(o),
    vatMinor: o.vatMinor,
    deliveryMethod: o.deliveryMethod,
    deliveryMinor: o.deliveryMinor,
    contact: { name: o.contactName, email: o.contactEmail, phone: o.contactPhone },
    organization: o.organization ? { name: o.organization.name, edrpou: o.organization.edrpou } : null,
    items: o.items.map((i) => ({
      productId: i.productId,
      slug: i.product.slug,
      name: i.product.name,
      partNumber: i.partNumberSnapshot ?? i.product.partNumber,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      vatRate: i.vatRate,
      totalMinor: i.unitPriceMinor * i.quantity,
    })),
    payments: o.payments.map((p) => ({ provider: p.provider, status: p.status, amountMinor: p.amountMinor })),
    // actor у публічну відповідь не віддаємо — це внутрішні id менеджерів.
    events: o.events.map((e) => ({ from: e.fromStatus, to: e.toStatus, note: e.note, createdAt: e.createdAt.toISOString() })),
    documents: availableDocuments(o.status),
  };
}
