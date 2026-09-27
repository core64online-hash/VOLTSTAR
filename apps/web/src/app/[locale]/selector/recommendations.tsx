'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { PowerCalculation, SelectorRecommendations } from '@voltstar/types';
import { fetchRecommendations } from '../../../lib/api';
import { ProductCard } from '../../../components/product-card';

/**
 * Генератори під розрахунок. Окремий запит після розрахунку: число клієнт бачить одразу,
 * а якщо каталог недоступний — лишається посилання на каталог і форма заявки, тобто
 * сторінка не ламається через збій добору.
 */
export function Recommendations({ calc }: { calc: PowerCalculation }) {
  const t = useTranslations('selector.recommend');
  const locale = useLocale();
  const [data, setData] = useState<SelectorRecommendations | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let current = true;
    setState('loading');
    fetchRecommendations(calc)
      .then((res) => {
        if (!current) return;
        setData(res);
        setState('ready');
      })
      .catch(() => {
        if (current) setState('failed');
      });
    // Скасовуємо застосування відповіді, якщо розрахунок уже змінився.
    return () => {
      current = false;
    };
  }, [calc]);

  const catalogHref = `/${locale}/catalog?phase=${calc.phase}&minPowerW=${data?.catalogQuery.minPowerW ?? calc.recommendedW}`;
  const catalogLink = (
    <Link href={catalogHref} className="text-sm font-semibold text-brand-dark hover:underline">
      {t('catalogLink')} →
    </Link>
  );

  if (state === 'loading') {
    return <p className="text-sm text-neutral-500">{t('loading')}</p>;
  }
  if (state === 'failed' || !data) {
    return <div>{catalogLink}</div>;
  }

  const nothing = data.exact.length === 0 && data.close.length === 0;

  return (
    <div className="space-y-6">
      {data.exact.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('title')}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.exact.map((p) => (
              <ProductCard key={p.id} product={p} locale={locale} />
            ))}
          </div>
        </section>
      )}

      {data.close.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">{t('closeTitle')}</h2>
          <p className="mb-3 text-sm text-neutral-600">{t('closeHint')}</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.close.map((p) => (
              <ProductCard key={p.id} product={p} locale={locale} />
            ))}
          </div>
        </section>
      )}

      {nothing && (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-600">
          {t('empty')}
        </p>
      )}

      {catalogLink}
    </div>
  );
}
