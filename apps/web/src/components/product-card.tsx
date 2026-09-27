import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Product } from '@voltstar/types';
import { formatPrice } from '../lib/api';

/**
 * Картка агрегата — спільна для каталогу, результатів пошуку по номеру й сторінок техніки,
 * щоб списки не розʼїхалися виглядом. Артикул на видноті: клієнт звіряє саме його.
 * Працює і в серверному рендері, і в клієнтському (next-intl підтримує обидва).
 */
export function ProductCard({ product, locale }: { product: Product; locale: string }) {
  const t = useTranslations('catalog');
  const price = product.prices[0];

  return (
    <Link
      href={`/${locale}/catalog/${product.slug}`}
      className="flex flex-col rounded-xl border border-neutral-200 p-5 transition-shadow hover:shadow-md"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {product.brand}
      </span>
      <span className="mt-1 text-lg font-semibold">{product.name}</span>
      <span className="mt-1 font-mono text-sm text-neutral-700">{product.partNumber}</span>
      <span className="mt-2 text-sm text-neutral-600">
        {t(`kinds.${product.kind}`)} · {t(`conditions.${product.condition}`)}
        {product.voltage ? ` · ${product.voltage} ${t('volt')}` : ''}
      </span>
      <span className="mt-3 text-sm">
        {product.inStock ? (
          <span className="text-green-700">{t('inStock')}</span>
        ) : (
          <span className="text-neutral-500">{t('outOfStock')}</span>
        )}
      </span>
      {price && (
        <span className="mt-3 text-lg font-bold text-brand-dark">
          {t('from')} {formatPrice(price.amountMinor, price.currency, `${locale}-UA`)}
        </span>
      )}
    </Link>
  );
}
