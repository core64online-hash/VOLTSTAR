import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AddCartItemInput,
  Cart,
  CartLine,
  CreateCartInput,
  DeliveryMethod,
} from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { splitGross } from '../pricing/pricing.math';
import type { BuyerContext } from './buyer-context';
import { assertDeliveryAllowed, computeTotals } from './cart.math';

const cartInclude = {
  items: {
    include: { product: { include: { inventory: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.CartInclude;
type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async create(input: CreateCartInput, ctx: BuyerContext): Promise<Cart> {
    const cart = await this.prisma.cart.create({
      data: { currency: input.currency, userId: ctx.userId ?? null },
      include: cartInclude,
    });
    return this.toDto(cart, ctx, this.defaultDelivery(cart.currency));
  }

  async get(cartId: string, ctx: BuyerContext, delivery?: DeliveryMethod): Promise<Cart> {
    const cart = await this.load(cartId, ctx);
    return this.toDto(cart, ctx, delivery ?? this.defaultDelivery(cart.currency));
  }

  async addItem(cartId: string, input: AddCartItemInput, ctx: BuyerContext): Promise<Cart> {
    const cart = await this.load(cartId, ctx);
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      include: { inventory: true },
    });
    if (!product) throw new NotFoundException('Товар не знайдено');

    const prices = await this.pricing.unitPrices([product.id], ctx.segment, cart.currency);
    if (!prices.has(product.id)) {
      throw new BadRequestException(`Товар «${product.name}» недоступний для вашого сегмента/валюти`);
    }

    const existing = cart.items.find((i) => i.productId === product.id);
    const quantity = (existing?.quantity ?? 0) + input.quantity;
    this.assertStock(product.name, product.inventory?.quantity, quantity);

    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
      update: { quantity },
      create: { cartId: cart.id, productId: product.id, quantity },
    });
    return this.get(cart.id, ctx);
  }

  async updateItem(cartId: string, itemId: string, quantity: number, ctx: BuyerContext): Promise<Cart> {
    const cart = await this.load(cartId, ctx);
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Позицію кошика не знайдено');
    this.assertStock(item.product.name, item.product.inventory?.quantity, quantity);

    await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return this.get(cart.id, ctx);
  }

  async removeItem(cartId: string, itemId: string, ctx: BuyerContext): Promise<Cart> {
    const cart = await this.load(cartId, ctx);
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    if (count === 0) throw new NotFoundException('Позицію кошика не знайдено');
    return this.get(cart.id, ctx);
  }

  /**
   * Завантажує кошик із перевіркою власника. Гостьовий кошик (без userId) закріплюється
   * за користувачем при першому зверненні після входу.
   */
  private async load(cartId: string, ctx: BuyerContext): Promise<CartRow> {
    const cart = await this.prisma.cart.findUnique({ where: { id: cartId }, include: cartInclude });
    if (!cart) throw new NotFoundException('Кошик не знайдено');
    if (cart.userId && cart.userId !== ctx.userId) throw new ForbiddenException('Це не ваш кошик');
    if (!cart.userId && ctx.userId) {
      await this.prisma.cart.update({ where: { id: cart.id }, data: { userId: ctx.userId } });
      cart.userId = ctx.userId;
    }
    return cart;
  }

  private assertStock(name: string, stock: number | undefined, quantity: number): void {
    // Відсутній запис складу — товар під замовлення, кількість не обмежуємо.
    if (stock != null && quantity > stock) {
      throw new ConflictException(`«${name}»: на складі лише ${stock} шт.`);
    }
  }

  private defaultDelivery(currency: Cart['currency']): DeliveryMethod {
    return currency === 'UAH' ? 'NOVA_POSHTA' : 'PICKUP';
  }

  private async toDto(cart: CartRow, ctx: BuyerContext, delivery: DeliveryMethod): Promise<Cart> {
    assertDeliveryAllowed(cart.currency, delivery);
    const prices = await this.pricing.unitPrices(
      cart.items.map((i) => i.productId),
      ctx.segment,
      cart.currency,
    );

    const lines: CartLine[] = [];
    const unavailable: Cart['unavailable'] = [];
    for (const item of cart.items) {
      const price = prices.get(item.productId);
      if (!price) {
        unavailable.push({ id: item.id, productId: item.productId, name: item.product.name });
        continue;
      }
      const b = splitGross({ unitGrossMinor: price.amountMinor, vatRate: price.vatRate, quantity: item.quantity });
      lines.push({
        id: item.id,
        productId: item.productId,
        slug: item.product.slug,
        name: item.product.name,
        partNumber: item.product.partNumber,
        ...(item.product.coreDepositMinor
          ? { coreDepositMinor: item.product.coreDepositMinor }
          : {}),
        quantity: item.quantity,
        unitGrossMinor: price.amountMinor,
        vatRate: price.vatRate,
        ...b,
      });
    }

    return {
      id: cart.id,
      currency: cart.currency,
      segment: ctx.segment,
      deliveryMethod: delivery,
      lines,
      unavailable,
      totals: computeTotals(lines, delivery),
    };
  }
}
