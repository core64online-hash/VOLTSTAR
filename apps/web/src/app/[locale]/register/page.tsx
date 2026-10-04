import { getTranslations, setRequestLocale } from 'next-intl/server';
import { RegisterForm } from './register-form';
import { NO_INDEX } from '../../../lib/seo';

/** Службова сторінка — не для пошукових систем. */
export const metadata = NO_INDEX;

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('account');

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{t('register.title')}</h1>
      <p className="mb-8 mt-2 text-neutral-600">{t('register.subtitle')}</p>
      <RegisterForm />
    </main>
  );
}
