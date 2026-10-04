import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LeadSource } from '@voltstar/types';
import { LeadForm } from '../../../components/lead-form';
import type { Metadata } from 'next';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, seo] = await Promise.all([
    getTranslations({ locale, namespace: 'reman' }),
    getTranslations({ locale, namespace: 'seo' }),
  ]);
  return pageMetadata({ locale, path: '/vidnovlennia', title: t('title'), description: seo('reman') });
}

/**
 * Відновлення — другий напрямок бізнесу поряд із продажем. Окремого обліку ремонтів тут немає
 * свідомо: на цьому етапі достатньо заявки в CRM, а не власної ERP для майстерні.
 */
export default async function RemanPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('reman');

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-neutral-600">{t('subtitle')}</p>

      <h2 className="mt-8 text-xl font-semibold">{t('steps.title')}</h2>
      <ol className="mt-4 space-y-3 text-sm">
        {(['s1', 's2', 's3', 's4'] as const).map((k, i) => (
          <li key={k} className="flex gap-3 rounded-xl border border-neutral-200 p-4">
            <span className="font-semibold text-brand-dark">{i + 1}</span>
            <span>{t(`steps.${k}`)}</span>
          </li>
        ))}
      </ol>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">{t('formTitle')}</h2>
        <p className="mt-1 text-sm text-neutral-600">{t('formHint')}</p>
        <div className="mt-4">
          <LeadForm source={LeadSource.REMAN} />
        </div>
      </section>
    </main>
  );
}
