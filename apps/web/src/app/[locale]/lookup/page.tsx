import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LeadSource, type LookupResult } from '@voltstar/types';
import { lookupByNumber } from '../../../lib/api';
import { NumberSearch } from '../../../components/number-search';
import { ProductCard } from '../../../components/product-card';
import { LeadForm } from '../../../components/lead-form';
import { pageMetadata } from '../../../lib/seo';

/** Результат залежить від запиту й від наявності на складі — кешувати сторінку нема сенсу. */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, seo] = await Promise.all([
    getTranslations({ locale, namespace: 'lookup' }),
    getTranslations({ locale, namespace: 'seo' }),
  ]);
  // Сторінка результатів пошуку не має потрапляти в індекс: адрес стільки ж, скільки номерів.
  return {
    ...pageMetadata({ locale, path: '/lookup', title: t('title'), description: seo('lookup') }),
    robots: { index: false, follow: true },
  };
}

export default async function LookupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const number = (str((await searchParams).number) ?? '').trim();
  const t = await getTranslations('lookup');

  let result: LookupResult | null = null;
  let failed = false;
  if (number) {
    try {
      result = await lookupByNumber(number);
    } catch {
      // API недоступний або номер закороткий — показуємо форму й чесне повідомлення.
      failed = true;
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mt-2 mb-6 text-3xl font-bold">{t('title')}</h1>

      <NumberSearch locale={locale} defaultValue={number} />

      {number && (
        <section className="mt-10">
          {failed || !result ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-600">
              {t('failed')}
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-neutral-600">
                {result.match === 'exact' && t('exact', { number })}
                {result.match === 'fuzzy' && t('fuzzy', { number })}
                {result.match === 'none' && t('none', { number })}
              </p>

              {result.items.length > 0 ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {result.items.map((p) => (
                    <ProductCard key={p.id} product={p} locale={locale} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-neutral-200 p-6">
                  {/* Не підсовуємо «схоже»: не той стартер гірший, ніж жоден. Натомість — заявка. */}
                  <p className="text-neutral-700">{t('noneHint')}</p>
                  <div className="mt-6">
                    <LeadForm source={LeadSource.PART_REQUEST} payload={{ number }} />
                  </div>
                </div>
              )}

              <p className="mt-6 text-sm">
                <Link href={`/${locale}/catalog`} className="text-brand-dark underline">
                  {t('browseCatalog')}
                </Link>
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
