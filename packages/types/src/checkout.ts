import { z } from 'zod';
import { CurrencySchema, OrderStatusSchema, PaymentProviderKindSchema, SegmentSchema } from './enums';

/** Спосіб доставки. */
export const DeliveryMethod = {
  PICKUP: 'PICKUP', // самовивіз зі складу
  NOVA_POSHTA: 'NOVA_POSHTA', // відділення «Нової пошти»
  COURIER: 'COURIER', // курʼєр за адресою
} as const;
export const DeliveryMethodSchema = z.nativeEnum(DeliveryMethod);
export type DeliveryMethod = (typeof DeliveryMethod)[keyof typeof DeliveryMethod];

/** Гілка оплати: B2C — картка онлайн, B2B/B2G — рахунок-фактура. */
export const CheckoutFlow = {
  CARD: 'CARD',
  INVOICE: 'INVOICE',
} as const;
export const CheckoutFlowSchema = z.nativeEnum(CheckoutFlow);
export type CheckoutFlow = (typeof CheckoutFlow)[keyof typeof CheckoutFlow];

/** Створення кошика. */
export const CreateCartSchema = z.object({
  currency: CurrencySchema.default('UAH'),
});
export type CreateCartInput = z.infer<typeof CreateCartSchema>;

/** Додавання товару в кошик (кількість підсумовується з наявною). */
export const AddCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(999).default(1),
});
export type AddCartItemInput = z.infer<typeof AddCartItemSchema>;

/** Зміна кількості позиції. */
export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().positive().max(999),
});
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemSchema>;

/** Позиція кошика з цінами сегмента (мінімальні одиниці). */
export const CartLineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  slug: z.string(),
  name: z.string(),
  /** Артикул: клієнт звіряє саме його, і він же лишається в рахунку. */
  partNumber: z.string(),
  /**
   * Застава за старий агрегат при купівлі на обмін, копійки за одиницю.
   * У суму замовлення не входить: її вносять при отриманні, якщо старий агрегат не здано,
   * і повертають, коли здано. Тому показуємо її окремо, а не в ціні.
   */
  coreDepositMinor: z.number().int().nonnegative().optional(),
  quantity: z.number().int().positive(),
  unitGrossMinor: z.number().int().nonnegative(),
  vatRate: z.number().min(0).max(1),
  netMinor: z.number().int().nonnegative(),
  vatMinor: z.number().int().nonnegative(),
  grossMinor: z.number().int().nonnegative(),
});
export type CartLine = z.infer<typeof CartLineSchema>;

/** Підсумки кошика: товари + доставка. */
export const CartTotalsSchema = z.object({
  itemsGrossMinor: z.number().int().nonnegative(),
  deliveryMinor: z.number().int().nonnegative(),
  netMinor: z.number().int().nonnegative(),
  vatMinor: z.number().int().nonnegative(),
  grossMinor: z.number().int().nonnegative(),
});
export type CartTotals = z.infer<typeof CartTotalsSchema>;

/** Кошик із розрахованими цінами для сегмента. */
export const CartSchema = z.object({
  id: z.string(),
  currency: CurrencySchema,
  segment: SegmentSchema,
  deliveryMethod: DeliveryMethodSchema,
  lines: z.array(CartLineSchema),
  /** Позиції без ціни в прайс-листі сегмента — блокують оформлення, доки їх не видалено. */
  unavailable: z.array(z.object({ id: z.string(), productId: z.string(), name: z.string() })),
  totals: CartTotalsSchema,
});
export type Cart = z.infer<typeof CartSchema>;

/** Контактні дані покупця. */
export const CheckoutContactSchema = z.object({
  name: z.string().min(2, 'Вкажіть імʼя'),
  email: z.string().email('Некоректний email'),
  phone: z.string().min(7, 'Вкажіть телефон'),
});
export type CheckoutContact = z.infer<typeof CheckoutContactSchema>;

/** Оформлення замовлення з кошика. */
export const CheckoutInputSchema = z.object({
  cartId: z.string().min(1),
  deliveryMethod: DeliveryMethodSchema.default('NOVA_POSHTA'),
  contact: CheckoutContactSchema,
  /** Бажаний провайдер (для карткової гілки); за замовчуванням — за валютою. */
  provider: PaymentProviderKindSchema.optional(),
  /** Куди повернути покупця після оплати. */
  returnUrl: z.string().url(),
});
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;

/** Інструкції для клієнта щодо оплати. */
export const PaymentInstructionSchema = z.object({
  provider: PaymentProviderKindSchema,
  /** URL сторінки оплати (hosted checkout). */
  redirectUrl: z.string().optional(),
  /** Поля форми, яку треба надіслати POST-ом на redirectUrl (WayForPay/LiqPay). */
  formFields: z.record(z.string()).optional(),
  /** Реквізити рахунку (гілка INVOICE). */
  invoice: z
    .object({
      recipient: z.string(),
      recipientEdrpou: z.string(),
      iban: z.string(),
      purpose: z.string(),
      amountMinor: z.number().int().nonnegative(),
      currency: CurrencySchema,
    })
    .optional(),
});
export type PaymentInstruction = z.infer<typeof PaymentInstructionSchema>;

/** Результат оформлення замовлення. */
export const CheckoutResultSchema = z.object({
  orderId: z.string(),
  orderNumber: z.string(),
  status: OrderStatusSchema,
  flow: CheckoutFlowSchema,
  totals: CartTotalsSchema,
  payment: PaymentInstructionSchema,
});
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;
