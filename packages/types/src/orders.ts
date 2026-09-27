import { z } from 'zod';
import { PasswordSchema } from './accounts';
import { DeliveryMethodSchema } from './checkout';
import {
  CurrencySchema,
  OrderStatusSchema,
  type OrderStatus,
  PaymentProviderKindSchema,
  SegmentSchema,
} from './enums';

/** Документи замовлення, доступні для завантаження (PDF). */
export const OrderDocumentKind = {
  INVOICE: 'invoice', // рахунок-фактура
  DELIVERY_NOTE: 'delivery-note', // видаткова накладна
} as const;
export const OrderDocumentKindSchema = z.nativeEnum(OrderDocumentKind);
export type OrderDocumentKind = (typeof OrderDocumentKind)[keyof typeof OrderDocumentKind];

/** Коротке подання замовлення для списків. */
export const OrderSummarySchema = z.object({
  number: z.string(),
  status: OrderStatusSchema,
  segment: SegmentSchema,
  currency: CurrencySchema,
  totalMinor: z.number().int().nonnegative(),
  itemsCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

/**
 * Ручні переходи, доступні менеджеру. Оплату (→ PAID) виставляють вебхуки та звірка
 * рахунку, а не ця таблиця. Оплачене замовлення не скасовують — лише повертають кошти.
 */
export const MANUAL_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['CANCELLED'],
  PENDING_PAYMENT: ['CANCELLED'],
  INVOICED: ['CANCELLED'],
  PAID: ['PROCESSING', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'REFUNDED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

/** Рядок списку замовлень для персоналу — з контактом покупця. */
export const StaffOrderSummarySchema = OrderSummarySchema.extend({
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  organization: z.string().nullable(),
});
export type StaffOrderSummary = z.infer<typeof StaffOrderSummarySchema>;

/** Повне подання замовлення: позиції, оплати, історія статусів, документи. */
export const OrderDetailSchema = OrderSummarySchema.extend({
  vatMinor: z.number().int().nonnegative(),
  deliveryMethod: DeliveryMethodSchema,
  deliveryMinor: z.number().int().nonnegative(),
  contact: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  organization: z.object({ name: z.string(), edrpou: z.string().nullable() }).nullable(),
  items: z.array(
    z.object({
      productId: z.string(),
      slug: z.string(),
      name: z.string(),
      /** Артикул на момент продажу — у відновлених агрегатів номер із часом змінюється. */
      partNumber: z.string(),
      quantity: z.number().int().positive(),
      unitPriceMinor: z.number().int().nonnegative(),
      vatRate: z.number(),
      totalMinor: z.number().int().nonnegative(),
    }),
  ),
  payments: z.array(
    z.object({
      provider: PaymentProviderKindSchema,
      status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']),
      amountMinor: z.number().int().nonnegative(),
    }),
  ),
  events: z.array(
    z.object({
      from: OrderStatusSchema.nullable(),
      to: OrderStatusSchema,
      note: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  /** Які документи можна завантажити на поточному етапі. */
  documents: z.array(OrderDocumentKindSchema),
});
export type OrderDetail = z.infer<typeof OrderDetailSchema>;

/** Пошук замовлення гостем: номер + email із замовлення. */
export const OrderLookupSchema = z.object({
  number: z.string().min(1),
  email: z.string().email(),
});
export type OrderLookupInput = z.infer<typeof OrderLookupSchema>;

/** Ручна зміна статусу менеджером. */
export const ChangeOrderStatusSchema = z.object({
  status: OrderStatusSchema,
  note: z.string().max(500).optional(),
});
export type ChangeOrderStatusInput = z.infer<typeof ChangeOrderStatusSchema>;

/** Список замовлень для менеджера. */
export const ManageOrdersQuerySchema = z.object({
  status: OrderStatusSchema.optional(),
  /** Пошук за номером, email, імʼям або організацією. */
  q: z.string().trim().max(100).optional(),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(25),
});
export type ManageOrdersQuery = z.infer<typeof ManageOrdersQuerySchema>;

/** Запит на скидання паролю (відповідь однакова незалежно від існування email). */
export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
  locale: z.enum(['uk', 'en']).default('uk'),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

/** Встановлення нового паролю за токеном із листа. */
export const ResetPasswordSchema = z.object({
  token: z.string().min(20),
  password: PasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
