import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccountView } from './account-view';
import { NO_INDEX } from '../../../lib/seo';

/** Службова сторінка — не для пошукових систем. */
export const metadata = NO_INDEX;

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('account');

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{t('profile.title')}</h1>
      <p className="mb-8 mt-2 text-neutral-600">{t('profile.subtitle')}</p>
      <AccountView />
    </main>
  );
}
