import { z } from 'zod';

/** Ринковий сегмент клієнта — визначає флоу, ціни та документообіг. */
export const Segment = {
  B2C: 'B2C',
  B2B: 'B2B',
  B2G: 'B2G',
} as const;
export const SegmentSchema = z.nativeEnum(Segment);
export type Segment = (typeof Segment)[keyof typeof Segment];

/** Тип організації. */
export const OrgType = {
  INDIVIDUAL: 'INDIVIDUAL',
  BUSINESS: 'BUSINESS',
  GOVERNMENT: 'GOVERNMENT',
} as const;
export const OrgTypeSchema = z.nativeEnum(OrgType);
export type OrgType = (typeof OrgType)[keyof typeof OrgType];

/** Ролі користувачів (RBAC). */
export const Role = {
  GUEST: 'GUEST',
  CUSTOMER: 'CUSTOMER',
  MANAGER: 'MANAGER',
  ADMIN: 'ADMIN',
} as const;
export const RoleSchema = z.nativeEnum(Role);
export type Role = (typeof Role)[keyof typeof Role];

/** Валюти. */
export const Currency = {
  UAH: 'UAH',
  USD: 'USD',
  EUR: 'EUR',
} as const;
export const CurrencySchema = z.nativeEnum(Currency);
export type Currency = (typeof Currency)[keyof typeof Currency];

/** Стани замовлення (машина станів). */
export const OrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  INVOICED: 'INVOICED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export const OrderStatusSchema = z.nativeEnum(OrderStatus);
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Платіжні провайдери. */
export const PaymentProviderKind = {
  WAYFORPAY: 'WAYFORPAY',
  LIQPAY: 'LIQPAY',
  STRIPE: 'STRIPE',
  BANK_INVOICE: 'BANK_INVOICE',
} as const;
export const PaymentProviderKindSchema = z.nativeEnum(PaymentProviderKind);
export type PaymentProviderKind =
  (typeof PaymentProviderKind)[keyof typeof PaymentProviderKind];

/** Стадії угоди у CRM-воронці. */
export const DealStage = {
  NEW: 'NEW',
  QUALIFIED: 'QUALIFIED',
  PROPOSAL: 'PROPOSAL',
  NEGOTIATION: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export const DealStageSchema = z.nativeEnum(DealStage);
export type DealStage = (typeof DealStage)[keyof typeof DealStage];

// ──────────────── Домен: стартери й генератори до техніки ────────────────

/** Що саме продаємо: агрегат у зборі, його вузол чи ремкомплект. */
export const PartKind = {
  STARTER: 'STARTER',
  ALTERNATOR: 'ALTERNATOR',
  COMPONENT: 'COMPONENT',
  REPAIR_KIT: 'REPAIR_KIT',
} as const;
export const PartKindSchema = z.nativeEnum(PartKind);
export type PartKind = (typeof PartKind)[keyof typeof PartKind];

/** Стан агрегата. EXCHANGE — відновлений в обмін на старий, із заставою за обмінний фонд. */
export const PartCondition = {
  NEW: 'NEW',
  REMANUFACTURED: 'REMANUFACTURED',
  EXCHANGE: 'EXCHANGE',
} as const;
export const PartConditionSchema = z.nativeEnum(PartCondition);
export type PartCondition = (typeof PartCondition)[keyof typeof PartCondition];

/** Напрямок обертання з боку привода. */
export const Rotation = {
  CW: 'CW',
  CCW: 'CCW',
} as const;
export const RotationSchema = z.nativeEnum(Rotation);
export type Rotation = (typeof Rotation)[keyof typeof Rotation];

/** Групи техніки, які обслуговує компанія. */
export const MachineSegment = {
  TRUCK: 'TRUCK',
  CONSTRUCTION: 'CONSTRUCTION',
  AGRICULTURAL: 'AGRICULTURAL',
  MILITARY: 'MILITARY',
} as const;
export const MachineSegmentSchema = z.nativeEnum(MachineSegment);
export type MachineSegment = (typeof MachineSegment)[keyof typeof MachineSegment];
