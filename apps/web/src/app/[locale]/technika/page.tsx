import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MACHINE_SEGMENT_SLUG, MachineSegment } from '@voltstar/types';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, seo] = await Promise.all([
    getTranslations({ locale, namespace: 'machines' }),
    getTranslations({ locale, namespace: 'seo' }),
  ]);
  return pageMetadata({ locale, path: '/technika', title: t('title'), description: seo('machines') });
}

/**
 * Вхід у розділ техніки. Клієнт, який не знайшов номера на агрегаті, шукає за своєю машиною —
 * і це той самий трафік, що й «стартер на МАЗ-5440» у пошуковику.
 */
export default async function MachinesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const t = await getTranslations('machines');
  const tCat = await getTranslations('catalog');

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mt-2 text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-neutral-600">{t('subtitle')}</p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {Object.values(MachineSegment).map((s) => (
          <li key={s}>
            <Link
              href={`/${locale}/technika/${MACHINE_SEGMENT_SLUG[s]}`}
              className="block rounded-xl border border-neutral-200 p-5 transition-shadow hover:shadow-md"
            >
              <span className="text-lg font-semibold">{tCat(`machineSegments.${s}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
