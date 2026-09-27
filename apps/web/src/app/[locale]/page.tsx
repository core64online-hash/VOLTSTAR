import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountDeletedNotice } from '../../components/account-deleted-notice';
import { NumberSearch } from '../../components/number-search';
import { jsonLd, localizedUrl, pageMetadata, SITE_NAME, SITE_URL } from '../../lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return pageMetadata({ locale, path: '', title: t('title'), description: t('description'), absoluteTitle: true });
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const tMeta = await getTranslations('meta');
  const t = await getTranslations('hero');
  const tSeg = await getTranslations('segments');
  const tFeat = await getTranslations('features');
  const tNav = await getTranslations('nav');

  const p = (path: string) => `/${locale}${path}`;

  return (
    <main className="min-h-screen">
      <Suspense fallback={null}>
        <AccountDeletedNotice />
      </Suspense>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: SITE_NAME,
            url: SITE_URL,
            logo: `${SITE_URL}/icon.svg`,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: SITE_NAME,
            url: localizedUrl(locale),
            inLanguage: locale,
            description: tMeta('description'),
            potentialAction: {
              '@type': 'SearchAction',
              target: `${localizedUrl(locale, '/lookup')}?number={search_term_string}`,
              'query-input': 'required name=search_term_string',
            },
          },
        ])}
      />
      {/* Hero */}
      <section className="bg-neutral-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-24 text-center">
          <p className="mb-3 text-sm font-semibold tracking-widest text-brand">VOLTSTAR</p>
          <h1 className="text-4xl font-bold sm:text-5xl">{t('title')}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-neutral-300">{t('subtitle')}</p>
          {/* Пошук по номеру — головний, а не один із рівноправних розділів: клієнт приходить
              із номером на руках, і все інше йому потрібно вже потім. */}
          <div className="mt-8">
            <NumberSearch locale={locale} />
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={p('/catalog')}
              className="rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300"
            >
              {t('ctaCatalog')}
            </Link>
            <Link
              href={p('/technika')}
              className="rounded-lg border border-neutral-600 px-6 py-3 font-semibold hover:bg-neutral-800"
            >
              {tNav('machines')}
            </Link>
            <Link
              href={p('/vidnovlennia')}
              className="rounded-lg border border-neutral-600 px-6 py-3 font-semibold hover:bg-neutral-800"
            >
              {tNav('reman')}
            </Link>
            <Link
              href={p('/business')}
              className="rounded-lg border border-neutral-600 px-6 py-3 font-semibold hover:bg-neutral-800"
            >
              {tNav('b2b')}
            </Link>
            <Link
              href={p('/account')}
              className="rounded-lg border border-neutral-600 px-6 py-3 font-semibold hover:bg-neutral-800"
            >
              {tNav('account')}
            </Link>
            <Link
              href={p('/cart')}
              className="rounded-lg border border-neutral-600 px-6 py-3 font-semibold hover:bg-neutral-800"
            >
              {tNav('cart')}
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[tFeat('lookup'), tFeat('reman'), tFeat('payment'), tFeat('crm')].map((f) => (
            <div key={f} className="rounded-xl border border-neutral-200 p-5">
              <p className="font-medium">{f}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Segments B2C / B2B / B2G */}
      <section className="bg-neutral-50">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="mb-8 text-2xl font-bold">{tSeg('title')}</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {(['b2c', 'b2b', 'b2g'] as const).map((s) => (
              <div key={s} className="rounded-xl bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold">{tSeg(`${s}.title`)}</h3>
                <p className="mt-2 text-sm text-neutral-600">{tSeg(`${s}.text`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
