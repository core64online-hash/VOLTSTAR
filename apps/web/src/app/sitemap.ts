import type { MetadataRoute } from 'next';
import type { Product } from '@voltstar/types';
import { routing } from '../i18n/routing';
import { apiUrl, serverHeaders } from '../lib/api';
import { localizedUrl } from '../lib/seo';

// Карта сайту перебудовується щогодини (нові товари з адмінки потрапляють у неї автоматично).
export const revalidate = 3600;

const STATIC_PAGES: {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
}[] = [
  { path: '', priority: 1, changeFrequency: 'weekly' },
  { path: '/catalog', priority: 0.9, changeFrequency: 'daily' },
  { path: '/vidnovlennia', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/business', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
];

const languagesFor = (path: string) =>
  Object.fromEntries(routing.locales.map((l) => [l, localizedUrl(l, path)]));

/** Усі товари каталогу (сторінками по 100). Якщо API недоступний — карта без товарів, а не помилка. */
async function allProducts(): Promise<Product[]> {
  const out: Product[] = [];
  try {
    for (let page = 1; page <= 100; page++) {
      const res = await fetch(apiUrl(`/catalog/products?perPage=100&page=${page}`), {
        headers: serverHeaders(),
        next: { revalidate },
      });
      if (!res.ok) break;
      const data = (await res.json()) as { items: Product[]; total: number };
      out.push(...data.items);
      if (out.length >= data.total || data.items.length === 0) break;
    }
  } catch {
    /* API недоступний під час генерації */
  }
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await allProducts();
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of routing.locales) {
    for (const p of STATIC_PAGES) {
      entries.push({
        url: localizedUrl(locale, p.path),
        changeFrequency: p.changeFrequency,
        priority: p.priority,
        alternates: { languages: languagesFor(p.path) },
      });
    }
    for (const product of products) {
      const path = `/catalog/${product.slug}`;
      entries.push({
        url: localizedUrl(locale, path),
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: languagesFor(path) },
      });
    }
  }
  return entries;
}
