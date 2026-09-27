import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Product } from '@voltstar/types';
import { formatPrice } from '../lib/api';

/**
 * Картка товару — спільна для каталогу й рекомендацій підбору, щоб два списки не розʼїхалися
 * виглядом. Працює і в серверному рендері, і в клієнтському (next-intl підтримує обидва).
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
      <span className="mt-2 text-sm text-neutral-600">
        {t('power')}: {(product.ratedPowerW / 1000).toFixed(1)} кВт · {t('fuel')}:{' '}
        {t(`fuels.${product.fuel}`)}
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
