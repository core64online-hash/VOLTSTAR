import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { machineSegmentBySlug, type MachineBrandGroup, type Product } from '@voltstar/types';
import { fetchMachines, fetchProducts } from '../../../../../lib/api';
import { ProductCard } from '../../../../../components/product-card';
import { jsonLd, localizedUrl, pageMetadata, SITE_NAME } from '../../../../../lib/seo';

// ISR: сторінка рендериться при першому запиті й оновлюється разом із каталогом.
export const revalidate = 300;
// Порожній список: жодної сторінки під час збірки, кожна генерується при першому запиті.
export const generateStaticParams = () => [];

type Params = { params: Promise<{ locale: string; segment: string; model: string }> };

/** Марка й модель за адресою моделі; `null` — такої техніки немає або під неї немає товарів. */
async function loadModel(
  segmentSlug: string,
  modelSlug: string,
): Promise<{ brand: string; name: string } | null> {
  const value = machineSegmentBySlug(segmentSlug);
  if (!value) return null;
  let groups: MachineBrandGroup[] = [];
  try {
    groups = await fetchMachines(value);
  } catch {
    return null;
  }
  for (const g of groups) {
    const model = g.models.find((m) => m.slug === modelSlug);
    if (model) return { brand: g.brand, name: model.name };
  }
  return null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, segment, model } = await params;
  const found = await loadModel(segment, model);
  if (!found) return {};
  const t = await getTranslations({ locale, namespace: 'machines' });
  const machine = `${found.brand} ${found.name}`;
  return pageMetadata({
    locale,
    path: `/technika/${segment}/${model}`,
    title: t('modelTitle', { machine }),
    description: t('modelDescription', { machine }),
  });
}

/**
 * «Стартери й генератори на МАЗ 5440» — основний органічний трафік у цій ніші: люди шукають
 * за своєю машиною, а не за брендом агрегата. Сам перелік товарів бере той самий фільтр
 * каталогу (`machineModel`), тож друга реалізація добору не заводиться.
 */
export default async function MachinePage({ params }: Params) {
  const { locale, segment, model } = await params;
  setRequestLocale(locale);
  const found = await loadModel(segment, model);
  // Немає такої техніки або під неї немає жодного агрегата — справжній 404.
  if (!found) notFound();
  const [t, tCat] = await Promise.all([getTranslations('machines'), getTranslations('catalog')]);
  const machine = `${found.brand} ${found.name}`;

  let products: Product[] = [];
  let total = 0;
  try {
    const list = await fetchProducts({ machineModel: model, perPage: '48' });
    products = list.items;
    total = list.total;
  } catch {
    // API недоступний — показуємо порожній стан, а не сторінку помилки.
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(breadcrumbs(locale, segment, model, machine))}
      />
      <nav aria-label={tCat('breadcrumbs')} className="text-sm text-neutral-600">
        <Link href={`/${locale}/technika/${segment}`} className="hover:underline">
          ← {t('title')}
        </Link>
      </nav>
      <h1 className="mt-2 text-3xl font-bold">{t('modelTitle', { machine })}</h1>
      {total > 0 && <p className="mt-2 text-neutral-600">{t('found', { n: total })}</p>}

      {products.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-600">
          {t('empty')}
        </p>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} />
          ))}
        </div>
      )}

      <p className="mt-8 text-sm">
        {/* Крос-номер точніший за модель техніки: та сама машина йде з різними двигунами. */}
        {t('preferNumber')}{' '}
        <Link href={`/${locale}/lookup`} className="text-brand-dark underline">
          {t('preferNumberLink')}
        </Link>
      </p>
    </main>
  );
}

function breadcrumbs(locale: string, segment: string, model: string, machine: string) {
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
        name: machine,
        item: localizedUrl(locale, `/technika/${segment}/${model}`),
      },
    ],
  };
}
