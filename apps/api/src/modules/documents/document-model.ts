import type { Currency, DeliveryMethod, OrderDocumentKind } from '@voltstar/types';
import { splitGross } from '../pricing/pricing.math';
import { DELIVERY_VAT_RATE } from '../cart/cart.math';
import { uahAmountInWords } from './amount-in-words';

export interface SellerRequisites {
  name: string;
  edrpou: string;
  iban: string;
  address?: string;
}

/** Знімок замовлення, потрібний для документа (незмінний після оформлення). */
export interface OrderSnapshot {
  number: string;
  createdAt: Date;
  currency: Currency;
  deliveryMethod: DeliveryMethod;
  deliveryMinor: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  organization: { name: string; edrpou: string | null } | null;
  items: Array<{
    name: string;
    /** Артикул: у документі йде поряд із назвою, інакше по рахунку не звірити, що саме продали. */
    partNumber?: string;
    quantity: number;
    unitPriceMinor: number;
    vatRate: number;
  }>;
}

export interface DocumentRow {
  index: number;
  name: string;
  quantity: number;
  unitNetMinor: number;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
}

export interface DocumentModel {
  kind: OrderDocumentKind;
  title: string;
  number: string;
  date: Date;
  currency: Currency;
  seller: SellerRequisites;
  buyer: { name: string; edrpou: string | null; contact: string };
  rows: DocumentRow[];
  totals: { netMinor: number; vatMinor: number; grossMinor: number };
  /** Сума прописом — лише для гривні. */
  amountInWords: string | null;
}

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: 'Самовивіз',
  NOVA_POSHTA: 'Доставка «Нова пошта»',
  COURIER: 'Курʼєрська доставка',
};

/**
 * Будує рядки й підсумки документа. Ціни в замовленні зберігаються з ПДВ;
 * у документі показуємо нетто за одиницю, суму без ПДВ, ПДВ і разом — як заведено
 * в українських рахунках. Доставка — окремим рядком.
 */
export function buildDocumentModel(
  kind: OrderDocumentKind,
  order: OrderSnapshot,
  seller: SellerRequisites,
): DocumentModel {
  const lines = order.items.map((i) => ({
    name: i.partNumber ? `${i.name} (арт. ${i.partNumber})` : i.name,
    quantity: i.quantity,
    gross: i.unitPriceMinor,
    vat: i.vatRate,
  }));
  if (order.deliveryMinor > 0) {
    lines.push({ name: DELIVERY_LABEL[order.deliveryMethod], quantity: 1, gross: order.deliveryMinor, vat: DELIVERY_VAT_RATE });
  }

  const rows: DocumentRow[] = lines.map((l, idx) => {
    const b = splitGross({ unitGrossMinor: l.gross, vatRate: l.vat, quantity: l.quantity });
    return {
      index: idx + 1,
      name: l.name,
      quantity: l.quantity,
      unitNetMinor: Math.round(l.gross / (1 + l.vat)),
      ...b,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      netMinor: acc.netMinor + r.netMinor,
      vatMinor: acc.vatMinor + r.vatMinor,
      grossMinor: acc.grossMinor + r.grossMinor,
    }),
    { netMinor: 0, vatMinor: 0, grossMinor: 0 },
  );

  const contact = [order.contactName, order.contactPhone, order.contactEmail].filter(Boolean).join(', ');
  return {
    kind,
    title: kind === 'invoice' ? 'Рахунок-фактура' : 'Видаткова накладна',
    number: order.number,
    date: order.createdAt,
    currency: order.currency,
    seller,
    buyer: {
      name: order.organization?.name ?? order.contactName ?? 'Фізична особа',
      edrpou: order.organization?.edrpou ?? null,
      contact,
    },
    rows,
    totals,
    amountInWords: order.currency === 'UAH' ? uahAmountInWords(totals.grossMinor) : null,
  };
}
