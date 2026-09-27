import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  MachineSegment,
  PartCondition,
  PartKind,
  type CatalogFacets,
  type Product,
} from '@voltstar/types';
import { fetchFacets, fetchProducts } from '../../../lib/api';
import { ProductCard } from '../../../components/product-card';
import type { Metadata } from 'next';
import { pageMetadata } from '../../../lib/seo';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, seo] = await Promise.all([
    getTranslations({ locale, namespace: 'catalog' }),
    getTranslations({ locale, namespace: 'seo' }),
  ]);
  return pageMetadata({ locale, path: '/catalog', title: t('title'), description: seo('catalog') });
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  // Статичний рендер/ISR: мова з параметра маршруту, а не із заголовків запиту.
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations('catalog');

  const filters = {
    q: str(sp.q),
    brand: str(sp.brand),
    kind: str(sp.kind),
    condition: str(sp.condition),
    machineSegment: str(sp.machineSegment),
    machineModel: str(sp.machineModel),
    voltage: str(sp.voltage),
    inStock: str(sp.inStock),
    perPage: '24',
  };

  let products: Product[] = [];
  let facets: CatalogFacets = { brands: [], kinds: [], conditions: [], machineSegments: [] };
  try {
    const [list, f] = await Promise.all([fetchProducts(filters), fetchFacets()]);
    products = list.items;
    facets = f;
  } catch {
    // API/БД недоступні — показуємо порожній стан і фільтри з енумів.
  }

  // Порожні фасети означають, що API не відповів: показуємо повний перелік із енумів,
  // щоб фільтри лишалися робочими.
  const kindOptions = facets.kinds.length ? facets.kinds : Object.values(PartKind);
  const conditionOptions = facets.conditions.length
    ? facets.conditions
    : Object.values(PartCondition);
  const segmentOptions = facets.machineSegments.length
    ? facets.machineSegments
    : Object.values(MachineSegment);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <Link href={`/${locale}`} className="text-sm text-neutral-500 hover:underline">
        VOLTSTAR
      </Link>
      <h1 className="mt-2 mb-6 text-3xl font-bold">{t('title')}</h1>

      {/* Фасетні фільтри (GET-форма, без клієнтського JS) */}
      <form
        action={`/${locale}/catalog`}
        method="get"
        className="mb-8 grid gap-3 rounded-xl border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder={t('filters.search')}
          aria-label={t('filters.search')}
          inputMode="search"
          className="rounded border px-2 py-1 lg:col-span-3"
        />
        <select
          name="brand"
          aria-label={t('filters.brand')}
          defaultValue={filters.brand ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.brand')}: {t('filters.all')}
          </option>
          {facets.brands.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          name="kind"
          aria-label={t('filters.kind')}
          defaultValue={filters.kind ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.kind')}: {t('filters.all')}
          </option>
          {kindOptions.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
        <select
          name="condition"
          aria-label={t('filters.condition')}
          defaultValue={filters.condition ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.condition')}: {t('filters.all')}
          </option>
          {conditionOptions.map((c) => (
            <option key={c} value={c}>
              {t(`conditions.${c}`)}
            </option>
          ))}
        </select>
        <select
          name="machineSegment"
          aria-label={t('filters.machineSegment')}
          defaultValue={filters.machineSegment ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.machineSegment')}: {t('filters.all')}
          </option>
          {segmentOptions.map((m) => (
            <option key={m} value={m}>
              {t(`machineSegments.${m}`)}
            </option>
          ))}
        </select>
        <select
          name="voltage"
          aria-label={t('filters.voltage')}
          defaultValue={filters.voltage ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.voltage')}: {t('filters.all')}
          </option>
          {[12, 24, 28].map((v) => (
            <option key={v} value={v}>
              {v} {t('volt')}
            </option>
          ))}
        </select>
        {/* Модель техніки не показуємо списком — їх тисячі; вона приходить зі сторінки техніки. */}
        {filters.machineModel && (
          <input type="hidden" name="machineModel" value={filters.machineModel} />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="inStock"
            value="true"
            defaultChecked={filters.inStock === 'true'}
          />
          {t('filters.inStock')}
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-black hover:bg-yellow-300"
          >
            {t('filters.apply')}
          </button>
          <Link
            href={`/${locale}/catalog`}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm"
          >
            {t('filters.reset')}
          </Link>
        </div>
      </form>

      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-neutral-500">
          {t('empty')}
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} />
          ))}
        </div>
      )}
    </main>
  );
}
