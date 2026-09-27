import { z } from 'zod';
import { CurrencySchema, DealStageSchema, SegmentSchema } from './enums';

/** Статус ліда. */
export const LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  CONVERTED: 'CONVERTED',
  DISQUALIFIED: 'DISQUALIFIED',
} as const;
export const LeadStatusSchema = z.nativeEnum(LeadStatus);
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

/** Звідки прийшов лід. */
export const LeadSource = {
  /** Пошук по крос-номеру не дав результату — клієнт залишив номер. */
  PART_REQUEST: 'part-request',
  /** Товар є в каталозі, але ціни на нього ще немає — клієнт просить назвати. */
  PRICE_REQUEST: 'price-request',
  /** Заявка на відновлення свого агрегата. */
  REMAN: 'reman',
  B2B_REQUEST: 'b2b-request',
  B2G_REQUEST: 'b2g-request',
  CONTACT: 'contact',
} as const;
export const LeadSourceSchema = z.nativeEnum(LeadSource);
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const ActivityTypeSchema = z.enum(['call', 'email', 'meeting', 'note']);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

/**
 * Публічна заявка (форма підбору, запит для бізнесу/держсектору).
 * `website` — пастка для ботів: людина його не бачить і не заповнює.
 */
export const CreateLeadSchema = z
  .object({
    source: LeadSourceSchema,
    name: z.string().trim().min(2, 'Вкажіть імʼя').max(120),
    email: z.string().trim().email('Некоректний email').optional().or(z.literal('').transform(() => undefined)),
    phone: z.string().trim().max(32).optional().or(z.literal('').transform(() => undefined)),
    companyName: z.string().trim().max(200).optional(),
    edrpou: z.string().trim().regex(/^\d{8}$/, 'ЄДРПОУ — 8 цифр').optional().or(z.literal('').transform(() => undefined)),
    message: z.string().trim().max(2000).optional(),
    payload: z.record(z.unknown()).optional(),
    website: z.string().max(0, 'spam').optional(),
  })
  .refine((v) => !!v.email || !!v.phone, { message: 'Вкажіть телефон або email', path: ['phone'] });
export type CreateLeadInput = z.infer<typeof CreateLeadSchema>;

export const LeadSchema = z.object({
  id: z.string(),
  source: z.string(),
  status: LeadStatusSchema,
  segment: SegmentSchema,
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyName: z.string().nullable(),
  edrpou: z.string().nullable(),
  message: z.string().nullable(),
  owner: z.object({ id: z.string(), email: z.string() }).nullable(),
  dealId: z.string().nullable(),
  createdAt: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const UpdateLeadSchema = z.object({
  status: LeadStatusSchema.optional(),
  ownerId: z.string().optional(),
});
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>;

export const ConvertLeadSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  amountMinor: z.number().int().nonnegative().default(0),
});
export type ConvertLeadInput = z.infer<typeof ConvertLeadSchema>;

export const DealSchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: DealStageSchema,
  amountMinor: z.number().int().nonnegative(),
  currency: CurrencySchema,
  lostReason: z.string().nullable(),
  company: z.object({ id: z.string(), name: z.string(), edrpou: z.string().nullable() }).nullable(),
  contact: z.object({ id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  owner: z.object({ id: z.string(), email: z.string() }).nullable(),
  orderNumber: z.string().nullable(),
  leadId: z.string().nullable(),
  updatedAt: z.string(),
});
export type Deal = z.infer<typeof DealSchema>;

/** Колонка канбану: стадія, угоди, сума й кількість. */
export const PipelineSchema = z.object({
  stages: z.array(
    z.object({
      stage: DealStageSchema,
      count: z.number().int().nonnegative(),
      totalMinor: z.number().int().nonnegative(),
      deals: z.array(DealSchema),
    }),
  ),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

export const CreateDealSchema = z.object({
  title: z.string().trim().min(2).max(200),
  amountMinor: z.number().int().nonnegative().default(0),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
});
export type CreateDealInput = z.infer<typeof CreateDealSchema>;

export const ChangeDealStageSchema = z.object({
  stage: DealStageSchema,
  lostReason: z.string().trim().max(500).optional(),
});
export type ChangeDealStageInput = z.infer<typeof ChangeDealStageSchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.string().nullable(),
  author: z.string().nullable(),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const CreateActivitySchema = z
  .object({
    type: ActivityTypeSchema,
    content: z.string().trim().min(1).max(5000),
    dealId: z.string().optional(),
    leadId: z.string().optional(),
  })
  .refine((v) => !!v.dealId !== !!v.leadId, { message: 'Вкажіть або dealId, або leadId', path: ['dealId'] });
export type CreateActivityInput = z.infer<typeof CreateActivitySchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueAt: z.string().nullable(),
  done: z.boolean(),
  overdue: z.boolean(),
  assignee: z.object({ id: z.string(), email: z.string() }).nullable(),
  dealId: z.string().nullable(),
  leadId: z.string().nullable(),
});
export type CrmTask = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(2).max(300),
  dueAt: z.string().datetime({ offset: true }).optional(),
  dealId: z.string().optional(),
  leadId: z.string().optional(),
  assigneeId: z.string().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({ done: z.boolean() });

/** Деталі угоди з історією комунікацій і задачами. */
export const DealDetailSchema = DealSchema.extend({
  activities: z.array(ActivitySchema),
  tasks: z.array(TaskSchema),
});
export type DealDetail = z.infer<typeof DealDetailSchema>;
