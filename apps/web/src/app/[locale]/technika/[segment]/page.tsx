import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  MACHINE_SEGMENT_SLUG,
  machineSegmentBySlug,
  type MachineBrandGroup,
} from '@voltstar/types';
import { fetchMachines } from '../../../../lib/api';
import { jsonLd, localizedUrl, pageMetadata, SITE_NAME } from '../../../../lib/seo';

// ISR: перелік техніки змінюється рідко — разом із каталогом.
export const revalidate = 300;

type Params = { params: Promise<{ locale: string; segment: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, segment } = await params;
  const value = machineSegmentBySlug(segment);
  if (!value) return {};
  const [t, tCat] = await Promise.all([
    getTranslations({ locale, namespace: 'machines' }),
    getTranslations({ locale, namespace: 'catalog' }),
  ]);
  const name = tCat(`machineSegments.${value}`);
  return pageMetadata({
    locale,
    path: `/technika/${segment}`,
    title: t('segmentTitle', { segment: name }),
    description: t('segmentDescription', { segment: name }),
  });
}

export default async function SegmentPage({ params }: Params) {
  const { locale, segment } = await params;
  setRequestLocale(locale);
  const value = machineSegmentBySlug(segment);
  // Невідома адреса — справжній 404, а не порожня сторінка в індексі.
  if (!value) notFound();
  const [t, tCat] = await Promise.all([
    getTranslations('machines'),
    getTranslations('catalog'),
  ]);
  const name = tCat(`machineSegments.${value}`);

  let groups: MachineBrandGroup[] = [];
  try {
    groups = await fetchMachines(value);
  } catch {
    // API недоступний — показуємо порожній стан, а не сторінку помилки.
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(breadcrumbs(locale, segment, name))}
      />
      <nav aria-label={tCat('breadcrumbs')} className="text-sm text-neutral-600">
        <Link href={`/${locale}/technika`} className="hover:underline">
          {t('title')}
        </Link>
      </nav>
      <h1 className="mt-2 text-3xl font-bold">{t('segmentTitle', { segment: name })}</h1>

      {groups.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-600">
          {t('empty')}
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {groups.map((g) => (
            <section key={g.brandSlug}>
              <h2 className="text-lg font-semibold">{g.brand}</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {g.models.map((m) => (
                  <li key={m.slug}>
                    <Link
                      href={`/${locale}/technika/${MACHINE_SEGMENT_SLUG[m.segment]}/${m.slug}`}
                      className="inline-block rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:border-neutral-400"
                    >
                      {m.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function breadcrumbs(locale: string, segment: string, name: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: localizedUrl(locale) },
      {
        '@type': 'ListItem',
        position: 2,
        name: locale === 'en' ? 'Machinery' : 'Техніка',
        item: localizedUrl(locale, '/technika'),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name,
        item: localizedUrl(locale, `/technika/${segment}`),
      },
    ],
  };
}
