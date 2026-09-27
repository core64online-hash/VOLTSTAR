import { z } from 'zod';
import { CurrencySchema, DealStageSchema, OrgTypeSchema, RoleSchema, SegmentSchema } from './enums';
import { LeadStatusSchema } from './crm';
import { imageUrlField, powerWField, slugField } from './fields';
import { FuelTypeSchema, PhaseTypeSchema } from './selector';

// Обмеження полів каталогу — спільні з масовим імпортом, див. ./fields.
const slug = slugField;

// ─────────────────────────── Каталог ───────────────────────────

const imageUrl = imageUrlField;

export const ProductSpecInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
});

/** Створення товару з адмін-панелі. */
export const AdminProductInputSchema = z
  .object({
    slug,
    name: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).optional(),
    brandId: z.string().min(1),
    categoryId: z.string().min(1),
    fuel: FuelTypeSchema,
    phase: PhaseTypeSchema,
    ratedPowerW: powerWField,
    maxPowerW: powerWField,
    images: z.array(imageUrl).max(20).default([]),
    specs: z.array(ProductSpecInputSchema).max(100).default([]),
    stock: z.number().int().nonnegative().default(0),
  })
  .refine((p) => p.maxPowerW >= p.ratedPowerW, {
    message: 'Пікова потужність не може бути меншою за номінальну',
    path: ['maxPowerW'],
  });
export type AdminProductInput = z.infer<typeof AdminProductInputSchema>;

/** Редагування: будь-яка підмножина полів (specs, якщо передано, замінюються повністю). */
export const AdminProductUpdateSchema = z
  .object({
    slug: slug.optional(),
    name: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    brandId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    fuel: FuelTypeSchema.optional(),
    phase: PhaseTypeSchema.optional(),
    ratedPowerW: powerWField.optional(),
    maxPowerW: powerWField.optional(),
    images: z.array(imageUrl).max(20).optional(),
    specs: z.array(ProductSpecInputSchema).max(100).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'Немає змін' });
export type AdminProductUpdate = z.infer<typeof AdminProductUpdateSchema>;

export const SetPriceSchema = z.object({
  amountMinor: z.number().int().nonnegative().max(100_000_000_00),
  vatRate: z.number().min(0).max(1).default(0.2),
});
export type SetPriceInput = z.infer<typeof SetPriceSchema>;

export const SetStockSchema = z.object({ quantity: z.number().int().nonnegative().max(1_000_000) });

export const AdminProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  brand: z.object({ id: z.string(), name: z.string() }),
  category: z.object({ id: z.string(), name: z.string() }),
  fuel: FuelTypeSchema,
  phase: PhaseTypeSchema,
  ratedPowerW: z.number().int(),
  maxPowerW: z.number().int(),
  images: z.array(z.string()),
  specs: z.array(ProductSpecInputSchema),
  stock: z.number().int(),
  prices: z.array(
    z.object({
      priceListId: z.string(),
      priceList: z.string(),
      segment: SegmentSchema,
      currency: CurrencySchema,
      amountMinor: z.number().int(),
      vatRate: z.number(),
    }),
  ),
  updatedAt: z.string(),
});
export type AdminProduct = z.infer<typeof AdminProductSchema>;

/** Довідники для форм: бренди, категорії, прайс-листи. */
export const CatalogRefsSchema = z.object({
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
  priceLists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      segment: SegmentSchema,
      currency: CurrencySchema,
      active: z.boolean(),
    }),
  ),
});
export type CatalogRefs = z.infer<typeof CatalogRefsSchema>;

// ─────────────────────── Користувачі й організації ───────────────────────

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  role: RoleSchema,
  organization: z
    .object({
      id: z.string(),
      name: z.string(),
      edrpou: z.string().nullable(),
      verified: z.boolean(),
    })
    .nullable(),
  ordersCount: z.number().int(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

/** Роль, яку може призначити адміністратор (GUEST — лише для анонімів). */
export const SetRoleSchema = z.object({ role: z.enum(['CUSTOMER', 'MANAGER', 'ADMIN']) });

export const AdminOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: OrgTypeSchema,
  segment: SegmentSchema,
  edrpou: z.string().nullable(),
  verified: z.boolean(),
  users: z.array(z.object({ id: z.string(), email: z.string() })),
  createdAt: z.string(),
});
export type AdminOrganization = z.infer<typeof AdminOrganizationSchema>;

export const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    perPage: z.number().int(),
  });
export type Page<T> = { items: T[]; total: number; page: number; perPage: number };

export const AdminListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(25),
});

// ─────────────────────────── Аудит ───────────────────────────

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  actor: z.object({ id: z.string(), email: z.string() }).nullable(),
  data: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.string().max(100).optional(),
  action: z.string().max(60).optional(),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(50),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

// ─────────────────────────── Аналітика ───────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата у форматі РРРР-ММ-ДД');

/** Період звіту — включно з обома датами (за Києвом). За замовчуванням останні 30 днів. */
export const AnalyticsQuerySchema = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Початок періоду пізніше за кінець',
    path: ['from'],
  });
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

export const AnalyticsSchema = z.object({
  period: z.object({ from: isoDate, to: isoDate }),
  currency: CurrencySchema,
  sales: z.object({
    /** Надходження: замовлення, оплачені в періоді (за датою оплати), мінус повернення в періоді. */
    revenueMinor: z.number().int(),
    refundsMinor: z.number().int(),
    paidOrders: z.number().int(),
    placedOrders: z.number().int(),
    averageOrderMinor: z.number().int(),
    /** Частка оформлених у періоді замовлень, які вже оплачено. */
    paymentRate: z.number(),
    bySegment: z.array(
      z.object({
        segment: SegmentSchema,
        revenueMinor: z.number().int(),
        orders: z.number().int(),
      }),
    ),
    byDay: z.array(
      z.object({ date: isoDate, revenueMinor: z.number().int(), orders: z.number().int() }),
    ),
    topProducts: z.array(
      z.object({
        productId: z.string(),
        name: z.string(),
        quantity: z.number().int(),
        revenueMinor: z.number().int(),
      }),
    ),
  }),
  funnel: z.object({
    leads: z.array(z.object({ status: LeadStatusSchema, count: z.number().int() })),
    leadsTotal: z.number().int(),
    dealsCreated: z.number().int(),
    won: z.object({ count: z.number().int(), amountMinor: z.number().int() }),
    lost: z.object({ count: z.number().int(), amountMinor: z.number().int() }),
    /** Виграні / (виграні + програні) серед закритих у періоді. */
    winRate: z.number(),
    openPipeline: z.array(
      z.object({ stage: DealStageSchema, count: z.number().int(), amountMinor: z.number().int() }),
    ),
  }),
  selector: z.object({
    runs: z.number().int(),
    leads: z.number().int(),
    deals: z.number().int(),
    /** Заявки з форми підбору / розрахунки. */
    leadRate: z.number(),
  }),
});
export type Analytics = z.infer<typeof AnalyticsSchema>;
