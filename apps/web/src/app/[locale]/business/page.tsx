import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LeadSource } from '@voltstar/types';
import { LeadForm } from '../../../components/lead-form';
import type { Metadata } from 'next';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [t, seo] = await Promise.all([getTranslations({ locale, namespace: 'business' }), getTranslations({ locale, namespace: 'seo' })]);
  return pageMetadata({ locale, path: '/business', title: t('title'), description: seo('business') });
}


export default async function BusinessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('business');

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-neutral-600">{t('subtitle')}</p>
      <ul className="my-6 grid gap-3 text-sm sm:grid-cols-3">
        {(['pricing', 'invoice', 'tender'] as const).map((k) => (
          <li key={k} className="rounded-xl border border-neutral-200 p-4">
            {t(`benefits.${k}`)}
          </li>
        ))}
      </ul>
      <LeadForm source={LeadSource.B2B_REQUEST} business />
    </main>
  );
}
