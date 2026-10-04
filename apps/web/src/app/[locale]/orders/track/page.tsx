import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NO_INDEX } from '../../../../lib/seo';

/** Службова сторінка — не для пошукових систем. */
export const metadata = NO_INDEX;

/** Відстеження замовлення гостем: номер + email. Форма працює без JS (GET). */
export default async function TrackOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const sp = await searchParams;
  const number = typeof sp.number === 'string' ? sp.number.trim() : '';
  const email = typeof sp.email === 'string' ? sp.email.trim() : '';
  if (number && email) {
    redirect(`/${locale}/orders/${encodeURIComponent(number)}?email=${encodeURIComponent(email)}`);
  }

  const t = await getTranslations('orders.track');
  const field = 'mt-1 w-full rounded border border-neutral-300 px-3 py-2';

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{t('title')}</h1>
      <p className="mb-8 mt-2 text-neutral-600">{t('subtitle')}</p>
      <form action={`/${locale}/orders/track`} method="get" className="space-y-4">
        <label className="block text-sm">
          {t('number')}
          <input name="number" required defaultValue={number} placeholder="VS-20260922-A1B2C3" className={field} />
        </label>
        <label className="block text-sm">
          Email
          <input name="email" type="email" required defaultValue={email} className={field} />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-brand px-6 py-3 font-semibold text-black hover:bg-yellow-300"
        >
          {t('submit')}
        </button>
      </form>
    </main>
  );
}
