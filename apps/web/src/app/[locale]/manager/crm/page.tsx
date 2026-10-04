import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CrmView } from './crm-view';
import { NO_INDEX } from '../../../../lib/seo';

/** Службова сторінка — не для пошукових систем. */
export const metadata = NO_INDEX;

export default async function CrmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('crm');

  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="mb-6 mt-2 text-3xl font-bold">{t('title')}</h1>
      <CrmView />
    </main>
  );
}
