import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FuelType, PhaseType, type CatalogFacets, type Product } from '@voltstar/types';
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
    fuel: str(sp.fuel),
    phase: str(sp.phase),
    minPowerW: str(sp.minPowerW),
    maxPowerW: str(sp.maxPowerW),
    inStock: str(sp.inStock),
    perPage: '24',
  };

  let products: Product[] = [];
  let facets: CatalogFacets = { brands: [], fuels: [] };
  try {
    const [list, f] = await Promise.all([fetchProducts(filters), fetchFacets()]);
    products = list.items;
    facets = f;
  } catch {
    // API/БД недоступні — показуємо порожній стан і фільтри з енумів.
  }

  const fuelOptions = facets.fuels.length ? facets.fuels : Object.values(FuelType);

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
        className="mb-8 grid gap-3 rounded-xl border border-neutral-200 p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder={t('filters.search')}
          aria-label={t('filters.search')}
          className="rounded border px-2 py-1 lg:col-span-2"
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
          name="fuel"
          aria-label={t('filters.fuel')}
          defaultValue={filters.fuel ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.fuel')}: {t('filters.all')}
          </option>
          {fuelOptions.map((f) => (
            <option key={f} value={f}>
              {t(`fuels.${f}`)}
            </option>
          ))}
        </select>
        <select
          name="phase"
          aria-label={t('filters.phase')}
          defaultValue={filters.phase ?? ''}
          className="rounded border px-2 py-1"
        >
          <option value="">
            {t('filters.phase')}: {t('filters.all')}
          </option>
          {Object.values(PhaseType).map((p) => (
            <option key={p} value={p}>
              {t(`phases.${p}`)}
            </option>
          ))}
        </select>
        {/* Потужність — щоб фільтр, з яким прийшли зі сторінки підбору, не губився при «Застосувати». */}
        <input
          type="number"
          name="minPowerW"
          min="0"
          step="100"
          defaultValue={filters.minPowerW ?? ''}
          placeholder={t('filters.minPower')}
          aria-label={t('filters.minPower')}
          className="rounded border px-2 py-1"
        />
        <input
          type="number"
          name="maxPowerW"
          min="0"
          step="100"
          defaultValue={filters.maxPowerW ?? ''}
          placeholder={t('filters.maxPower')}
          aria-label={t('filters.maxPower')}
          className="rounded border px-2 py-1"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="inStock"
            value="true"
            defaultChecked={filters.inStock === 'true'}
          />
          {t('filters.inStock')}
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
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
