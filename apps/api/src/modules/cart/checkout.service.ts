import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Order, Payment } from '@prisma/client';
import type { CheckoutInput, CheckoutResult } from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { logStatusChange } from '../orders/order-events';
import { PaymentsService } from '../payments/payments.service';
import { SearchService } from '../search/search.service';
import type { BuyerContext } from './buyer-context';
import { CartService } from './cart.service';
import {
  assertReturnUrlAllowed,
  chooseProvider,
  generateOrderNumber,
  initialOrderStatus,
  resolveFlow,
} from './checkout.flow';

@Injectable()
export class CheckoutService {
  private readonly allowedOrigins: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly search: SearchService,
    private readonly crm: CrmService,
    config: ConfigService,
  ) {
    this.allowedOrigins = (config.get<string>('API_CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /**
   * Оформлення: перевірки → транзакція (резерв складу, замовлення, платіж, видалення
   * кошика) → ініціація оплати в провайдера поза транзакцією.
   */
  async checkout(input: CheckoutInput, ctx: BuyerContext): Promise<CheckoutResult> {
    assertReturnUrlAllowed(input.returnUrl, this.allowedOrigins);

    const flow = resolveFlow(ctx.segment);
    if (flow === 'INVOICE') await this.assertVerifiedOrganization(ctx);

    const cart = await this.carts.get(input.cartId, ctx, input.deliveryMethod);
    if (cart.unavailable.length > 0) {
      throw new BadRequestException('У кошику є товари, недоступні для вашого сегмента — видаліть їх');
    }
    if (cart.lines.length === 0) throw new BadRequestException('Кошик порожній');

    const provider = chooseProvider(flow, cart.currency, input.provider);
    this.payments.assertAvailable(provider);

    const number = generateOrderNumber();
    const order = await this.prisma.$transaction(async (tx) => {
      for (const line of cart.lines) {
        const stock = await tx.inventoryItem.findUnique({ where: { productId: line.productId } });
        if (!stock) continue; // під замовлення
        // Умовне списання: захищає від перепродажу при конкурентних оформленнях.
        const { count } = await tx.inventoryItem.updateMany({
          where: { productId: line.productId, quantity: { gte: line.quantity } },
          data: { quantity: { decrement: line.quantity } },
        });
        if (count === 0) throw new ConflictException(`«${line.name}» закінчився на складі`);
      }

      const created = await tx.order.create({
        data: {
          number,
          userId: ctx.userId ?? null,
          orgId: ctx.orgId ?? null,
          segment: ctx.segment,
          status: initialOrderStatus(flow),
          currency: cart.currency,
          totalMinor: cart.totals.grossMinor,
          vatMinor: cart.totals.vatMinor,
          deliveryMethod: cart.deliveryMethod,
          deliveryMinor: cart.totals.deliveryMinor,
          contactName: input.contact.name,
          contactEmail: input.contact.email,
          contactPhone: input.contact.phone,
          items: {
            create: cart.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPriceMinor: l.unitGrossMinor,
              vatRate: l.vatRate,
              // Артикул фіксуємо на момент продажу: у відновлених агрегатів номер із часом
              // змінюється, а в рахунку має лишитися той, за яким купували.
              partNumberSnapshot: l.partNumber,
            })),
          },
          payments: {
            create: { provider, amountMinor: cart.totals.grossMinor, currency: cart.currency },
          },
        },
        include: { payments: true },
      });
      await logStatusChange(tx, { orderId: created.id, from: null, to: created.status, actor: 'system:checkout' });
      await tx.cart.delete({ where: { id: cart.id } });
      return created;
    });

    const payment = order.payments[0];
    let instruction: CheckoutResult['payment'];
    try {
      instruction = await this.payments.initiate(payment, {
        orderNumber: order.number,
        description: `Замовлення ${order.number} — VOLTSTAR`,
        returnUrl: input.returnUrl,
        customerEmail: input.contact.email,
      });
    } catch (e) {
      await this.release(order, payment, cart.lines);
      void this.search.syncProducts(cart.lines.map((l) => l.productId));
      throw e;
    }

    void this.notifications.orderPlaced(order.number);
    void this.crm.onOrderPlaced(order.number);
    // Резерв міг вичерпати склад — оновлюємо «в наявності» в пошуковому індексі.
    void this.search.syncProducts(cart.lines.map((l) => l.productId));

    return {
      orderId: order.id,
      orderNumber: order.number,
      status: order.status,
      flow,
      totals: cart.totals,
      payment: instruction,
    };
  }

  private async assertVerifiedOrganization(ctx: BuyerContext): Promise<void> {
    if (!ctx.userId || !ctx.orgId) {
      throw new ForbiddenException('Оформлення B2B/B2G доступне лише для акаунта організації');
    }
    const org = await this.prisma.organization.findUnique({ where: { id: ctx.orgId } });
    if (!org?.verified) {
      throw new ForbiddenException('Організація ще не верифікована — зверніться до менеджера');
    }
  }

  /** Відкат після збою провайдера: скасовуємо замовлення й повертаємо резерв на склад. */
  private async release(
    order: Order,
    payment: Payment,
    lines: Array<{ productId: string; quantity: number }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      await logStatusChange(tx, {
        orderId: order.id,
        from: order.status,
        to: 'CANCELLED',
        actor: 'system:checkout-rollback',
        note: 'Платіжний сервіс недоступний',
      });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      for (const l of lines) {
        await tx.inventoryItem.updateMany({
          where: { productId: l.productId },
          data: { quantity: { increment: l.quantity } },
        });
      }
    });
  }
}
