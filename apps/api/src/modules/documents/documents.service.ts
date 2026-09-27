import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrderDocumentKind, OrderStatus } from '@voltstar/types';
import { PrismaService } from '../../prisma/prisma.service';
import { DELIVERY_NOTE_STATUSES } from '../orders/order-state';
import { buildDocumentModel, type SellerRequisites } from './document-model';
import { renderDocumentPdf } from './pdf-renderer';

export interface RenderedDocument {
  filename: string;
  content: Buffer;
}

/** Документи, доступні для замовлення на поточному статусі. */
export function availableDocuments(status: OrderStatus): OrderDocumentKind[] {
  if (status === 'CANCELLED') return [];
  return DELIVERY_NOTE_STATUSES.includes(status) ? ['invoice', 'delivery-note'] : ['invoice'];
}

/**
 * PDF-документи замовлення. Рендеряться на вимогу з незмінного знімка замовлення
 * (ціни позицій зафіксовані при оформленні), тож повторне завантаження дає той самий зміст.
 */
@Injectable()
export class DocumentsService {
  private readonly seller: SellerRequisites;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.seller = {
      name: config.get<string>('INVOICE_RECIPIENT') || 'ТОВ «ВОЛЬТСТАР»',
      edrpou: config.get<string>('INVOICE_RECIPIENT_EDRPOU') ?? '',
      iban: config.get<string>('INVOICE_IBAN') ?? '',
      address: config.get<string>('INVOICE_RECIPIENT_ADDRESS') || undefined,
    };
  }

  async render(orderNumber: string, kind: OrderDocumentKind): Promise<RenderedDocument> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      include: { items: { include: { product: true }, orderBy: { id: 'asc' } }, organization: true },
    });
    if (!order) throw new NotFoundException('Замовлення не знайдено');
    if (!availableDocuments(order.status).includes(kind)) {
      throw new BadRequestException('Документ недоступний на поточному етапі замовлення');
    }

    const model = buildDocumentModel(
      kind,
      {
        number: order.number,
        createdAt: order.createdAt,
        currency: order.currency,
        deliveryMethod: order.deliveryMethod,
        deliveryMinor: order.deliveryMinor,
        contactName: order.contactName,
        contactEmail: order.contactEmail,
        contactPhone: order.contactPhone,
        organization: order.organization
          ? { name: order.organization.name, edrpou: order.organization.edrpou }
          : null,
        items: order.items.map((i) => ({
          name: i.product.name,
          // Артикул на момент продажу; у старих замовленнях його немає — беремо поточний.
          partNumber: i.partNumberSnapshot ?? i.product.partNumber,
          quantity: i.quantity,
          unitPriceMinor: i.unitPriceMinor,
          vatRate: i.vatRate,
        })),
      },
      this.seller,
    );
    const prefix = kind === 'invoice' ? 'rakhunok' : 'nakladna';
    return { filename: `${prefix}-${order.number}.pdf`, content: await renderDocumentPdf(model) };
  }
}
