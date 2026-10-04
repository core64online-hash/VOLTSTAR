import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminShell } from './admin-shell';
import { NO_INDEX } from '../../../lib/seo';

export const metadata = NO_INDEX;

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('admin');
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="mb-4 mt-2 text-3xl font-bold">{t('title')}</h1>
      <AdminShell>{children}</AdminShell>
    </main>
  );
}
